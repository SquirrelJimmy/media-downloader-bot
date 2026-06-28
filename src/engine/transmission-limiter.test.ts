import { describe, expect, it } from "vitest";
import { transmissionLimiter } from "@/engine/transmission-limiter";

describe("transmission limiter", () => {
  it("limits concurrent transmissions", async () => {
    transmissionLimiter.setMax(2);
    let active = 0;
    let maxActive = 0;
    let releaseFirst: (() => void) | undefined;
    let releaseSecond: (() => void) | undefined;

    const runTask = (index: number) =>
      transmissionLimiter.run(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => {
          if (index === 0) {
            releaseFirst = resolve;
          } else if (index === 1) {
            releaseSecond = resolve;
          } else {
            resolve();
          }
        });
        active -= 1;
      });

    const tasks = [runTask(0), runTask(1), runTask(2)];
    await Promise.resolve();

    expect(maxActive).toBe(2);
    releaseFirst?.();
    await Promise.resolve();
    expect(maxActive).toBe(2);
    releaseSecond?.();
    await Promise.all(tasks);
    transmissionLimiter.setMax(25);
  });
});
