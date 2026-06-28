import { access, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseAppConfig } from "@/config/schema";
import { parseYtdlpExtraArgLine, ytdlpPlugin } from "@/plugins/builtin/ytdlp";
import type { DownloadRequest, PluginContext } from "@/plugins/types";

let tempDir: string;

function request(text = "https://www.youtube.com/watch?v=test"): DownloadRequest {
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
      id: "task-ytdlp",
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

function context(
  path: string,
  onProgress: PluginContext["onProgress"] = () => undefined,
  ytdlpOptions: Record<string, unknown> = {},
): PluginContext {
  return {
    tempDir,
    config: parseAppConfig({
      storage: {
        save_path: join(tempDir, "downloads"),
        date_format: "%Y_%m",
      },
      plugins: {
        ytdlp: {
          enabled: true,
          path,
          options: ytdlpOptions,
        },
      },
    }),
    onProgress,
  };
}

async function executable(name: string, body: string) {
  const path = join(tempDir, name);
  await writeFile(path, body, "utf8");
  await chmod(path, 0o755);
  return path;
}

describe("ytdlp plugin", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "telegram-download-ytdlp-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("downloads supported URLs and returns the produced file metadata", async () => {
    const bin = await executable(
      "fake-ytdlp",
      [
        "#!/bin/sh",
        "while [ \"$#\" -gt 0 ]; do",
        "  if [ \"$1\" = \"-o\" ]; then shift; output=\"$1\"; fi",
        "  shift",
        "done",
        "outdir=$(dirname \"$output\")",
        "printf '[download]  50.0%% of 2.00MiB at 1.00MiB/s\\n'",
        "printf 'video bytes' > \"$outdir/video.mp4\"",
      ].join("\n"),
    );
    const progress: Array<{ downloaded: number; total: number; speed: number }> = [];

    const result = await ytdlpPlugin.download(
      request(),
      context(bin, (downloaded, total, speed) => progress.push({ downloaded, total, speed })),
    );

    expect(result).toMatchObject({
      status: "success",
      fileName: "video.mp4",
      fileSize: 11,
    });
    expect(result.filePath).toBe(join(tempDir, "downloads", "External_URL", "youtube_com", "2026_06", "video.mp4"));
    await expect(readFile(result.filePath ?? "", "utf8")).resolves.toBe("video bytes");
    await expect(access(join(tempDir, "task-ytdlp"))).rejects.toThrow();
    expect(progress.at(0)?.total).toBe(2 * 1024 * 1024);
  });

  it("passes configured yt-dlp options and extra args to the binary", async () => {
    const argsPath = join(tempDir, "args.txt");
    const bin = await executable(
      "fake-ytdlp-options",
      [
        "#!/bin/sh",
        `printf '%s\\n' "$@" > ${JSON.stringify(argsPath)}`,
        "while [ \"$#\" -gt 0 ]; do",
        "  if [ \"$1\" = \"-o\" ]; then shift; output=\"$1\"; fi",
        "  shift",
        "done",
        "outdir=$(dirname \"$output\")",
        "printf 'video bytes' > \"$outdir/video.mp4\"",
      ].join("\n"),
    );

    const result = await ytdlpPlugin.download(
      request(),
      context(bin, () => undefined, {
        format: "best",
        no_playlist: false,
        merge_output_format: "mp4",
        proxy: "socks5://127.0.0.1:7890",
        cookies: "/tmp/cookies.txt",
        user_agent: "Agent",
        referer: "https://example.com",
        rate_limit: "2M",
        retries: 4,
        fragment_retries: 5,
        concurrent_fragments: 6,
        extra_args: ["--embed-thumbnail", "--write-subs"],
      }),
    );

    expect(result.status).toBe("success");
    const args = (await readFile(argsPath, "utf8")).trim().split("\n");
    expect(args).toContain("--newline");
    expect(args).not.toContain("--no-playlist");
    expect(args).toEqual(
      expect.arrayContaining([
        "-f",
        "best",
        "--merge-output-format",
        "mp4",
        "--proxy",
        "socks5://127.0.0.1:7890",
        "--cookies",
        "/tmp/cookies.txt",
        "--user-agent",
        "Agent",
        "--referer",
        "https://example.com",
        "--limit-rate",
        "2M",
        "--retries",
        "4",
        "--fragment-retries",
        "5",
        "--concurrent-fragments",
        "6",
        "--embed-thumbnail",
        "--write-subs",
      ]),
    );
  });

  it("splits quoted extra arg lines without invoking a shell", () => {
    expect(
      parseYtdlpExtraArgLine('--cookies-from-browser "chrome:$HOME/Library/Application Support/Google/Chrome/Default"'),
    ).toEqual([
      "--cookies-from-browser",
      `chrome:${homedir()}/Library/Application Support/Google/Chrome/Default`,
    ]);
    expect(() => parseYtdlpExtraArgLine('--cookies-from-browser "chrome')).toThrow("unterminated quote");
  });

  it("rejects extra args that would override managed output or progress behavior", async () => {
    const bin = await executable(
      "fake-ytdlp-blocked",
      ["#!/bin/sh", "exit 0"].join("\n"),
    );

    const result = await ytdlpPlugin.download(
      request(),
      context(bin, () => undefined, {
        extra_args: ["--output=/tmp/evil.%(ext)s"],
      }),
    );

    expect(result.status).toBe("failed");
    expect(result.error?.message).toContain("unsupported option");
  });

  it("returns failed when yt-dlp exits non-zero", async () => {
    const bin = await executable(
      "fake-ytdlp-fail",
      ["#!/bin/sh", "printf 'bad url' >&2", "exit 2"].join("\n"),
    );

    const result = await ytdlpPlugin.download(request(), context(bin));

    expect(result.status).toBe("failed");
    expect(result.error?.message).toContain("bad url");
  });

  it("lets yt-dlp try non-Telegram page URLs beyond the old explicit host list", () => {
    expect(ytdlpPlugin.canHandle(request("https://vimeo.com/123456"), context("missing"))).toBe(true);
  });

  it("does not take Telegram message links or direct file URLs", () => {
    expect(ytdlpPlugin.canHandle(request("https://t.me/c/1492447836/456"), context("missing"))).toBe(false);
    expect(ytdlpPlugin.canHandle(request("https://example.com/file.mp4"), context("missing"))).toBe(false);
  });
});
