import { nanoid } from "nanoid";
import { unlink } from "node:fs/promises";
import { db, libsqlClient } from "@/db/client";
import { downloads, tasks } from "@/db/schema";
import type { DownloadResult } from "@/plugins/types";
import type { NormalizedMessage, TaskNode, TaskSource, TaskStatus, TaskType } from "@/types/download";
import { taskQueue, type DownloadJob } from "@/engine/task-queue";
import { abortTaskTransmissions } from "@/engine/task-cancellation";
import { telegramFileFormat } from "@/utils/telegram-storage";

export function createTaskNode(input: {
  chatId: string;
  chatTitle?: string;
  type?: TaskType;
  source?: TaskSource;
  filter?: string;
  uploadTelegramChatId?: string;
  uploadTelegramReplyToMessageId?: number;
  uploadTelegramCommentToMessageId?: number;
}): TaskNode {
  const now = new Date().toISOString();
  return {
    id: nanoid(),
    chatId: input.chatId,
    chatTitle: input.chatTitle,
    type: input.type ?? "download",
    source: input.source ?? "manual",
    status: "queued",
    filter: input.filter,
    uploadTelegramChatId: input.uploadTelegramChatId,
    uploadTelegramReplyToMessageId: input.uploadTelegramReplyToMessageId,
    uploadTelegramCommentToMessageId: input.uploadTelegramCommentToMessageId,
    counters: {
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      stopped: 0,
    },
    createdAt: now,
    updatedAt: now,
  };
}

export async function enqueueMessageDownload(message: NormalizedMessage, node: TaskNode) {
  const job = createDownloadJob(message, node);
  await persistTaskNode(node);
  return taskQueue.enqueue(job);
}

export async function enqueueExistingDownloadJob(message: NormalizedMessage, node: TaskNode) {
  const job = createDownloadJob(message, node);
  return taskQueue.enqueue(job);
}

export function createDownloadJob(message: NormalizedMessage, node: TaskNode, jobId?: string): DownloadJob {
  node.counters.total += 1;
  node.updatedAt = new Date().toISOString();
  return {
    id: jobId ?? `${node.id}:${message.id}`,
    message,
    node,
  };
}

export async function persistTaskNode(node: TaskNode) {
  const timestamp = new Date().toISOString();
  await db
    .insert(tasks)
    .values({
      externalId: node.id,
      chatId: node.chatId,
      chatTitle: node.chatTitle,
      taskType: node.type,
      source: node.source,
      startTime: node.createdAt || timestamp,
      totalCount: node.counters.total,
      successCount: node.counters.success,
      failedCount: node.counters.failed,
      skipCount: node.counters.skipped,
      stoppedCount: node.counters.stopped,
      status: node.status,
      filter: node.filter,
    })
    .onConflictDoUpdate({
      target: tasks.externalId,
      set: {
        chatTitle: node.chatTitle,
        totalCount: node.counters.total,
        successCount: node.counters.success,
        failedCount: node.counters.failed,
        skipCount: node.counters.skipped,
        stoppedCount: node.counters.stopped,
        status: node.status,
        filter: node.filter,
      },
    });
}

async function taskRowId(taskExternalId: string) {
  const result = await libsqlClient.execute({
    sql: `
      SELECT id
      FROM tasks
      WHERE external_id = ?
      LIMIT 1
    `,
    args: [taskExternalId],
  });
  const id = result.rows.at(0)?.id;
  return typeof id === "number" ? id : id === undefined ? undefined : Number(id);
}

export async function recordDownloadResult(
  message: NormalizedMessage,
  node: TaskNode,
  result: DownloadResult,
) {
  if (result.status === "success") {
    node.counters.success += 1;
  } else if (result.status === "failed") {
    node.counters.failed += 1;
  } else if (result.status === "stopped") {
    node.counters.stopped += 1;
  } else {
    node.counters.skipped += 1;
  }
  node.updatedAt = new Date().toISOString();
  node.status = "running";
  const taskId = await taskRowId(node.id);
  const timestamp = new Date().toISOString();

  await db.insert(downloads).values({
    messageId: message.id,
    chatId: message.chatId,
    chatTitle: message.chatTitle,
    senderId: message.senderId,
    senderName: message.senderName,
    forwardSenderId: message.forwardOrigin?.senderId,
    forwardSenderName: message.forwardOrigin?.senderName,
    forwardChatId: message.forwardOrigin?.chatId,
    forwardChatTitle: message.forwardOrigin?.chatTitle,
    forwardMessageId: message.forwardOrigin?.messageId,
    forwardDate: message.forwardOrigin?.date,
    messageDate: message.date,
    downloadDate: timestamp,
    fileName: result.fileName ?? message.fileName ?? `${message.id}`,
    fileSize: result.fileSize ?? message.fileSize,
    mediaType: message.mediaType,
    mediaGroupId: message.mediaGroupId,
    fileFormat: telegramFileFormat(result.fileName ?? message.fileName, message.mimeType),
    caption: message.caption ?? message.text,
    savePath: result.filePath ?? "",
    status: result.status,
    source: node.source,
    errorMsg: result.error?.message,
    taskId,
  });

  await incrementTaskResult(node.id, result);
}

