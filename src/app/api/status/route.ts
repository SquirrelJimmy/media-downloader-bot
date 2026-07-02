import { NextResponse } from "next/server";
import { loadAppConfig } from "@/config/load";
import { getBotClientStatus } from "@/engine/bot-client";
import { getRuntimeStatus } from "@/engine/runtime-state";
import { getServerBootstrapStatus, startServerRuntime } from "@/engine/server-bootstrap";
import { isSqliteBusyError, taskQueue } from "@/engine/task-queue";
import { getUserClientStatus } from "@/engine/user-client";

export const runtime = "nodejs";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function GET() {
  let runtimeError: string | undefined;
  let queueError: string | undefined;

  await startServerRuntime().catch((error) => {
    runtimeError = errorMessage(error);
  });

  const config = await loadAppConfig();
  const queue = await taskQueue.refreshRuntimeStatus().catch((error) => {
    queueError = errorMessage(error);
    return undefined;
  });

  return NextResponse.json({
    runtime: getRuntimeStatus(),
    serverRuntime: {
      ...getServerBootstrapStatus(),
      lastError: runtimeError ?? getServerBootstrapStatus().lastError,
    },
    queue,
    error: runtimeError ?? queueError,
    sqliteBusy: Boolean(runtimeError?.includes("SQLITE_BUSY") || (queueError && isSqliteBusyError({ message: queueError }))),
    userClient: await getUserClientStatus(config),
    botClient: getBotClientStatus(config),
  }, { status: runtimeError || queueError ? 503 : 200 });
}
