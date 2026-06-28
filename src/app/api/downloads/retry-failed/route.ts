import { NextResponse } from "next/server";
import { taskQueue } from "@/engine/task-queue";

export const runtime = "nodejs";

export async function POST() {
  const queued = await taskQueue.retryFailed();
  return NextResponse.json({
    queued,
  });
}
