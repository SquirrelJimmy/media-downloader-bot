import { NextResponse } from "next/server";
import { searchDownloads } from "@/db/queries";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const limit = Number(searchParams.get("limit") ?? 50);
  const data = await searchDownloads(q, Number.isFinite(limit) ? limit : 50);
  return NextResponse.json({ data });
}
