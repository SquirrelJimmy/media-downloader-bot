import { NextResponse } from "next/server";
import { getTaskById } from "@/db/queries";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = await getTaskById(Number(id));
  if (!task) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }
  return NextResponse.json({ data: task });
}
