import type {
  AppConfigPayload,
  DownloadRecord,
  PluginFormValues,
  ProgressItem,
  SettingsFormValues,
} from "@/types/console";

export const statusLabels = {
  success: "成功",
  downloading: "下载中",
  queued: "排队",
  failed: "失败",
  skip: "跳过",
  stopped: "已停止",
};

export const taskStatusLabels = {
  queued: "排队",
  running: "运行中",
  completed: "完成",
  failed: "失败",
  stopped: "已停止",
};

export const taskStatusColors = {
  queued: "gold",
  running: "blue",
  completed: "green",
  failed: "red",
  stopped: "default",
};

export const statusColors = {
  success: "green",
  downloading: "blue",
  queued: "gold",
  failed: "red",
  skip: "default",
  stopped: "default",
};

export const RECENT_DOWNLOAD_LIMIT = 10;

export const languageOptions = ["ZH", "EN", "RU", "UA"].map((value) => ({ label: value, value }));
export const mediaTypeOptions = ["audio", "document", "photo", "video", "voice", "video_note", "animation", "text", "external"].map(
  (value) => ({ label: value, value }),
);
export const pathPrefixOptions = ["chat_title", "media_datetime", "media_type"].map((value) => ({ label: value, value }));
export const fileNamePrefixOptions = ["message_id", "file_name", "caption"].map((value) => ({ label: value, value }));
export const cloudAdapterOptions = [
  { label: "rclone", value: "rclone" },
  { label: "aligo（暂未支持）", value: "aligo", disabled: true },
  { label: "webdav（暂未支持）", value: "webdav", disabled: true },
  { label: "none（关闭请使用总开关）", value: "none", disabled: true },
];

export function isSupportedCloudAdapter(adapter: AppConfigPayload["pipeline"]["cloud_upload"]["adapter"]) {
  return adapter === "rclone";
}

export function validateCloudSettings(values: SettingsFormValues) {
  const errors: string[] = [];
  if (!values.cloudUploadEnabled) {
    return errors;
  }
  if (!isSupportedCloudAdapter(values.cloudUploadAdapter)) {
    errors.push("当前后端未注册该云盘适配器，启用云盘上传时请选择 rclone");
  }
  if (values.cloudUploadAdapter === "rclone") {
    if (!normalizeOptionalString(values.cloudRemoteDir).trim()) {
      errors.push("启用 rclone 云盘上传时需要填写云盘远端目录");
    }
    if (!normalizeOptionalString(values.rclonePath).trim()) {
      errors.push("启用 rclone 云盘上传时需要填写 rclone 路径");
    }
  }
  return errors;
}

export function validateTelegramForwardSettings(values: SettingsFormValues) {
  if (!values.telegramForwardEnabled) {
    return [];
  }
  return normalizeOptionalString(values.telegramForwardTargetChatId).trim() ? [] : ["启用 Telegram 转发时需要填写转发目标"];
}

export function taskCounterValue(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item).trim()).filter(Boolean);
}

export function normalizeMultilineArgs(value: unknown): string[] {
  if (Array.isArray(value)) {
    return normalizeStringArray(value);
  }
  if (typeof value !== "string") {
    return [];
  }
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeOptionalString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeNonnegativeInteger(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

function normalizePositiveNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeAllowedUserIds(value: unknown): Array<string | number> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => String(item).trim())
    .filter(Boolean)
    .map((item) => {
      if (!/^-?\d+$/.test(item)) {
        return item;
      }
      const number = Number(item);
      return Number.isSafeInteger(number) ? number : item;
    });
}

export function pluginFormValues(config: AppConfigPayload): PluginFormValues {
  const ytdlpOptions = config.plugins.ytdlp.options;
  return {
    telegramEnabled: config.plugins.telegram.enabled,
    telegramTextEnabled: config.plugins.telegram_text.enabled,
    telegramTextPriority: config.plugins.telegram_text.priority,
    ytdlpEnabled: config.plugins.ytdlp.enabled,
    ytdlpPriority: config.plugins.ytdlp.priority,
    ytdlpPath: config.plugins.ytdlp.path,
    ytdlpFormat: ytdlpOptions.format,
    ytdlpNoPlaylist: ytdlpOptions.no_playlist,
    ytdlpMergeOutputFormat: ytdlpOptions.merge_output_format,
    ytdlpProxy: ytdlpOptions.proxy,
    ytdlpCookies: ytdlpOptions.cookies,
    ytdlpCookiesFromBrowser: ytdlpOptions.cookies_from_browser,
    ytdlpUserAgent: ytdlpOptions.user_agent,
    ytdlpReferer: ytdlpOptions.referer,
    ytdlpRateLimit: ytdlpOptions.rate_limit,
    ytdlpRetries: ytdlpOptions.retries,
    ytdlpFragmentRetries: ytdlpOptions.fragment_retries,
    ytdlpConcurrentFragments: ytdlpOptions.concurrent_fragments,
    ytdlpExtraArgs: ytdlpOptions.extra_args.join("\n"),
    httpEnabled: config.plugins.http.enabled,
    httpPriority: config.plugins.http.priority,
    httpMaxFileSize: config.plugins.http.max_file_size,
  };
}

