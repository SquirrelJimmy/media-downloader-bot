import { NextResponse } from "next/server";
import { runConfiguredDownloads } from "@/engine/config-driven-download";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      chatIds?: Array<string | number>;
      limit?: number;
      dryRun?: boolean;
    };

    const result = await runConfiguredDownloads({
      chatIds: body.chatIds,
      limit: body.limit,
      dryRun: body.dryRun,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "configured download failed" },
      { status: 409 },
    );
  }
}
