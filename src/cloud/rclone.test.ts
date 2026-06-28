import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseRcloneProgress, rcloneAdapter, waitForChildExit } from "@/cloud/rclone";
import { parseAppConfig } from "@/config/schema";

describe("rclone progress parsing", () => {
  it("parses transferred bytes, total bytes, speed and eta", () => {
    expect(parseRcloneProgress("Transferred:    1.500 MiB / 3 MiB, 50%, 512 KiB/s, ETA 3s")).toEqual({
      transferredBytes: 1572864,
      totalBytes: 3145728,
      speedBytesPerSecond: 524288,
      eta: "3s",
    });
  });

  it("ignores unrelated output", () => {
    expect(parseRcloneProgress("Transferred checks: 1 / 1, 100%")).toBeNull();
  });
});

describe("rclone child process handling", () => {
  it("resolves when the child process closes", async () => {
    const child = new EventEmitter();
    const promise = waitForChildExit(child);

    child.emit("close", 0);

    await expect(promise).resolves.toBe(0);
  });

  it("rejects when the child process cannot start", async () => {
    const child = new EventEmitter();
    const promise = waitForChildExit(child);
    const error = new Error("spawn rclone ENOENT");

    child.emit("error", error);

    await expect(promise).rejects.toBe(error);
  });

  it("returns a failed upload result when rclone cannot be started", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "telegram-download-rclone-"));
    const filePath = join(tempDir, "file.bin");
    await writeFile(filePath, "data");

    try {
      const result = await rcloneAdapter.upload(filePath, {
        config: parseAppConfig({
          save_path: tempDir,
          pipeline: {
            cloud_upload: {
              enabled: true,
              adapter: "rclone",
              remote_dir: "remote:",
              rclone_path: "definitely-not-a-real-rclone-command",
            },
          },
        }),
      });

      expect(result.status).toBe("failed");
      expect(result.error?.message).toContain("definitely-not-a-real-rclone-command");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
