import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseAppConfig } from "@/config/schema";
import type { CloudUploadAdapter } from "@/cloud/adapter";
import type { DownloadResult } from "@/plugins/types";
import type { NormalizedMessage, TaskNode } from "@/types/download";

let tempDir: string;

function taskNode(): TaskNode {
  const now = new Date().toISOString();
  return {
    id: "task-pipeline",
    chatId: "-1001",
    type: "download",
    source: "manual",
    status: "running",
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

function result(filePath: string): DownloadResult {
  return {
    status: "success",
    filePath,
    fileName: "file.bin",
    fileSize: 4,
  };
}

function telegramResult(filePath: string, message: Partial<NormalizedMessage> = {}): DownloadResult {
  return {
    ...result(filePath),
    message: {
      id: 100,
      chatId: "-1001",
      chatTitle: "Source",
      mediaType: "video",
      caption: "caption",
      ...message,
    },
  };
}

async function exists(path: string) {
  return stat(path)
    .then(() => true)
    .catch(() => false);
}

async function loadPipelineWithCloudAdapter(adapter: CloudUploadAdapter) {
  vi.resetModules();
  vi.doMock("@/cloud", () => ({
    getCloudUploadAdapter: () => adapter,
  }));
  return import("@/engine/pipeline");
}

async function loadPipelineWithMissingCloudAdapter() {
  vi.resetModules();
  vi.doMock("@/cloud", () => ({
    getCloudUploadAdapter: () => null,
  }));
  return import("@/engine/pipeline");
}

async function loadPipelineWithTelegramClient(client: unknown) {
  vi.resetModules();
  vi.doMock("@/engine/user-client", () => ({
    ensureStartedUserClient: vi.fn(async () => client),
  }));
  return import("@/engine/pipeline");
}

describe("post download pipeline", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "telegram-download-pipeline-"));
  });

  afterEach(async () => {
    vi.doUnmock("@/cloud");
    vi.doUnmock("@/engine/user-client");
    await rm(tempDir, { recursive: true, force: true });
  });

  it("keeps the local file when cloud upload fails even if delete_after_upload is enabled", async () => {
    const filePath = join(tempDir, "failed.bin");
    await writeFile(filePath, "data");
    const { runPostDownloadPipeline } = await loadPipelineWithCloudAdapter({
      name: "rclone",
      upload: vi.fn(async () => ({
        status: "failed" as const,
        error: new Error("upload failed"),
      })),
    });

    await runPostDownloadPipeline(
      result(filePath),
      taskNode(),
      parseAppConfig({
        pipeline: {
          cloud_upload: {
            enabled: true,
            adapter: "rclone",
            remote_dir: "remote:",
            delete_after_upload: true,
          },
        },
      }),
    );

    expect(await exists(filePath)).toBe(true);
  });

  it("deletes the local file after a successful cloud upload when configured", async () => {
    const filePath = join(tempDir, "success.bin");
    await writeFile(filePath, "data");
    const { runPostDownloadPipeline } = await loadPipelineWithCloudAdapter({
      name: "rclone",
      upload: vi.fn(async () => ({
        status: "success" as const,
        remotePath: "remote:/success.bin",
      })),
    });

    await runPostDownloadPipeline(
      result(filePath),
      taskNode(),
      parseAppConfig({
        pipeline: {
          cloud_upload: {
            enabled: true,
            adapter: "rclone",
            remote_dir: "remote:",
            delete_after_upload: true,
          },
        },
      }),
    );

    expect(await exists(filePath)).toBe(false);
  });

  it("publishes structured cloud upload progress events", async () => {
    const filePath = join(tempDir, "upload.bin");
    await writeFile(filePath, "data");
    const { runPostDownloadPipeline } = await loadPipelineWithCloudAdapter({
      name: "rclone",
      upload: vi.fn(async (_path, ctx) => {
        ctx.onProgress?.({
          transferredBytes: 2,
          totalBytes: 4,
          speedBytesPerSecond: 1,
        });
        return {
          status: "success" as const,
          remotePath: "remote:/upload.bin",
        };
      }),
    });
    const runtimeModule = await import("@/engine/runtime-state");
    const events: Array<{ event: string; payload: unknown }> = [];
    const unsubscribe = runtimeModule.subscribeRuntimeEvents((event) => events.push(event));

    await runPostDownloadPipeline(
      result(filePath),
      taskNode(),
      parseAppConfig({
        pipeline: {
          cloud_upload: {
            enabled: true,
            adapter: "rclone",
            remote_dir: "remote:",
          },
        },
      }),
    );
    unsubscribe();

    expect(events.find((event) => event.event === "upload.progress")?.payload).toMatchObject({
      phase: "upload",
      taskId: "task-pipeline",
      chatId: "-1001",
      fileName: "file.bin",
      downloaded: 2,
      total: 4,
      speed: 1,
    });
    expect(events.find((event) => event.event === "upload.finish")?.payload).toMatchObject({
      taskId: "task-pipeline",
      remotePath: "remote:/upload.bin",
    });
  });

  it("publishes upload failure when configured cloud adapter is not registered", async () => {
    const filePath = join(tempDir, "missing-adapter.bin");
    await writeFile(filePath, "data");
    const { runPostDownloadPipeline } = await loadPipelineWithMissingCloudAdapter();
    const runtimeModule = await import("@/engine/runtime-state");
    const events: Array<{ event: string; payload: unknown }> = [];
    const unsubscribe = runtimeModule.subscribeRuntimeEvents((event) => events.push(event));

    await runPostDownloadPipeline(
      result(filePath),
      taskNode(),
      parseAppConfig({
        pipeline: {
          cloud_upload: {
            enabled: true,
            adapter: "aligo",
            remote_dir: "/telegram",
          },
        },
      }),
    );
    unsubscribe();

    expect(await exists(filePath)).toBe(true);
    expect(events.find((event) => event.event === "upload.failed")?.payload).toMatchObject({
      taskId: "task-pipeline",
      filePath,
      error: 'cloud upload adapter "aligo" is not registered',
    });
  });

  it("publishes telegram forward progress events", async () => {
    const filePath = join(tempDir, "forward.bin");
    await writeFile(filePath, "data");
    const sendMedia = vi.fn(async (_target, _media, params) => {
      params.progressCallback(2, 4);
    });
    const { runPostDownloadPipeline } = await loadPipelineWithTelegramClient({ sendMedia });
    const runtimeModule = await import("@/engine/runtime-state");
    const events: Array<{ event: string; payload: unknown }> = [];
    const unsubscribe = runtimeModule.subscribeRuntimeEvents((event) => events.push(event));

    await runPostDownloadPipeline(
      result(filePath),
      taskNode(),
      parseAppConfig({
        pipeline: {
          telegram_forward: {
            enabled: true,
            target_chat_id: "-1002",
          },
        },
      }),
    );
    unsubscribe();

    expect(sendMedia).toHaveBeenCalled();
    expect(events.find((event) => event.event === "forward.progress")?.payload).toMatchObject({
      phase: "forward",
      taskId: "task-pipeline",
      chatId: "-1001",
      fileName: "file.bin",
      downloaded: 2,
      total: 4,
    });
    expect(events.find((event) => event.event === "forward.finish")?.payload).toMatchObject({
      taskId: "task-pipeline",
      filePath,
    });
  });

  it("applies legacy telegram forward caption replacement and footer", async () => {
    const filePath = join(tempDir, "caption.bin");
    await writeFile(filePath, "data");
    const sendMedia = vi.fn(async () => ({}));
    const { runPostDownloadPipeline } = await loadPipelineWithTelegramClient({ sendMedia });

    await runPostDownloadPipeline(
      telegramResult(filePath, { caption: "ad hello" }),
      taskNode(),
      parseAppConfig({
        after_upload_telegram_delete: false,
        replace_advertisement_list: ["ad "],
        group_add_advertisement: {
          "-1002": "footer",
        },
        pipeline: {
          telegram_forward: {
            enabled: true,
            target_chat_id: "-1002",
          },
        },
      }),
    );

    expect(sendMedia).toHaveBeenCalledWith(
      "-1002",
      filePath,
      expect.objectContaining({
        caption: "hello\nfooter",
      }),
    );
    expect(await exists(filePath)).toBe(true);
  });

  it("skips telegram forward when legacy advertisement filter matches", async () => {
    const filePath = join(tempDir, "filtered.bin");
    await writeFile(filePath, "data");
    const sendMedia = vi.fn(async () => ({}));
    const { runPostDownloadPipeline } = await loadPipelineWithTelegramClient({ sendMedia });
    const runtimeModule = await import("@/engine/runtime-state");
    const events: Array<{ event: string; payload: unknown }> = [];
    const unsubscribe = runtimeModule.subscribeRuntimeEvents((event) => events.push(event));

    await runPostDownloadPipeline(
      telegramResult(filePath, { caption: "promo text" }),
      taskNode(),
      parseAppConfig({
        filter_advertisement_list: ["promo"],
        pipeline: {
          telegram_forward: {
            enabled: true,
            target_chat_id: "-1002",
          },
        },
      }),
    );
    unsubscribe();

    expect(sendMedia).not.toHaveBeenCalled();
    expect(await exists(filePath)).toBe(true);
    expect(events.find((event) => event.event === "forward.skip")?.payload).toMatchObject({
      taskId: "task-pipeline",
      reason: "advertisement",
    });
  });

  it("deletes the local file after a successful telegram forward when configured", async () => {
    const filePath = join(tempDir, "forward-delete.bin");
    await writeFile(filePath, "data");
    const sendMedia = vi.fn(async () => ({}));
    const { runPostDownloadPipeline } = await loadPipelineWithTelegramClient({ sendMedia });

    await runPostDownloadPipeline(
      telegramResult(filePath),
      taskNode(),
      parseAppConfig({
        after_upload_telegram_delete: true,
        pipeline: {
          telegram_forward: {
            enabled: true,
            target_chat_id: "-1002",
          },
        },
      }),
    );

    expect(sendMedia).toHaveBeenCalled();
    expect(await exists(filePath)).toBe(false);
  });
});
