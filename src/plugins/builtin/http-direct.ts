import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { finished } from "node:stream/promises";
import type { DownloadPlugin } from "@/plugins/types";
import { moveFileAcrossDevices } from "@/utils/files";
import { extractUrls, isDirectFileUrl } from "@/utils/url";
import { sanitizeFileName } from "@/utils/format";
import { getConfiguredExternalSavePath } from "@/utils/telegram-storage";

export const httpDirectPlugin: DownloadPlugin = {
  name: "http-direct",
  priority: 1.75,
  canHandle(req, ctx) {
    if (!ctx.config.plugins.http.enabled) {
      return false;
    }
    const urls = req.extractedUrl ? [req.extractedUrl] : extractUrls(req.message.text ?? req.message.caption);
    return urls.some(isDirectFileUrl);
  },
  async download(req, ctx) {
    const url = req.extractedUrl ?? extractUrls(req.message.text ?? req.message.caption).find(isDirectFileUrl);
    if (!url) {
      return { status: "skip" };
    }
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      return { status: "failed", error: new Error(`HTTP ${response.status}`) };
    }
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > ctx.config.plugins.http.max_file_size) {
      return { status: "failed", error: new Error("file exceeds configured max_file_size") };
    }

    const taskTempDir = join(ctx.tempDir, req.node.id);
    const finalDir = getConfiguredExternalSavePath(ctx.config, url, req.message);
    await mkdir(taskTempDir, { recursive: true });
    await mkdir(finalDir, { recursive: true });
    const fileName = sanitizeFileName(basename(new URL(url).pathname) || `${req.message.id}.bin`);
    const tempPath = join(taskTempDir, fileName);
    const finalPath = join(finalDir, fileName);
    const writer = createWriteStream(tempPath);
    try {
      for await (const chunk of response.body) {
        writer.write(chunk);
      }
      writer.end();
      await finished(writer);
      await moveFileAcrossDevices(tempPath, finalPath);
      const fileStat = await stat(finalPath);
      return { status: "success", filePath: finalPath, fileName, fileSize: contentLength || fileStat.size };
    } finally {
      await rm(taskTempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  },
};
