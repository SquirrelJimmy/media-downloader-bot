import { afterEach, describe, expect, it, vi } from "vitest";

describe("/api/status", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@/engine/server-bootstrap");
    vi.doUnmock("@/config/load");
    vi.doUnmock("@/engine/task-queue");
    vi.doUnmock("@/engine/runtime-state");
    vi.doUnmock("@/engine/user-client");
    vi.doUnmock("@/engine/bot-client");
  });

  it("returns JSON status when runtime auto-start fails", async () => {
    vi.doMock("@/engine/server-bootstrap", () => ({
      startServerRuntime: vi.fn(async () => {
        throw Object.assign(new Error("SQLITE_BUSY: database is locked"), {
          code: "SQLITE_BUSY",
        });
      }),
      getServerBootstrapStatus: vi.fn(() => ({
        initialized: false,
        botStarted: false,
        workerStarted: false,
        listenForwardStarted: false,
        lastError: "SQLITE_BUSY: database is locked",
      })),
    }));
    vi.doMock("@/config/load", () => ({
      loadAppConfig: vi.fn(async () => ({
        telegram: {
          bot_token: "",
          allowed_user_ids: [],
        },
      })),
    }));
    vi.doMock("@/engine/task-queue", () => ({
      isSqliteBusyError: vi.fn((error: unknown) => String((error as { message?: string }).message ?? "").includes("SQLITE_BUSY")),
      taskQueue: {
        refreshRuntimeStatus: vi.fn(async () => {
          throw new Error("SQLITE_BUSY: database is locked");
        }),
      },
    }));
    vi.doMock("@/engine/runtime-state", () => ({
      getRuntimeStatus: vi.fn(() => ({
        activeTasks: 0,
        queuedTasks: 0,
        downloadSpeedBytesPerSecond: 0,
      })),
    }));
    vi.doMock("@/engine/user-client", () => ({
      getUserClientStatus: vi.fn(() => ({ configured: false, started: false })),
    }));
    vi.doMock("@/engine/bot-client", () => ({
      getBotClientStatus: vi.fn(() => ({
        configured: false,
        started: false,
        allowedUserCount: 0,
        commandsRegistered: false,
        startupNoticeSent: false,
      })),
    }));

    const { GET } = await import("./route");

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.error).toContain("SQLITE_BUSY");
    expect(data.serverRuntime.lastError).toContain("SQLITE_BUSY");
    expect(data.sqliteBusy).toBe(true);
  });
});
