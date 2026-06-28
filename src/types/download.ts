export const taskTypes = ["download", "forward", "listen_forward"] as const;
export type TaskType = (typeof taskTypes)[number];

export const taskStatuses = [
  "queued",
  "running",
  "completed",
  "failed",
  "stopped",
] as const;
export type TaskStatus = (typeof taskStatuses)[number];

export const downloadStatuses = [
  "queued",
  "downloading",
  "success",
  "failed",
  "skip",
  "stopped",
] as const;
export type DownloadStatus = (typeof downloadStatuses)[number];

export const taskSources = ["auto", "bot", "forward", "manual"] as const;
export type TaskSource = (typeof taskSources)[number];

export type MediaType =
  | "audio"
  | "document"
  | "photo"
  | "video"
  | "video_note"
  | "voice"
  | "animation"
  | "text"
  | "external";

export interface TaskCounters {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  stopped: number;
}

export interface TaskNode {
  id: string;
  chatId: string;
  chatTitle?: string;
  type: TaskType;
  source: TaskSource;
  status: TaskStatus;
  filter?: string;
  uploadTelegramChatId?: string;
  uploadTelegramReplyToMessageId?: number;
  uploadTelegramCommentToMessageId?: number;
  startOffsetId?: number;
  endOffsetId?: number;
  limit?: number;
  counters: TaskCounters;
  createdAt: string;
  updatedAt: string;
}

export interface NormalizedMessage {
  id: number;
  chatId: string;
  chatTitle?: string;
  date?: string;
  text?: string;
  caption?: string;
  media?: unknown;
  mediaType?: MediaType;
  mediaGroupId?: string;
  mediaGroupExpectedCount?: number;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  senderId?: string;
  senderName?: string;
  forwardOrigin?: {
    senderId?: string;
    senderName?: string;
    chatId?: string;
    chatTitle?: string;
    messageId?: number;
    date?: string;
  };
  replyToMessageId?: number;
  messageThreadId?: number;
  source?: {
    kind: "mtcute";
    chatId: string;
    messageId: number;
  };
}

export interface DownloadProgress {
  taskId: string;
  messageId: number;
  downloadedBytes: number;
  totalBytes: number;
  speedBytesPerSecond: number;
  updatedAt: string;
}

export interface RuntimeStatus {
  activeTasks: number;
  queuedTasks: number;
  downloadSpeedBytesPerSecond: number;
  uploadSpeedBytesPerSecond: number;
  updatedAt: string;
}
