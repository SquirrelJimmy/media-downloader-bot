import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedMessage, TaskNode } from "@/types/download";

let tempDir: string;

async function loadWorkerModules() {
  vi.resetModules();
  tempDir = await mkdtemp(join(tmpdir(), "telegram-download-worker-"));
  process.env.DATABASE_URL = `file:${join(tempDir, "test.db")}`;
  vi.doMock("@/config/load", async () => {
    const { parseAppConfig } = await import("@/config/schema");
    return {
      loadAppConfig: async () => parseAppConfig({}),
      saveAppConfig: vi.fn(),
    };
  });
  const migrateModule = await import("@/db/migrate");
  const clientModule = await import("@/db/client");
  const serviceModule = await import("@/engine/task-service");
  const workerModule = await import("@/engine/worker");
  await migrateModule.migrate();
  return { ...clientModule, ...serviceModule, ...workerModule };
}

function message(): NormalizedMessage {
  return {
    id: 9,
    chatId: "-1001",
    chatTitle: "Source",
    mediaType: "photo",
    fileName: "photo.jpg",
    senderId: "sender-1",
    senderName: "Alice",
    forwardOrigin: {
      chatId: "-1002",
      chatTitle: "Origin Channel",
      messageId: 7,
    },
  };
}

function node(): TaskNode {
  const now = new Date().toISOString();
  return {
    id: "task-filter-skip",
    chatId: "-1001",
    chatTitle: "Source",
    type: "download",
    source: "bot",
    status: "queued",
    filter: "media_type == 'video'",
    counters: {
      total: 1,
      success: 0,
      failed: 0,
      skipped: 0,
      stopped: 0,
    },
    createdAt: now,
    updatedAt: now,
  };
}

