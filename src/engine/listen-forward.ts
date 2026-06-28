import { db, libsqlClient } from "@/db/client";
import { listenForwardRules } from "@/db/schema";
import { loadAppConfig } from "@/config/load";
import { runConfiguredDownloads } from "@/engine/config-driven-download";
import { sleep } from "@/engine/task-queue";
import { filterEngine } from "@/filter/dsl";
import { logger } from "@/utils/logger";

export async function createListenForwardRule(input: {
  sourceChatId: string;
  targetChatId: string;
  filter?: string;
  pollIntervalSeconds?: number;
  lastReadMessageId?: number;
}) {
  if (input.filter) {
    const checked = filterEngine.check(input.filter);
    if (!checked.ok) {
      throw new Error(checked.error ?? "invalid filter");
    }
  }

  const timestamp = new Date().toISOString();
  await libsqlClient.execute({
    sql: `
      UPDATE listen_forward_rules
      SET enabled = 0, updated_at = ?
      WHERE source_chat_id = ?
        AND enabled = 1
    `,
    args: [timestamp, input.sourceChatId],
  });

  const result = await db
    .insert(listenForwardRules)
    .values({
      sourceChatId: input.sourceChatId,
      targetChatId: input.targetChatId,
      filter: input.filter,
      pollIntervalSeconds: input.pollIntervalSeconds ?? 10,
      lastReadMessageId: input.lastReadMessageId ?? 0,
      updatedAt: timestamp,
    })
    .returning();

  return result.at(0);
}

export async function listListenForwardRules() {
  return db.select().from(listenForwardRules);
}

export async function disableListenForwardRules(sourceChatId?: string) {
  const timestamp = new Date().toISOString();
  const whereSource = sourceChatId ? "AND source_chat_id = ?" : "";
  const result = await libsqlClient.execute({
    sql: `
      UPDATE listen_forward_rules
      SET enabled = 0, updated_at = ?
      WHERE enabled = 1
        ${whereSource}
    `,
    args: sourceChatId ? [timestamp, sourceChatId] : [timestamp],
  });
  return result.rowsAffected;
}

function shouldPollRule(rule: { updatedAt: string | null; pollIntervalSeconds: number }, now = Date.now()) {
  const updatedAt = rule.updatedAt ? Date.parse(rule.updatedAt) : 0;
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) {
    return true;
  }
  return now - updatedAt >= rule.pollIntervalSeconds * 1000;
}

export async function runListenForwardOnce(options: { force?: boolean } = {}) {
  const config = await loadAppConfig();
  const rules = await listListenForwardRules();
  const enabled = rules.filter((rule) => rule.enabled && (options.force || shouldPollRule(rule)));
  const results = [];

  for (const rule of enabled) {
    const result = await runConfiguredDownloads({
      chats: [
        {
          chat_id: rule.sourceChatId,
          enabled: true,
          last_read_message_id: rule.lastReadMessageId,
          ids_to_retry: [],
          download_filter: rule.filter ?? "",
          upload_telegram_chat_id: rule.targetChatId,
          limit: 100,
          reverse: true,
        },
      ],
      taskType: "listen_forward",
      source: "bot",
      uploadTelegramChatId: rule.targetChatId,
    }, config);

    const lastReadMessageId = result.chats.at(0)?.lastReadMessageId ?? rule.lastReadMessageId;
    await libsqlClient.execute({
      sql: `
        UPDATE listen_forward_rules
        SET last_read_message_id = ?, updated_at = ?
        WHERE id = ?
      `,
      args: [lastReadMessageId, new Date().toISOString(), rule.id],
    });
    results.push({ ruleId: rule.id, ...result });
  }

  return results;
}

export async function runListenForwardLoop(options: { abortSignal?: AbortSignal } = {}) {
  logger.info("listen_forward loop started");
  for (;;) {
    if (options.abortSignal?.aborted) {
      return;
    }
    await runListenForwardOnce().catch((error) => {
      logger.error({ error }, "listen_forward poll failed");
    });
    await sleep(10_000, options.abortSignal).catch((error) => {
      if (!options.abortSignal?.aborted) {
        throw error;
      }
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runListenForwardLoop().catch((error) => {
    logger.error({ error }, "listen_forward loop crashed");
    process.exitCode = 1;
  });
}
