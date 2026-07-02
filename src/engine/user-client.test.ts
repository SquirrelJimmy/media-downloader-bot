import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseAppConfig } from "@/config/schema";
import {
  __resetUserClientForTest,
  __setTelegramSessionTableReaderForTest,
  __setUserClientFactoryForTest,
  ensureStartedUserClient,
  inspectTelegramSession,
  normalizeMtcuteMessage,
} from "@/engine/user-client";

const require = createRequire(import.meta.url);

function tempSessionConfig(tempDir: string, userSession: string) {
  return parseAppConfig({
    telegram: {
      sessions_dir: tempDir,
      user_session: userSession,
    },
  });
}

function createSqlite(path: string, sql: string) {
  const Database = require("better-sqlite3") as new (path: string) => {
    exec(sql: string): void;
    close(): void;
  };
  const db = new Database(path);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}

afterEach(async () => {
  __setTelegramSessionTableReaderForTest(null);
  __setUserClientFactoryForTest(null);
  await __resetUserClientForTest();
});

describe("telegram user client message normalization", () => {
  it("extracts sender and forward origin metadata", () => {
    const date = new Date("2026-06-29T10:00:00.000Z");
    const forwardDate = new Date("2026-06-28T09:00:00.000Z");
    const message = {
      id: 77,
      date,
      text: "caption",
      chat: {
        id: "-1001",
        title: "Target Chat",
      },
      sender: {
        id: "sender-1",
        displayName: "Alice Sender",
      },
      media: {
        type: "photo",
        uniqueFileId: "photo-unique",
        fileSize: 123,
      },
      groupedIdUnique: "album-1",
      forward: {
        sender: {
          id: "forward-sender-1",
          displayName: "Bob Forward",
        },
        fromChat() {
          return {
            id: "-1002",
            title: "Origin Channel",
          };
        },
        fromMessageId: 66,
        date: forwardDate,
      },
    };

    expect(normalizeMtcuteMessage(message as never, { mediaGroupExpectedCount: 2 })).toMatchObject({
      id: 77,
      chatId: "-1001",
      chatTitle: "Target Chat",
      caption: "caption",
      mediaType: "photo",
      mediaGroupId: "album-1",
      mediaGroupExpectedCount: 2,
      fileName: "photo-unique.jpg",
      fileSize: 123,
      senderId: "sender-1",
      senderName: "Alice Sender",
      forwardOrigin: {
        senderId: "forward-sender-1",
        senderName: "Bob Forward",
        chatId: "-1002",
        chatTitle: "Origin Channel",
        messageId: 66,
        date: forwardDate.toISOString(),
      },
      source: {
        kind: "mtcute",
        chatId: "-1001",
        messageId: 77,
      },
    });
  });

  it("keeps anonymous forward sender name as origin title", () => {
    const date = new Date("2026-06-29T10:00:00.000Z");
    const forwardDate = new Date("2026-06-28T09:00:00.000Z");
    const message = {
      id: 78,
      date,
      text: "caption",
      chat: {
        id: "-1001",
        title: "DaZuo Ka",
      },
      sender: {
        id: "sender-1",
        displayName: "DaZuo Ka",
      },
      media: {
        type: "photo",
        uniqueFileId: "photo-unique",
      },
      forward: {
        sender: {
          type: "anonymous",
          displayName: "如何与沙雕相处",
        },
        fromChat() {
          return null;
        },
        fromMessageId: null,
        date: forwardDate,
      },
    };

    expect(normalizeMtcuteMessage(message as never)).toMatchObject({
      chatTitle: "DaZuo Ka",
      senderName: "DaZuo Ka",
      forwardOrigin: {
        senderName: "如何与沙雕相处",
        chatTitle: "如何与沙雕相处",
        date: forwardDate.toISOString(),
      },
    });
  });

  it("does not normalize webpage previews as downloadable telegram media", () => {
    const date = new Date("2026-06-29T10:00:00.000Z");
    const message = {
      id: 79,
      date,
      text: "https://www.youtube.com/watch?v=preview",
      chat: {
        id: "-1001",
        title: "Target Chat",
      },
      media: {
        type: "webpage",
        preview: {
          url: "https://www.youtube.com/watch?v=preview",
        },
      },
    };

    expect(normalizeMtcuteMessage(message as never)).toMatchObject({
      id: 79,
      text: "https://www.youtube.com/watch?v=preview",
      media: undefined,
      mediaType: undefined,
      fileName: undefined,
    });
  });
});

