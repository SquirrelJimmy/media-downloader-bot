"use client";

import { useCallback, useState } from "react";
import { App, type FormInstance } from "antd";
import type { PluginFormValues, YtdlpBinaryStatus } from "@/types/console";
import { fetchJson, redirectToLoginForAuthError } from "@/components/console/http";

type UseYtdlpStatusOptions = {
  pluginForm: FormInstance<PluginFormValues>;
  loadConfig: () => Promise<unknown>;
};

export function useYtdlpStatus({ pluginForm, loadConfig }: UseYtdlpStatusOptions) {
  const { message } = App.useApp();
  const [ytdlpStatus, setYtdlpStatus] = useState<YtdlpBinaryStatus | null>(null);
  const [ytdlpStatusLoading, setYtdlpStatusLoading] = useState(false);
  const [ytdlpDownloading, setYtdlpDownloading] = useState(false);

  const loadYtdlpStatus = useCallback(async (options?: { includeVersion?: boolean }) => {
    setYtdlpStatusLoading(true);
    try {
      const result = await fetchJson<YtdlpBinaryStatus>(`/api/plugins/ytdlp${options?.includeVersion ? "?version=1" : ""}`);
      if (redirectToLoginForAuthError(result)) {
        return null;
      }
      if (!result.ok || !result.data) {
        message.error(result.error ?? "检测 yt-dlp 失败");
        return null;
      }
      setYtdlpStatus(result.data);
      return result.data;
    } finally {
      setYtdlpStatusLoading(false);
    }
  }, [message]);

  const downloadYtdlp = useCallback(async () => {
    setYtdlpDownloading(true);
    try {
      const result = await fetchJson<YtdlpBinaryStatus & { configPath?: string }>("/api/plugins/ytdlp", { method: "POST" });
      if (redirectToLoginForAuthError(result)) {
        return;
      }
      if (!result.ok || !result.data) {
        message.error(result.error ?? "下载 yt-dlp 失败");
        return;
      }
      const data = result.data;
      setYtdlpStatus(data);
      pluginForm.setFieldValue("ytdlpPath", data.configPath ?? data.path);
      await loadConfig();
      message.success("yt-dlp 已下载/更新");
    } finally {
      setYtdlpDownloading(false);
    }
  }, [loadConfig, message, pluginForm]);

  return {
    ytdlpStatus,
    ytdlpStatusLoading,
    ytdlpDownloading,
    loadYtdlpStatus,
    downloadYtdlp,
  };
}
