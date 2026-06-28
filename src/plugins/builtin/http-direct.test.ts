import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseAppConfig } from "@/config/schema";
import { httpDirectPlugin } from "@/plugins/builtin/http-direct";
import type { DownloadRequest, PluginContext } from "@/plugins/types";

let tempDir: string;

function request(text = "https://cdn.example.com/files/video.mp4"): DownloadRequest {
  return {
    message: {
      id: 1,
      chatId: "external",
      chatTitle: "External URL",
      date: "2026-06-30T00:00:00.000Z",
      text,
      mediaType: "external",
    },
    node: {
      id: "task-http",
      chatId: "external",
      type: "download",
      source: "bot",
      status: "running",
      counters: {
        total: 1,
        success: 0,
        failed: 0,
        skipped: 0,
        stopped: 0,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
}

function context(): PluginContext {
  return {
    tempDir,
    config: parseAppConfig({
      storage: {
        save_path: join(tempDir, "downloads"),
        date_format: "%Y_%m",
      },
      plugins: {
        http: {
          enabled: true,
          max_file_size: 1024,
        },
      },
    }),
    onProgress: () => undefined,
  };
}

describe("http direct plugin", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "telegram-download-http-direct-"));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("stores direct files under External_URL platform folders", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("video bytes", {
          headers: {
            "content-length": "11",
          },
        }),
      ),
    );

    const result = await httpDirectPlugin.download(request(), context());

    expect(result).toMatchObject({
      status: "success",
      fileName: "video.mp4",
      fileSize: 11,
    });
    expect(result.filePath).toBe(join(tempDir, "downloads", "External_URL", "cdn_example_com", "2026_06", "video.mp4"));
    await expect(readFile(result.filePath ?? "", "utf8")).resolves.toBe("video bytes");
    await expect(access(join(tempDir, "task-http"))).rejects.toThrow();
  });
});
