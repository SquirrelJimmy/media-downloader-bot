import { afterEach, describe, expect, it, vi } from "vitest";

describe("/api/tasks/delete", () => {
  afterEach(() => {
    vi.doUnmock("@/engine/task-service");
    vi.resetModules();
  });

  it("rejects empty ids", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/tasks/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [] }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("ids");
  });

  it("deletes selected tasks", async () => {
    const deleteTasks = vi.fn(async () => ({
      deletedTasks: 2,
      deletedQueueItems: 2,
      deletedDownloads: 1,
      deletedFiles: 1,
      missingFiles: 0,
      failedFiles: 0,
      stoppedQueueItems: 1,
      abortedTransmissions: 0,
    }));
    vi.doMock("@/engine/task-service", () => ({
      deleteTasks,
    }));
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://localhost/api/tasks/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [1, "2", "bad"], deleteFiles: true }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(deleteTasks).toHaveBeenCalledWith({ taskIds: [1, 2], deleteFiles: true });
    expect(data.deletedTasks).toBe(2);
  });
});
