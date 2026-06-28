import { libsqlClient } from "@/db/client";
import type { AppConfig, ChatDownloadConfig } from "@/config/schema";
import { loadAppConfig } from "@/config/load";
import { createDownloadJob, createTaskNode, persistTaskNode } from "@/engine/task-service";
import { taskQueue } from "@/engine/task-queue";
import { getTelegramMessage, iterTelegramHistory } from "@/engine/user-client";
import { publishRuntimeEvent } from "@/engine/runtime-state";
import { filterEngine } from "@/filter/dsl";
import { metadataFromMessage } from "@/filter/metadata";
import { logger } from "@/utils/logger";
import type { NormalizedMessage, TaskNode, TaskSource, TaskType } from "@/types/download";

interface ChatProgressRow {
  chat_id: string;
  chat_title?: string;
  configured_last_read_message_id: number;
  last_read_message_id: number;
  total_scanned: number;
  total_queued: number;
  total_skipped: number;
  total_failed: number;
}

export interface RunConfiguredDownloadsOptions {
  chatIds?: Array<string | number>;
  limit?: number;
  dryRun?: boolean;
  taskType?: TaskType;
  source?: TaskSource;
  uploadTelegramChatId?: string;
  uploadTelegramReplyToMessageId?: number;
  uploadTelegramCommentToMessageId?: number;
  chats?: ChatDownloadConfig[];
}

export interface ChatBatchResult {
  chatId: string;
  taskId: string;
  scanned: number;
  queued: number;
  skipped: number;
  lastReadMessageId: number;
  dryRun: boolean;
}

export interface ConfiguredDownloadsResult {
  totalChats: number;
  processedChats: number;
  queued: number;
  skipped: number;
  dryRun: boolean;
  chats: ChatBatchResult[];
}

function nowIso() {
  return new Date().toISOString();
}

function configuredChatId(chat: ChatDownloadConfig) {
  return String(chat.chat_id);
}

function stableJobId(node: TaskNode, chatId: string, messageId: number) {
  return `${node.id}:chat:${chatId}:${messageId}`;
}

function maxMessageId(current: number, message: NormalizedMessage) {
  return Math.max(current, message.id);
}

async function enqueueConfiguredMessage(input: {
  message: NormalizedMessage;
  node: TaskNode;
  chatId: string;
  dryRun?: boolean;
}) {
  const { message, node, chatId, dryRun } = input;
  if (dryRun) {
    return;
  }
  const job = createDownloadJob(message, node, stableJobId(node, chatId, message.id));
  await taskQueue.enqueue(job);
}

function effectiveReverse(chat: ChatDownloadConfig, offsetId: number) {
  return offsetId > 0 ? chat.reverse : false;
}

function effectiveOffsetId(chat: ChatDownloadConfig, offsetId: number) {
  return offsetId > 0 ? chat.start_offset_id ?? offsetId : chat.start_offset_id;
}

function inclusiveMaxId(messageId?: number) {
  return messageId === undefined ? undefined : messageId + 1;
}

async function getChatProgress(chatId: string): Promise<ChatProgressRow | null> {
  const result = await libsqlClient.execute({
    sql: `
      SELECT
        chat_id,
        chat_title,
        configured_last_read_message_id,
        last_read_message_id,
        total_scanned,
        total_queued,
        total_skipped,
        total_failed
      FROM chat_progress
      WHERE chat_id = ?
      LIMIT 1
    `,
    args: [chatId],
  });
  return (result.rows.at(0) as ChatProgressRow | undefined) ?? null;
}

async function startChatProgress(chat: ChatDownloadConfig, task: TaskNode, offsetId: number) {
  const timestamp = nowIso();
  const chatId = configuredChatId(chat);

  await libsqlClient.execute({
    sql: `
      INSERT INTO chat_progress (
        chat_id,
        chat_title,
        configured_last_read_message_id,
        last_read_message_id,
        last_task_external_id,
        last_scan_started_at,
        last_error,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
      ON CONFLICT(chat_id) DO UPDATE SET
        chat_title = excluded.chat_title,
        configured_last_read_message_id = excluded.configured_last_read_message_id,
        last_task_external_id = excluded.last_task_external_id,
        last_scan_started_at = excluded.last_scan_started_at,
        last_error = NULL,
        updated_at = excluded.updated_at
    `,
    args: [
      chatId,
      chat.chat_title ?? null,
      chat.last_read_message_id,
      offsetId,
      task.id,
      timestamp,
      timestamp,
    ],
  });
}

async function finishChatProgress(
  chat: ChatDownloadConfig,
  task: TaskNode,
  result: Omit<ChatBatchResult, "dryRun">,
) {
  const timestamp = nowIso();
  await libsqlClient.execute({
    sql: `
      UPDATE chat_progress
      SET
        chat_title = COALESCE(?, chat_title),
        last_read_message_id = MAX(last_read_message_id, ?),
        last_queued_message_id = CASE
          WHEN ? > 0 THEN MAX(COALESCE(last_queued_message_id, 0), ?)
          ELSE last_queued_message_id
        END,
        last_task_external_id = ?,
        last_scan_finished_at = ?,
        total_scanned = total_scanned + ?,
        total_queued = total_queued + ?,
        total_skipped = total_skipped + ?,
        updated_at = ?
      WHERE chat_id = ?
    `,
    args: [
      task.chatTitle ?? chat.chat_title ?? null,
      result.lastReadMessageId,
      result.queued,
      result.lastReadMessageId,
      task.id,
      timestamp,
      result.scanned,
      result.queued,
      result.skipped,
      timestamp,
      configuredChatId(chat),
    ],
  });
}

