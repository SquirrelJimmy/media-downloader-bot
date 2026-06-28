import { NextResponse } from "next/server";
import { createListenForwardRule, listListenForwardRules } from "@/engine/listen-forward";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ data: await listListenForwardRules() });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      sourceChatId?: string;
      targetChatId?: string;
      filter?: string;
      pollIntervalSeconds?: number;
    };
    if (!body.sourceChatId || !body.targetChatId) {
      return NextResponse.json({ error: "sourceChatId and targetChatId are required" }, { status: 400 });
    }
    const data = await createListenForwardRule({
      sourceChatId: body.sourceChatId,
      targetChatId: body.targetChatId,
      filter: body.filter,
      pollIntervalSeconds: body.pollIntervalSeconds,
    });
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "create listen forward rule failed" },
      { status: 409 },
    );
  }
}
