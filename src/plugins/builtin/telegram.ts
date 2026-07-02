import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { FileDownloadLocation } from "@mtcute/node";
import type { DownloadPlugin } from "@/plugins/types";
import { moveFileAcrossDevices } from "@/utils/files";
import {
  canDownloadTelegramMessage,
  getConfiguredTelegramFileName,
  getConfiguredTelegramSavePath,
} from "@/utils/telegram-storage";
import { isDownloadableTelegramMedia } from "@/utils/telegram-media";

export const telegramPlugin: DownloadPlugin = {
  name: "telegram",
  priority: 1,
  canHandle(req, ctx) {
    return ctx.config.plugins.telegram.enabled && isDownloadableTelegramMedia(req.message.media);
  },
  async download(req, ctx) {
    if (!isDownloadableTelegramMedia(req.message.media)) {
      return { status: "skip" };
    }

    if (!ctx.userClient) {
      return {
        status: "failed",
        error: new Error("Telegram user client is not started"),
      };
    }

    if (!canDownloadTelegramMessage(ctx.config, req.message)) {
      return { status: "skip" };
    }

    const finalDir = getConfiguredTelegramSavePath(ctx.config, req.message);
    const tempDir = join(ctx.config.storage.temp_path, req.node.id);
    await mkdir(finalDir, { recursive: true });
    await mkdir(tempDir, { recursive: true });

    const safeFileName = getConfiguredTelegramFileName(ctx.config, req.message);
    const tempPath = join(tempDir, safeFileName);
    const finalPath = join(finalDir, safeFileName);

    try {
      const startedAt = Date.now();
      await ctx.userClient.downloadToFile(tempPath, req.message.media as FileDownloadLocation, {
        fileSize: req.message.fileSize,
        abortSignal: ctx.abortSignal,
        progressCallback(downloaded: number, total: number) {
          const elapsedSeconds = Math.max(1, (Date.now() - startedAt) / 1000);
          ctx.onProgress(downloaded, Number.isFinite(total) ? total : req.message.fileSize ?? 0, downloaded / elapsedSeconds);
        },
      });

      await moveFileAcrossDevices(tempPath, finalPath);
      const fileStat = await stat(finalPath);

      return {
        status: "success",
        filePath: finalPath,
        fileName: safeFileName,
        fileSize: fileStat.size,
      };
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  },
};
