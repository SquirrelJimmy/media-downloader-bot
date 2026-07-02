import { libsqlClient, retrySqliteBusy } from "@/db/client";
import type { NormalizedMessage, TaskNode } from "@/types/download";
import { updateRuntimeStatus } from "@/engine/runtime-state";
import { logger } from "@/utils/logger";

export interface DownloadJob {
  id: string;
  message: NormalizedMessage;
  node: TaskNode;
}

export interface QueuedDownloadJob extends DownloadJob {
  queueId: number;
  attempts: number;
}

export interface TaskQueueStats {
  queued: number;
  running: number;
  completed: number;
  failed: number;
  stopped: number;
}

export interface TaskQueue {
  enqueue(job: DownloadJob): Promise<QueuedDownloadJob>;
  dequeue(options?: DequeueOptions): Promise<QueuedDownloadJob>;
  markCompleted(queueId: number): Promise<void>;
  markFailed(queueId: number, error: unknown): Promise<void>;
  stop(taskExternalId?: string): Promise<number>;
  retryFailed(): Promise<number>;
  hasPendingForTask(taskExternalId: string): Promise<boolean>;
  stats(): Promise<TaskQueueStats>;
  size(): Promise<number>;
}

interface DequeueOptions {
  workerId?: string;
  pollIntervalMs?: number;
  lockMs?: number;
  abortSignal?: AbortSignal;
}

interface QueueRow {
  id: number;
  job_id: string;
  payload: string;
  attempts: number;
}

const defaultWorkerId = `${process.pid}:${Math.random().toString(36).slice(2, 8)}`;
const defaultPollIntervalMs = 1000;
const defaultLockMs = 10 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function futureIso(ms: number) {
  return new Date(Date.now() + ms).toISOString();
}

export function sleep(ms: number, abortSignal?: AbortSignal) {
  if (!abortSignal) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  if (abortSignal.aborted) {
    return Promise.reject(abortSignal.reason ?? new Error("aborted"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      abortSignal.removeEventListener("abort", onAbort);
      resolve(undefined);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      abortSignal.removeEventListener("abort", onAbort);
      reject(abortSignal.reason ?? new Error("aborted"));
    };
    abortSignal.addEventListener("abort", onAbort, { once: true });
  });
}

export function isSqliteBusyError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as Record<string, unknown>;
  return (
    record.code === "SQLITE_BUSY" ||
    record.extendedCode === "SQLITE_BUSY" ||
    record.rawCode === 5 ||
    String(record.message ?? "").includes("SQLITE_BUSY")
  );
}

function parseJob(row: QueueRow): QueuedDownloadJob {
  const payload = JSON.parse(row.payload) as DownloadJob;
  return {
    ...payload,
    queueId: row.id,
    attempts: row.attempts,
  };
}

