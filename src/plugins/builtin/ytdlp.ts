import { spawn } from "node:child_process";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { DownloadPlugin } from "@/plugins/types";
import { moveFileAcrossDevices } from "@/utils/files";
import { extractUrls, getHostname, isDirectFileUrl } from "@/utils/url";
import { sanitizeFileName } from "@/utils/format";
import { getConfiguredExternalSavePath } from "@/utils/telegram-storage";
import { findExecutableYtdlp } from "@/utils/ytdlp-binary";
import type { YtdlpOptionsConfig } from "@/config/schema";

function isTelegramHost(host: string) {
  return host === "t.me" || host.endsWith(".t.me") || host === "telegram.me" || host.endsWith(".telegram.me");
}

function isYtdlpUrl(url: string) {
  const host = getHostname(url);
  return Boolean(host) && !isTelegramHost(host) && !isDirectFileUrl(url);
}

function parseBytes(value: string, unit: string) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }
  const normalizedUnit = unit.toLowerCase();
  const multiplier =
    normalizedUnit.startsWith("g")
      ? 1024 ** 3
      : normalizedUnit.startsWith("m")
        ? 1024 ** 2
        : normalizedUnit.startsWith("k")
          ? 1024
          : 1;
  return number * multiplier;
}

function parseProgressLine(line: string) {
  const downloaded = line.match(/of\s+~?\s*([\d.]+)\s*([KMGT]?i?B)/i);
  const percent = line.match(/([\d.]+)%/);
  const speed = line.match(/at\s+([\d.]+)\s*([KMGT]?i?B)\/s/i);
  if (!downloaded && !speed) {
    return null;
  }

  const total = downloaded ? parseBytes(downloaded[1] ?? "0", downloaded[2] ?? "B") : 0;
  const downloadedBytes = percent && total > 0 ? total * (Number(percent[1]) / 100) : 0;
  const speedBytes = speed ? parseBytes(speed[1] ?? "0", speed[2] ?? "B") : 0;
  return {
    downloaded: Math.max(0, Math.round(downloadedBytes)),
    total: Math.max(0, Math.round(total)),
    speed: Math.max(0, Math.round(speedBytes)),
  };
}

async function downloadedFiles(path: string) {
  const entries = await readdir(path, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && !entry.name.endsWith(".part") && !entry.name.endsWith(".ytdl"))
      .map(async (entry) => {
        const filePath = join(path, entry.name);
        const info = await stat(filePath);
        return { filePath, fileName: entry.name, fileSize: info.size, mtimeMs: info.mtimeMs };
      }),
  );
  return files.sort((left, right) => right.mtimeMs - left.mtimeMs);
}

const blockedExtraArgs = new Set([
  "-o",
  "--output",
  "--paths",
  "-P",
  "--newline",
  "--no-progress",
  "--progress",
  "--progress-template",
  "--exec",
  "--exec-before-download",
  "--use-postprocessor",
  "--ppa",
  "--postprocessor-args",
]);

function expandEnvironmentVariables(value: string) {
  return value
    .replace(/^\$HOME(?=\/|$)/, homedir())
    .replace(/\${HOME}/g, homedir())
    .replace(/\$HOME/g, homedir());
}

