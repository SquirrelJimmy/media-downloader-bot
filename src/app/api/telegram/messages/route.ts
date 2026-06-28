import { NextResponse } from "next/server";
import { loadAppConfig } from "@/config/load";
import { processJob } from "@/engine/worker";
import { createDownloadJob, createTaskNode, enqueueMessageDownload, persistTaskNode } from "@/engine/task-service";
import { getTelegramMessage } from "@/engine/user-client";
import { filterEngine } from "@/filter/dsl";
import { metadataFromMessage } from "@/filter/metadata";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      chatId?: string | number;
      messageId?: number;
      filter?: string;
      processImmediately?: boolean;
    };

    if (!body.chatId || !body.messageId) {
      return NextResponse.json({ error: "chatId and messageId are required" }, { status: 400 });
    }

    const config = await loadAppConfig();
    const message = await getTelegramMessage(config, body.chatId, body.messageId);

    if (!message) {
      return NextResponse.json({ error: "message not found" }, { status: 404 });
    }

    if (body.filter) {
      const checked = filterEngine.check(body.filter);
      if (!checked.ok) {
        return NextResponse.json({ error: checked.error ?? "invalid filter" }, { status: 400 });
      }
      if (!filterEngine.execute(body.filter, metadataFromMessage(message))) {
        return NextResponse.json({
          task: null,
          message,
          queued: false,
          skipped: true,
          reason: "filter",
        });
      }
    }

    const node = createTaskNode({
      chatId: String(body.chatId),
      chatTitle: message.chatTitle,
      source: "manual",
      filter: body.filter,
    });

    const job = body.processImmediately ? createDownloadJob(message, node) : await enqueueMessageDownload(message, node);
    if (body.processImmediately) {
      await persistTaskNode(node);
    }
    const result = body.processImmediately ? await processJob(job) : undefined;

    return NextResponse.json({
      task: node,
      message,
      queued: !body.processImmediately,
      result,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Telegram message download failed" },
      { status: 409 },
    );
  }
}