async function failChatProgress(chat: ChatDownloadConfig, error: unknown) {
  const timestamp = nowIso();
  await libsqlClient.execute({
    sql: `
      UPDATE chat_progress
      SET
        total_failed = total_failed + 1,
        last_error = ?,
        last_scan_finished_at = ?,
        updated_at = ?
      WHERE chat_id = ?
    `,
    args: [
      error instanceof Error ? error.message : String(error),
      timestamp,
      timestamp,
      configuredChatId(chat),
    ],
  });
}

function selectConfiguredChats(config: AppConfig, options: RunConfiguredDownloadsOptions) {
  const sourceChats = options.chats ?? config.chats;
  const chatIds = options.chatIds;
  const filter = chatIds?.map(String);
  return sourceChats.filter((chat) => {
    if (!chat.enabled) {
      return false;
    }
    return !filter || filter.includes(configuredChatId(chat));
  });
}

async function runConfiguredChat(
  config: AppConfig,
  chat: ChatDownloadConfig,
  options: RunConfiguredDownloadsOptions,
): Promise<ChatBatchResult> {
  const chatId = configuredChatId(chat);
  const progress = await getChatProgress(chatId);
  const offsetId =
    chat.start_offset_id ??
    Math.max(
      chat.last_read_message_id,
      progress?.last_read_message_id ?? 0,
      progress?.configured_last_read_message_id ?? 0,
    );
  const node = createTaskNode({
    chatId,
    chatTitle: chat.chat_title,
    type: options.taskType ?? "download",
    source: options.source ?? "auto",
    filter: chat.download_filter || undefined,
    uploadTelegramChatId: (options.uploadTelegramChatId ?? chat.upload_telegram_chat_id) || undefined,
    uploadTelegramReplyToMessageId: options.uploadTelegramReplyToMessageId,
    uploadTelegramCommentToMessageId: options.uploadTelegramCommentToMessageId,
  });
  node.limit = options.limit ?? chat.limit;
  node.startOffsetId = chat.start_offset_id ?? offsetId;
  node.endOffsetId = chat.end_offset_id;

  if (!options.dryRun) {
    await startChatProgress(chat, node, offsetId);
    await persistTaskNode(node);
  }
  publishRuntimeEvent("chat.scan.start", { chatId, taskId: node.id, offsetId });

  let scanned = 0;
  let queued = 0;
  let skipped = 0;
  let lastReadMessageId = offsetId;

  try {
    for (const messageId of chat.ids_to_retry) {
      scanned += 1;
      const message = await getTelegramMessage(config, chat.chat_id, messageId);
      if (!message) {
        skipped += 1;
        continue;
      }

      node.chatTitle ??= message.chatTitle;
      if (chat.download_filter && !filterEngine.execute(chat.download_filter, metadataFromMessage(message))) {
        skipped += 1;
        continue;
      }

      await enqueueConfiguredMessage({
        message,
        node,
        chatId,
        dryRun: options.dryRun,
      });
      queued += 1;
    }

    for await (const message of iterTelegramHistory(config, chat.chat_id, {
      limit: options.limit ?? chat.limit,
      offsetId: effectiveOffsetId(chat, offsetId),
      minId: offsetId,
      maxId: inclusiveMaxId(chat.end_offset_id),
      reverse: effectiveReverse(chat, offsetId),
    })) {
      scanned += 1;
      node.chatTitle ??= message.chatTitle;

      if (
        message.id <= offsetId ||
        (chat.end_offset_id !== undefined && message.id > chat.end_offset_id) ||
        chat.ids_to_retry.includes(message.id)
      ) {
        skipped += 1;
        continue;
      }

      lastReadMessageId = maxMessageId(lastReadMessageId, message);

      if (chat.download_filter && !filterEngine.execute(chat.download_filter, metadataFromMessage(message))) {
        skipped += 1;
        continue;
      }

      await enqueueConfiguredMessage({
        message,
        node,
        chatId,
        dryRun: options.dryRun,
      });
      queued += 1;
    }

    if (!options.dryRun) {
      await persistTaskNode(node);
    }
    const result = {
      chatId,
      taskId: node.id,
      scanned,
      queued,
      skipped,
      lastReadMessageId,
    };
    if (!options.dryRun) {
      await finishChatProgress(chat, node, result);
    }
    publishRuntimeEvent("chat.scan.finish", result);
    return { ...result, dryRun: Boolean(options.dryRun) };
  } catch (error) {
    await failChatProgress(chat, error);
    logger.error({ error, chatId, taskId: node.id }, "configured chat scan failed");
    throw error;
  }
}

export async function runConfiguredDownloads(
  options: RunConfiguredDownloadsOptions = {},
  config?: AppConfig,
): Promise<ConfiguredDownloadsResult> {
  const appConfig = config ?? (await loadAppConfig());
  const chats = selectConfiguredChats(appConfig, options);
  const results: ChatBatchResult[] = [];

  for (const chat of chats) {
    results.push(await runConfiguredChat(appConfig, chat, options));
  }

  return {
    totalChats: (options.chats ?? appConfig.chats).length,
    processedChats: results.length,
    queued: results.reduce((sum, item) => sum + item.queued, 0),
    skipped: results.reduce((sum, item) => sum + item.skipped, 0),
    dryRun: Boolean(options.dryRun),
    chats: results,
  };
}
