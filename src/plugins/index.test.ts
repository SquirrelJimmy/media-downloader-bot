import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseAppConfig } from "@/config/schema";
import type { DownloadRequest, PluginContext } from "@/plugins/types";

let tempDir: string;

function request(): DownloadRequest {
  return {
    message: {
      id: 391,
      chatId: "external",
      chatTitle: "External URL",
      text: "https://www.youtube.com/watch?v=test",
      mediaType: "external",
    },
    node: {
      id: "task-url",
      chatId: "external",
      type: "download",
      source: "bot",
      status: "running",
      counters: { total: 1, success: 0, failed: 0, skipped: 0, stopped: 0 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
}

function context(): PluginContext {
  return {
    tempDir,
    config: parseAppConfig({
      enable_download_txt: true,
      plugins: {
        ytdlp: {
          enabled: true,
          path: "missing",
        },
      },
    }),
    onProgress: () => undefined,
  };
}

describe("builtin plugin order", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "telegram-download-plugin-order-"));
  });

  afterEach(async () => {
    vi.doUnmock("@/plugins/builtin/ytdlp");
    vi.resetModules();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("handles URL downloads before saving plain text", async () => {
    vi.resetModules();
    const { registerBuiltinPlugins } = await import("@/plugins");

    expect(registerBuiltinPlugins().list().map((plugin) => plugin.name)).toEqual([
      "telegram",
      "ytdlp",
      "http-direct",
      "telegram-text",
    ]);
  });

  it("selects ytdlp before telegram-text for supported video URLs", async () => {
    vi.resetModules();
    vi.doMock("@/plugins/builtin/ytdlp", () => ({
      ytdlpPlugin: {
        name: "ytdlp",
        priority: 1.5,
        canHandle: vi.fn(async () => true),
        download: vi.fn(async () => ({
          status: "success" as const,
          filePath: join(tempDir, "video.mp4"),
          fileName: "video.mp4",
          fileSize: 10,
        })),
      },
    }));
    const { registerBuiltinPlugins } = await import("@/plugins");

    const result = await registerBuiltinPlugins().download(request(), context());

    expect(result).toMatchObject({
      status: "success",
      pluginName: "ytdlp",
      fileName: "video.mp4",
    });
  });

  it("uses configured non-telegram priorities when selecting plugins", async () => {
    vi.resetModules();
    vi.doMock("@/plugins/builtin/ytdlp", () => ({
      ytdlpPlugin: {
        name: "ytdlp",
        priority: 1.5,
        canHandle: vi.fn(async () => true),
        download: vi.fn(async () => ({
          status: "success" as const,
          filePath: join(tempDir, "video.mp4"),
          fileName: "video.mp4",
          fileSize: 10,
        })),
      },
    }));
    const { registerBuiltinPlugins } = await import("@/plugins");
    const registry = registerBuiltinPlugins();
    const configuredContext: PluginContext = {
      ...context(),
      config: parseAppConfig({
        enable_download_txt: true,
        plugins: {
          telegram_text: {
            enabled: true,
            priority: 0.5,
          },
          ytdlp: {
            enabled: true,
            priority: 1.5,
            path: "missing",
          },
        },
      }),
    };

    expect(registry.list(configuredContext.config).map((plugin) => plugin.name)).toEqual([
      "telegram-text",
      "telegram",
      "ytdlp",
      "http-direct",
    ]);
    const result = await registry.download(request(), configuredContext);

    expect(result).toMatchObject({
      status: "success",
      pluginName: "telegram-text",
      fileName: "391.txt",
    });
  });

  it("returns failed when a selected plugin throws instead of hiding it as skip", async () => {
    vi.resetModules();
    vi.doMock("@/plugins/builtin/ytdlp", () => ({
      ytdlpPlugin: {
        name: "ytdlp",
        priority: 1.5,
        canHandle: vi.fn(async () => true),
        download: vi.fn(async () => {
          throw new Error("disk I/O error");
        }),
      },
    }));
    const { registerBuiltinPlugins } = await import("@/plugins");

    const result = await registerBuiltinPlugins().download(request(), context());

    expect(result).toMatchObject({
      status: "failed",
      pluginName: "ytdlp",
    });
    expect(result.error?.message).toBe("disk I/O error");
  });
});
