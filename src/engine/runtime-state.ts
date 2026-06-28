import { EventEmitter } from "node:events";
import type { RuntimeStatus } from "@/types/download";

const runtimeEvents = new EventEmitter();

let runtimeStatus: RuntimeStatus = {
  activeTasks: 0,
  queuedTasks: 0,
  downloadSpeedBytesPerSecond: 0,
  uploadSpeedBytesPerSecond: 0,
  updatedAt: new Date().toISOString(),
};

export function getRuntimeStatus() {
  return runtimeStatus;
}

export function updateRuntimeStatus(patch: Partial<Omit<RuntimeStatus, "updatedAt">>) {
  runtimeStatus = {
    ...runtimeStatus,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  runtimeEvents.emit("status", runtimeStatus);
  return runtimeStatus;
}

export function publishRuntimeEvent(event: string, payload: unknown) {
  runtimeEvents.emit("event", { event, payload, timestamp: new Date().toISOString() });
}

export function subscribeRuntimeEvents(callback: (event: { event: string; payload: unknown; timestamp: string }) => void) {
  const onStatus = (payload: RuntimeStatus) =>
    callback({ event: "status", payload, timestamp: new Date().toISOString() });
  const onEvent = (payload: { event: string; payload: unknown; timestamp: string }) => callback(payload);
  runtimeEvents.on("status", onStatus);
  runtimeEvents.on("event", onEvent);
  return () => {
    runtimeEvents.off("status", onStatus);
    runtimeEvents.off("event", onEvent);
  };
}
