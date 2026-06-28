import type { AppConfig } from "@/config/schema";

export interface CloudUploadProgress {
  transferredBytes: number;
  totalBytes: number;
  speedBytesPerSecond?: number;
  eta?: string;
}

export interface CloudUploadContext {
  config: AppConfig;
  onProgress?: (progress: CloudUploadProgress) => void;
  abortSignal?: AbortSignal;
}

export interface CloudUploadResult {
  status: "success" | "skip" | "failed";
  remotePath?: string;
  error?: Error;
}

export interface CloudUploadAdapter {
  name: string;
  upload(filePath: string, ctx: CloudUploadContext): Promise<CloudUploadResult>;
}
