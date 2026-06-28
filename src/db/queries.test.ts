import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir: string;

async function loadDbModules() {
  vi.resetModules();
  tempDir = await mkdtemp(join(tmpdir(), "telegram-download-db-"));
  process.env.DATABASE_URL = `file:${join(tempDir, "test.db")}`;
  const migrateModule = await import("@/db/migrate");
  const clientModule = await import("@/db/client");
  const queriesModule = await import("@/db/queries");
  await migrateModule.migrate();
  return { ...clientModule, ...queriesModule };
}

describe("download queries", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    delete process.env.DATABASE_URL;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("searches sender and forward origin fields", async () => {
    const { libsqlClient, searchDownloads } = await loadDbModules();
    await libsqlClient.execute({
      sql: `
        INSERT INTO downloads (
          message_id,
          chat_id,
          chat_title,
          sender_id,
          sender_name,
          forward_sender_id,
          forward_sender_name,
          forward_chat_id,
          forward_chat_title,
          file_name,
          save_path,
          status,
          source
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        10,
        "-1001",
        "Target Chat",
        "sender-1",
        "Alice Sender",
        "forward-sender-1",
        "Bob Forward",
        "-1002",
        "Origin Channel",
        "clip.mp4",
        "downloads/clip.mp4",
        "success",
        "bot",
      ],
    });

    const senderResults = await searchDownloads("Alice", 10);
    expect(senderResults).toHaveLength(1);
    expect(senderResults.at(0)).toMatchObject({
      senderName: "Alice Sender",
      forwardChatTitle: "Origin Channel",
      savePath: "downloads/clip.mp4",
    });
    expect(await searchDownloads("Origin Channel", 10)).toHaveLength(1);
    expect(await searchDownloads("forward-sender-1", 10)).toHaveLength(1);
  });

  it("counts stopped downloads separately from skipped downloads", async () => {
    const { libsqlClient, getDownloadStats } = await loadDbModules();
    await libsqlClient.batch([
      {
        sql: `
          INSERT INTO downloads (message_id, chat_id, file_name, save_path, status, source)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        args: [1, "-1001", "success.mp4", "downloads/success.mp4", "success", "bot"],
      },
      {
        sql: `
          INSERT INTO downloads (message_id, chat_id, file_name, save_path, status, source)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        args: [2, "-1001", "skip.mp4", "downloads/skip.mp4", "skip", "bot"],
      },
      {
        sql: `
          INSERT INTO downloads (message_id, chat_id, file_name, save_path, status, source)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        args: [3, "-1001", "stopped.mp4", "downloads/stopped.mp4", "stopped", "bot"],
      },
    ]);

    expect(await getDownloadStats()).toMatchObject({
      total: 3,
      success: 1,
      skipped: 1,
      stopped: 1,
    });
  });

  it("returns numeric zero stats for an empty downloads table", async () => {
    const { getDownloadStats } = await loadDbModules();

    expect(await getDownloadStats()).toEqual({
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      stopped: 0,
      totalBytes: 0,
    });
  });

  it("adds missing columns when migrating an existing database", async () => {
    vi.resetModules();
    tempDir = await mkdtemp(join(tmpdir(), "telegram-download-db-legacy-"));
    process.env.DATABASE_URL = `file:${join(tempDir, "test.db")}`;
    const { libsqlClient } = await import("@/db/client");

    await libsqlClient.execute(`
      CREATE TABLE downloads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL,
        chat_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        save_path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        source TEXT NOT NULL DEFAULT 'auto'
      )
    `);
    await libsqlClient.execute(`
      INSERT INTO downloads (message_id, chat_id, file_name, save_path, status, source)
      VALUES (1, '-1001', 'old.mp4', 'downloads/old.mp4', 'success', 'auto')
    `);
    await libsqlClient.execute(`
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        external_id TEXT NOT NULL UNIQUE,
        chat_id TEXT NOT NULL,
        task_type TEXT NOT NULL,
        total_count INTEGER NOT NULL DEFAULT 0,
        success_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        skip_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'queued'
      )
    `);
    await libsqlClient.execute(`
      CREATE TABLE task_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL UNIQUE,
        task_external_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        message_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        payload TEXT NOT NULL
      )
    `);
    await libsqlClient.execute(`
      CREATE TABLE chat_progress (
        chat_id TEXT PRIMARY KEY,
        chat_title TEXT
      )
    `);
    await libsqlClient.execute(`
      CREATE TABLE listen_forward_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_chat_id TEXT NOT NULL,
        target_chat_id TEXT NOT NULL
      )
    `);

    const { migrate } = await import("@/db/migrate");
    await migrate();

    async function columnNames(tableName: string) {
      const info = await libsqlClient.execute(`PRAGMA table_info(${tableName})`);
      return new Set(info.rows.map((row) => String(row.name)));
    }

    expect((await columnNames("downloads")).has("task_id")).toBe(true);
    expect((await columnNames("downloads")).has("forward_chat_id")).toBe(true);
    expect((await columnNames("tasks")).has("total_bytes")).toBe(true);
    expect((await columnNames("tasks")).has("stopped_count")).toBe(true);
    expect((await columnNames("tasks")).has("filter")).toBe(true);
    expect((await columnNames("task_queue")).has("locked_until")).toBe(true);
    expect((await columnNames("task_queue")).has("max_attempts")).toBe(true);
    expect((await columnNames("chat_progress")).has("total_queued")).toBe(true);
    expect((await columnNames("listen_forward_rules")).has("poll_interval_seconds")).toBe(true);

    const rows = await libsqlClient.execute("SELECT download_date FROM downloads WHERE message_id = 1");
    expect(rows.rows.at(0)?.download_date).toEqual(expect.any(String));
  });
});
