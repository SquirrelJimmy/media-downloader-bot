import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

let tempDir: string | undefined;

afterEach(async () => {
  vi.doUnmock("node:fs/promises");
  vi.resetModules();
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("moveFileAcrossDevices", () => {
  it("renames files on the same filesystem", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "telegram-download-files-"));
    const source = join(tempDir, "source.txt");
    const destination = join(tempDir, "nested", "destination.txt");
    await writeFile(source, "hello", "utf8");
    const { moveFileAcrossDevices } = await import("@/utils/files");

    await moveFileAcrossDevices(source, destination);

    await expect(readFile(destination, "utf8")).resolves.toBe("hello");
    await expect(readFile(source, "utf8")).rejects.toThrow();
  });

  it("copies and unlinks when rename crosses devices", async () => {
    const mkdir = vi.fn(async () => undefined);
    const rename = vi.fn(async () => {
      const error = new Error("cross-device link not permitted") as NodeJS.ErrnoException;
      error.code = "EXDEV";
      throw error;
    });
    const copyFile = vi.fn(async () => undefined);
    const unlink = vi.fn(async () => undefined);
    vi.doMock("node:fs/promises", () => ({
      copyFile,
      mkdir,
      rename,
      unlink,
    }));
    const { moveFileAcrossDevices } = await import("@/utils/files");

    await moveFileAcrossDevices("/tmp/file.tmp", "/downloads/file.mp4");

    expect(mkdir).toHaveBeenCalledWith("/downloads", { recursive: true });
    expect(rename).toHaveBeenCalledWith("/tmp/file.tmp", "/downloads/file.mp4");
    expect(copyFile).toHaveBeenCalledWith("/tmp/file.tmp", "/downloads/file.mp4");
    expect(unlink).toHaveBeenCalledWith("/tmp/file.tmp");
  });
});
