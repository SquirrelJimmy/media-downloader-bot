import { NextResponse } from "next/server";
import { listChatProgress, listQueueItems } from "@/db/queries";
import { isSqliteBusyError, taskQueue } from "@/engine/task-queue";

export const runtime = "nodejs";

const emptyStats = {
  queued: 0,
  running: 0,
  completed: 0,
  failed: 0,
  stopped: 0,
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit") ?? 50);
    const normalizedLimit = Number.isFinite(limit) ? limit : 50;
    const items = await listQueueItems(normalizedLimit);
    const data = items.map((item) => ({
      id: item.id,
      jobId: item.jobId,
      taskExternalId: item.taskExternalId,
      chatId: item.chatId,
      messageId: item.messageId,
      status: item.status,
      priority: item.priority,
      attempts: item.attempts,
      maxAttempts: item.maxAttempts,
      lockedBy: item.lockedBy,
      lockedUntil: item.lockedUntil,
      availableAt: item.availableAt,
      lastError: item.lastError,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      completedAt: item.completedAt,
    }));

    return NextResponse.json({
      stats: await taskQueue.stats(),
      chatProgress: await listChatProgress(normalizedLimit),
      data,
    });
  } catch (error) {
    const sqliteBusy = isSqliteBusyError(error);
    return NextResponse.json(
      {
        error: errorMessage(error),
        sqliteBusy,
        stats: emptyStats,
        chatProgress: [],
        data: [],
      },
      { status: sqliteBusy ? 503 : 500 },
    );
  }
}