export function parseYtdlpExtraArgLine(line: string) {
  const args: string[] = [];
  let current = "";
  let quote: "\"" | "'" | null = null;
  let escaping = false;

  for (const char of line.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(expandEnvironmentVariables(current));
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (escaping) {
    current += "\\";
  }
  if (quote) {
    throw new Error(`yt-dlp extra_args contains an unterminated quote: ${line}`);
  }
  if (current) {
    args.push(expandEnvironmentVariables(current));
  }
  return args;
}

function parseYtdlpExtraArgs(extraArgs: string[]) {
  return extraArgs.flatMap((item) => parseYtdlpExtraArgLine(item)).filter(Boolean);
}

function assertAllowedExtraArgs(extraArgs: string[]) {
  const blocked = extraArgs.find((arg) => {
    const option = arg.includes("=") ? arg.split("=")[0] : arg;
    return option ? blockedExtraArgs.has(option) : false;
  });
  if (blocked) {
    throw new Error(`yt-dlp extra_args contains unsupported option: ${blocked}`);
  }
}

export function buildYtdlpArgs(options: YtdlpOptionsConfig, outputTemplate: string, url: string) {
  const extraArgs = parseYtdlpExtraArgs(options.extra_args.map((item) => item.trim()).filter(Boolean));
  assertAllowedExtraArgs(extraArgs);

  const args = ["--newline"];
  if (options.no_playlist) {
    args.push("--no-playlist");
  }
  if (options.format.trim()) {
    args.push("-f", options.format.trim());
  }
  if (options.merge_output_format.trim()) {
    args.push("--merge-output-format", options.merge_output_format.trim());
  }
  if (options.proxy.trim()) {
    args.push("--proxy", options.proxy.trim());
  }
  if (options.cookies.trim()) {
    args.push("--cookies", options.cookies.trim());
  }
  if (options.cookies_from_browser.trim()) {
    args.push("--cookies-from-browser", options.cookies_from_browser.trim());
  }
  if (options.user_agent.trim()) {
    args.push("--user-agent", options.user_agent.trim());
  }
  if (options.referer.trim()) {
    args.push("--referer", options.referer.trim());
  }
  if (options.rate_limit.trim()) {
    args.push("--limit-rate", options.rate_limit.trim());
  }
  if (options.retries > 0) {
    args.push("--retries", String(options.retries));
  }
  if (options.fragment_retries > 0) {
    args.push("--fragment-retries", String(options.fragment_retries));
  }
  if (options.concurrent_fragments > 0) {
    args.push("--concurrent-fragments", String(options.concurrent_fragments));
  }
  args.push(...extraArgs, "-o", outputTemplate, url);
  return args;
}

export const ytdlpPlugin: DownloadPlugin = {
  name: "ytdlp",
  priority: 1.5,
  canHandle(req, ctx) {
    if (!ctx.config.plugins.ytdlp.enabled) {
      return false;
    }
    const urls = req.extractedUrl ? [req.extractedUrl] : extractUrls(req.message.text ?? req.message.caption);
    return urls.some(isYtdlpUrl);
  },
  async download(req, ctx) {
    const url =
      req.extractedUrl ?? extractUrls(req.message.text ?? req.message.caption).find((item) => isYtdlpUrl(item));
    if (!url) {
      return { status: "skip" };
    }

    const taskTempDir = join(ctx.tempDir, req.node.id);
    const finalDir = getConfiguredExternalSavePath(ctx.config, url, req.message);
    await mkdir(taskTempDir, { recursive: true });
    await mkdir(finalDir, { recursive: true });
    const outputTemplate = join(taskTempDir, "%(title).200B.%(ext)s");
    let binPath: string;
    try {
      binPath = await findExecutableYtdlp(ctx.config.plugins.ytdlp.path);
    } catch (error) {
      return {
        status: "failed",
        error: error instanceof Error ? error : new Error("yt-dlp executable is not available"),
      };
    }
    let args: string[];
    try {
      args = buildYtdlpArgs(ctx.config.plugins.ytdlp.options, outputTemplate, url);
    } catch (error) {
      return {
        status: "failed",
        error: error instanceof Error ? error : new Error("invalid yt-dlp options"),
      };
    }
    const child = spawn(binPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    let stdout = "";
    let pendingStdout = "";
    const emitProgress = (line: string) => {
      const progress = parseProgressLine(line);
      if (progress) {
        ctx.onProgress(progress.downloaded, progress.total, progress.speed);
      }
    };
    const handleOutput = (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      pendingStdout += text;
      const lines = pendingStdout.split(/\r?\n|\r/);
      pendingStdout = lines.pop() ?? "";
      for (const line of lines) {
        emitProgress(line);
      }
    };
    child.stdout.on("data", handleOutput);
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const exitCode = await new Promise<number | null>((resolve) => {
      child.on("close", resolve);
    });
    if (pendingStdout) {
      emitProgress(pendingStdout);
    }

    if (exitCode !== 0) {
      return {
        status: "failed",
        error: new Error(stderr.trim() || `yt-dlp exited with ${exitCode}`),
      };
    }

    const files = await downloadedFiles(taskTempDir);
    const file = files.at(0);
    if (!file) {
      return {
        status: "failed",
        error: new Error(stdout.trim() || stderr.trim() || "yt-dlp completed without producing a file"),
      };
    }
    const fileName = sanitizeFileName(file.fileName);
    const finalPath = join(finalDir, fileName);
    await moveFileAcrossDevices(file.filePath, finalPath);
    const fileStat = await stat(finalPath);
    await rm(taskTempDir, { recursive: true, force: true }).catch(() => undefined);

    return {
      status: "success",
      filePath: finalPath,
      fileName: basename(fileName),
      fileSize: fileStat.size,
    };
  },
};