function serializableJob(job: DownloadJob): DownloadJob {
  const message = { ...job.message };
  delete message.media;
  return {
    ...job,
    message,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

export class SqliteTaskQueue implements TaskQueue {
  private nextExpiredLockCleanupAt = 0;

  async enqueue(job: DownloadJob) {
    const timestamp = nowIso();

    await libsqlClient.execute({
      sql: `
        INSERT INTO task_queue (
          job_id,
          task_external_id,
          chat_id,
          message_id,
          status,
          payload,
          available_at,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?)
        ON CONFLICT(job_id) DO UPDATE SET
          payload = excluded.payload,
          status = CASE
            WHEN task_queue.status IN ('completed', 'running') THEN task_queue.status
            ELSE 'queued'
          END,
          available_at = CASE
            WHEN task_queue.status IN ('completed', 'running') THEN task_queue.available_at
            ELSE excluded.available_at
          END,
          locked_by = CASE
            WHEN task_queue.status = 'running' THEN task_queue.locked_by
            ELSE NULL
          END,
          locked_until = CASE
            WHEN task_queue.status = 'running' THEN task_queue.locked_until
            ELSE NULL
          END,
          last_error = CASE
            WHEN task_queue.status = 'running' THEN task_queue.last_error
            ELSE NULL
          END,
          completed_at = CASE
            WHEN task_queue.status = 'completed' THEN task_queue.completed_at
            ELSE NULL
          END,
          updated_at = excluded.updated_at
      `,
      args: [
        job.id,
        job.node.id,
        job.message.chatId,
        job.message.id,
        JSON.stringify(serializableJob(job)),
        timestamp,
        timestamp,
        timestamp,
      ],
    });

    await this.refreshRuntimeStatus();
    const queued = await this.getByJobId(job.id);
    if (!queued) {
      throw new Error(`Queued job ${job.id} was not found after enqueue`);
    }
    return queued;
  }

  async dequeue(options: DequeueOptions = {}) {
    const workerId = options.workerId ?? defaultWorkerId;
    const pollIntervalMs = options.pollIntervalMs ?? defaultPollIntervalMs;
    const lockMs = options.lockMs ?? defaultLockMs;
    const abortSignal = options.abortSignal;

    for (;;) {
      if (abortSignal?.aborted) {
        throw abortSignal.reason ?? new Error("aborted");
      }
      const job = await this.tryDequeue(workerId, lockMs).catch((error) => {
        if (isSqliteBusyError(error)) {
          logger.warn({ workerId }, "dequeue skipped because sqlite is busy");
          return null;
        }
        throw error;
      });
      if (job) {
        await this.refreshRuntimeStatus();
        return job;
      }
      await sleep(pollIntervalMs, abortSignal);
    }
  }

  async markCompleted(queueId: number) {
    const timestamp = nowIso();
    await libsqlClient.execute({
      sql: `
        UPDATE task_queue
        SET
          status = 'completed',
          locked_by = NULL,
          locked_until = NULL,
          completed_at = ?,
          updated_at = ?
        WHERE id = ?
          AND status != 'stopped'
      `,
      args: [timestamp, timestamp, queueId],
    });
    await this.refreshRuntimeStatus();
  }

  async markFailed(queueId: number, error: unknown) {
    const timestamp = nowIso();
    const backoffSeconds = await this.nextBackoffSeconds(queueId);

    await libsqlClient.execute({
      sql: `
        UPDATE task_queue
        SET
          status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
          locked_by = NULL,
          locked_until = NULL,
          available_at = CASE
            WHEN attempts >= max_attempts THEN available_at
            ELSE strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)
          END,
          last_error = ?,
          updated_at = ?
        WHERE id = ?
          AND status != 'stopped'
      `,
      args: [`+${backoffSeconds} seconds`, errorMessage(error), timestamp, queueId],
    });
    await this.refreshRuntimeStatus();
  }

  async stop(taskExternalId?: string) {
    const timestamp = nowIso();
    const whereTask = taskExternalId ? "AND task_external_id = ?" : "";
    const result = await libsqlClient.execute({
      sql: `
        UPDATE task_queue
        SET
          status = 'stopped',
          locked_by = NULL,
          locked_until = NULL,
          completed_at = ?,
          last_error = 'stopped by command',
          updated_at = ?
        WHERE status IN ('queued', 'running')
          ${whereTask}
      `,
      args: taskExternalId ? [timestamp, timestamp, taskExternalId] : [timestamp, timestamp],
    });
    await this.refreshRuntimeStatus();
    return result.rowsAffected;
  }

  async retryFailed() {
    const timestamp = nowIso();
    const result = await libsqlClient.execute({
      sql: `
        UPDATE task_queue
        SET
          status = 'queued',
          locked_by = NULL,
          locked_until = NULL,
          available_at = ?,
          last_error = NULL,
          updated_at = ?
        WHERE status = 'failed'
      `,
      args: [timestamp, timestamp],
    });
    await this.refreshRuntimeStatus();
    return result.rowsAffected;
  }

  async hasPendingForTask(taskExternalId: string) {
    const result = await libsqlClient.execute({
      sql: `
        SELECT COUNT(*) AS count
        FROM task_queue
        WHERE task_external_id = ?
          AND status IN ('queued', 'running')
      `,
      args: [taskExternalId],
    });
    return Number(result.rows.at(0)?.count ?? 0) > 0;
  }

  async stats() {
    const result = await libsqlClient.execute(`
      SELECT status, COUNT(*) AS count
      FROM task_queue
      GROUP BY status
    `);

    const stats: TaskQueueStats = {
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
      stopped: 0,
    };

    for (const row of result.rows) {
      const status = String(row.status) as keyof TaskQueueStats;
      if (status in stats) {
        stats[status] = Number(row.count ?? 0);
      }
    }

    return stats;
  }

  async size() {
    const result = await libsqlClient.execute(`
      SELECT COUNT(*) AS count
      FROM task_queue
      WHERE status = 'queued'
    `);
    return Number(result.rows.at(0)?.count ?? 0);
  }

  async refreshRuntimeStatus() {
    const stats = await this.stats();
    updateRuntimeStatus({
      queuedTasks: stats.queued,
      activeTasks: stats.running,
    });
    return stats;
  }

  private async tryDequeue(workerId: string, lockMs: number) {
    const timestamp = nowIso();
    const lockedUntil = futureIso(lockMs);
    let transaction: Awaited<ReturnType<typeof libsqlClient.transaction>> | undefined;

    await this.releaseExpiredLocksIfDue(timestamp).catch((error) => {
      if (!isSqliteBusyError(error)) {
        throw error;
      }
      logger.warn({ workerId }, "expired lock cleanup skipped because sqlite is busy");
    });

    const selected = await retrySqliteBusy(() =>
      libsqlClient.execute({
        sql: `
          SELECT id, job_id, payload, attempts
          FROM task_queue
          WHERE status = 'queued'
            AND (available_at IS NULL OR available_at <= ?)
          ORDER BY priority DESC, id ASC
          LIMIT 1
        `,
        args: [timestamp],
      }),
    );
    const row = selected.rows.at(0) as QueueRow | undefined;
    if (!row) {
      return null;
    }

    try {
      transaction = await libsqlClient.transaction("write");

      const claimed = await transaction.execute({
        sql: `
          UPDATE task_queue
          SET
            status = 'running',
            attempts = attempts + 1,
            locked_by = ?,
            locked_until = ?,
            updated_at = ?
          WHERE id = ?
            AND status = 'queued'
        `,
        args: [workerId, lockedUntil, timestamp, row.id],
      });

      if (claimed.rowsAffected !== 1) {
        await transaction.commit();
        return null;
      }

      const updated = await transaction.execute({
        sql: `
          SELECT id, job_id, payload, attempts
          FROM task_queue
          WHERE id = ?
        `,
        args: [row.id],
      });

      await transaction.commit();
      const updatedRow = updated.rows.at(0) as QueueRow | undefined;
      return updatedRow ? parseJob(updatedRow) : null;
    } catch (error) {
      if (!isSqliteBusyError(error)) {
        logger.error({ error }, "dequeue transaction failed");
      }
      await transaction?.rollback().catch((rollbackError) => {
        logger.warn({ error: rollbackError }, "dequeue transaction rollback failed");
      });
      throw error;
    } finally {
      transaction?.close();
    }
  }

  private async getByJobId(jobId: string) {
    const result = await libsqlClient.execute({
      sql: `
        SELECT id, job_id, payload, attempts
        FROM task_queue
        WHERE job_id = ?
        LIMIT 1
      `,
      args: [jobId],
    });
    const row = result.rows.at(0) as QueueRow | undefined;
    return row ? parseJob(row) : null;
  }

  private async nextBackoffSeconds(queueId: number) {
    const result = await libsqlClient.execute({
      sql: `
        SELECT attempts
        FROM task_queue
        WHERE id = ?
        LIMIT 1
      `,
      args: [queueId],
    });
    const attempts = Number(result.rows.at(0)?.attempts ?? 1);
    return Math.min(300, Math.max(5, attempts * attempts * 5));
  }

  private async releaseExpiredLocksIfDue(timestamp: string) {
    const now = Date.now();
    if (now < this.nextExpiredLockCleanupAt) {
      return;
    }
    this.nextExpiredLockCleanupAt = now + 30_000;
    await retrySqliteBusy(() =>
      libsqlClient.execute({
        sql: `
          UPDATE task_queue
          SET
            status = 'queued',
            locked_by = NULL,
            locked_until = NULL,
            updated_at = ?
          WHERE status = 'running'
            AND locked_until IS NOT NULL
            AND locked_until <= ?
        `,
        args: [timestamp, timestamp],
      }),
    );
  }
}

export const taskQueue = new SqliteTaskQueue();
