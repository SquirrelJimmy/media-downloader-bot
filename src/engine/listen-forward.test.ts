import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir: string;

async function loadListenForwardModule() {
  vi.resetModules();
  tempDir = await mkdtemp(join(tmpdir(), "telegram-download-listen-forward-"));
  process.env.DATABASE_URL = `file:${join(tempDir, "test.db")}`;
  vi.doMock("@/config/load", async () => {
    const { parseAppConfig } = await import("@/config/schema");
    return {
      loadAppConfig: async () => parseAppConfig({}),
      saveAppConfig: vi.fn(),
    };
  });
  const migrateModule = await import("@/db/migrate");
  const listenForwardModule = await import("@/engine/listen-forward");
  await migrateModule.migrate();
  return listenForwardModule;
}

describe("listen forward rules", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    vi.doUnmock("@/config/load");
    vi.doUnmock("@/engine/config-driven-download");
    delete process.env.DATABASE_URL;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("stores the initial last read message id", async () => {
    const { createListenForwardRule, listListenForwardRules } = await loadListenForwardModule();
    await createListenForwardRule({
      sourceChatId: "-1001",
      targetChatId: "-1002",
      lastReadMessageId: 123,
    });

    const rules = await listListenForwardRules();
    expect(rules).toHaveLength(1);
    expect(rules[0]?.lastReadMessageId).toBe(123);
  });

  it("replaces an existing enabled rule for the same source chat", async () => {
    const { createListenForwardRule, listListenForwardRules } = await loadListenForwardModule();
    await createListenForwardRule({
      sourceChatId: "-1001",
      targetChatId: "-1002",
      lastReadMessageId: 123,
    });
    await createListenForwardRule({
      sourceChatId: "-1001",
      targetChatId: "-1003",
      filter: "media_type == 'video'",
      lastReadMessageId: 200,
    });

    const rules = await listListenForwardRules();
    expect(rules).toHaveLength(2);
    expect(rules.filter((rule) => rule.sourceChatId === "-1001" && rule.enabled)).toHaveLength(1);
    expect(rules.find((rule) => rule.enabled)).toMatchObject({
      sourceChatId: "-1001",
      targetChatId: "-1003",
      filter: "media_type == 'video'",
      lastReadMessageId: 200,
    });
  });

  it("only polls the latest enabled rule for a replaced listen_forward source", async () => {
    const runConfiguredDownloads = vi.fn(async () => ({
      chats: [{ lastReadMessageId: 300 }],
      totalChats: 1,
      processedChats: 1,
      queued: 0,
      skipped: 0,
      dryRun: false,
    }));
    vi.doMock("@/engine/config-driven-download", () => ({
      runConfiguredDownloads,
    }));
    const { createListenForwardRule, runListenForwardOnce } = await loadListenForwardModule();
    await createListenForwardRule({
      sourceChatId: "-1001",
      targetChatId: "-1002",
      lastReadMessageId: 123,
    });
    await createListenForwardRule({
      sourceChatId: "-1001",
      targetChatId: "-1003",
      lastReadMessageId: 200,
    });

    await runListenForwardOnce({ force: true });

    expect(runConfiguredDownloads).toHaveBeenCalledTimes(1);
    expect(runConfiguredDownloads).toHaveBeenCalledWith(
      expect.objectContaining({
        chats: [
          expect.objectContaining({
            chat_id: "-1001",
            last_read_message_id: 200,
            upload_telegram_chat_id: "-1003",
          }),
        ],
      }),
      expect.anything(),
    );
  });

  it("respects poll interval unless forced", async () => {
    const runConfiguredDownloads = vi.fn(async () => ({
      chats: [{ lastReadMessageId: 124 }],
      totalChats: 1,
      processedChats: 1,
      queued: 0,
      skipped: 0,
      dryRun: false,
    }));
    vi.doMock("@/engine/config-driven-download", () => ({
      runConfiguredDownloads,
    }));
    const { createListenForwardRule, runListenForwardOnce } = await loadListenForwardModule();
    await createListenForwardRule({
      sourceChatId: "-1001",
      targetChatId: "-1002",
      lastReadMessageId: 123,
      pollIntervalSeconds: 3600,
    });

    expect(await runListenForwardOnce()).toEqual([]);
    expect(runConfiguredDownloads).not.toHaveBeenCalled();

    await runListenForwardOnce({ force: true });
    expect(runConfiguredDownloads).toHaveBeenCalledTimes(1);
  });

  it("exits the listen-forward loop when the runtime restart signal aborts", async () => {
    const { runListenForwardLoop } = await loadListenForwardModule();
    const abortController = new AbortController();
    const promise = runListenForwardLoop({ abortSignal: abortController.signal });

    await new Promise((resolve) => setTimeout(resolve, 0));
    abortController.abort(new Error("runtime restart"));

    await expect(promise).resolves.toBeUndefined();
  });
});
