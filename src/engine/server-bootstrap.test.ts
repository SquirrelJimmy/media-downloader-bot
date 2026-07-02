import { beforeEach, describe, expect, it, vi } from "vitest";

describe("server bootstrap", () => {
  beforeEach(() => {
    vi.resetModules();
    delete (globalThis as typeof globalThis & { __telegramDownloadServerBootstrap?: unknown })
      .__telegramDownloadServerBootstrap;
  });

  it("records bot startup errors without failing the server runtime", async () => {
    vi.doMock("@/db/migrate", () => ({
      migrate: vi.fn(async () => undefined),
    }));
    vi.doMock("@/config/load", () => ({
      loadAppConfig: vi.fn(async () => ({
        telegram: {
          bot_token: "bad-token",
        },
      })),
    }));
    vi.doMock("@/engine/bot-client", () => ({
      ensureStartedBotClient: vi.fn(async () => {
        throw new Error("invalid bot token");
      }),
      isBotClientReadyForConfig: vi.fn(() => false),
      stopBotClient: vi.fn(async () => undefined),
    }));
    const runListenForwardLoop = vi.fn(async () => undefined);
    const runWorker = vi.fn(async () => undefined);
    vi.doMock("@/engine/listen-forward", () => ({
      runListenForwardLoop,
    }));
    vi.doMock("@/engine/worker", () => ({
      runWorker,
    }));

    const { getServerBootstrapStatus, startServerRuntime } = await import("@/engine/server-bootstrap");

    await expect(startServerRuntime()).resolves.toBeUndefined();

    expect(getServerBootstrapStatus()).toMatchObject({
      initialized: true,
      workerStarted: true,
      listenForwardStarted: true,
      botStarted: false,
      botError: "invalid bot token",
    });
    expect(runWorker).toHaveBeenCalledWith({ abortSignal: expect.any(AbortSignal) });
    expect(runListenForwardLoop).toHaveBeenCalledWith({ abortSignal: expect.any(AbortSignal) });
  });

  it("retries migration when sqlite is briefly busy", async () => {
    const migrate = vi.fn()
      .mockRejectedValueOnce({ code: "SQLITE_BUSY" })
      .mockResolvedValue(undefined);
    vi.doMock("@/db/migrate", () => ({
      migrate,
    }));
    vi.doMock("@/config/load", () => ({
      loadAppConfig: vi.fn(async () => ({
        telegram: {
          bot_token: "",
        },
      })),
    }));
    vi.doMock("@/engine/bot-client", () => ({
      ensureStartedBotClient: vi.fn(async () => undefined),
      isBotClientReadyForConfig: vi.fn(() => true),
      stopBotClient: vi.fn(async () => undefined),
    }));
    vi.doMock("@/engine/listen-forward", () => ({
      runListenForwardLoop: vi.fn(async () => undefined),
    }));
    vi.doMock("@/engine/worker", () => ({
      runWorker: vi.fn(async () => undefined),
    }));

    const { startServerRuntime } = await import("@/engine/server-bootstrap");

    await expect(startServerRuntime()).resolves.toBeUndefined();
    expect(migrate).toHaveBeenCalledTimes(2);
  });

  it("restarts runtime services by stopping bot and aborting old loops", async () => {
    vi.doMock("@/db/migrate", () => ({
      migrate: vi.fn(async () => undefined),
    }));
    vi.doMock("@/config/load", () => ({
      loadAppConfig: vi.fn(async () => ({
        telegram: {
          bot_token: "token",
        },
      })),
    }));
    const stopBotClient = vi.fn(async () => undefined);
    const destroyUserClient = vi.fn(async () => undefined);
    vi.doMock("@/engine/bot-client", () => ({
      ensureStartedBotClient: vi.fn(async () => undefined),
      isBotClientReadyForConfig: vi.fn(() => false),
      stopBotClient,
    }));
    vi.doMock("@/engine/user-client", () => ({
      destroyUserClient,
    }));
    const workerSignals: AbortSignal[] = [];
    const listenSignals: AbortSignal[] = [];
    vi.doMock("@/engine/worker", () => ({
      runWorker: vi.fn(({ abortSignal }: { abortSignal: AbortSignal }) => {
        workerSignals.push(abortSignal);
        return new Promise<void>((resolve) => {
          abortSignal.addEventListener("abort", () => resolve(), { once: true });
        });
      }),
    }));
    vi.doMock("@/engine/listen-forward", () => ({
      runListenForwardLoop: vi.fn(({ abortSignal }: { abortSignal: AbortSignal }) => {
        listenSignals.push(abortSignal);
        return new Promise<void>((resolve) => {
          abortSignal.addEventListener("abort", () => resolve(), { once: true });
        });
      }),
    }));

    const { getServerBootstrapStatus, restartServerRuntime, startServerRuntime } = await import("@/engine/server-bootstrap");

    await startServerRuntime();
    const oldWorkerSignal = workerSignals[0];
    const oldListenSignal = listenSignals[0];

    await expect(restartServerRuntime()).resolves.toMatchObject({
      initialized: true,
      workerStarted: true,
      listenForwardStarted: true,
    });

    expect(stopBotClient).toHaveBeenCalledTimes(1);
    expect(destroyUserClient).toHaveBeenCalledTimes(1);
    expect(oldWorkerSignal?.aborted).toBe(true);
    expect(oldListenSignal?.aborted).toBe(true);
    expect(workerSignals).toHaveLength(2);
    expect(listenSignals).toHaveLength(2);
    expect(getServerBootstrapStatus()).toMatchObject({
      initialized: true,
      workerStarted: true,
      listenForwardStarted: true,
    });
  });
});
