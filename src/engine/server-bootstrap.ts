import { loadAppConfig } from "@/config/load";
import { migrate } from "@/db/migrate";
import { ensureStartedBotClient, isBotClientReadyForConfig, stopBotClient } from "@/engine/bot-client";
import { runListenForwardLoop } from "@/engine/listen-forward";
import { destroyUserClient } from "@/engine/user-client";
import { runWorker } from "@/engine/worker";
import { logger } from "@/utils/logger";

interface ServerBootstrapState {
  promise?: Promise<void>;
  initialized: boolean;
  botStarted: boolean;
  workerStarted: boolean;
  listenForwardStarted: boolean;
  workerAbortController?: AbortController;
  listenForwardAbortController?: AbortController;
  workerPromise?: Promise<void>;
  listenForwardPromise?: Promise<void>;
  lastError?: string;
  botError?: string;
  workerError?: string;
  listenForwardError?: string;
}

const globalState = globalThis as typeof globalThis & {
  __telegramDownloadServerBootstrap?: ServerBootstrapState;
};

const bootstrapState =
  globalState.__telegramDownloadServerBootstrap ??
  (globalState.__telegramDownloadServerBootstrap = {
    initialized: false,
    botStarted: false,
    workerStarted: false,
    listenForwardStarted: false,
  });

bootstrapState.initialized ??= false;
bootstrapState.botStarted ??= false;
bootstrapState.workerStarted ??= false;
bootstrapState.listenForwardStarted ??= false;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isSqliteBusyError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as Record<string, unknown>;
  return (
    record.code === "SQLITE_BUSY" ||
    record.extendedCode === "SQLITE_BUSY" ||
    record.rawCode === 5 ||
    String(record.message ?? "").includes("SQLITE_BUSY")
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retrySqliteBusy<T>(operation: () => Promise<T>, label: string, attempts = 30) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isSqliteBusyError(error) || attempt === attempts) {
        throw error;
      }
      const delayMs = Math.min(2000, attempt * 250);
      logger.warn({ error, attempt, attempts, delayMs }, `${label} retrying because sqlite is busy`);
      await sleep(delayMs);
    }
  }
  throw lastError;
}

function shouldSkipBootstrap() {
  return process.env.NEXT_RUNTIME === "edge" || process.env.NEXT_PHASE === "phase-production-build";
}

async function waitForRuntimeLoopStop(promise: Promise<void> | undefined, label: string) {
  if (!promise) {
    return;
  }
  let timedOut = false;
  await Promise.race([
    promise.catch(() => undefined),
    sleep(5000).then(() => {
      timedOut = true;
    }),
  ]);
  if (timedOut) {
    logger.warn({ label }, "runtime loop did not stop before restart timeout");
  }
}

export function getServerBootstrapStatus() {
  return {
    initialized: bootstrapState.initialized,
    botStarted: bootstrapState.botStarted,
    workerStarted: bootstrapState.workerStarted,
    listenForwardStarted: bootstrapState.listenForwardStarted,
    lastError: bootstrapState.lastError,
    botError: bootstrapState.botError,
    workerError: bootstrapState.workerError,
    listenForwardError: bootstrapState.listenForwardError,
  };
}

