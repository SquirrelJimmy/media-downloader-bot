import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { parseAppConfig } from "@/config/schema";
import {
  discardPendingMediaGroupsForTask,
  enqueueMediaGroupForward,
  flushPendingMediaGroups,
  flushPendingMediaGroupsForTask,
} from "@/engine/media-group-forwarder";
import { abortTaskTransmissions } from "@/engine/task-cancellation";
import type { DownloadResult } from "@/plugins/types";
import type { TelegramUserClient } from "@/engine/user-client";
import type { NormalizedMessage, TaskNode } from "@/types/download";

function taskNode(): TaskNode {
  return {
    id: "task-1",
    chatId: "-1001",
    type: "forward",
    source: "bot",
    status: "running",
    counters: {
      total: 2,
      success: 0,
      failed: 0,
      skipped: 0,
      stopped: 0,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function message(id: number): NormalizedMessage {
  return {
    id,
    chatId: "-1001",
    mediaGroupId: "group-1",
    mediaGroupExpectedCount: 2,
    mediaType: "photo",
  };
}

function result(id: number): DownloadResult {
  return {
    status: "success",
    message: message(id),
    filePath: `/tmp/${id}.jpg`,
    fileName: `${id}.jpg`,
    fileSize: 1,
  };
}

async function exists(path: string) {
  return stat(path)
    .then(() => true)
    .catch(() => false);
}

describe("media group forwarder", () => {
  it("flushes grouped media as one sorted media group", async () => {
    const sentGroups: unknown[][] = [];
    const client = {
      sendMediaGroup: async (_target: string, medias: unknown[]) => {
        sentGroups.push(medias);
        return [];
      },
      sendMedia: async () => {
        throw new Error("sendMedia should not be used for grouped media");
      },
    } as unknown as TelegramUserClient;

    enqueueMediaGroupForward({
      node: taskNode(),
      config: parseAppConfig({}),
      client,
      target: "target",
      message: message(2),
      result: result(2),
      flushDelayMs: 60_000,
    });
    enqueueMediaGroupForward({
      node: taskNode(),
      config: parseAppConfig({}),
      client,
      target: "target",
      message: message(1),
      result: result(1),
      flushDelayMs: 60_000,
    });

    await flushPendingMediaGroups();

    expect(sentGroups).toHaveLength(1);
    expect(sentGroups[0]?.map((item) => (item as { fileName: string }).fileName)).toEqual(["1.jpg", "2.jpg"]);
  });

  it("uses processed caption on the first grouped media item", async () => {
    const sentGroups: unknown[][] = [];
    const client = {
      sendMediaGroup: async (_target: string, medias: unknown[]) => {
        sentGroups.push(medias);
        return [];
      },
      sendMedia: async () => {
        throw new Error("sendMedia should not be used for grouped media");
      },
    } as unknown as TelegramUserClient;

    enqueueMediaGroupForward({
      node: taskNode(),
      config: parseAppConfig({}),
      client,
      target: "target",
      message: { ...message(1), mediaGroupId: "group-caption" },
      result: { ...result(1), message: { ...message(1), mediaGroupId: "group-caption" } },
      caption: "album caption",
      flushDelayMs: 60_000,
    });
    enqueueMediaGroupForward({
      node: taskNode(),
      config: parseAppConfig({}),
      client,
      target: "target",
      message: { ...message(2), mediaGroupId: "group-caption" },
      result: { ...result(2), message: { ...message(2), mediaGroupId: "group-caption" } },
      flushDelayMs: 60_000,
    });

    await flushPendingMediaGroups();

    expect((sentGroups[0]?.[0] as { caption?: string }).caption).toBe("album caption");
    expect((sentGroups[0]?.[1] as { caption?: string }).caption).toBeUndefined();
  });

  it("flushes as soon as the expected group count is reached", async () => {
    const sentGroups: unknown[][] = [];
    const client = {
      sendMediaGroup: async (_target: string, medias: unknown[]) => {
        sentGroups.push(medias);
        return [];
      },
      sendMedia: async () => {
        throw new Error("sendMedia should not be used for grouped media");
      },
    } as unknown as TelegramUserClient;

    enqueueMediaGroupForward({
      node: taskNode(),
      config: parseAppConfig({}),
      client,
      target: "target",
      message: { ...message(10), mediaGroupId: "group-2" },
      result: { ...result(10), message: { ...message(10), mediaGroupId: "group-2" } },
      flushDelayMs: 60_000,
    });
    enqueueMediaGroupForward({
      node: taskNode(),
      config: parseAppConfig({}),
      client,
      target: "target",
      message: { ...message(11), mediaGroupId: "group-2" },
      result: { ...result(11), message: { ...message(11), mediaGroupId: "group-2" } },
      flushDelayMs: 60_000,
    });

    await Promise.resolve();

    expect(sentGroups).toHaveLength(1);
    expect(sentGroups[0]?.map((item) => (item as { fileName: string }).fileName)).toEqual(["10.jpg", "11.jpg"]);
  });

  it("registers grouped telegram forwarding for task cancellation", async () => {
    let resolveSend: (() => void) | undefined;
    const sentOptions: Array<{ abortSignal?: AbortSignal }> = [];
    const client = {
      sendMediaGroup: async (_target: string, _medias: unknown[], options?: { abortSignal?: AbortSignal }) => {
        sentOptions.push(options ?? {});
        await new Promise<void>((resolve) => {
          resolveSend = resolve;
        });
        return [];
      },
      sendMedia: async () => {
        throw new Error("sendMedia should not be used for grouped media");
      },
    } as unknown as TelegramUserClient;
    const node = { ...taskNode(), id: "task-abort-signal" };

    enqueueMediaGroupForward({
      node,
      config: parseAppConfig({}),
      client,
      target: "target",
      message: { ...message(50), mediaGroupId: "group-abort", mediaGroupExpectedCount: undefined },
      result: { ...result(50), message: { ...message(50), mediaGroupId: "group-abort", mediaGroupExpectedCount: undefined } },
    });
    enqueueMediaGroupForward({
      node,
      config: parseAppConfig({}),
      client,
      target: "target",
      message: { ...message(51), mediaGroupId: "group-abort", mediaGroupExpectedCount: undefined },
      result: { ...result(51), message: { ...message(51), mediaGroupId: "group-abort", mediaGroupExpectedCount: undefined } },
    });

    const flushPromise = flushPendingMediaGroupsForTask(node.id);
    await Promise.resolve();

    expect(sentOptions).toHaveLength(1);
    expect(sentOptions[0]?.abortSignal).toBeDefined();
    expect(sentOptions[0]?.abortSignal?.aborted).toBe(false);

    expect(abortTaskTransmissions(node.id)).toBe(1);
    expect(sentOptions[0]?.abortSignal?.aborted).toBe(true);

    resolveSend?.();
    await flushPromise;
  });

  it("waits for an in-flight expected-count flush when flushing a task", async () => {
    let resolveSend: (() => void) | undefined;
    let sendFinished = false;
    const client = {
      sendMediaGroup: async () => {
        await new Promise<void>((resolve) => {
          resolveSend = resolve;
        });
        sendFinished = true;
        return [];
      },
      sendMedia: async () => {
        throw new Error("sendMedia should not be used for grouped media");
      },
    } as unknown as TelegramUserClient;
    const node = { ...taskNode(), id: "task-in-flight-flush" };

    enqueueMediaGroupForward({
      node,
      config: parseAppConfig({}),
      client,
      target: "target",
      message: { ...message(40), mediaGroupId: "group-in-flight" },
      result: { ...result(40), message: { ...message(40), mediaGroupId: "group-in-flight" } },
      flushDelayMs: 60_000,
    });
    enqueueMediaGroupForward({
      node,
      config: parseAppConfig({}),
      client,
      target: "target",
      message: { ...message(41), mediaGroupId: "group-in-flight" },
      result: { ...result(41), message: { ...message(41), mediaGroupId: "group-in-flight" } },
      flushDelayMs: 60_000,
    });

    await Promise.resolve();
    const flushPromise = flushPendingMediaGroupsForTask(node.id);
    let taskFlushResolved = false;
    void flushPromise.then(() => {
      taskFlushResolved = true;
    });
    await Promise.resolve();

    expect(taskFlushResolved).toBe(false);
    expect(sendFinished).toBe(false);

    resolveSend?.();
    await flushPromise;

    expect(sendFinished).toBe(true);
    expect(taskFlushResolved).toBe(true);
  });

  it("waits for task flush when the expected group count is unknown", async () => {
    const sentGroups: unknown[][] = [];
    const sentSingles: unknown[] = [];
    const client = {
      sendMediaGroup: async (_target: string, medias: unknown[]) => {
        sentGroups.push(medias);
        return [];
      },
      sendMedia: async (_target: string, media: unknown) => {
        sentSingles.push(media);
        return {};
      },
    } as unknown as TelegramUserClient;
    const node = { ...taskNode(), id: "task-unknown-count" };

    enqueueMediaGroupForward({
      node,
      config: parseAppConfig({}),
      client,
      target: "target",
      message: { ...message(20), mediaGroupId: "group-unknown", mediaGroupExpectedCount: undefined },
      result: {
        ...result(20),
        message: { ...message(20), mediaGroupId: "group-unknown", mediaGroupExpectedCount: undefined },
      },
    });
    await Promise.resolve();
    expect(sentGroups).toHaveLength(0);

    await flushPendingMediaGroupsForTask(node.id);

    expect(sentGroups).toHaveLength(0);
    expect(sentSingles).toHaveLength(1);
  });

  it("discards pending groups without sending after stop", async () => {
    const sentGroups: unknown[][] = [];
    const client = {
      sendMediaGroup: async (_target: string, medias: unknown[]) => {
        sentGroups.push(medias);
        return [];
      },
      sendMedia: async () => {
        throw new Error("sendMedia should not be used for grouped media");
      },
    } as unknown as TelegramUserClient;
    const node = { ...taskNode(), id: "task-discard" };

    enqueueMediaGroupForward({
      node,
      config: parseAppConfig({}),
      client,
      target: "target",
      message: { ...message(30), mediaGroupId: "group-discard", mediaGroupExpectedCount: undefined },
      result: {
        ...result(30),
        message: { ...message(30), mediaGroupId: "group-discard", mediaGroupExpectedCount: undefined },
      },
    });

    discardPendingMediaGroupsForTask(node.id);
    await flushPendingMediaGroupsForTask(node.id);

    expect(sentGroups).toHaveLength(0);
  });

  it("keeps media group files when cloud delete_after_upload is enabled but upload did not succeed", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "telegram-download-media-group-"));
    const filePath = join(tempDir, "kept.jpg");
    await writeFile(filePath, "data");
    const sentSingles: unknown[] = [];
    const client = {
      sendMediaGroup: async () => [],
      sendMedia: async (_target: string, media: unknown) => {
        sentSingles.push(media);
        return {};
      },
    } as unknown as TelegramUserClient;
    const node = { ...taskNode(), id: "task-keep-after-cloud-failure" };

    try {
      enqueueMediaGroupForward({
        node,
        config: parseAppConfig({
          pipeline: {
            cloud_upload: {
              delete_after_upload: true,
            },
          },
        }),
        client,
        target: "target",
        message: { ...message(50), mediaGroupId: "group-keep", mediaGroupExpectedCount: undefined },
        result: {
          ...result(50),
          filePath,
          message: { ...message(50), mediaGroupId: "group-keep", mediaGroupExpectedCount: undefined },
        },
      });

      await flushPendingMediaGroupsForTask(node.id);

      expect(sentSingles).toHaveLength(1);
      expect(await exists(filePath)).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("deletes media group files after successful forward when explicitly allowed", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "telegram-download-media-group-"));
    const filePath = join(tempDir, "deleted.jpg");
    await writeFile(filePath, "data");
    const client = {
      sendMediaGroup: async () => [],
      sendMedia: async () => ({}),
    } as unknown as TelegramUserClient;
    const node = { ...taskNode(), id: "task-delete-after-forward" };

    try {
      enqueueMediaGroupForward({
        node,
        config: parseAppConfig({}),
        client,
        target: "target",
        message: { ...message(60), mediaGroupId: "group-delete", mediaGroupExpectedCount: undefined },
        result: {
          ...result(60),
          filePath,
          message: { ...message(60), mediaGroupId: "group-delete", mediaGroupExpectedCount: undefined },
        },
        deleteAfterForward: true,
      });

      await flushPendingMediaGroupsForTask(node.id);

      expect(await exists(filePath)).toBe(false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
