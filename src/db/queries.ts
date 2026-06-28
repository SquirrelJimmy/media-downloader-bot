import { sql } from "drizzle-orm";
import { desc, eq, like, or } from "drizzle-orm";
import { db } from "@/db/client";
import { chatProgress, downloads, taskQueue, tasks } from "@/db/schema";

export async function listDownloads(limit = 50) {
  return db.select().from(downloads).orderBy(desc(downloads.downloadDate)).limit(limit);
}

export async function listTasks(limit = 50) {
  return db.select().from(tasks).orderBy(desc(tasks.startTime)).limit(limit);
}

export async function listActiveTasks(limit = 50) {
  return db
    .select()
    .from(tasks)
    .where(sql`${tasks.status} IN ('queued', 'running')`)
    .orderBy(desc(tasks.startTime))
    .limit(limit);
}

export async function getTaskById(id: number) {
  const result = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  return result.at(0) ?? null;
}

export async function listQueueItems(limit = 50) {
  return db.select().from(taskQueue).orderBy(desc(taskQueue.createdAt)).limit(limit);
}

export async function listChatProgress(limit = 50) {
  return db.select().from(chatProgress).orderBy(desc(chatProgress.updatedAt)).limit(limit);
}

export async function getDownloadStats() {
  const result = await db.all<{
    total: number;
    success: number;
    failed: number;
    skipped: number;
    stopped: number;
    totalBytes: number | null;
  }>(sql`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status = 'skip' THEN 1 ELSE 0 END) AS skipped,
      SUM(CASE WHEN status = 'stopped' THEN 1 ELSE 0 END) AS stopped,
      SUM(file_size) AS totalBytes
    FROM downloads
  `);
  const row = result.at(0);
  return {
    total: Number(row?.total ?? 0),
    success: Number(row?.success ?? 0),
    failed: Number(row?.failed ?? 0),
    skipped: Number(row?.skipped ?? 0),
    stopped: Number(row?.stopped ?? 0),
    totalBytes: Number(row?.totalBytes ?? 0),
  };
}

export async function searchDownloads(query: string, limit = 50) {
  if (!query.trim()) {
    return listDownloads(limit);
  }
  const likeQuery = `%${query.trim()}%`;
  return db
    .select()
    .from(downloads)
    .where(
      or(
        like(downloads.fileName, likeQuery),
        like(downloads.caption, likeQuery),
        like(downloads.chatTitle, likeQuery),
        like(downloads.chatId, likeQuery),
        like(downloads.senderName, likeQuery),
        like(downloads.senderId, likeQuery),
        like(downloads.forwardSenderName, likeQuery),
        like(downloads.forwardSenderId, likeQuery),
        like(downloads.forwardChatTitle, likeQuery),
        like(downloads.forwardChatId, likeQuery),
      ),
    )
    .orderBy(desc(downloads.downloadDate))
    .limit(limit);
}
