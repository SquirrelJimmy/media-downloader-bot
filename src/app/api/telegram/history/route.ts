import { NextResponse } from "next/server";
import { loadAppConfig } from "@/config/load";
import { processJob } from "@/engine/worker";
import {
  createDownloadJob,
  createTaskNode,
  enqueueExistingDownloadJob,
  persistTaskNode,
} from "@/engine/task-service";
import { iterTelegramHistory } from "@/engine/user-client";
import { filterEngine } from "@/filter/dsl";
import { metadataFromMessage } from "@/filter/metadata";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    chatId?: string | number;
    limit?: number;
    offsetId?: number;
    minId?: number;
    maxId?: number;
    reverse?: boolean;
    filter?: string;
    processImmediately?: boolean;
  };

  if (!body.chatId) {
    return NextResponse.json({ error: "chatId is required" }, { status: 400 });
  }

  const config = await loadAppConfig();
  if (body.filter) {
    const checked = filterEngine.check(body.filter);
    if (!checked.ok) {
      return NextResponse.json({ error: checked.error ?? "invalid filter" }, { status: 400 });
    }
  }

  const node = createTaskNode({
    chatId: String(body.chatId),
    source: "manual",
    filter: body.filter,
  });

  let queued = 0;
  const results = [];
  const messages = [];
  let skipped = 0;
  for await (const message of iterTelegramHistory(config, body.chatId, {
    limit: body.limit ?? 100,
    offsetId: body.offsetId,
    minId: body.minId,
    maxId: body.maxId,
    reverse: body.reverse,
  })) {
    node.chatTitle ??= message.chatTitle;
    if (body.filter && !filterEngine.execute(body.filter, metadataFromMessage(message))) {
      skipped += 1;
      continue;
    }
    if (body.processImmediately) {
      const job = createDownloadJob(message, node);
      await persistTaskNode(node);
      results.push(await processJob(job));
    } else {
      messages.push(message);
    }
    queued += 1;
  }

  if (!body.processImmediately) {
    for (const message of messages) {
      await enqueueExistingDownloadJob(message, node);
    }
    await persistTaskNode(node);
  }

  return NextResponse.json({
    task: node,
    queued: body.processImmediately ? 0 : queued,
    processed: body.processImmediately ? queued : 0,
    skipped,
    results: body.processImmediately ? results : undefined,
  });
}
