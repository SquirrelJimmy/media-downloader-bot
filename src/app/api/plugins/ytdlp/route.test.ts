import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir: string;
let previousConfigPath: string | undefined;

describe("/api/plugins/ytdlp", () => {
  beforeEach(async () => {
    previousConfigPath = process.env.APP_CONFIG_PATH;
    tempDir = await mkdtemp(join(tmpdir(), "telegram-download-ytdlp-route-"));
    process.env.APP_CONFIG_PATH = join(tempDir, "app.yaml");
    vi.resetModules();
  });

  afterEach(async () => {
    if (previousConfigPath === undefined) {
      delete process.env.APP_CONFIG_PATH;
    } else {
      process.env.APP_CONFIG_PATH = previousConfigPath;
    }
    vi.doUnmock("@/utils/ytdlp-binary");
    await rm(tempDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it("returns local yt-dlp status", async () => {
    vi.doMock("@/utils/ytdlp-binary", () => ({
      defaultYtdlpPath: () => "data/bin/yt-dlp_test",
      normalizeYtdlpPath: (path?: string) => (path?.startsWith("data/") ? `./${path}` : path),
      ytdlpStatus: vi.fn(async (path?: string) => ({
        path: path || "data/bin/yt-dlp_test",
        platform: "darwin",
        arch: "arm64",
        assetName: "yt-dlp_macos",
        downloadUrl: "https://example.com/yt-dlp_macos",
        exists: false,
        executable: false,
      })),
      downloadYtdlpBinary: vi.fn(),
    }));
    const { GET } = await import("./route");

    const response = await GET(new Request("http://localhost/api/plugins/ytdlp"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      assetName: "yt-dlp_macos",
      exists: false,
      executable: false,
    });
  });

  it("passes through version detection only when requested", async () => {
    const ytdlpStatusMock = vi.fn(async (path?: string, options?: { includeVersion?: boolean }) => ({
      path: path || "./data/bin/yt-dlp_test",
      platform: "darwin",
      arch: "arm64",
      assetName: "yt-dlp_macos",
      downloadUrl: "https://example.com/yt-dlp_macos",
      exists: true,
      executable: true,
      version: options?.includeVersion ? "2026.06.09" : undefined,
    }));
    vi.doMock("@/utils/ytdlp-binary", () => ({
      defaultYtdlpPath: () => "./data/bin/yt-dlp_test",
      normalizeYtdlpPath: (path?: string) => (path?.startsWith("data/") ? `./${path}` : path),
      ytdlpStatus: ytdlpStatusMock,
      downloadYtdlpBinary: vi.fn(),
    }));
    const { GET } = await import("./route");

    const response = await GET(new Request("http://localhost/api/plugins/ytdlp?version=1"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.version).toBe("2026.06.09");
    expect(ytdlpStatusMock).toHaveBeenCalledWith(expect.any(String), { includeVersion: true });
  });

  it("downloads or updates yt-dlp and saves the configured path", async () => {
    vi.doMock("@/utils/ytdlp-binary", () => ({
      defaultYtdlpPath: () => "data/bin/yt-dlp_test",
      normalizeYtdlpPath: (path?: string) => (path?.startsWith("data/") ? `./${path}` : path),
      ytdlpStatus: vi.fn(),
      downloadYtdlpBinary: vi.fn(async ({ targetPath }: { targetPath?: string }) => ({
        path: targetPath || "data/bin/yt-dlp_test",
        platform: "darwin",
        arch: "arm64",
        assetName: "yt-dlp_macos",
        downloadUrl: "https://example.com/yt-dlp_macos",
        exists: true,
        executable: true,
        version: "2026.06.09",
      })),
    }));
    const { POST } = await import("./route");

    const response = await POST();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      path: "data/bin/yt-dlp_test",
      configPath: "./data/bin/yt-dlp_test",
      executable: true,
    });

    vi.resetModules();
    const { loadAppConfig } = await import("@/config/load");
    await expect(loadAppConfig()).resolves.toMatchObject({
      plugins: {
        ytdlp: {
          path: "./data/bin/yt-dlp_test",
        },
      },
    });
  });
});
