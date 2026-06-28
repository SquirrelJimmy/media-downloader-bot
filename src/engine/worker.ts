import { loadAppConfig } from "@/config/load";
import { runPostDownloadPipeline } from "@/engine/pipeline";
import { isSqliteBusyError, taskQueue, type DownloadJob, type QueuedDownloadJob } from "@/engine/task-queue";
import { publishRuntimeEvent, updateRuntimeStatus } from "@/engine/runtime-state";
import { metadataFromMessage } from "@/filter/metadata";
import { filterEngine } from "@/filter/dsl";
import { registerBuiltinPlugins } from "@/plugins";
import { extractUrls } from "@/utils/url";
import { logger } from "@/utils/logger";
import { ensureStartedUserClient, getTelegramMessage, type TelegramUserClient } from "@/engine/user-client";
import { markTaskNodeFinished, recordDownloadResult, syncTaskStatusFromQueue } from "@/engine/task-service";
import { isTaskAbortError, registerTaskCancellation } from "@/engine/task-cancellation";
import { discardPendingMediaGroupsForTask, flushPendingMediaGroupsForTask } from "@/engine/media-group-forwarder";
import { transmissionLimiter } from "@/engine/transmission-limiter";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loggableError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return error;
}

async function hydrateJobMessage(job: DownloadJob, config: Awaited<ReturnType<typeof loadAppConfig>>) {
  if (job.message.media) {
    return job.message;
  }

  if (job.message.source?.kind !== "mtcute") {
    return job.message;
  }

  const message = await getTelegramMessage(config, job.message.source.chatId, job.message.source.messageId);
  return message ?? job.message;
}

function downloadProgressPayload(
  job: DownloadJob,
  message: Awaited<ReturnType<typeof hydrateJobMessage>>,
  config: Awaited<ReturnType<typeof loadAppConfig>>,
  downloaded: number,
  total: number,
  speed: number,
) {
  return {
    jobId: job.id,
    taskId: job.node.id,
    taskType: job.node.type,
    chatId: message.chatId,
    chatTitle: message.chatTitle,
    messageId: message.id,
    fileName: config.download.hide_file_name ? "[hidden]" : message.fileName,
    mediaType: message.mediaType,
    senderId: message.senderId,
    senderName: message.senderName,
    forwardChatId: message.forwardOrigin?.chatId,
    forwardChatTitle: message.forwardOrigin?.chatTitle,
    forwardSenderId: message.forwardOrigin?.senderId,
    forwardSenderName: message.forwardOrigin?.senderName,
    forwardMessageId: message.forwardOrigin?.messageId,
    mediaGroupId: message.mediaGroupId,
    downloaded,
    total,
    speed,
  };
}

export async function processJob(
  job: DownloadJob,
  options: {
    telegramClient?: TelegramUserClient;
    onProgress?: (downloaded: number, total: number, speed: number) => void;
    abortSignal?: AbortSignal;
  } = {},
) {
  const config = await loadAppConfig();
  const registry = registerBuiltinPlugins();
  let message: Awaited<ReturnType<typeof hydrateJobMessage>>;
  try {
    message = await hydrateJobMessage(job, config);
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    const result = {
      status: "failed" as const,
      message: job.message,
      error: normalizedError,
    };
    await recordDownloadResult(job.message, job.node, result);
    publishRuntimeEvent("download.failed", { jobId: job.id, error: normalizedError.message, result });
    return result;
  }
  const meta = metadataFromMessage(message);
  const userClient =
    options.telegramClient ??
    (message.source?.kind === "mtcute" || message.media ? await ensureStartedUserClient(config) : undefined);

  if (job.node.filter && !filterEngine.execute(job.node.filter, meta)) {
    const result = { status: "skip" as const, message };
    await recordDownloadResult(message, job.node, result);
    publishRuntimeEvent("download.skip", { jobId: job.id, reason: "filter", result });
    return result;
  }

  const extractedUrl = extractUrls(message.text ?? message.caption).at(0);
  const abortController = new AbortController();
  const unregisterCancellation = registerTaskCancellation(job.node.id, abortController);
  const abortFromCaller = () => {
    abortController.abort(options.abortSignal?.reason);
  };
  if (options.abortSignal) {
    if (options.abortSignal.aborted) {
      abortFromCaller();
    } else {
      options.abortSignal.addEventListener("abort", abortFromCaller, { once: true });
    }
  }
  try {
    transmissionLimiter.setMax(config.queue.max_concurrent_transmissions);
    const resultWithMessage = await transmissionLimiter.run(async () => {
      const result = await registry.download(
        {
          message,
          node: job.node,
          extractedUrl,
        },
        {
          config,
          tempDir: config.storage.temp_path,
          userClient,
          abortSignal: abortController.signal,
          onProgress(downloaded, total, speed) {
            updateRuntimeStatus({ downloadSpeedBytesPerSecond: speed });
            publishRuntimeEvent("download.progress", downloadProgressPayload(job, message, config, downloaded, total, speed));
            options.onProgress?.(downloaded, total, speed);
          },
        },
      );
      const resultWithMessage = { ...result, message };
      await runPostDownloadPipeline(resultWithMessage, job.node, config, { abortSignal: abortController.signal });
      return resultWithMessage;
    });
    await recordDownloadResult(message, job.node, resultWithMessage);
    publishRuntimeEvent("download.finish", { jobId: job.id, result: resultWithMessage });
    return resultWithMessage;
  } catch (error) {
    if (isTaskAbortError(error) || abortController.signal.aborted) {
      const result = {
        status: "stopped" as const,
        message,
        error: error instanceof Error ? error : new Error("stopped by command"),
      };
      await recordDownloadResult(message, job.node, result);
      publishRuntimeEvent("download.stop", { jobId: job.id, result });
      return result;
    }
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    const result = {
      status: "failed" as const,
      message,
      error: normalizedError,
    };
    await recordDownloadResult(message, job.node, result);
    publishRuntimeEvent("download.failed", { jobId: job.id, error: normalizedError.message, result });
    return result;
  } finally {
    if (options.abortSignal) {
      options.abortSignal.removeEventListener("abort", abortFromCaller);
    }
    unregisterCancellation();
    updateRuntimeStatus({ downloadSpeedBytesPerSecond: 0 });
  }
}

