import { NextResponse } from "next/server";
import { runListenForwardOnce } from "@/engine/listen-forward";

export const runtime = "nodejs";

export async function POST() {
  try {
    return NextResponse.json({ data: await runListenForwardOnce({ force: true }) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "listen forward run failed" },
      { status: 409 },
    );
  }
}