describe("telegram session inspection", () => {
  it("detects missing, mtcute and pyrogram session file shapes", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "telegram-session-test-"));
    try {
      await expect(inspectTelegramSession(tempSessionConfig(tempDir, "missing.session"))).resolves.toMatchObject({
        exists: false,
        mtcuteStorage: false,
      });

      const mtcutePath = join(tempDir, "mtcute.session");
      createSqlite(
        mtcutePath,
        `
          create table mtcute_migrations (repo text not null primary key, version integer not null);
          create table auth_keys (dc integer primary key, key blob not null);
          create table key_value (key text primary key, value blob not null);
        `,
      );
      await expect(inspectTelegramSession(tempSessionConfig(tempDir, "mtcute.session"))).resolves.toMatchObject({
        exists: true,
        sqlite: true,
        mtcuteStorage: true,
        pyrogramStorage: false,
        warning: undefined,
      });

      const pyrogramPath = join(tempDir, "pyrogram.session");
      createSqlite(
        pyrogramPath,
        `
          create table sessions (dc_id integer primary key, api_id integer, test_mode integer, auth_key blob);
          create table peers (id integer primary key, access_hash integer, type integer);
        `,
      );
      await expect(inspectTelegramSession(tempSessionConfig(tempDir, "pyrogram.session"))).resolves.toMatchObject({
        exists: true,
        sqlite: true,
        mtcuteStorage: false,
        pyrogramStorage: true,
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("detects non-sqlite session files", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "telegram-session-test-"));
    try {
      await writeFile(join(tempDir, "bad.session"), "not sqlite", "utf8");
      await expect(inspectTelegramSession(tempSessionConfig(tempDir, "bad.session"))).resolves.toMatchObject({
        exists: true,
        sqlite: false,
        mtcuteStorage: false,
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("reports sqlite short-read session errors as a repair warning", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "telegram-session-test-"));
    try {
      const mtcutePath = join(tempDir, "mtcute.session");
      createSqlite(
        mtcutePath,
        `
          create table mtcute_migrations (repo text not null primary key, version integer not null);
          create table auth_keys (dc integer primary key, key blob not null);
          create table key_value (key text primary key, value blob not null);
        `,
      );
      __setTelegramSessionTableReaderForTest(async () => {
        const error = new Error("disk I/O error");
        (error as NodeJS.ErrnoException).code = "SQLITE_IOERR_SHORT_READ";
        throw error;
      });

      await expect(inspectTelegramSession(tempSessionConfig(tempDir, "mtcute.session"))).resolves.toMatchObject({
        exists: true,
        sqlite: true,
        mtcuteStorage: false,
        warning: expect.stringContaining("session file may be corrupted"),
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("destroys a half-started user client after start failure and allows retry", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "telegram-session-test-"));
    try {
      const mtcutePath = join(tempDir, "mtcute.session");
      createSqlite(
        mtcutePath,
        `
          create table mtcute_migrations (repo text not null primary key, version integer not null);
          create table auth_keys (dc integer primary key, key blob not null);
          create table key_value (key text primary key, value blob not null);
        `,
      );
      const firstClient = {
        start: vi.fn(async () => {
          const error = new Error("disk I/O error");
          (error as NodeJS.ErrnoException).code = "SQLITE_IOERR_SHORT_READ";
          throw error;
        }),
        destroy: vi.fn(async () => undefined),
      };
      const secondClient = {
        start: vi.fn(async () => undefined),
        destroy: vi.fn(async () => undefined),
      };
      __setUserClientFactoryForTest(
        vi
          .fn(() => firstClient as never)
          .mockImplementationOnce(() => firstClient as never)
          .mockImplementationOnce(() => secondClient as never),
      );
      const config = parseAppConfig({
        telegram: {
          api_id: 1,
          api_hash: "hash",
          sessions_dir: tempDir,
          user_session: "mtcute.session",
        },
      });

      await expect(ensureStartedUserClient(config)).rejects.toThrow("session file may be corrupted");
      expect(firstClient.destroy).toHaveBeenCalledTimes(1);
      await expect(ensureStartedUserClient(config)).resolves.toBe(secondClient);
      expect(secondClient.start).toHaveBeenCalledTimes(1);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
