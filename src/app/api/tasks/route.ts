import { NextResponse } from "next/server";
import { loadAppConfig } from "@/config/load";
import { listTasks } from "@/db/queries";
import { getTelegramMessage } from "@/engine/user-client";
import { createTaskNode, enqueueMessageDownload } from "@/engine/task-service";
import { filterEngine } from "@/filter/dsl";
import type { NormalizedMessage } from "@/types/download";
import { parseTelegramMessageRef } from "@/utils/telegram-link";
import { extractUrls, getHostname } from "@/utils/url";

export const runtime = "nodejs";

function isTelegramUrl(url: string) {
  const host = getHostname(url);
  return host === "t.me" || host.endsWith(".t.me") || host === "telegram.me" || host.endsWith(".telegram.me");
}

function responseMessage(message: NormalizedMessage) {
  return {
    id: message.id,
    chatId: message.chatId,
    chatTitle: message.chatTitle,
    mediaType: message.mediaType,
  };
}

function queuedTelegramMessage(
  message: NormalizedMessage,
  source: NonNullable<NormalizedMessage["source"]>,
): NormalizedMessage {
  return {
    ...message,
    media: undefined,
    source,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get("limit") ?? 50);
  return NextResponse.json({ data: await listTasks(Number.isFinite(limit) ? limit : 50) });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { input?: string; filter?: string };
  const input = body.input?.trim();
  if (!input) {
    return NextResponse.json({ error: "input is required" }, { status: 400 });
  }

  const urls = extractUrls(input);
  if (urls.length === 0) {
    return NextResponse.json({ error: "input must contain one http(s) URL" }, { status: 400 });
  }
  if (urls.length > 1) {
    return NextResponse.json({ error: "only one URL can be added at a time" }, { status: 400 });
  }

  const filter = body.filter?.trim() || undefined;
  if (filter) {
    const checked = filterEngine.check(filter);
    if (!checked.ok) {
      return NextResponse.json({ error: checked.error ?? "invalid filter" }, { status: 400 });
    }
  }

  const url = urls[0];
  const config = await loadAppConfig();
  let message: NormalizedMessage;

  if (isTelegramUrl(url)) {
    const ref = parseTelegramMessageRef(url);
    if (!ref) {
      return NextResponse.json({ error: "Telegram URL must point to a message" }, { status: 400 });
    }

    const telegramMessage = await getTelegramMessage(config, ref.chatId, ref.messageId);
    if (!telegramMessage) {
      return NextResponse.json({ error: "message not found" }, { status: 404 });
    }
    message = queuedTelegramMessage(telegramMessage, {
      kind: "mtcute",
      chatId: ref.chatId,
      messageId: ref.messageId,
    });
  } else {
    message = {
      id: Date.now(),
      chatId: "external",
      chatTitle: "External URL",
      date: new Date().toISOString(),
      text: url,
      mediaType: "external",
      fileName: url,
    };
  }

  const node = createTaskNode({
    chatId: message.chatId,
    chatTitle: message.chatTitle,
    source: "manual",
    filter,
  });
  const queueItem = await enqueueMessageDownload(message, node);

  return NextResponse.json({
    task: node,
    queued: true,
    queueItem: {
      id: queueItem.queueId,
      jobId: queueItem.id,
    },
    message: responseMessage(message),
  });
}
