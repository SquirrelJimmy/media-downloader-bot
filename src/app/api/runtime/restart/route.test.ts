import { afterEach, describe, expect, it, vi } from "vitest";

describe("/api/runtime/restart", () => {
  afterEach(() => {
    vi.doUnmock("@/engine/server-bootstrap");
    vi.resetModules();
  });

  it("returns restarted runtime status", async () => {
    vi.doMock("@/engine/server-bootstrap", () => ({
      restartServerRuntime: vi.fn(async () => ({
        initialized: true,
        botStarted: true,
        workerStarted: true,
        listenForwardStarted: true,
      })),
    }));
    const { POST } = await import("./route");

    const response = await POST();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      restarted: true,
      message: "runtime services restarted",
      status: {
        initialized: true,
        workerStarted: true,
        listenForwardStarted: true,
      },
    });
  });

  it("returns an error when restart fails", async () => {
    vi.doMock("@/engine/server-bootstrap", () => ({
      restartServerRuntime: vi.fn(async () => {
        throw new Error("restart failed");
      }),
    }));
    const { POST } = await import("./route");

    const response = await POST();
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.error).toBe("restart failed");
  });
});
