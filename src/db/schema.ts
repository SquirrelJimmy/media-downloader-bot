import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";

export const downloads = sqliteTable(
  "downloads",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    messageId: integer("message_id").notNull(),
    chatId: text("chat_id").notNull(),
    chatTitle: text("chat_title"),
    senderId: text("sender_id"),
    senderName: text("sender_name"),
    forwardSenderId: text("forward_sender_id"),
    forwardSenderName: text("forward_sender_name"),
    forwardChatId: text("forward_chat_id"),
    forwardChatTitle: text("forward_chat_title"),
    forwardMessageId: integer("forward_message_id"),
    forwardDate: text("forward_date"),
    messageDate: text("message_date"),
    downloadDate: text("download_date").default(sql`(datetime('now'))`),
    fileName: text("file_name").notNull(),
    fileSize: integer("file_size"),
    fileSha256: text("file_sha256"),
    mediaType: text("media_type"),
    mediaGroupId: text("media_group_id"),
    fileFormat: text("file_format"),
    caption: text("caption"),
    savePath: text("save_path").notNull(),
    status: text("status", { enum: ["success", "failed", "skip", "stopped", "downloading", "queued"] })
      .notNull()
      .default("queued"),
    source: text("source", { enum: ["auto", "bot", "forward", "manual"] }).notNull().default("auto"),
    errorMsg: text("error_msg"),
    downloadSpeed: real("download_speed"),
    taskId: integer("task_id"),
  },
  (table) => ({
    chatIdx: index("idx_downloads_chat").on(table.chatId, table.downloadDate),
    statusIdx: index("idx_downloads_status").on(table.status, table.downloadDate),
    shaIdx: index("idx_downloads_sha256").on(table.fileSha256),
    taskIdx: index("idx_downloads_task").on(table.taskId),
  }),
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    externalId: text("external_id").notNull().unique(),
    chatId: text("chat_id").notNull(),
    chatTitle: text("chat_title"),
    taskType: text("task_type", { enum: ["download", "forward", "listen_forward"] }).notNull(),
    source: text("source", { enum: ["auto", "bot", "forward", "manual"] }).notNull().default("manual"),
    startTime: text("start_time").default(sql`(datetime('now'))`),
    endTime: text("end_time"),
    totalCount: integer("total_count").notNull().default(0),
    successCount: integer("success_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    skipCount: integer("skip_count").notNull().default(0),
    stoppedCount: integer("stopped_count").notNull().default(0),
    totalBytes: integer("total_bytes").notNull().default(0),
    status: text("status", { enum: ["queued", "running", "completed", "failed", "stopped"] })
      .notNull()
      .default("queued"),
    filter: text("filter"),
  },
  (table) => ({
    taskStatusIdx: index("idx_tasks_status").on(table.status, table.startTime),
    taskChatIdx: index("idx_tasks_chat").on(table.chatId, table.startTime),
  }),
);

export const taskQueue = sqliteTable(
  "task_queue",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    jobId: text("job_id").notNull().unique(),
    taskExternalId: text("task_external_id").notNull(),
    chatId: text("chat_id").notNull(),
    messageId: integer("message_id").notNull(),
    status: text("status", { enum: ["queued", "running", "completed", "failed", "stopped"] })
      .notNull()
      .default("queued"),
    payload: text("payload").notNull(),
    priority: integer("priority").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    lockedBy: text("locked_by"),
    lockedUntil: text("locked_until"),
    availableAt: text("available_at").default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
    lastError: text("last_error"),
    createdAt: text("created_at").default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
    updatedAt: text("updated_at").default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
    completedAt: text("completed_at"),
  },
  (table) => ({
    queueStatusIdx: index("idx_task_queue_status_available").on(table.status, table.availableAt),
    queueLockIdx: index("idx_task_queue_lock").on(table.lockedUntil),
    queueTaskIdx: index("idx_task_queue_task").on(table.taskExternalId),
    queueChatIdx: index("idx_task_queue_chat").on(table.chatId, table.createdAt),
  }),
);

export const chatProgress = sqliteTable(
  "chat_progress",
  {
    chatId: text("chat_id").primaryKey(),
    chatTitle: text("chat_title"),
    configuredLastReadMessageId: integer("configured_last_read_message_id").notNull().default(0),
    lastReadMessageId: integer("last_read_message_id").notNull().default(0),
    lastQueuedMessageId: integer("last_queued_message_id"),
    lastTaskExternalId: text("last_task_external_id"),
    lastScanStartedAt: text("last_scan_started_at"),
    lastScanFinishedAt: text("last_scan_finished_at"),
    lastError: text("last_error"),
    totalScanned: integer("total_scanned").notNull().default(0),
    totalQueued: integer("total_queued").notNull().default(0),
    totalSkipped: integer("total_skipped").notNull().default(0),
    totalFailed: integer("total_failed").notNull().default(0),
    updatedAt: text("updated_at").default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (table) => ({
    chatProgressUpdatedIdx: index("idx_chat_progress_updated").on(table.updatedAt),
  }),
);

export const listenForwardRules = sqliteTable(
  "listen_forward_rules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceChatId: text("source_chat_id").notNull(),
    targetChatId: text("target_chat_id").notNull(),
    filter: text("filter"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    lastReadMessageId: integer("last_read_message_id").notNull().default(0),
    pollIntervalSeconds: integer("poll_interval_seconds").notNull().default(10),
    createdAt: text("created_at").default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
    updatedAt: text("updated_at").default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (table) => ({
    listenForwardEnabledIdx: index("idx_listen_forward_enabled").on(table.enabled, table.updatedAt),
  }),
);

export const fileIndex = sqliteTable("file_index", {
  sha256: text("sha256").primaryKey(),
  firstSeen: text("first_seen").default(sql`(datetime('now'))`),
  fileSize: integer("file_size"),
  refCount: integer("ref_count").notNull().default(1),
});

export type DownloadRecord = InferSelectModel<typeof downloads>;
export type NewDownloadRecord = InferInsertModel<typeof downloads>;
export type TaskRecord = InferSelectModel<typeof tasks>;
export type NewTaskRecord = InferInsertModel<typeof tasks>;
export type TaskQueueRecord = InferSelectModel<typeof taskQueue>;
export type NewTaskQueueRecord = InferInsertModel<typeof taskQueue>;
export type ChatProgressRecord = InferSelectModel<typeof chatProgress>;
export type NewChatProgressRecord = InferInsertModel<typeof chatProgress>;
export type ListenForwardRuleRecord = InferSelectModel<typeof listenForwardRules>;
export type NewListenForwardRuleRecord = InferInsertModel<typeof listenForwardRules>;
export type FileIndexRecord = InferSelectModel<typeof fileIndex>;