export function settingsFormValues(config: AppConfigPayload): SettingsFormValues {
  return {
    telegramApiId: config.telegram.api_id,
    telegramApiHash: config.telegram.api_hash,
    telegramBotToken: config.telegram.bot_token,
    telegramAllowedUserIds: config.telegram.allowed_user_ids.map((item) => String(item)),
    telegramSessionsDir: config.telegram.sessions_dir,
    telegramUserSession: config.telegram.user_session,
    telegramPhone: config.telegram.phone,
    appName: config.app.name,
    language: config.app.language,
    savePath: config.storage.save_path,
    tempPath: config.storage.temp_path,
    mediaTypes: config.storage.media_types,
    filePathPrefix: config.storage.file_path_prefix,
    fileNamePrefix: config.storage.file_name_prefix,
    fileNamePrefixSplit: config.storage.file_name_prefix_split,
    dateFormat: config.storage.date_format,
    hideFileName: config.download.hide_file_name,
    dropNoAudioVideo: config.download.drop_no_audio_video,
    maxDownloadTasks: config.queue.max_download_tasks,
    maxConcurrentTransmissions: config.queue.max_concurrent_transmissions,
    botDownloadFilter: config.bot.download_filter,
    forwardLimitPerMinute: config.forward.limit_per_minute,
    forwardDeleteAfterUpload: config.forward.delete_after_upload,
    cloudUploadEnabled: config.pipeline.cloud_upload.enabled,
    cloudUploadAdapter: config.pipeline.cloud_upload.adapter,
    cloudRemoteDir: config.pipeline.cloud_upload.remote_dir,
    rclonePath: config.pipeline.cloud_upload.rclone_path,
    beforeUploadFileZip: config.pipeline.cloud_upload.before_upload_file_zip,
    cloudDeleteAfterUpload: config.pipeline.cloud_upload.delete_after_upload,
    telegramForwardEnabled: config.pipeline.telegram_forward.enabled,
    telegramForwardTargetChatId: config.pipeline.telegram_forward.target_chat_id,
    pipelineDeleteAfterUpload: config.pipeline.delete_after_upload,
  };
}

export function mergePluginConfig(config: AppConfigPayload, values: PluginFormValues): AppConfigPayload {
  return {
    ...config,
    plugins: {
      ...config.plugins,
      telegram: {
        ...config.plugins.telegram,
        enabled: values.telegramEnabled,
      },
      telegram_text: {
        ...config.plugins.telegram_text,
        enabled: values.telegramTextEnabled,
        priority: normalizePositiveNumber(values.telegramTextPriority, config.plugins.telegram_text.priority),
      },
      ytdlp: {
        ...config.plugins.ytdlp,
        enabled: values.ytdlpEnabled,
        priority: normalizePositiveNumber(values.ytdlpPriority, config.plugins.ytdlp.priority),
        path: values.ytdlpPath,
        options: {
          ...config.plugins.ytdlp.options,
          format: normalizeOptionalString(values.ytdlpFormat),
          no_playlist: Boolean(values.ytdlpNoPlaylist),
          merge_output_format: normalizeOptionalString(values.ytdlpMergeOutputFormat),
          proxy: normalizeOptionalString(values.ytdlpProxy),
          cookies: normalizeOptionalString(values.ytdlpCookies),
          cookies_from_browser: normalizeOptionalString(values.ytdlpCookiesFromBrowser),
          user_agent: normalizeOptionalString(values.ytdlpUserAgent),
          referer: normalizeOptionalString(values.ytdlpReferer),
          rate_limit: normalizeOptionalString(values.ytdlpRateLimit),
          retries: normalizeNonnegativeInteger(values.ytdlpRetries),
          fragment_retries: normalizeNonnegativeInteger(values.ytdlpFragmentRetries),
          concurrent_fragments: normalizeNonnegativeInteger(values.ytdlpConcurrentFragments),
          extra_args: normalizeMultilineArgs(values.ytdlpExtraArgs),
        },
      },
      http: {
        ...config.plugins.http,
        enabled: values.httpEnabled,
        priority: normalizePositiveNumber(values.httpPriority, config.plugins.http.priority),
        max_file_size: values.httpMaxFileSize,
      },
    },
  };
}

