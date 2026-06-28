import { getRuntimeStatus } from "@/engine/runtime-state";
import { taskQueue } from "@/engine/task-queue";

export const runtime = "nodejs";

export async function GET() {
  await taskQueue.refreshRuntimeStatus();
  const status = getRuntimeStatus();
  const body = [
    "# HELP tg_download_active_tasks Active download tasks",
    "# TYPE tg_download_active_tasks gauge",
    `tg_download_active_tasks ${status.activeTasks}`,
    "# HELP tg_download_queued_tasks Queued download tasks",
    "# TYPE tg_download_queued_tasks gauge",
    `tg_download_queued_tasks ${status.queuedTasks}`,
    "# HELP tg_download_speed_bytes_per_second Download speed",
    "# TYPE tg_download_speed_bytes_per_second gauge",
    `tg_download_speed_bytes_per_second ${status.downloadSpeedBytesPerSecond}`,
  ].join("\n");

  return new Response(`${body}\n`, {
    headers: {
      "Content-Type": "text/plain; version=0.0.4",
    },
  });
}
