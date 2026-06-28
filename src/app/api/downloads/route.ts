import { NextResponse } from "next/server";
import { listDownloads } from "@/db/queries";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get("limit") ?? 50);
  const records = await listDownloads(Number.isFinite(limit) ? limit : 50);
  return NextResponse.json({ data: records });
}