export function mergeSettingsConfig(config: AppConfigPayload, values: SettingsFormValues): AppConfigPayload {
  return {
    ...config,
    telegram: {
      ...config.telegram,
      api_id: normalizeNonnegativeInteger(values.telegramApiId),
      api_hash: normalizeOptionalString(values.telegramApiHash).trim(),
      bot_token: normalizeOptionalString(values.telegramBotToken).trim(),
      allowed_user_ids: normalizeAllowedUserIds(values.telegramAllowedUserIds),
      sessions_dir: normalizeOptionalString(values.telegramSessionsDir),
      user_session: normalizeOptionalString(values.telegramUserSession),
      phone: normalizeOptionalString(values.telegramPhone),
    },
    app: {
      ...config.app,
      name: values.appName,
      language: values.language,
    },
    bot: {
      ...config.bot,
      download_filter: normalizeStringArray(values.botDownloadFilter),
    },
    storage: {
      ...config.storage,
      save_path: values.savePath,
      temp_path: values.tempPath,
      media_types: normalizeStringArray(values.mediaTypes),
      file_path_prefix: normalizeStringArray(values.filePathPrefix),
      file_name_prefix: normalizeStringArray(values.fileNamePrefix),
      file_name_prefix_split: values.fileNamePrefixSplit,
      date_format: values.dateFormat,
    },
    download: {
      ...config.download,
      hide_file_name: values.hideFileName,
      drop_no_audio_video: values.dropNoAudioVideo,
    },
    forward: {
      ...config.forward,
      limit_per_minute: values.forwardLimitPerMinute,
      delete_after_upload: values.forwardDeleteAfterUpload,
    },
    queue: {
      ...config.queue,
      max_download_tasks: values.maxDownloadTasks,
      max_concurrent_transmissions: values.maxConcurrentTransmissions,
    },
    pipeline: {
      ...config.pipeline,
      delete_after_upload: values.pipelineDeleteAfterUpload,
      cloud_upload: {
        ...config.pipeline.cloud_upload,
        enabled: values.cloudUploadEnabled,
        adapter: values.cloudUploadAdapter,
        remote_dir: values.cloudRemoteDir,
        rclone_path: values.rclonePath,
        before_upload_file_zip: values.beforeUploadFileZip,
        delete_after_upload: values.cloudDeleteAfterUpload,
      },
      telegram_forward: {
        ...config.pipeline.telegram_forward,
        enabled: values.telegramForwardEnabled,
        target_chat_id: values.telegramForwardTargetChatId,
      },
    },
  };
}

export function sourceText(record: DownloadRecord) {
  return record.chatTitle || record.chatId;
}

export function senderText(record: DownloadRecord) {
  return record.senderName || record.senderId;
}

export function forwardOriginText(record: DownloadRecord) {
  return record.forwardChatTitle || record.forwardSenderName || record.forwardChatId || record.forwardSenderId;
}

export function progressTitle(item: ProgressItem) {
  return item.fileName || `${item.mediaType ?? "media"} #${item.messageId ?? item.jobId}`;
}

export function progressPhaseText(item: ProgressItem) {
  if (item.phase === "upload") {
    return "云盘上传";
  }
  if (item.phase === "forward") {
    return "TG 转发";
  }
  return "下载";
}

export function progressSourceText(item: ProgressItem) {
  return item.chatTitle || item.chatId || item.taskId || item.jobId;
}

export function progressSenderText(item: ProgressItem) {
  return item.senderName || item.senderId;
}

export function progressForwardOriginText(item: ProgressItem) {
  return item.forwardChatTitle || item.forwardSenderName || item.forwardChatId || item.forwardSenderId;
}

export function progressPercent(item: ProgressItem) {
  const downloaded = taskCounterValue(item.downloaded);
  const total = taskCounterValue(item.total);
  return total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
}

export function stopMessageText(prefix: string, data: { stoppedQueueItems?: number; abortedTransmissions?: number; disabledListenRules?: number }) {
  const listenText =
    data.disabledListenRules !== undefined ? `，监听规则 ${data.disabledListenRules ?? 0} 条` : "";
  return `${prefix}，队列 ${data.stoppedQueueItems ?? 0} 条，传输 ${data.abortedTransmissions ?? 0} 条${listenText}`;
}
