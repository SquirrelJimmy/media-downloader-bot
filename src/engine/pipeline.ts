import { unlink } from "node:fs/promises";
import { getCloudUploadAdapter } from "@/cloud";
import type { AppConfig } from "@/config/schema";
import type { DownloadResult } from "@/plugins/types";
import type { TaskNode } from "@/types/download";
import { ensureStartedUserClient } from "@/engine/user-client";
import { logger } from "@/utils/logger";
import { enqueueMediaGroupForward } from "@/engine/media-group-forwarder";
import { publishRuntimeEvent, updateRuntimeStatus } from "@/engine/runtime-state";
import {
  createTransferSpeedTracker,
  defaultTransferJobId,
  transferProgressPayload,
} from "@/engine/transfer-events";
import { buildForwardCaption, forwardRateLimiter } from "@/engine/telegram-forward";

export async function runPostDownloadPipeline(
  result: DownloadResult,
  node: TaskNode,
  config: AppConfig,
  options: { abortSignal?: AbortSignal } = {},
) {
  if (result.status !== "success" || !result.filePath) {
    return result;
  }

  let cloudUploadSucceeded = false;
  let telegramForwardSucceeded = false;

  if (config.pipeline.cloud_upload.enabled) {
    const adapter = getCloudUploadAdapter(config.pipeline.cloud_upload.adapter);
    const uploadJobId = defaultTransferJobId(node, result, "upload");
    if (adapter) {
      const uploadResult = await adapter.upload(result.filePath, {
        config,
        abortSignal: options.abortSignal,
        onProgress(progress) {
          updateRuntimeStatus({ uploadSpeedBytesPerSecond: progress.speedBytesPerSecond ?? 0 });
          publishRuntimeEvent(
            "upload.progress",
            transferProgressPayload({
              phase: "upload",
              jobId: uploadJobId,
              node,
              result,
              transferred: progress.transferredBytes,
              total: progress.totalBytes,
              speed: progress.speedBytesPerSecond ?? 0,
            }),
          );
        },
      });
      if (uploadResult.status === "failed") {
        updateRuntimeStatus({ uploadSpeedBytesPerSecond: 0 });
        publishRuntimeEvent("upload.failed", { jobId: uploadJobId, taskId: node.id, filePath: result.filePath });
        logger.error({ error: uploadResult.error, taskId: node.id }, "cloud upload failed");
      } else if (uploadResult.status === "success") {
        cloudUploadSucceeded = true;
        updateRuntimeStatus({ uploadSpeedBytesPerSecond: 0 });
        publishRuntimeEvent("upload.finish", {
          jobId: uploadJobId,
          taskId: node.id,
          filePath: result.filePath,
          remotePath: uploadResult.remotePath,
        });
      }
    } else {
      const error = `cloud upload adapter "${config.pipeline.cloud_upload.adapter}" is not registered`;
      publishRuntimeEvent("upload.failed", { jobId: uploadJobId, taskId: node.id, filePath: result.filePath, error });
      logger.error({ adapter: config.pipeline.cloud_upload.adapter, taskId: node.id }, error);
    }
  }

  const telegramTarget = node.uploadTelegramChatId || config.pipeline.telegram_forward.target_chat_id;
  if ((config.pipeline.telegram_forward.enabled || node.uploadTelegramChatId) && telegramTarget) {
    const client = await ensureStartedUserClient(config);
    const caption = buildForwardCaption(config, telegramTarget, result.message);
    if (caption.skip) {
      publishRuntimeEvent("forward.skip", {
        taskId: node.id,
        filePath: result.filePath,
        reason: "advertisement",
      });
      return result;
    }
    const deleteAfterTelegramForward = config.forward.delete_after_upload || config.pipeline.delete_after_upload;
    if (result.message?.mediaGroupId) {
      enqueueMediaGroupForward({
        node,
        config,
        client,
        target: telegramTarget,
        message: result.message,
        result,
        deleteAfterForward: deleteAfterTelegramForward,
        caption: caption.caption,
        progressJobId: defaultTransferJobId(node, result, "forward"),
        abortSignal: options.abortSignal,
      });
      return result;
    }
    const forwardJobId = defaultTransferJobId(node, result, "forward");
    const forwardSpeed = createTransferSpeedTracker();
    await forwardRateLimiter.wait(config.forward.limit_per_minute);
    await client.sendMedia(telegramTarget, result.filePath, {
      caption: caption.caption,
      replyTo: node.uploadTelegramReplyToMessageId,
      commentTo: node.uploadTelegramCommentToMessageId,
      abortSignal: options.abortSignal,
      progressCallback(uploaded, total) {
        const speed = forwardSpeed(uploaded);
        updateRuntimeStatus({ uploadSpeedBytesPerSecond: speed });
        publishRuntimeEvent(
          "forward.progress",
          transferProgressPayload({
            phase: "forward",
            jobId: forwardJobId,
            node,
            result,
            transferred: uploaded,
            total,
            speed,
          }),
        );
        logger.debug({ taskId: node.id, uploaded, total }, "telegram forward progress");
      },
    });
    telegramForwardSucceeded = true;
    updateRuntimeStatus({ uploadSpeedBytesPerSecond: 0 });
    publishRuntimeEvent("forward.finish", { jobId: forwardJobId, taskId: node.id, filePath: result.filePath });
  }

  const shouldDeleteAfterSuccessfulUpload =
    (config.pipeline.cloud_upload.delete_after_upload && cloudUploadSucceeded) ||
    ((config.forward.delete_after_upload || config.pipeline.delete_after_upload) && telegramForwardSucceeded);

  if (shouldDeleteAfterSuccessfulUpload && !result.message?.mediaGroupId) {
    await unlink(result.filePath).catch((error) => {
      logger.warn({ error, path: result.filePath }, "failed to delete local file after pipeline");
    });
  }

  return result;
}
