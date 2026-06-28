import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedMessage } from "@/types/download";

let tempDir: string;

function message(id: number): NormalizedMessage {
  return {
    id,
    chatId: "-1001",
    chatTitle: "Source",
    mediaType: "photo",
    fileName: `${id}.jpg`,
  };
}

async function loadConfiguredDownloadModules() {
  vi.resetModules();
  tempDir = await mkdtemp(join(tmpdir(), "telegram-download-configured-"));
  process.env.DATABASE_URL = `file:${join(tempDir, "test.db")}`;

  vi.doMock("@/engine/user-client", () => ({
    getTelegramMessage: vi.fn(),
    iterTelegramHistory: async function* () {
      yield message(10);
    },
  }));

  vi.doMock("@/engine/task-queue", async () => {
    const clientModule = await import("@/db/client");
    return {
      taskQueue: {
        enqueue: vi.fn(async () => {
          const rows = await clientModule.libsqlClient.execute("SELECT external_id FROM tasks");
          expect(rows.rows).toHaveLength(1);
          return {
            queueId: 1,
            attempts: 0,
          };
        }),
      },
    };
  });

  const migrateModule = await import("@/db/migrate");
  const configModule = await import("@/config/schema");
  const configuredModule = await import("@/engine/config-driven-download");
  await migrateModule.migrate();
  return { ...configModule, ...configuredModule };
}

async function loadConfiguredDownloadModulesWithUserClient(input: {
  retryMessages?: Record<number, NormalizedMessage | null>;
  historyMessages?: NormalizedMessage[];
}) {
  vi.resetModules();
  tempDir = await mkdtemp(join(tmpdir(), "telegram-download-configured-"));
  process.env.DATABASE_URL = `file:${join(tempDir, "test.db")}`;

  const historyCalls: Array<{ chatId: string | number; params: unknown }> = [];

  vi.doMock("@/engine/user-client", () => ({
    getTelegramMessage: vi.fn(async (_config, _chatId, messageId: number) => input.retryMessages?.[messageId] ?? null),
    iterTelegramHistory: async function* (_config: unknown, chatId: string | number, params: unknown) {
      historyCalls.push({ chatId, params });
      for (const item of input.historyMessages ?? []) {
        yield item;
      }
    },
  }));

  const enqueued: unknown[] = [];
  vi.doMock("@/engine/task-queue", () => ({
    taskQueue: {
      enqueue: vi.fn(async (job) => {
        enqueued.push(job);
        return {
          queueId: enqueued.length,
          attempts: 0,
        };
      }),
    },
  }));

  const migrateModule = await import("@/db/migrate");
  const clientModule = await import("@/db/client");
  const configModule = await import("@/config/schema");
  const configuredModule = await import("@/engine/config-driven-download");
  await migrateModule.migrate();
  return { ...clientModule, ...configModule, ...configuredModule, enqueued, historyCalls };
}

describe("configured downloads", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    vi.doUnmock("@/engine/user-client");
    vi.doUnmock("@/engine/task-queue");
    delete process.env.DATABASE_URL;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("persists the task before enqueueing messages", async () => {
    const { parseAppConfig, runConfiguredDownloads } = await loadConfiguredDownloadModules();
    const result = await runConfiguredDownloads(
      {
        chats: [
          {
            chat_id: "-1001",
            enabled: true,
            last_read_message_id: 0,
            ids_to_retry: [],
            download_filter: "",
            upload_telegram_chat_id: "",
            reverse: true,
          },
        ],
      },
      parseAppConfig({}),
    );

    expect(result.queued).toBe(1);
  });

  it("does not advance chat history progress from ids_to_retry messages", async () => {
    const { libsqlClient, parseAppConfig, runConfiguredDownloads, enqueued } =
      await loadConfiguredDownloadModulesWithUserClient({
        retryMessages: {
          100: message(100),
        },
        historyMessages: [message(11), message(12)],
      });

    const result = await runConfiguredDownloads(
      {
        chats: [
          {
            chat_id: "-1001",
            enabled: true,
            last_read_message_id: 10,
            ids_to_retry: [100],
            download_filter: "",
            upload_telegram_chat_id: "",
            reverse: true,
          },
        ],
      },
      parseAppConfig({}),
    );

    expect(result.queued).toBe(3);
    expect(result.chats[0]?.lastReadMessageId).toBe(12);
    expect(enqueued).toHaveLength(3);

    const progress = await libsqlClient.execute("SELECT last_read_message_id FROM chat_progress WHERE chat_id = '-1001'");
    expect(progress.rows.at(0)?.last_read_message_id).toBe(12);
  });

  it("passes inclusive end id bounds to telegram history", async () => {
    const { parseAppConfig, runConfiguredDownloads, historyCalls } =
      await loadConfiguredDownloadModulesWithUserClient({
        historyMessages: [],
      });

    await runConfiguredDownloads(
      {
        chats: [
          {
            chat_id: "-1001",
            enabled: true,
            last_read_message_id: 0,
            ids_to_retry: [],
            download_filter: "",
            upload_telegram_chat_id: "",
            limit: 6,
            start_offset_id: 10,
            end_offset_id: 15,
            reverse: true,
          },
        ],
      },
      parseAppConfig({}),
    );

    expect(historyCalls).toHaveLength(1);
    expect(historyCalls[0]).toEqual({
      chatId: "-1001",
      params: {
        limit: 6,
        offsetId: 10,
        minId: 10,
        maxId: 16,
        reverse: true,
      },
    });
  });

  it("does not enqueue or advance progress for messages beyond end_offset_id", async () => {
    const { libsqlClient, parseAppConfig, runConfiguredDownloads, enqueued } =
      await loadConfiguredDownloadModulesWithUserClient({
        historyMessages: [message(11), message(12), message(16)],
      });

    const result = await runConfiguredDownloads(
      {
        chats: [
          {
            chat_id: "-1001",
            enabled: true,
            last_read_message_id: 0,
            ids_to_retry: [],
            download_filter: "",
            upload_telegram_chat_id: "",
            start_offset_id: 10,
            end_offset_id: 12,
            reverse: true,
          },
        ],
      },
      parseAppConfig({}),
    );

    expect(result.queued).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.chats[0]?.lastReadMessageId).toBe(12);
    expect(enqueued.map((job) => (job as { message: NormalizedMessage }).message.id)).toEqual([11, 12]);

    const progress = await libsqlClient.execute("SELECT last_read_message_id FROM chat_progress WHERE chat_id = '-1001'");
    expect(progress.rows.at(0)?.last_read_message_id).toBe(12);
  });
});
