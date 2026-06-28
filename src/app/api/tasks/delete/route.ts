import { NextResponse } from "next/server";
import { deleteTasks } from "@/engine/task-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    ids?: unknown;
    deleteFiles?: boolean;
  };
  const ids = Array.isArray(body.ids)
    ? body.ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
    : [];

  if (ids.length === 0) {
    return NextResponse.json({ error: "ids must contain at least one task id" }, { status: 400 });
  }

  const result = await deleteTasks({
    taskIds: ids,
    deleteFiles: Boolean(body.deleteFiles),
  });
  return NextResponse.json(result);
}