export async function processQueuedJob(job: QueuedDownloadJob) {
  try {
    const result = await processJob(job);
    if (result.status === "failed") {
      await taskQueue.markFailed(job.queueId, result.error ?? new Error("download failed"));
      await syncTaskStatusFromQueue(job.node.id);
      return result;
    }
    if (result.status === "stopped") {
      await taskQueue.stop(job.node.id);
      discardPendingMediaGroupsForTask(job.node.id);
      await markTaskNodeFinished(job.node.id, "stopped");
      return result;
    }
    await taskQueue.markCompleted(job.queueId);
    if (!(await taskQueue.hasPendingForTask(job.node.id))) {
      await flushPendingMediaGroupsForTask(job.node.id);
    }
    await syncTaskStatusFromQueue(job.node.id);
    return result;
  } catch (error) {
    if (isTaskAbortError(error)) {
      await taskQueue.stop(job.node.id);
      discardPendingMediaGroupsForTask(job.node.id);
      await markTaskNodeFinished(job.node.id, "stopped");
      publishRuntimeEvent("download.stop", { jobId: job.id, error: error instanceof Error ? error.message : "stopped by command" });
      return { status: "failed" as const, error: error instanceof Error ? error : new Error("stopped by command") };
    }
    await taskQueue.markFailed(job.queueId, error);
    await syncTaskStatusFromQueue(job.node.id);
    publishRuntimeEvent("download.failed", { jobId: job.id, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

async function runWorkerLoop(workerId: string, abortSignal?: AbortSignal) {
  for (;;) {
    if (abortSignal?.aborted) {
      return;
    }
    let job: QueuedDownloadJob;
    try {
      job = await taskQueue.dequeue({ workerId, abortSignal });
    } catch (error) {
      if (abortSignal?.aborted) {
        return;
      }
      const delayMs = isSqliteBusyError(error) ? 1000 : 3000;
      logger.error({ error, workerId, delayMs }, "download worker dequeue failed");
      await sleep(delayMs);
      continue;
    }
    await processQueuedJob(job).catch((error) => {
      logger.error({ error: loggableError(error), jobId: job.id, queueId: job.queueId, workerId }, "download job failed");
    });
  }
}

export async function runWorker(options: { abortSignal?: AbortSignal } = {}) {
  const config = await loadAppConfig();
  const workerCount = Math.max(1, config.queue.max_download_tasks);
  logger.info({ workerCount }, "download worker started");
  await Promise.all(
    Array.from({ length: workerCount }, (_, index) =>
      runWorkerLoop(`download-worker-${process.pid}-${index + 1}`, options.abortSignal),
    ),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runWorker().catch((error) => {
    logger.error({ error }, "worker crashed");
    process.exitCode = 1;
  });
}
