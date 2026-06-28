import type { AppConfig } from "@/config/schema";
import type { TelegramUserClient } from "@/engine/user-client";
import type { NormalizedMessage, TaskNode } from "@/types/download";

export interface PluginContext {
  userClient?: TelegramUserClient;
  tempDir: string;
  config: AppConfig;
  onProgress: (downloaded: number, total: number, speed: number) => void;
  abortSignal?: AbortSignal;
}

export interface DownloadRequest {
  message: NormalizedMessage;
  extractedUrl?: string;
  node: TaskNode;
}

export interface DownloadResult {
  status: "success" | "skip" | "failed" | "stopped";
  message?: NormalizedMessage;
  filePath?: string;
  fileName?: string;
  fileSize?: number;
  error?: Error;
  pluginName?: string;
}

export interface DownloadPlugin {
  name: string;
  priority: number;
  canHandle(req: DownloadRequest, ctx: PluginContext): boolean | Promise<boolean>;
  download(req: DownloadRequest, ctx: PluginContext): Promise<DownloadResult>;
}
