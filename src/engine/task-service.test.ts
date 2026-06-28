import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloadResult } from "@/plugins/types";
import type { NormalizedMessage } from "@/types/download";

let tempDir: string;

async function loadTaskServiceModules() {
  vi.resetModules();
  tempDir = await mkdtemp(join(tmpdir(), "telegram-download-task-service-"));
  process.env.DATABASE_URL = `file:${join(tempDir, "test.db")}`;
  const migrateModule = await import("@/db/migrate");
  const clientModule = await import("@/db/client");
  const taskServiceModule = await import("@/engine/task-service");
  await migrateModule.migrate();
  return { ...clientModule, ...taskServiceModule };
}

describe("task service", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    delete process.env.DATABASE_URL;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("records sender, forward origin and task id on download records", async () => {
    const { createTaskNode, persistTaskNode, recordDownloadResult, libsqlClient } = await loadTaskServiceModules();
    const node = createTaskNode({
      chatId: "-1001",
      chatTitle: "Target Chat",
      source: "bot",
    });
    await persistTaskNode(node);

    const message: NormalizedMessage = {
      id: 55,
      chatId: "-1001",
      chatTitle: "Target Chat",
      senderId: "sender-1",
      senderName: "Alice",
      forwardOrigin: {
        senderId: "forward-sender-1",
        senderName: "Bob",
        chatId: "-1002",
        chatTitle: "Origin Channel",
        messageId: 44,
      },
      fileName: "photo.jpg",
      mediaType: "photo",
    };
    const result: DownloadResult = {
      status: "success",
      fileName: "photo.jpg",
      filePath: "downloads/photo.jpg",
      fileSize: 10,
    };

    await recordDownloadResult(message, node, result);

    const rows = await libsqlClient.execute("SELECT * FROM downloads");
    const row = rows.rows.at(0);
    expect(row?.sender_id).toBe("sender-1");
    expect(row?.sender_name).toBe("Alice");
    expect(row?.forward_sender_id).toBe("forward-sender-1");
    expect(row?.forward_chat_title).toBe("Origin Channel");
    expect(row?.forward_message_id).toBe(44);
    expect(row?.task_id).toBe(1);
    expect(row?.download_date).toEqual(expect.any(String));

    const tasks = await libsqlClient.execute("SELECT start_time FROM tasks WHERE id = 1");
    expect(tasks.rows.at(0)?.start_time).toEqual(expect.any(String));
  });

  it("counts stopped task results separately from skipped results", async () => {
    const { createTaskNode, persistTaskNode, recordDownloadResult, libsqlClient } = await loadTaskServiceModules();
    const node = createTaskNode({
      chatId: "-1001",
      source: "bot",
    });
    await persistTaskNode(node);

    const message: NormalizedMessage = {
      id: 56,
      chatId: "-1001",
      fileName: "video.mp4",
      mediaType: "video",
    };

    await recordDownloadResult(message, node, {
      status: "stopped",
      error: new Error("stopped by command"),
    });

    expect(node.counters.skipped).toBe(0);
    expect(node.counters.stopped).toBe(1);
    const tasks = await libsqlClient.execute("SELECT skip_count, stopped_count FROM tasks WHERE id = 1");
    expect(tasks.rows.at(0)?.skip_count).toBe(0);
    expect(tasks.rows.at(0)?.stopped_count).toBe(1);
  });

  it("records file format from mime type when telegram media has no file name", async () => {
    const { createTaskNode, persistTaskNode, recordDownloadResult, libsqlClient } = await loadTaskServiceModules();
    const node = createTaskNode({
      chatId: "-1001",
      source: "bot",
    });
    await persistTaskNode(node);

    const message: NormalizedMessage = {
      id: 57,
      chatId: "-1001",
      mediaType: "video",
      mimeType: "video/mp4",
    };

    await recordDownloadResult(message, node, {
      status: "success",
      filePath: "downloads/57.mp4",
      fileSize: 10,
    });

    const rows = await libsqlClient.execute("SELECT file_format FROM downloads WHERE message_id = 57");
    expect(rows.rows.at(0)?.file_format).toBe("mp4");
  });

  it("disables the matching listen_forward rule when stopping a listen_forward task", async () => {
    const { createTaskNode, persistTaskNode, stopTaskTransmission, libsqlClient } = await loadTaskServiceModules();
    const node = createTaskNode({
      chatId: "-1001",
      source: "bot",
      type: "listen_forward",
      uploadTelegramChatId: "-1002",
    });
    await persistTaskNode(node);
    await libsqlClient.execute({
      sql: `
        INSERT INTO listen_forward_rules (source_chat_id, target_chat_id, enabled, last_read_message_id)
        VALUES (?, ?, 1, 10)
      `,
      args: ["-1001", "-1002"],
    });

    const result = await stopTaskTransmission(node.id);

    expect(result.disabledListenRules).toBe(1);
    const rules = await libsqlClient.execute("SELECT enabled FROM listen_forward_rules WHERE source_chat_id = '-1001'");
    expect(rules.rows.at(0)?.enabled).toBe(0);
  });

  it("does not disable listen_forward rules when stopping a normal download task", async () => {
    const { createTaskNode, persistTaskNode, stopTaskTransmission, libsqlClient } = await loadTaskServiceModules();
    const node = createTaskNode({
      chatId: "-1001",
      source: "bot",
      type: "download",
    });
    await persistTaskNode(node);
    await libsqlClient.execute({
      sql: `
        INSERT INTO listen_forward_rules (source_chat_id, target_chat_id, enabled, last_read_message_id)
        VALUES (?, ?, 1, 10)
      `,
      args: ["-1001", "-1002"],
    });

    const result = await stopTaskTransmission(node.id);

    expect(result.disabledListenRules).toBeUndefined();
    const rules = await libsqlClient.execute("SELECT enabled FROM listen_forward_rules WHERE source_chat_id = '-1001'");
    expect(rules.rows.at(0)?.enabled).toBe(1);
  });

  it("deletes tasks, queue items and download records without deleting files by default", async () => {
    const { createTaskNode, enqueueMessageDownload, recordDownloadResult, deleteTasks, libsqlClient } =
      await loadTaskServiceModules();
    const filePath = join(tempDir, "downloaded.mp4");
    await writeFile(filePath, "video", "utf8");
    const node = createTaskNode({
      chatId: "external",
      chatTitle: "External URL",
      source: "manual",
    });
    const message: NormalizedMessage = {
      id: 1,
      chatId: "external",
      chatTitle: "External URL",
      mediaType: "external",
      text: "https://example.com/video",
    };
    await enqueueMessageDownload(message, node);
    await recordDownloadResult(message, node, {
      status: "success",
      fileName: "downloaded.mp4",
      filePath,
      fileSize: 5,
    });

    const result = await deleteTasks({ taskIds: [1], deleteFiles: false });

    expect(result).toMatchObject({
      deletedTasks: 1,
      deletedQueueItems: 1,
      deletedDownloads: 1,
      deletedFiles: 0,
      stoppedQueueItems: 1,
    });
    await expect(access(filePath)).resolves.toBeUndefined();
    await expect(libsqlClient.execute("SELECT COUNT(*) AS count FROM tasks")).resolves.toMatchObject({
      rows: [expect.objectContaining({ count: 0 })],
    });
    await expect(libsqlClient.execute("SELECT COUNT(*) AS count FROM task_queue")).resolves.toMatchObject({
      rows: [expect.objectContaining({ count: 0 })],
    });
    await expect(libsqlClient.execute("SELECT COUNT(*) AS count FROM downloads")).resolves.toMatchObject({
      rows: [expect.objectContaining({ count: 0 })],
    });
  });

  it("deletes associated files when requested and skips missing task ids", async () => {
    const { createTaskNode, persistTaskNode, recordDownloadResult, deleteTasks, libsqlClient } =
      await loadTaskServiceModules();
    const firstPath = join(tempDir, "first.mp4");
    const secondPath = join(tempDir, "second.mp4");
    await writeFile(firstPath, "first", "utf8");

    for (const [index, filePath] of [firstPath, secondPath].entries()) {
      const node = createTaskNode({
        chatId: "external",
        chatTitle: `External ${index}`,
        source: "manual",
      });
      await persistTaskNode(node);
      await recordDownloadResult(
        {
          id: index + 1,
          chatId: "external",
          chatTitle: `External ${index}`,
          mediaType: "external",
        },
        node,
        {
          status: "success",
          fileName: `${index}.mp4`,
          filePath,
          fileSize: 5,
        },
      );
    }

    const result = await deleteTasks({ taskIds: [1, 2, 999], deleteFiles: true });

    expect(result).toMatchObject({
      deletedTasks: 2,
      deletedDownloads: 2,
      deletedFiles: 1,
      missingFiles: 1,
      failedFiles: 0,
    });
    await expect(access(firstPath)).rejects.toThrow();
    const tasks = await libsqlClient.execute("SELECT COUNT(*) AS count FROM tasks");
    expect(tasks.rows.at(0)?.count).toBe(0);
  });
});
