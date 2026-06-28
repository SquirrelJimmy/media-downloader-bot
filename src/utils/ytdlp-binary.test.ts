import { access, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  downloadYtdlpBinary,
  normalizeYtdlpPath,
  ytdlpCandidatePaths,
  ytdlpPlatformInfo,
  ytdlpStatus,
} from "@/utils/ytdlp-binary";

let tempDir: string;

describe("yt-dlp binary utilities", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "telegram-download-ytdlp-binary-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("selects release assets by platform and architecture", () => {
    expect(ytdlpPlatformInfo("darwin", "arm64")).toMatchObject({
      assetName: "yt-dlp_macos",
      defaultPath: `.${join("/data", "bin", "yt-dlp_macos")}`,
    });
    expect(ytdlpPlatformInfo("linux", "arm64")).toMatchObject({
      assetName: "yt-dlp_linux_aarch64",
    });
    expect(ytdlpPlatformInfo("linux", "x64")).toMatchObject({
      assetName: "yt-dlp_linux",
    });
    expect(ytdlpPlatformInfo("win32", "x64")).toMatchObject({
      assetName: "yt-dlp.exe",
    });
  });

  it("keeps the legacy macOS fallback candidate", () => {
    expect(ytdlpCandidatePaths("custom-ytdlp")).toContain("custom-ytdlp");
    expect(ytdlpCandidatePaths("data/bin/yt-dlp_macos")).toContain("./data/bin/yt-dlp_macos");
    expect(ytdlpCandidatePaths("custom-ytdlp")).toContain(join("data", "bin", "yt-dlp_macos"));
  });

  it("normalizes data paths to explicit relative paths", () => {
    expect(normalizeYtdlpPath("data/bin/yt-dlp_macos")).toBe("./data/bin/yt-dlp_macos");
    expect(normalizeYtdlpPath("./data/bin/yt-dlp_macos")).toBe("./data/bin/yt-dlp_macos");
    expect(normalizeYtdlpPath("/usr/local/bin/yt-dlp")).toBe("/usr/local/bin/yt-dlp");
  });

  it("checks existence quickly unless version is requested", async () => {
    const targetPath = join(tempDir, "slow-version-ytdlp");
    await writeFile(targetPath, "#!/bin/sh\nsleep 10\nprintf 2026.06.09\n", "utf8");
    await chmod(targetPath, 0o755);

    const quickStatus = await ytdlpStatus(targetPath);

    expect(quickStatus.exists).toBe(true);
    expect(quickStatus.executable).toBe(true);
    expect(quickStatus.version).toBeUndefined();
  });

  it("downloads a binary to the target path and marks it executable", async () => {
    const targetPath = join(tempDir, "yt-dlp");
    const fetchImpl = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("#!/bin/sh\nprintf 2026.06.09\n"));
            controller.close();
          },
        }),
        {
        status: 200,
        },
      );

    const status = await downloadYtdlpBinary({ targetPath, fetchImpl: fetchImpl as typeof fetch });

    expect(status.path).toBe(targetPath);
    expect(status.exists).toBe(true);
    expect(status.executable).toBe(true);
    await expect(access(targetPath)).resolves.toBeUndefined();
    await expect(readFile(targetPath, "utf8")).resolves.toContain("2026.06.09");
  });
});