export async function incrementTaskResult(taskExternalId: string, result: DownloadResult) {
  const successIncrement = result.status === "success" ? 1 : 0;
  const failedIncrement = result.status === "failed" ? 1 : 0;
  const skipIncrement = result.status === "skip" ? 1 : 0;
  const stoppedIncrement = result.status === "stopped" ? 1 : 0;
  const totalBytesIncrement = result.status === "success" ? result.fileSize ?? 0 : 0;

  await libsqlClient.execute({
    sql: `
      UPDATE tasks
      SET
        success_count = success_count + ?,
        failed_count = failed_count + ?,
        skip_count = skip_count + ?,
        stopped_count = stopped_count + ?,
        total_bytes = total_bytes + ?,
        status = 'running'
      WHERE external_id = ?
    `,
    args: [
      successIncrement,
      failedIncrement,
      skipIncrement,
      stoppedIncrement,
      totalBytesIncrement,
      taskExternalId,
    ],
  });
}

export async function syncTaskStatusFromQueue(taskExternalId: string) {
  const result = await libsqlClient.execute({
    sql: `
      SELECT
        SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN status = 'stopped' THEN 1 ELSE 0 END) AS stopped,
        COUNT(*) AS total
      FROM task_queue
      WHERE task_external_id = ?
    `,
    args: [taskExternalId],
  });
  const row = result.rows.at(0);
  if (!row || Number(row.total ?? 0) === 0) {
    return;
  }

  const queued = Number(row.queued ?? 0);
  const running = Number(row.running ?? 0);
  const failed = Number(row.failed ?? 0);
  const stopped = Number(row.stopped ?? 0);
  const status =
    queued > 0 || running > 0
      ? "running"
      : failed > 0
        ? "failed"
        : stopped > 0
          ? "stopped"
          : "completed";
  const endTime = status === "running" ? null : new Date().toISOString();

  await libsqlClient.execute({
    sql: `
      UPDATE tasks
      SET status = ?, end_time = ?
      WHERE external_id = ?
    `,
    args: [status, endTime, taskExternalId],
  });
}

export async function markTaskNodeFinished(taskExternalId: string, status: Extract<TaskStatus, "completed" | "failed" | "stopped">) {
  await libsqlClient.execute({
    sql: `
      UPDATE tasks
      SET status = ?, end_time = ?
      WHERE external_id = ?
    `,
    args: [status, new Date().toISOString(), taskExternalId],
  });
}

async function disableListenRulesForStoppedTask(taskExternalId?: string) {
  const timestamp = new Date().toISOString();
  if (!taskExternalId) {
    const result = await libsqlClient.execute({
      sql: `
        UPDATE listen_forward_rules
        SET enabled = 0, updated_at = ?
        WHERE enabled = 1
      `,
      args: [timestamp],
    });
    return result.rowsAffected;
  }

  const task = await libsqlClient.execute({
    sql: `
      SELECT task_type, chat_id
      FROM tasks
      WHERE external_id = ?
      LIMIT 1
    `,
    args: [taskExternalId],
  });
  const row = task.rows.at(0);
  if (row?.task_type !== "listen_forward") {
    return undefined;
  }

  const result = await libsqlClient.execute({
    sql: `
      UPDATE listen_forward_rules
      SET enabled = 0, updated_at = ?
      WHERE enabled = 1
        AND source_chat_id = ?
    `,
    args: [timestamp, String(row.chat_id)],
  });
  return result.rowsAffected;
}