describe("worker", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    vi.doUnmock("@/config/load");
    delete process.env.DATABASE_URL;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("records and counts filter skips", async () => {
    const { libsqlClient, persistTaskNode, processJob } = await loadWorkerModules();
    const task = node();
    await persistTaskNode(task);

    const result = await processJob({
      id: "job-filter-skip",
      message: message(),
      node: task,
    });

    expect(result.status).toBe("skip");
    const downloads = await libsqlClient.execute("SELECT status, sender_id, task_id FROM downloads");
    expect(downloads.rows).toHaveLength(1);
    expect(downloads.rows.at(0)?.status).toBe("skip");
    expect(downloads.rows.at(0)?.sender_id).toBe("sender-1");
    expect(downloads.rows.at(0)?.task_id).toBe(1);

    const tasks = await libsqlClient.execute("SELECT skip_count FROM tasks WHERE external_id = 'task-filter-skip'");
    expect(tasks.rows.at(0)?.skip_count).toBe(1);
  });

  it("does not overwrite queue-derived active task count", async () => {
    vi.resetModules();
    tempDir = await mkdtemp(join(tmpdir(), "telegram-download-worker-active-"));
    process.env.DATABASE_URL = `file:${join(tempDir, "test.db")}`;
    vi.doMock("@/config/load", async () => {
      const { parseAppConfig } = await import("@/config/schema");
      return {
        loadAppConfig: async () => parseAppConfig({}),
        saveAppConfig: vi.fn(),
      };
    });
    vi.doMock("@/plugins", () => ({
      registerBuiltinPlugins: () => ({
        download: vi.fn(async () => ({
          status: "success" as const,
          fileName: "photo.jpg",
          filePath: "downloads/photo.jpg",
          fileSize: 10,
        })),
      }),
    }));

    const migrateModule = await import("@/db/migrate");
    const serviceModule = await import("@/engine/task-service");
    const runtimeModule = await import("@/engine/runtime-state");
    const workerModule = await import("@/engine/worker");
    await migrateModule.migrate();
    const task = { ...node(), filter: undefined };
    await serviceModule.persistTaskNode(task);
    runtimeModule.updateRuntimeStatus({ activeTasks: 2 });

    await workerModule.processJob({
      id: "job-success",
      message: message(),
      node: task,
    });

    expect(runtimeModule.getRuntimeStatus().activeTasks).toBe(2);
    vi.doUnmock("@/plugins");
  });

  it("publishes source metadata with download progress events", async () => {
    vi.resetModules();
    tempDir = await mkdtemp(join(tmpdir(), "telegram-download-worker-progress-"));
    process.env.DATABASE_URL = `file:${join(tempDir, "test.db")}`;
    vi.doMock("@/config/load", async () => {
      const { parseAppConfig } = await import("@/config/schema");
      return {
        loadAppConfig: async () => parseAppConfig({}),
        saveAppConfig: vi.fn(),
      };
    });
    vi.doMock("@/plugins", () => ({
      registerBuiltinPlugins: () => ({
        download: vi.fn(async (_req, ctx) => {
          ctx.onProgress(5, 10, 2);
          return {
            status: "success" as const,
            fileName: "photo.jpg",
            filePath: "downloads/photo.jpg",
            fileSize: 10,
          };
        }),
      }),
    }));

    const migrateModule = await import("@/db/migrate");
    const serviceModule = await import("@/engine/task-service");
    const runtimeModule = await import("@/engine/runtime-state");
    const workerModule = await import("@/engine/worker");
    await migrateModule.migrate();
    const task = { ...node(), id: "task-progress", filter: undefined };
    await serviceModule.persistTaskNode(task);
    const events: Array<{ event: string; payload: unknown }> = [];
    const unsubscribe = runtimeModule.subscribeRuntimeEvents((event) => events.push(event));

    await workerModule.processJob({
      id: "job-progress",
      message: message(),
      node: task,
    });
    unsubscribe();

    const progress = events.find((event) => event.event === "download.progress")?.payload as
      | Record<string, unknown>
      | undefined;
    expect(progress).toMatchObject({
      jobId: "job-progress",
      taskId: "task-progress",
      chatTitle: "Source",
      messageId: 9,
      fileName: "photo.jpg",
      senderName: "Alice",
      forwardChatTitle: "Origin Channel",
      forwardMessageId: 7,
      downloaded: 5,
      total: 10,
      speed: 2,
    });
    vi.doUnmock("@/plugins");
  });

  it("records and counts failed downloads when a plugin throws", async () => {
    vi.resetModules();
    tempDir = await mkdtemp(join(tmpdir(), "telegram-download-worker-failed-"));
    process.env.DATABASE_URL = `file:${join(tempDir, "test.db")}`;
    vi.doMock("@/config/load", async () => {
      const { parseAppConfig } = await import("@/config/schema");
      return {
        loadAppConfig: async () => parseAppConfig({}),
        saveAppConfig: vi.fn(),
      };
    });
    vi.doMock("@/plugins", () => ({
      registerBuiltinPlugins: () => ({
        download: vi.fn(async () => {
          throw new Error("plugin exploded");
        }),
      }),
    }));

    const migrateModule = await import("@/db/migrate");
    const clientModule = await import("@/db/client");
    const serviceModule = await import("@/engine/task-service");
    const workerModule = await import("@/engine/worker");
    await migrateModule.migrate();
    const task = { ...node(), id: "task-plugin-failed", filter: undefined };
    await serviceModule.persistTaskNode(task);

    const result = await workerModule.processJob({
      id: "job-plugin-failed",
      message: message(),
      node: task,
    });

    expect(result.status).toBe("failed");
    const downloads = await clientModule.libsqlClient.execute(
      "SELECT status, error_msg, sender_id, task_id FROM downloads",
    );
    expect(downloads.rows).toHaveLength(1);
    expect(downloads.rows.at(0)?.status).toBe("failed");
    expect(downloads.rows.at(0)?.error_msg).toBe("plugin exploded");
    expect(downloads.rows.at(0)?.sender_id).toBe("sender-1");
    expect(downloads.rows.at(0)?.task_id).toBe(1);

    const tasks = await clientModule.libsqlClient.execute(
      "SELECT failed_count FROM tasks WHERE external_id = 'task-plugin-failed'",
    );
    expect(tasks.rows.at(0)?.failed_count).toBe(1);
    vi.doUnmock("@/plugins");
  });

  it("records failed downloads when Telegram message hydration fails", async () => {
    vi.resetModules();
    tempDir = await mkdtemp(join(tmpdir(), "telegram-download-worker-hydrate-failed-"));
    process.env.DATABASE_URL = `file:${join(tempDir, "test.db")}`;
    vi.doMock("@/config/load", async () => {
      const { parseAppConfig } = await import("@/config/schema");
      return {
        loadAppConfig: async () => parseAppConfig({}),
        saveAppConfig: vi.fn(),
      };
    });
    vi.doMock("@/engine/user-client", () => ({
      getTelegramMessage: vi.fn(async () => {
        throw new Error("cannot fetch telegram message");
      }),
      ensureStartedUserClient: vi.fn(),
    }));

    const migrateModule = await import("@/db/migrate");
    const clientModule = await import("@/db/client");
    const serviceModule = await import("@/engine/task-service");
    const workerModule = await import("@/engine/worker");
    await migrateModule.migrate();
    const task = { ...node(), id: "task-hydrate-failed", filter: undefined };
    await serviceModule.persistTaskNode(task);

    const result = await workerModule.processJob({
      id: "job-hydrate-failed",
      message: {
        ...message(),
        media: undefined,
        source: {
          kind: "mtcute",
          chatId: "-1001",
          messageId: 9,
        },
      },
      node: task,
    });

    expect(result.status).toBe("failed");
    const downloads = await clientModule.libsqlClient.execute("SELECT status, error_msg FROM downloads");
    expect(downloads.rows.at(0)).toMatchObject({
      status: "failed",
      error_msg: "cannot fetch telegram message",
    });
    const tasks = await clientModule.libsqlClient.execute(
      "SELECT failed_count FROM tasks WHERE external_id = 'task-hydrate-failed'",
    );
    expect(tasks.rows.at(0)?.failed_count).toBe(1);
    vi.doUnmock("@/engine/user-client");
  });

  it("starts one dequeue loop per configured download worker", async () => {
    vi.resetModules();
    vi.doMock("@/config/load", async () => {
      const { parseAppConfig } = await import("@/config/schema");
      return {
        loadAppConfig: async () => parseAppConfig({ queue: { max_download_tasks: 3 } }),
        saveAppConfig: vi.fn(),
      };
    });
    const dequeue = vi.fn((options: { workerId: string }) => {
      expect(options.workerId).toContain("download-worker-");
      return new Promise(() => undefined);
    });
    vi.doMock("@/engine/task-queue", () => ({
      taskQueue: {
        dequeue,
      },
    }));

    const { runWorker } = await import("@/engine/worker");
    void runWorker();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(dequeue).toHaveBeenCalledTimes(3);
    expect(dequeue.mock.calls.map(([arg]) => arg.workerId)).toEqual([
      expect.stringContaining("download-worker-"),
      expect.stringContaining("download-worker-"),
      expect.stringContaining("download-worker-"),
    ]);

    vi.doUnmock("@/engine/task-queue");
  });

  it("exits idle worker loops when the runtime restart signal aborts", async () => {
    vi.resetModules();
    vi.doMock("@/config/load", async () => {
      const { parseAppConfig } = await import("@/config/schema");
      return {
        loadAppConfig: async () => parseAppConfig({ queue: { max_download_tasks: 1 } }),
        saveAppConfig: vi.fn(),
      };
    });
    vi.doMock("@/engine/task-queue", async () => {
      const actual = await vi.importActual<typeof import("@/engine/task-queue")>("@/engine/task-queue");
      return {
        ...actual,
        taskQueue: {
          dequeue: vi.fn(
            ({ abortSignal }: { abortSignal: AbortSignal }) =>
              new Promise((_, reject) => {
                abortSignal.addEventListener("abort", () => reject(abortSignal.reason), { once: true });
              }),
          ),
        },
      };
    });
    const { runWorker } = await import("@/engine/worker");
    const abortController = new AbortController();
    const promise = runWorker({ abortSignal: abortController.signal });

    abortController.abort(new Error("runtime restart"));

    await expect(promise).resolves.toBeUndefined();
    vi.doUnmock("@/engine/task-queue");
  });
});
