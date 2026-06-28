import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DownloadPlugin } from "@/plugins/types";
import {
  getConfiguredTelegramFileName,
  getConfiguredTelegramSavePath,
} from "@/utils/telegram-storage";

export const telegramTextPlugin: DownloadPlugin = {
  name: "telegram-text",
  priority: 2,
  canHandle(req, ctx) {
    return ctx.config.plugins.telegram_text.enabled && Boolean(req.message.text) && !req.message.media;
  },
  async download(req, ctx) {
    const configuredName = getConfiguredTelegramFileName(ctx.config, {
      ...req.message,
      fileName: undefined,
      caption: undefined,
      mimeType: "text/plain",
    });
    const fileName = configuredName;
    const dir = getConfiguredTelegramSavePath(ctx.config, req.message, { mediaType: "msg" });
    const filePath = join(dir, fileName);
    await mkdir(dir, { recursive: true });
    await writeFile(filePath, req.message.text ?? "", "utf8");
    return {
      status: "success",
      filePath,
      fileName,
      fileSize: Buffer.byteLength(req.message.text ?? ""),
    };
  },
};
