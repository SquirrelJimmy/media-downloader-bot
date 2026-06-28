import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseAppConfig } from "@/config/schema";
import { telegramTextPlugin } from "@/plugins/builtin/telegram-text";
import type { NormalizedMessage, TaskNode } from "@/types/download";

let tempDir: string;

function node(): TaskNode {
  const now = new Date().toISOString();
  return {
    id: "task-text",
    chatId: "-1001",
    type: "download",
    source: "manual",
    status: "running",
    counters: { total: 1, success: 0, failed: 0, skipped: 0, stopped: 0 },
    createdAt: now,
    updatedAt: now,
  };
}

const message: NormalizedMessage = {
  id: 42,
  chatId: "-1001",
  chatTitle: "Source/Chat",
  date: "2026-06-28T12:30:00.000Z",
  text: "plain text",
};

describe("telegram text plugin", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "telegram-download-text-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("uses legacy path and file name prefixes when saving text messages", async () => {
    const config = parseAppConfig({
      enable_download_txt: true,
      storage: {
        save_path: tempDir,
        file_path_prefix: ["chat_title", "media_datetime", "media_type"],
        file_name_prefix: ["message_id"],
        date_format: "%Y_%m",
      },
    });

    expect(await telegramTextPlugin.canHandle({ message, node: node() }, {
      config,
      tempDir,
      onProgress: () => undefined,
    })).toBe(true);

    const result = await telegramTextPlugin.download(
      { message, node: node() },
      {
        config,
        tempDir,
        onProgress: () => undefined,
      },
    );

    expect(result).toMatchObject({
      status: "success",
      fileName: "42.txt",
      filePath: join(tempDir, "Source_Chat", "2026_06", "msg", "42.txt"),
    });
    await expect(readFile(result.filePath ?? "", "utf8")).resolves.toBe("plain text");
  });
});
