import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { basename, dirname, extname, relative } from "node:path";
import type { EventEmitter } from "node:events";
import type { CloudUploadAdapter } from "@/cloud/adapter";

function parseByteValue(value: string) {
  const match = value.trim().match(/^([\d.]+)\s*([KMGTPE]?i?)?B?$/i);
  if (!match) {
    return undefined;
  }
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) {
    return undefined;
  }
  const unit = (match[2] ?? "").toLowerCase();
  const multipliers: Record<string, number> = {
    "": 1,
    k: 1000,
    m: 1000 ** 2,
    g: 1000 ** 3,
    t: 1000 ** 4,
    p: 1000 ** 5,
    e: 1000 ** 6,
    ki: 1024,
    mi: 1024 ** 2,
    gi: 1024 ** 3,
    ti: 1024 ** 4,
    pi: 1024 ** 5,
    ei: 1024 ** 6,
  };
  return Math.round(amount * (multipliers[unit] ?? 1));
}

export function parseRcloneProgress(line: string) {
  const transferred = line.match(/Transferred:\s*([\d.]+\s*[KMGTPE]?i?B?)\s*\/\s*([\d.]+\s*[KMGTPE]?i?B?)/i);
  if (!transferred) {
    return null;
  }
  const speed = line.match(/,\s*([\d.]+\s*[KMGTPE]?i?B?)\/s/i);
  const eta = line.match(/ETA\s+([^,\r\n]+)/i);
  return {
    transferredBytes: parseByteValue(transferred[1]) ?? 0,
    totalBytes: parseByteValue(transferred[2]) ?? 0,
    speedBytesPerSecond: speed ? parseByteValue(speed[1]) : undefined,
    eta: eta?.[1]?.trim(),
  };
}

export function waitForChildExit(child: Pick<EventEmitter, "once">) {
  return new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code: number | null) => resolve(code));
  });
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

async function zipFile(filePath: string) {
  const extension = extname(filePath);
  const basePath = extension ? filePath.slice(0, -extension.length) : filePath;
  const zipPath = `${basePath}.zip`;
  await mkdir(dirname(zipPath), { recursive: true });
  const child = spawn("zip", ["-j", zipPath, filePath], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const exitCode = await waitForChildExit(child);
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `zip exited with ${exitCode}`);
  }
  return zipPath;
}

function remoteTargetDir(filePath: string, savePath: string, remoteDir: string) {
  const relativeDir = dirname(relative(savePath, filePath));
  if (!relativeDir || relativeDir === ".") {
    return remoteDir;
  }
  return `${remoteDir.replace(/\/$/, "")}/${relativeDir.replace(/\\/g, "/")}`;
}

export const rcloneAdapter: CloudUploadAdapter = {
  name: "rclone",
  async upload(filePath, ctx) {
    const { cloud_upload } = ctx.config.pipeline;
    if (!cloud_upload.enabled || !cloud_upload.remote_dir) {
      return { status: "skip" };
    }

    let uploadPath = filePath;
    let zipPath: string | undefined;
    try {
      if (cloud_upload.before_upload_file_zip) {
        zipPath = await zipFile(filePath);
        uploadPath = zipPath;
      }
    } catch (error) {
      return { status: "failed", error: error instanceof Error ? error : new Error(String(error)) };
    }

    try {
      const targetDir = remoteTargetDir(filePath, ctx.config.storage.save_path, cloud_upload.remote_dir);
      const child = spawn(cloud_upload.rclone_path, [
        "copy",
        uploadPath,
        targetDir,
        "--create-empty-src-dirs",
        "--ignore-existing",
        "--progress",
      ]);

      let stderr = "";
      const onOutput = (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        for (const line of text.split(/\r?\n|\r/)) {
          const progress = parseRcloneProgress(line);
          if (progress) {
            ctx.onProgress?.(progress);
          }
        }
      };
      child.stdout.on("data", onOutput);
      child.stderr.on("data", onOutput);

      const abortUpload = () => {
        child.kill("SIGTERM");
      };
      ctx.abortSignal?.addEventListener("abort", abortUpload, { once: true });

      let exitCode: number | null;
      try {
        exitCode = await waitForChildExit(child);
      } finally {
        ctx.abortSignal?.removeEventListener("abort", abortUpload);
      }

      if (exitCode !== 0) {
        if (zipPath) {
          await rm(zipPath, { force: true }).catch(() => undefined);
        }
        const error = ctx.abortSignal?.aborted
          ? new Error("stopped by command")
          : new Error(stderr.trim() || `rclone exited with ${exitCode}`);
        return { status: "failed", error };
      }

      if (zipPath) {
        await rm(zipPath, { force: true }).catch(() => undefined);
      }

      return {
        status: "success",
        remotePath: `${targetDir.replace(/\/$/, "")}/${basename(uploadPath)}`,
      };
    } catch (error) {
      if (zipPath) {
        await rm(zipPath, { force: true }).catch(() => undefined);
      }
      return { status: "failed", error: toError(error) };
    }
  },
};
