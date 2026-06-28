import { NextResponse } from "next/server";
import { filterEngine } from "@/filter/dsl";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { expression?: string };
  const result = filterEngine.check(body.expression ?? "");
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
