import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedMessage, TaskNode } from "@/types/download";

let tempDir: string;

async function loadQueueModules() {
  vi.resetModules();
  tempDir = await mkdtemp(join(tmpdir(), "telegram-download-queue-"));
  process.env.DATABASE_URL = `file:${join(tempDir, "test.db")}`;
  const migrateModule = await import("@/db/migrate");
  const queueModule = await import("@/engine/task-queue");
  const serviceModule = await import("@/engine/task-service");
  await migrateModule.migrate();
  return { ...queueModule, ...serviceModule };
}

function message(): NormalizedMessage {
  return {
    id: 7,
    chatId: "-1001",
    mediaType: "photo",
  };
}

function node(id: string): TaskNode {
  const now = new Date().toISOString();
  return {
    id,
    chatId: "-1001",
    type: "download",
    source: "auto",
    status: "queued",
    counters: {
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      stopped: 0,
    },
    createdAt: now,
    updatedAt: now,
  };
}

describe("task queue", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    delete process.env.DATABASE_URL;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("allows the same message to be queued by different tasks", async () => {
    const { taskQueue, createDownloadJob } = await loadQueueModules();
    await taskQueue.enqueue(createDownloadJob(message(), node("task-a")));
    await taskQueue.enqueue(createDownloadJob(message(), node("task-b")));

    expect(await taskQueue.size()).toBe(2);
  });

  it("recognizes libsql sqlite busy errors", async () => {
    const { isSqliteBusyError } = await loadQueueModules();

    expect(isSqliteBusyError({ code: "SQLITE_BUSY" })).toBe(true);
    expect(isSqliteBusyError({ extendedCode: "SQLITE_BUSY" })).toBe(true);
    expect(isSqliteBusyError({ rawCode: 5 })).toBe(true);
    expect(isSqliteBusyError(new Error("SQLITE_BUSY: database is locked"))).toBe(true);
    expect(isSqliteBusyError(new Error("other"))).toBe(false);
  });
});