export function startServerRuntime() {
  if (shouldSkipBootstrap()) {
    return Promise.resolve();
  }

  if (bootstrapState.promise) {
    return bootstrapState.promise;
  }

  bootstrapState.promise = (async () => {
    await retrySqliteBusy(() => migrate(), "server runtime migration");
    const config = await loadAppConfig();
    const botReadyForConfig = config.telegram.bot_token
      ? isBotClientReadyForConfig(config)
      : !bootstrapState.botStarted;

    if (
      bootstrapState.initialized &&
      bootstrapState.workerStarted &&
      bootstrapState.listenForwardStarted &&
      botReadyForConfig
    ) {
      return;
    }

    if (!bootstrapState.workerStarted) {
      const workerAbortController = new AbortController();
      bootstrapState.workerAbortController = workerAbortController;
      bootstrapState.workerStarted = true;
      bootstrapState.workerError = undefined;
      bootstrapState.workerPromise = runWorker({ abortSignal: workerAbortController.signal })
        .catch((error) => {
          if (workerAbortController.signal.aborted) {
            return;
          }
          bootstrapState.workerStarted = false;
          bootstrapState.workerError = errorMessage(error);
          bootstrapState.workerPromise = undefined;
          logger.error({ error }, "download worker auto-start failed");
        });
      logger.info("download worker auto-started with Next server runtime");
    }

    if (!bootstrapState.listenForwardStarted) {
      const listenForwardAbortController = new AbortController();
      bootstrapState.listenForwardAbortController = listenForwardAbortController;
      bootstrapState.listenForwardStarted = true;
      bootstrapState.listenForwardError = undefined;
      bootstrapState.listenForwardPromise = runListenForwardLoop({ abortSignal: listenForwardAbortController.signal })
        .catch((error) => {
          if (listenForwardAbortController.signal.aborted) {
            return;
          }
          bootstrapState.listenForwardStarted = false;
          bootstrapState.listenForwardError = errorMessage(error);
          bootstrapState.listenForwardPromise = undefined;
          logger.error({ error }, "listen_forward auto-start failed");
        });
      logger.info("listen_forward loop auto-started with Next server runtime");
    }

    if (config.telegram.bot_token && !isBotClientReadyForConfig(config)) {
      try {
        await ensureStartedBotClient(config);
        bootstrapState.botStarted = true;
        bootstrapState.botError = undefined;
        logger.info("telegram bot auto-started with Next server runtime");
      } catch (error) {
        bootstrapState.botStarted = false;
        bootstrapState.botError = errorMessage(error);
        logger.error({ error }, "telegram bot auto-start failed");
      }
    } else if (!config.telegram.bot_token) {
      if (bootstrapState.botStarted) {
        await stopBotClient();
        bootstrapState.botStarted = false;
        logger.info("telegram bot stopped because telegram.bot_token is empty");
      } else {
        logger.info("telegram bot auto-start skipped: telegram.bot_token is empty");
      }
      bootstrapState.botError = undefined;
    }

    bootstrapState.lastError = undefined;
    bootstrapState.initialized = true;
  })()
    .catch((error) => {
      bootstrapState.lastError = errorMessage(error);
      logger.error({ error }, "server runtime auto-start failed");
      throw error;
    })
    .finally(() => {
      bootstrapState.promise = undefined;
    });

  return bootstrapState.promise;
}

export async function restartServerRuntime() {
  if (shouldSkipBootstrap()) {
    return getServerBootstrapStatus();
  }

  await bootstrapState.promise?.catch(() => undefined);
  await stopBotClient();
  await destroyUserClient().catch((error) => {
    logger.warn({ error }, "failed to destroy user client during runtime restart");
  });
  bootstrapState.botStarted = false;
  bootstrapState.botError = undefined;

  bootstrapState.workerAbortController?.abort(new Error("runtime restart"));
  bootstrapState.listenForwardAbortController?.abort(new Error("runtime restart"));
  await Promise.all([
    waitForRuntimeLoopStop(bootstrapState.workerPromise, "worker"),
    waitForRuntimeLoopStop(bootstrapState.listenForwardPromise, "listen_forward"),
  ]);
  bootstrapState.workerAbortController = undefined;
  bootstrapState.listenForwardAbortController = undefined;
  bootstrapState.workerPromise = undefined;
  bootstrapState.listenForwardPromise = undefined;
  bootstrapState.workerStarted = false;
  bootstrapState.listenForwardStarted = false;
  bootstrapState.workerError = undefined;
  bootstrapState.listenForwardError = undefined;
  bootstrapState.initialized = false;
  bootstrapState.lastError = undefined;
  bootstrapState.promise = undefined;

  await startServerRuntime();
  return getServerBootstrapStatus();
}
