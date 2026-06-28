import { describe, expect, it } from "vitest";
import { abortTaskTransmissions, isTaskAbortError, registerTaskCancellation } from "@/engine/task-cancellation";

describe("task cancellation", () => {
  it("aborts only controllers for the selected task", () => {
    const taskController = new AbortController();
    const otherController = new AbortController();
    const unregisterTask = registerTaskCancellation("task-a", taskController);
    const unregisterOther = registerTaskCancellation("task-b", otherController);

    expect(abortTaskTransmissions("task-a")).toBe(1);
    expect(taskController.signal.aborted).toBe(true);
    expect(otherController.signal.aborted).toBe(false);

    unregisterTask();
    unregisterOther();
  });

  it("detects stop abort errors", () => {
    expect(isTaskAbortError(new Error("stopped by command"))).toBe(true);
  });
});
