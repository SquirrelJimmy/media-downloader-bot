import { NextResponse } from "next/server";
import { stopTaskTransmission } from "@/engine/task-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    taskExternalId?: string;
    all?: boolean;
  };

  if (!body.all && !body.taskExternalId) {
    return NextResponse.json(
      { error: "taskExternalId or all=true is required" },
      { status: 400 },
    );
  }

  const result = await stopTaskTransmission(body.all ? undefined : body.taskExternalId);
  return NextResponse.json(result);
}
