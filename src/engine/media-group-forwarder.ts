import { unlink } from "node:fs/promises";
import type { AppConfig } from "@/config/schema";
import type { DownloadResult } from "@/plugins/types";
import type { TelegramUserClient } from "@/engine/user-client";
import type { NormalizedMessage, TaskNode } from "@/types/download";
import { logger } from "@/utils/logger";
import { registerTaskCancellation } from "@/engine/task-cancellation";
import { publishRuntimeEvent, updateRuntimeStatus } from "@/engine/runtime-state";
import {
  createTransferSpeedTracker,
  defaultTransferJobId,
  transferProgressPayload,
} from "@/engine/transfer-events";
import { forwardRateLimiter } from "@/engine/telegram-forward";

interface MediaGroupItem {
  message: NormalizedMessage;
  result: DownloadResult;
  deleteAfterForward: boolean;
  caption?: string;
}

interface MediaGroupBucket {
  node: TaskNode;
  config: AppConfig;
  client: TelegramUserClient;
  target: string;
  items: Map<number, MediaGroupItem>;
  progressJobId?: string;
  timer?: NodeJS.Timeout;
  abortController: AbortController;
  unlinkAbortSignals: Set<() => void>;
  unregisterCancellation: () => void;
  flushing: boolean;
  resolve: () => void;
  promise: Promise<void>;
}

const mediaGroupState = globalThis as typeof globalThis & {
  __telegramDownloadMediaGroups?: {
    buckets: Map<string, MediaGroupBucket>;
  };
};

const state =
  mediaGroupState.__telegramDownloadMediaGroups ??
  (mediaGroupState.__telegramDownloadMediaGroups = {
    buckets: new Map<string, MediaGroupBucket>(),
  });

function groupKey(node: TaskNode, message: NormalizedMessage, target: string) {
  return [node.id, message.chatId, message.mediaGroupId, target].join(":");
}

function mediaInput(item: MediaGroupItem, index: number) {
  const { result } = item;
  if (!result.filePath) {
    return undefined;
  }
  return {
    type: "auto" as const,
    file: result.filePath,
    fileName: result.fileName,
    fileSize: result.fileSize,
    caption: index === 0 ? item.caption : undefined,
  };
}

async function cleanupItems(items: MediaGroupItem[]) {
  await Promise.all(
    items.map((item) =>
      item.deleteAfterForward && item.result.filePath
        ? unlink(item.result.filePath).catch((error) => {
            logger.warn({ error, path: item.result.filePath }, "failed to delete media group file after pipeline");
          })
        : Promise.resolve(),
    ),
  );
}

function linkAbortSignal(bucket: MediaGroupBucket, abortSignal?: AbortSignal) {
  if (!abortSignal) {
    return;
  }

  if (abortSignal.aborted) {
    bucket.abortController.abort(abortSignal.reason);
    return;
  }

  const abort = () => bucket.abortController.abort(abortSignal.reason);
  abortSignal.addEventListener("abort", abort, { once: true });
  bucket.unlinkAbortSignals.add(() => abortSignal.removeEventListener("abort", abort));
}

function cleanupBucket(key: string, bucket: MediaGroupBucket) {
  state.buckets.delete(key);
  if (bucket.timer) {
    clearTimeout(bucket.timer);
    bucket.timer = undefined;
  }
  for (const unlinkAbortSignal of bucket.unlinkAbortSignals) {
    unlinkAbortSignal();
  }
  bucket.unlinkAbortSignals.clear();
  bucket.unregisterCancellation();
  bucket.resolve();
}

