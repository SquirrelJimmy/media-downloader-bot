import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@/db/schema";

export const databaseUrl = process.env.DATABASE_URL ?? "file:data/app.db";
const sqliteBusyRetryAttempts = 30;

function runtimeFilePath(path: string) {
  return isAbsolute(path) ? path : join(/*turbopackIgnore: true*/ process.cwd(), path);
}

if (databaseUrl.startsWith("file:")) {
  const filePath = databaseUrl.slice("file:".length);
  mkdirSync(dirname(runtimeFilePath(filePath)), { recursive: true });
}

export const libsqlClient = createClient({
  url: databaseUrl,
});

export const db = drizzle(libsqlClient, { schema });

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

export async function retrySqliteBusy<T>(
  operation: () => Promise<T>,
  options: { attempts?: number; label?: string } = {},
) {
  const attempts = options.attempts ?? sqliteBusyRetryAttempts;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isSqliteBusyError(error) || attempt === attempts) {
        throw error;
      }
      await sleep(Math.min(2000, attempt * 250));
    }
  }
  throw lastError;
}

let databaseRuntimeConfigured: Promise<void> | undefined;

export function configureDatabaseRuntime() {
  if (databaseRuntimeConfigured) {
    return databaseRuntimeConfigured;
  }

  databaseRuntimeConfigured = (async () => {
    if (!databaseUrl.startsWith("file:")) {
      return;
    }

    await retrySqliteBusy(() => libsqlClient.execute("PRAGMA busy_timeout = 10000"), {
      label: "sqlite busy_timeout",
    });
    await retrySqliteBusy(() => libsqlClient.execute("PRAGMA journal_mode = WAL"), {
      label: "sqlite journal_mode",
    });
    await retrySqliteBusy(() => libsqlClient.execute("PRAGMA synchronous = NORMAL"), {
      label: "sqlite synchronous",
    });
  })().catch((error) => {
    databaseRuntimeConfigured = undefined;
    throw error;
  });

  return databaseRuntimeConfigured;
}
