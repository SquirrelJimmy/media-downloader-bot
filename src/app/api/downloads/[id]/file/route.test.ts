import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir: string;

async function loadRouteModules() {
  vi.resetModules();
  tempDir = await mkdtemp(join(tmpdir(), "telegram-download-file-route-"));
  process.env.DATABASE_URL = `file:${join(tempDir, "test.db")}`;
  const migrateModule = await import("@/db/migrate");
  const clientModule = await import("@/db/client");
  await migrateModule.migrate();
  const routeModule = await import("./route");
  return { ...clientModule, ...routeModule };
}

async function insertDownload(input: { savePath: string; fileName?: string; status?: string }) {
  const { libsqlClient } = await import("@/db/client");
  const result = await libsqlClient.execute({
    sql: `
      INSERT INTO downloads (message_id, chat_id, file_name, save_path, status, source)
      VALUES (?, ?, ?, ?, ?, ?)
      RETURNING id
    `,
    args: [1, "-1001", input.fileName ?? "video.mp4", input.savePath, input.status ?? "success", "bot"],
  });
  return Number(result.rows.at(0)?.id);
}

describe("/api/downloads/[id]/file", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    delete process.env.DATABASE_URL;
    await rm(tempDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it("returns a recorded file inline", async () => {
    const { GET } = await loadRouteModules();
    const filePath = join(tempDir, "downloads", "video.mp4");
    await mkdir(join(tempDir, "downloads"), { recursive: true });
    await writeFile(filePath, "video bytes", "utf8");
    const id = await insertDownload({ savePath: filePath, fileName: "video.mp4" });

    const response = await GET(new Request("http://localhost/api/downloads/1/file"), {
      params: Promise.resolve({ id: String(id) }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("content-disposition")).toContain("inline");
    await expect(response.text()).resolves.toBe("video bytes");
  });

  it("supports byte range requests", async () => {
    const { GET } = await loadRouteModules();
    const filePath = join(tempDir, "downloads", "clip.mp4");
    await mkdir(join(tempDir, "downloads"), { recursive: true });
    await writeFile(filePath, "0123456789", "utf8");
    const id = await insertDownload({ savePath: filePath, fileName: "clip.mp4" });

    const response = await GET(
      new Request("http://localhost/api/downloads/1/file", {
        headers: { range: "bytes=2-5" },
      }),
      {
        params: Promise.resolve({ id: String(id) }),
      },
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(response.headers.get("content-length")).toBe("4");
    await expect(response.text()).resolves.toBe("2345");
  });

  it("returns 404 when the recorded file is missing", async () => {
    const { GET } = await loadRouteModules();
    const id = await insertDownload({ savePath: join(tempDir, "missing.mp4"), fileName: "missing.mp4" });

    const response = await GET(new Request("http://localhost/api/downloads/1/file"), {
      params: Promise.resolve({ id: String(id) }),
    });

    expect(response.status).toBe(404);
  });

  it("returns 404 when save_path is empty", async () => {
    const { GET } = await loadRouteModules();
    const id = await insertDownload({ savePath: "", fileName: "empty.mp4" });

    const response = await GET(new Request("http://localhost/api/downloads/1/file"), {
      params: Promise.resolve({ id: String(id) }),
    });

    expect(response.status).toBe(404);
  });

  it("does not read arbitrary query path values", async () => {
    const { GET } = await loadRouteModules();
    const filePath = join(tempDir, "secret.txt");
    await writeFile(filePath, "secret", "utf8");

    const response = await GET(new Request(`http://localhost/api/downloads/999/file?path=${encodeURIComponent(filePath)}`), {
      params: Promise.resolve({ id: "999" }),
    });

    expect(response.status).toBe(404);
  });
});