async function flushBucket(key: string) {
  const bucket = state.buckets.get(key);
  if (!bucket) {
    return;
  }
  if (bucket.flushing) {
    await bucket.promise;
    return;
  }
  bucket.flushing = true;
  if (bucket.timer) {
    clearTimeout(bucket.timer);
    bucket.timer = undefined;
  }

  const items = Array.from(bucket.items.values()).sort((left, right) => left.message.id - right.message.id);
  const medias = items.map((item, index) => mediaInput(item, index)).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const progressJobId = bucket.progressJobId ?? defaultTransferJobId(bucket.node, items[0]?.result ?? {}, "forward");

  if (medias.length === 0) {
    cleanupBucket(key, bucket);
    return;
  }

  try {
    if (medias.length === 1) {
      const [item] = items;
      const speedTracker = createTransferSpeedTracker();
      await forwardRateLimiter.wait(bucket.config.forward.limit_per_minute);
      await bucket.client.sendMedia(bucket.target, medias[0], {
        caption: item.caption,
        replyTo: bucket.node.uploadTelegramReplyToMessageId,
        commentTo: bucket.node.uploadTelegramCommentToMessageId,
        abortSignal: bucket.abortController.signal,
        progressCallback(uploaded, total) {
          const speed = speedTracker(uploaded);
          updateRuntimeStatus({ uploadSpeedBytesPerSecond: speed });
          publishRuntimeEvent(
            "forward.progress",
            transferProgressPayload({
              phase: "forward",
              jobId: progressJobId,
              node: bucket.node,
              result: item.result,
              transferred: uploaded,
              total,
              speed,
            }),
          );
        },
      });
    } else {
      const itemSizes = items.map((item) => item.result.fileSize ?? item.message.fileSize ?? 0);
      const itemProgress = new Map<number, number>();
      const totalBytes = itemSizes.reduce((sum, size) => sum + size, 0);
      const speedTracker = createTransferSpeedTracker();
      await forwardRateLimiter.wait(bucket.config.forward.limit_per_minute);
      await bucket.client.sendMediaGroup(bucket.target, medias, {
        replyTo: bucket.node.uploadTelegramReplyToMessageId,
        commentTo: bucket.node.uploadTelegramCommentToMessageId,
        abortSignal: bucket.abortController.signal,
        progressCallback(index, uploaded, total) {
          itemProgress.set(index, uploaded);
          if (total > itemSizes[index]) {
            itemSizes[index] = total;
          }
          const transferredBytes = Array.from(itemProgress.values()).reduce((sum, value) => sum + value, 0);
          const aggregateTotal = Math.max(
            totalBytes,
            itemSizes.reduce((sum, size) => sum + size, 0),
          );
          const speed = speedTracker(transferredBytes);
          updateRuntimeStatus({ uploadSpeedBytesPerSecond: speed });
          publishRuntimeEvent(
            "forward.progress",
            transferProgressPayload({
              phase: "forward",
              jobId: progressJobId,
              node: bucket.node,
              result: items[index]?.result ?? items[0].result,
              transferred: transferredBytes,
              total: aggregateTotal,
              speed,
            }),
          );
        },
      });
    }
    updateRuntimeStatus({ uploadSpeedBytesPerSecond: 0 });
    publishRuntimeEvent("forward.finish", { jobId: progressJobId, taskId: bucket.node.id });
    await cleanupItems(items);
  } catch (error) {
    updateRuntimeStatus({ uploadSpeedBytesPerSecond: 0 });
    publishRuntimeEvent("forward.failed", {
      jobId: progressJobId,
      taskId: bucket.node.id,
      error: error instanceof Error ? error.message : String(error),
    });
    logger.error(
      {
        error,
        taskId: bucket.node.id,
        mediaGroupId: items.at(0)?.message.mediaGroupId,
        itemCount: items.length,
      },
      "failed to forward media group",
    );
  } finally {
    cleanupBucket(key, bucket);
  }
}

export function enqueueMediaGroupForward(input: {
  node: TaskNode;
  config: AppConfig;
  client: TelegramUserClient;
  target: string;
  message: NormalizedMessage;
  result: DownloadResult;
  deleteAfterForward?: boolean;
  caption?: string;
  flushDelayMs?: number;
  progressJobId?: string;
  abortSignal?: AbortSignal;
}) {
  const { node, config, client, target, message, result } = input;
  if (!message.mediaGroupId) {
    return null;
  }

  const key = groupKey(node, message, target);
  let resolvePromise: () => void = () => undefined;
  let bucket = state.buckets.get(key);
  if (!bucket) {
    const promise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });
    bucket = {
      node,
      config,
      client,
      target,
      items: new Map(),
      progressJobId: input.progressJobId,
      abortController: new AbortController(),
      unlinkAbortSignals: new Set(),
      unregisterCancellation: () => undefined,
      flushing: false,
      resolve: resolvePromise,
      promise,
    };
    bucket.unregisterCancellation = registerTaskCancellation(node.id, bucket.abortController);
    state.buckets.set(key, bucket);
  } else if (bucket.flushing) {
    return bucket.promise;
  } else if (bucket.timer) {
    clearTimeout(bucket.timer);
    bucket.timer = undefined;
  }

  bucket.progressJobId = bucket.progressJobId ?? input.progressJobId;
  linkAbortSignal(bucket, input.abortSignal);

  if (input.flushDelayMs !== undefined) {
    bucket.timer = setTimeout(() => {
      void flushBucket(key);
    }, input.flushDelayMs);
  }

  bucket.items.set(message.id, {
    message,
    result,
    deleteAfterForward: Boolean(input.deleteAfterForward),
    caption: input.caption,
  });
  if (message.mediaGroupExpectedCount && bucket.items.size >= message.mediaGroupExpectedCount) {
    void flushBucket(key);
  }
  return bucket.promise;
}

export async function flushPendingMediaGroups() {
  await Promise.all(Array.from(state.buckets.keys()).map((key) => flushBucket(key)));
}

export async function flushPendingMediaGroupsForTask(taskExternalId: string) {
  const keys = Array.from(state.buckets.keys()).filter((key) => key.startsWith(`${taskExternalId}:`));
  await Promise.all(keys.map((key) => flushBucket(key)));
}

export function discardPendingMediaGroupsForTask(taskExternalId: string) {
  const keys = Array.from(state.buckets.keys()).filter((key) => key.startsWith(`${taskExternalId}:`));
  for (const key of keys) {
    const bucket = state.buckets.get(key);
    if (!bucket) {
      continue;
    }
    state.buckets.delete(key);
    if (bucket.timer) {
      clearTimeout(bucket.timer);
    }
    bucket.abortController.abort(new Error("stopped by command"));
    for (const unlinkAbortSignal of bucket.unlinkAbortSignals) {
      unlinkAbortSignal();
    }
    bucket.unlinkAbortSignals.clear();
    bucket.unregisterCancellation();
    bucket.resolve();
  }
}
