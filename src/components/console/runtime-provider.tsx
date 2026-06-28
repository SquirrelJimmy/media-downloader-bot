"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { App } from "antd";
import type { ProgressItem, QueuePayload, StatusPayload } from "@/types/console";
import { fetchJson, redirectToLoginForAuthError } from "@/components/console/http";

type ConsoleRuntimeContextValue = {
  loading: boolean;
  status: StatusPayload | null;
  queue: QueuePayload | null;
  eventVersion: number;
  lastRuntimeEvent?: {
    event: string;
    timestamp: string;
  };
  progressItems: Record<string, ProgressItem>;
  activeProgressItems: ProgressItem[];
  refreshRuntime: () => Promise<void>;
  retryFailed: () => Promise<void>;
  runConfiguredScan: () => Promise<void>;
};

const ConsoleRuntimeContext = createContext<ConsoleRuntimeContextValue | null>(null);
const taskRefreshEvents = [
  "status",
  "download.progress",
  "download.finish",
  "download.failed",
  "download.stop",
  "download.skip",
  "chat.scan.start",
  "chat.scan.finish",
] as const;

function parseSseData<T>(event: Event): T | null {
  const rawData = (event as MessageEvent).data;
  if (typeof rawData !== "string" || !rawData.trim()) {
    return null;
  }
  try {
    return JSON.parse(rawData) as T;
  } catch {
    return null;
  }
}

export function ConsoleRuntimeProvider({ children }: { children: React.ReactNode }) {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [queue, setQueue] = useState<QueuePayload | null>(null);
  const [eventVersion, setEventVersion] = useState(0);
  const [lastRuntimeEvent, setLastRuntimeEvent] = useState<ConsoleRuntimeContextValue["lastRuntimeEvent"]>();
  const [progressItems, setProgressItems] = useState<Record<string, ProgressItem>>({});

  const refreshRuntime = useCallback(async () => {
    setLoading(true);
    try {
      const [statusJson, queueJson] = await Promise.all([
        fetchJson<StatusPayload>("/api/status"),
        fetchJson<QueuePayload>("/api/tasks/queue?limit=20"),
      ]);
      if (redirectToLoginForAuthError(statusJson) || redirectToLoginForAuthError(queueJson)) {
        return;
      }
      if (statusJson.data) {
        setStatus(statusJson.data);
      }
      if (queueJson.data) {
        setQueue(queueJson.data);
      }
      if (!statusJson.ok || !queueJson.ok) {
        const failed = !statusJson.ok ? statusJson : queueJson;
        if (!failed.networkError) {
          console.warn("runtime refresh failed", failed.error);
        }
      }
    } catch (error) {
      console.warn("runtime refresh failed", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => void refreshRuntime(), 0);
    const timer = window.setInterval(() => void refreshRuntime(), 5000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [refreshRuntime]);

  useEffect(() => {
    const events = new EventSource("/api/events");
    const markTaskRefreshEvent = (eventName: string) => (event: Event) => {
      let timestamp = new Date().toISOString();
      const data = parseSseData<{ timestamp?: string }>(event);
      if (data?.timestamp) {
        timestamp = data.timestamp;
      }
      setLastRuntimeEvent({ event: eventName, timestamp });
      setEventVersion((version) => version + 1);
    };
    const upsertProgressItem = (phase: ProgressItem["phase"]) => (event: Event) => {
      const data = parseSseData<{ payload?: ProgressItem; timestamp?: string }>(event);
      const payload = data?.payload;
      if (!payload) {
        return;
      }
      setProgressItems((current) => ({
        ...current,
        [payload.jobId]: {
          ...payload,
          phase,
          updatedAt: data.timestamp ?? new Date().toISOString(),
        },
      }));
    };
    events.addEventListener("download.progress", upsertProgressItem("download"));
    events.addEventListener("upload.progress", upsertProgressItem("upload"));
    events.addEventListener("forward.progress", upsertProgressItem("forward"));
    const removeProgressItem = (event: Event) => {
      const data = parseSseData<{ payload?: { jobId?: string } }>(event);
      const jobId = data?.payload?.jobId;
      if (!jobId) {
        return;
      }
      setProgressItems((current) => {
        const next = { ...current };
        delete next[jobId];
        return next;
      });
    };
    taskRefreshEvents.forEach((eventName) => {
      events.addEventListener(eventName, markTaskRefreshEvent(eventName));
    });
    events.addEventListener("download.finish", removeProgressItem);
    events.addEventListener("download.stop", removeProgressItem);
    events.addEventListener("download.failed", removeProgressItem);
    events.addEventListener("download.skip", removeProgressItem);
    events.addEventListener("upload.finish", removeProgressItem);
    events.addEventListener("upload.failed", removeProgressItem);
    events.addEventListener("forward.finish", removeProgressItem);
    events.addEventListener("forward.failed", removeProgressItem);
    return () => events.close();
  }, []);

  const runConfiguredScan = useCallback(async () => {
    const result = await fetchJson<{ queued?: number; error?: string }>("/api/downloads/configured", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    if (redirectToLoginForAuthError(result)) {
      return;
    }
    if (!result.ok || !result.data) {
      message.error(result.error ?? "配置扫描失败");
      return;
    }
    const data = result.data;
    message.success(`配置扫描完成，入队 ${data.queued ?? 0} 条`);
    await refreshRuntime();
  }, [message, refreshRuntime]);

  const retryFailed = useCallback(async () => {
    const result = await fetchJson<{ queued?: number; error?: string }>("/api/downloads/retry-failed", { method: "POST" });
    if (redirectToLoginForAuthError(result)) {
      return;
    }
    if (!result.ok || !result.data) {
      message.error(result.error ?? "重试失败任务失败");
      return;
    }
    const data = result.data;
    message.success(`已重试入队 ${data.queued ?? 0} 条`);
    await refreshRuntime();
  }, [message, refreshRuntime]);

  const value = useMemo(
    () => ({
      loading,
      status,
      queue,
      eventVersion,
      lastRuntimeEvent,
      progressItems,
      activeProgressItems: Object.values(progressItems),
      refreshRuntime,
      retryFailed,
      runConfiguredScan,
    }),
    [eventVersion, lastRuntimeEvent, loading, progressItems, queue, refreshRuntime, retryFailed, runConfiguredScan, status],
  );

  return <ConsoleRuntimeContext.Provider value={value}>{children}</ConsoleRuntimeContext.Provider>;
}

export function useConsoleRuntime() {
  const context = useContext(ConsoleRuntimeContext);
  if (!context) {
    throw new Error("useConsoleRuntime must be used within ConsoleRuntimeProvider");
  }
  return context;
}