export async function stopTaskTransmission(taskExternalId?: string) {
  const abortedTransmissions = abortTaskTransmissions(taskExternalId);
  const stoppedQueueItems = await taskQueue.stop(taskExternalId);
  const disabledListenRules = await disableListenRulesForStoppedTask(taskExternalId);
  const timestamp = new Date().toISOString();
  const whereTask = taskExternalId ? "AND external_id = ?" : "";
  const result = await libsqlClient.execute({
    sql: `
      UPDATE tasks
      SET status = 'stopped', end_time = ?
      WHERE status IN ('queued', 'running')
        ${whereTask}
    `,
    args: taskExternalId ? [timestamp, taskExternalId] : [timestamp],
  });

  return {
    abortedTransmissions,
    stoppedQueueItems,
    stoppedTasks: result.rowsAffected,
    disabledListenRules,
  };
}

export interface DeleteTasksResult {
  deletedTasks: number;
  deletedQueueItems: number;
  deletedDownloads: number;
  deletedFiles: number;
  missingFiles: number;
  failedFiles: number;
  stoppedQueueItems: number;
  abortedTransmissions: number;
}

function placeholders(values: unknown[]) {
  return values.map(() => "?").join(",");
}

function emptyDeleteTasksResult(): DeleteTasksResult {
  return {
    deletedTasks: 0,
    deletedQueueItems: 0,
    deletedDownloads: 0,
    deletedFiles: 0,
    missingFiles: 0,
    failedFiles: 0,
    stoppedQueueItems: 0,
    abortedTransmissions: 0,
  };
}

async function deleteFilesForTasks(taskIds: number[]) {
  const result = {
    deletedFiles: 0,
    missingFiles: 0,
    failedFiles: 0,
  };
  if (taskIds.length === 0) {
    return result;
  }

  const rows = await libsqlClient.execute({
    sql: `
      SELECT DISTINCT save_path
      FROM downloads
      WHERE task_id IN (${placeholders(taskIds)})
        AND save_path IS NOT NULL
        AND save_path != ''
    `,
    args: taskIds,
  });

  for (const row of rows.rows) {
    const savePath = typeof row.save_path === "string" ? row.save_path : "";
    if (!savePath) {
      continue;
    }
    await unlink(savePath)
      .then(() => {
        result.deletedFiles += 1;
      })
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
          result.missingFiles += 1;
        } else {
          result.failedFiles += 1;
        }
      });
  }

  return result;
}

export async function deleteTasks(input: { taskIds: number[]; deleteFiles?: boolean }): Promise<DeleteTasksResult> {
  const requestedTaskIds = Array.from(
    new Set(input.taskIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)),
  );
  const result = emptyDeleteTasksResult();
  if (requestedTaskIds.length === 0) {
    return result;
  }

  const taskRows = await libsqlClient.execute({
    sql: `
      SELECT id, external_id
      FROM tasks
      WHERE id IN (${placeholders(requestedTaskIds)})
    `,
    args: requestedTaskIds,
  });
  const taskIds = taskRows.rows
    .map((row) => Number(row.id))
    .filter((id) => Number.isInteger(id) && id > 0);
  const externalIds = taskRows.rows
    .map((row) => (typeof row.external_id === "string" ? row.external_id : ""))
    .filter(Boolean);
  if (taskIds.length === 0 || externalIds.length === 0) {
    return result;
  }

  for (const externalId of externalIds) {
    const stopped = await stopTaskTransmission(externalId);
    result.stoppedQueueItems += stopped.stoppedQueueItems;
    result.abortedTransmissions += stopped.abortedTransmissions;
  }

  if (input.deleteFiles) {
    Object.assign(result, await deleteFilesForTasks(taskIds));
  }

  const deletedQueue = await libsqlClient.execute({
    sql: `
      DELETE FROM task_queue
      WHERE task_external_id IN (${placeholders(externalIds)})
    `,
    args: externalIds,
  });
  result.deletedQueueItems = deletedQueue.rowsAffected;

  const deletedDownloads = await libsqlClient.execute({
    sql: `
      DELETE FROM downloads
      WHERE task_id IN (${placeholders(taskIds)})
    `,
    args: taskIds,
  });
  result.deletedDownloads = deletedDownloads.rowsAffected;

  const deletedTasks = await libsqlClient.execute({
    sql: `
      DELETE FROM tasks
      WHERE id IN (${placeholders(taskIds)})
    `,
    args: taskIds,
  });
  result.deletedTasks = deletedTasks.rowsAffected;

  await taskQueue.refreshRuntimeStatus().catch(() => undefined);
  return result;
}
