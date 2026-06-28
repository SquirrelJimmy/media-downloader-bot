import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, chmod, mkdir, rename, rm, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { finished } from "node:stream/promises";

export interface YtdlpPlatformInfo {
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  assetName: string;
  defaultPath: string;
  downloadUrl: string;
}

const releaseBaseUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";
const ytdlpVersionTimeoutMs = 3000;

type YtdlpStatusOptions = {
  includeVersion?: boolean;
};

const versionCache = new Map<string, { size: number; mtimeMs: number; version?: string }>();

function dotRelativeDataPath(assetName: string) {
  return `./${join("data", "bin", assetName)}`;
}

export function normalizeYtdlpPath(path?: string) {
  if (!path) {
    return path;
  }
  if (path.startsWith("./") || path.startsWith("/") || path.startsWith("../")) {
    return path;
  }
  return path.startsWith("data/") ? `./${path}` : path;
}

export function ytdlpPlatformInfo(
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
): YtdlpPlatformInfo {
  let assetName: string;

  if (platform === "win32") {
    assetName = arch === "arm64" ? "yt-dlp_windows_arm64.exe" : "yt-dlp.exe";
  } else if (platform === "darwin") {
    assetName = arch === "x64" || arch === "arm64" ? "yt-dlp_macos" : "yt-dlp";
  } else if (platform === "linux") {
    assetName = arch === "arm64" ? "yt-dlp_linux_aarch64" : "yt-dlp_linux";
  } else {
    assetName = "yt-dlp";
  }

  return {
    platform,
    arch,
    assetName,
    defaultPath: dotRelativeDataPath(assetName),
    downloadUrl: `${releaseBaseUrl}/${assetName}`,
  };
}

export function defaultYtdlpPath() {
  return ytdlpPlatformInfo().defaultPath;
}

export function ytdlpCandidatePaths(configuredPath?: string) {
  return Array.from(
    new Set(
      [
        normalizeYtdlpPath(configuredPath),
        configuredPath,
        defaultYtdlpPath(),
        "./data/bin/yt-dlp_macos",
        "data/bin/yt-dlp_macos",
      ].filter(
        (path): path is string => Boolean(path),
      ),
    ),
  );
}

export async function findExecutableYtdlp(configuredPath?: string): Promise<string> {
  const candidates = ytdlpCandidatePaths(configuredPath);
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next configured fallback.
    }
  }
  throw new Error(`yt-dlp executable is not available: tried ${candidates.join(", ")}`);
}

export async function ytdlpStatus(configuredPath?: string, options: YtdlpStatusOptions = {}) {
  const info = ytdlpPlatformInfo();
  const path = normalizeYtdlpPath(configuredPath) || info.defaultPath;
  let exists = false;
  let executable = false;
  let size: number | undefined;
  let mtimeMs: number | undefined;
  let mtime: string | undefined;
  let version: string | undefined;

  try {
    const file = await stat(path);
    exists = file.isFile();
    size = file.size;
    mtimeMs = file.mtimeMs;
    mtime = file.mtime.toISOString();
  } catch {
    exists = false;
  }

  try {
    await access(path, constants.X_OK);
    executable = true;
  } catch {
    executable = false;
  }

  if (executable && options.includeVersion && typeof size === "number" && typeof mtimeMs === "number") {
    const cached = versionCache.get(path);
    if (cached && cached.size === size && cached.mtimeMs === mtimeMs) {
      version = cached.version;
    } else {
      version = await ytdlpVersion(path).catch(() => undefined);
      versionCache.set(path, { size, mtimeMs, version });
    }
  }

  return {
    ...info,
    path,
    exists,
    executable,
    size,
    mtime,
    version,
  };
}

export async function downloadYtdlpBinary(input: {
  targetPath?: string;
  fetchImpl?: typeof fetch;
}) {
  const info = ytdlpPlatformInfo();
  const targetPath = normalizeYtdlpPath(input.targetPath) || info.defaultPath;
  const fetchImpl = input.fetchImpl ?? fetch;
  await mkdir(dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.download`;

  const response = await fetchImpl(info.downloadUrl);
  if (!response.ok || !response.body) {
    throw new Error(`yt-dlp download failed: HTTP ${response.status}`);
  }

  const writer = createWriteStream(tempPath);
  try {
    for await (const chunk of response.body) {
      writer.write(chunk);
    }
    writer.end();
    await finished(writer);
    await chmod(tempPath, 0o755);
    await rename(tempPath, targetPath);
    await chmod(targetPath, 0o755);
  } catch (error) {
    writer.destroy();
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }

  return ytdlpStatus(targetPath, { includeVersion: true });
}

async function ytdlpVersion(path: string) {
  const child = spawn(path, ["--version"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  const exitCode = await new Promise<number | null>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGTERM");
      resolve(null);
    }, ytdlpVersionTimeoutMs);
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(code);
    });
    child.on("error", () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(null);
    });
  });
  if (exitCode !== 0) {
    return undefined;
  }
  return stdout.trim() || undefined;
}
