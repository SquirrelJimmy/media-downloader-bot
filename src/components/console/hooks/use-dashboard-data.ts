"use client";

import { useCallback, useEffect, useState } from "react";
import type { DownloadRecord, StatsPayload, TaskRecord } from "@/types/console";
import { RECENT_DOWNLOAD_LIMIT } from "@/components/console/utils";
import { fetchJson, redirectToLoginForAuthError } from "@/components/console/http";

export function useDashboardData() {
  const [downloads, setDownloads] = useState<DownloadRecord[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [loading, setLoading] = useState(false);

  const loadDashboardData = useCallback(async () => {
    setLoading(true);
    try {
      const [downloadsJson, tasksJson, statsJson] = await Promise.all([
        fetchJson<{ data?: DownloadRecord[] }>(`/api/downloads?limit=${RECENT_DOWNLOAD_LIMIT}`),
        fetchJson<{ data?: TaskRecord[] }>("/api/tasks?limit=20"),
        fetchJson<StatsPayload>("/api/downloads/stats"),
      ]);
      if (
        redirectToLoginForAuthError(downloadsJson) ||
        redirectToLoginForAuthError(tasksJson) ||
        redirectToLoginForAuthError(statsJson)
      ) {
        return;
      }
      if (downloadsJson.data) {
        setDownloads((downloadsJson.data.data ?? []).slice(0, RECENT_DOWNLOAD_LIMIT));
      }
      if (tasksJson.data) {
        setTasks(tasksJson.data.data ?? []);
      }
      if (statsJson.data) {
        setStats(statsJson.data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => void loadDashboardData(), 0);
    const timer = window.setInterval(() => void loadDashboardData(), 5000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [loadDashboardData]);

  return {
    downloads,
    tasks,
    stats,
    loading,
    refreshDashboardData: loadDashboardData,
  };
}
