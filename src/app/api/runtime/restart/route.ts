import { NextResponse } from "next/server";
import { restartServerRuntime } from "@/engine/server-bootstrap";

export const runtime = "nodejs";

export async function POST() {
  try {
    const status = await restartServerRuntime();
    return NextResponse.json({
      restarted: true,
      status,
      message: "runtime services restarted",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "runtime restart failed" },
      { status: 409 },
    );
  }
}
