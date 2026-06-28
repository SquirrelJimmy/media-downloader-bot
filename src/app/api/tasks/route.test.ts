import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseAppConfig } from "@/config/schema";
import type { NormalizedMessage } from "@/types/download";

let tempDir: string;

async function loadRouteModules(message?: NormalizedMessage | null) {
  vi.resetModules();
  tempDir = await mkdtemp(join(tmpdir(), "telegram-download-api-tasks-"));
  process.env.DATABASE_URL = `file:${join(tempDir, "test.db")}`;
  vi.doMock("@/config/load", () => ({
    loadAppConfig: vi.fn(async () => parseAppConfig({})),
  }));
  vi.doMock("@/engine/user-client", () => ({
    getTelegramMessage: vi.fn(async () => message ?? null),
  }));
  const migrateModule = await import("@/db/migrate");
  const clientModule = await import("@/db/client");
  const routeModule = await import("./route");
  await migrateModule.migrate();
  return { ...clientModule, ...routeModule };
}

function postRequest(body: unknown) {
  return new Request("http://localhost/api/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/tasks", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    vi.doUnmock("@/config/load");
    vi.doUnmock("@/engine/user-client");
    delete process.env.DATABASE_URL;
    await rm(tempDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it("enqueues an external URL as a manual download task", async () => {
    const { POST, libsqlClient } = await loadRouteModules();

    const response = await POST(postRequest({ input: "https://vimeo.com/123456" }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.queued).toBe(true);
    expect(data.task.source).toBe("manual");
    expect(data.message).toMatchObject({
      chatId: "external",
      chatTitle: "External URL",
      mediaType: "external",
    });
    expect(data.queueItem).toMatchObject({
      id: 1,
      jobId: expect.any(String),
    });

    const tasks = await libsqlClient.execute("SELECT source, total_count FROM tasks");
    expect(tasks.rows.at(0)).toMatchObject({ source: "manual", total_count: 1 });

    const queue = await libsqlClient.execute("SELECT status, chat_id, message_id FROM task_queue");
    expect(queue.rows.at(0)?.status).toBe("queued");
    expect(queue.rows.at(0)?.chat_id).toBe("external");
  });

  it("enqueues a Telegram message URL after resolving the message", async () => {
    const telegramMessage: NormalizedMessage = {
      id: 456,
      chatId: "-1001492447836",
      chatTitle: "Channel",
      mediaType: "video",
      fileName: "clip.mp4",
      source: {
        kind: "mtcute",
        chatId: "-1001492447836",
        messageId: 456,
      },
    };
    const { POST, libsqlClient } = await loadRouteModules(telegramMessage);

    const response = await POST(postRequest({ input: "https://t.me/c/1492447836/456", filter: "media_type == 'video'" }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.task).toMatchObject({
      chatId: "-1001492447836",
      chatTitle: "Channel",
      source: "manual",
      filter: "media_type == 'video'",
    });
    expect(data.message).toMatchObject({
      id: 456,
      chatId: "-1001492447836",
      mediaType: "video",
    });

    const queue = await libsqlClient.execute("SELECT chat_id, message_id FROM task_queue");
    expect(queue.rows.at(0)).toMatchObject({ chat_id: "-1001492447836", message_id: 456 });
  });

  it("queues Telegram message references without serializing mtcute media objects", async () => {
    const telegramMessage: NormalizedMessage = {
      id: 789,
      chatId: "-1002097256815",
      chatTitle: "Channel",
      mediaType: "video",
      fileName: "clip.mp4",
      media: { type: "video", fileSize: 1024 },
    };
    const { POST, libsqlClient } = await loadRouteModules(telegramMessage);

    const response = await POST(postRequest({ input: "https://t.me/pyzicg/789" }));
    expect(response.status).toBe(200);

    const queue = await libsqlClient.execute("SELECT payload FROM task_queue");
    const payload = JSON.parse(String(queue.rows.at(0)?.payload)) as { message: NormalizedMessage };
    expect(payload.message.media).toBeUndefined();
    expect(payload.message.source).toEqual({
      kind: "mtcute",
      chatId: "pyzicg",
      messageId: 789,
    });
  });

  it("rejects invalid manual task input", async () => {
    const { POST } = await loadRouteModules();

    await expect(POST(postRequest({ input: "" })).then((res) => res.status)).resolves.toBe(400);
    await expect(POST(postRequest({ input: "not a url" })).then((res) => res.status)).resolves.toBe(400);
    await expect(
      POST(postRequest({ input: "https://example.com/a https://example.com/b" })).then((res) => res.status),
    ).resolves.toBe(400);
    await expect(POST(postRequest({ input: "https://t.me/channel" })).then((res) => res.status)).resolves.toBe(400);
    await expect(
      POST(postRequest({ input: "https://vimeo.com/123456", filter: "media_type ==" })).then((res) => res.status),
    ).resolves.toBe(400);
  });
});
