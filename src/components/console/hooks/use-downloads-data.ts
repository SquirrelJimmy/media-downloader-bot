"use client";

import { useCallback, useEffect, useState } from "react";
import type { DownloadRecord } from "@/types/console";
import { useConsoleRuntime } from "@/components/console/runtime-provider";
import { fetchJson, redirectToLoginForAuthError } from "@/components/console/http";

export function useDownloadsData() {
  const { eventVersion } = useConsoleRuntime();
  const [downloadRecords, setDownloadRecords] = useState<DownloadRecord[]>([]);
  const [downloadQuery, setDownloadQuery] = useState("");
  const [activeDownloadQuery, setActiveDownloadQuery] = useState("");
  const [loading, setLoading] = useState(false);

  const fetchDownloads = useCallback(async (query: string, options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      const endpoint = query.trim()
        ? `/api/downloads/search?q=${encodeURIComponent(query.trim())}&limit=100`
        : "/api/downloads?limit=100";
      const result = await fetchJson<{ data?: DownloadRecord[] }>(endpoint);
      if (redirectToLoginForAuthError(result)) {
        return;
      }
      if (result.data) {
        setDownloadRecords(result.data.data ?? []);
      }
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, []);

  const loadDownloads = useCallback(async () => {
    await fetchDownloads(activeDownloadQuery, undefined);
  }, [activeDownloadQuery, fetchDownloads]);

  const searchDownloads = useCallback(async () => {
    const query = downloadQuery.trim();
    setActiveDownloadQuery(query);
    await fetchDownloads(query, undefined);
  }, [downloadQuery, fetchDownloads]);

  useEffect(() => {
    const timer = window.setTimeout(() => void fetchDownloads("", undefined), 0);
    return () => window.clearTimeout(timer);
  }, [fetchDownloads]);

  useEffect(() => {
    if (eventVersion === 0) {
      return;
    }
    const timer = window.setTimeout(() => void fetchDownloads(activeDownloadQuery, { silent: true }), 400);
    return () => window.clearTimeout(timer);
  }, [activeDownloadQuery, eventVersion, fetchDownloads]);

  return {
    downloadRecords,
    downloadQuery,
    setDownloadQuery,
    loading,
    loadDownloads,
    searchDownloads,
  };
}
