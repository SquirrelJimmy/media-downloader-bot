export type DownloadRecord = {
  id: number;
  messageId: number;
  fileName: string;
  chatTitle?: string;
  chatId: string;
  senderId?: string;
  senderName?: string;
  forwardSenderId?: string;
  forwardSenderName?: string;
  forwardChatId?: string;
  forwardChatTitle?: string;
  forwardMessageId?: number;
  status: "success" | "downloading" | "queued" | "failed" | "skip" | "stopped";
  fileSize?: number;
  mediaType?: string;
  mediaGroupId?: string;
  source: string;
  savePath?: string;
  messageDate?: string;
  downloadDate?: string;
};

export type TaskRecord = {
  id: number;
  externalId: string;
  chatId: string;
  chatTitle?: string;
  taskType: "download" | "forward" | "listen_forward";
  source: string;
  startTime?: string;
  endTime?: string;
  totalCount: number;
  successCount: number;
  failedCount: number;
  skipCount: number;
  stoppedCount: number;
  totalBytes: number;
  status: "queued" | "running" | "completed" | "failed" | "stopped";
  filter?: string;
};

export type QueueItem = {
  id: number;
  jobId: string;
  taskExternalId: string;
  chatId: string;
  messageId: number;
  status: "queued" | "running" | "completed" | "failed" | "stopped";
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type StatusPayload = {
  runtime: {
    activeTasks: number;
    queuedTasks: number;
    downloadSpeedBytesPerSecond: number;
  };
  serverRuntime?: {
    initialized: boolean;
    botStarted: boolean;
    workerStarted: boolean;
    listenForwardStarted: boolean;
    lastError?: string;
    botError?: string;
    workerError?: string;
    listenForwardError?: string;
  };
  botClient?: {
    configured: boolean;
    started: boolean;
    allowedUserCount: number;
    commandsRegistered: boolean;
    startupNoticeSent: boolean;
  };
  userClient?: {
    configured: boolean;
    started: boolean;
    session?: {
      exists: boolean;
      sqlite: boolean;
      mtcuteStorage: boolean;
      pyrogramStorage: boolean;
      warning?: string;
    };
  };
  queue?: {
    queued: number;
    running: number;
    completed: number;
    failed: number;
    stopped: number;
  };
};

export type StatsPayload = {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  stopped: number;
  totalBytes: number | null;
};

export type QueuePayload = {
  stats?: StatusPayload["queue"];
  data?: QueueItem[];
  chatProgress: Array<{
    chatId: string;
    chatTitle?: string;
    lastReadMessageId: number;
    totalQueued: number;
    totalSkipped: number;
    lastError?: string;
  }>;
};

export type ProgressItem = {
  jobId: string;
  phase?: "download" | "upload" | "forward";
  taskId?: string;
  taskType?: string;
  chatId?: string;
  chatTitle?: string;
  messageId?: number;
  fileName?: string;
  mediaType?: string;
  senderId?: string;
  senderName?: string;
  forwardChatId?: string;
  forwardChatTitle?: string;
  forwardSenderId?: string;
  forwardSenderName?: string;
  forwardMessageId?: number;
  mediaGroupId?: string;
  filePath?: string;
  remotePath?: string;
  downloaded?: number;
  total?: number;
  speed?: number;
  updatedAt: string;
};

export type AppConfigPayload = {
  app: {
    name: string;
    language: "EN" | "ZH" | "RU" | "UA";
  };
  bot: {
    download_filter: string[];
  };
  telegram: {
    api_id: number;
    api_hash: string;
    bot_token: string;
    allowed_user_ids: Array<string | number>;
    sessions_dir: string;
    user_session: string;
    phone: string;
  };
  storage: {
    save_path: string;
    temp_path: string;
    media_types: string[];
    file_path_prefix: string[];
    file_name_prefix: string[];
    file_name_prefix_split: string;
    date_format: string;
  };
  download: {
    hide_file_name: boolean;
    drop_no_audio_video: boolean;
  };
  forward: {
    limit_per_minute: number;
    delete_after_upload: boolean;
  };
  queue: {
    max_download_tasks: number;
    max_concurrent_transmissions: number;
  };
  plugins: {
    telegram: {
      enabled: boolean;
    };
    telegram_text: {
      enabled: boolean;
      priority: number;
    };
    ytdlp: {
      enabled: boolean;
      priority: number;
      path: string;
      options: YtdlpOptionsPayload;
    };
    http: {
      enabled: boolean;
      priority: number;
      max_file_size: number;
    };
  };
  pipeline: {
    cloud_upload: {
      enabled: boolean;
      adapter: "rclone" | "aligo" | "webdav" | "none";
      remote_dir: string;
      rclone_path: string;
      before_upload_file_zip: boolean;
      delete_after_upload: boolean;
    };
    telegram_forward: {
      enabled: boolean;
      target_chat_id: string;
    };
    delete_after_upload: boolean;
  };
};

export type YtdlpOptionsPayload = {
  format: string;
  no_playlist: boolean;
  merge_output_format: string;
  proxy: string;
  cookies: string;
  cookies_from_browser: string;
  user_agent: string;
  referer: string;
  rate_limit: string;
  retries: number;
  fragment_retries: number;
  concurrent_fragments: number;
  extra_args: string[];
};

export type PluginFormValues = {
  telegramEnabled: boolean;
  telegramTextEnabled: boolean;
  telegramTextPriority: number;
  ytdlpEnabled: boolean;
  ytdlpPriority: number;
  ytdlpPath: string;
  ytdlpFormat: string;
  ytdlpNoPlaylist: boolean;
  ytdlpMergeOutputFormat: string;
  ytdlpProxy: string;
  ytdlpCookies: string;
  ytdlpCookiesFromBrowser: string;
  ytdlpUserAgent: string;
  ytdlpReferer: string;
  ytdlpRateLimit: string;
  ytdlpRetries: number;
  ytdlpFragmentRetries: number;
  ytdlpConcurrentFragments: number;
  ytdlpExtraArgs: string;
  httpEnabled: boolean;
  httpPriority: number;
  httpMaxFileSize: number;
};

export type SettingsFormValues = {
  telegramApiId: number;
  telegramApiHash: string;
  telegramBotToken: string;
  telegramAllowedUserIds: string[];
  telegramSessionsDir: string;
  telegramUserSession: string;
  telegramPhone: string;
  appName: string;
  language: AppConfigPayload["app"]["language"];
  savePath: string;
  tempPath: string;
  mediaTypes: string[];
  filePathPrefix: string[];
  fileNamePrefix: string[];
  fileNamePrefixSplit: string;
  dateFormat: string;
  hideFileName: boolean;
  dropNoAudioVideo: boolean;
  maxDownloadTasks: number;
  maxConcurrentTransmissions: number;
  botDownloadFilter: string[];
  forwardLimitPerMinute: number;
  forwardDeleteAfterUpload: boolean;
  cloudUploadEnabled: boolean;
  cloudUploadAdapter: AppConfigPayload["pipeline"]["cloud_upload"]["adapter"];
  cloudRemoteDir: string;
  rclonePath: string;
  beforeUploadFileZip: boolean;
  cloudDeleteAfterUpload: boolean;
  telegramForwardEnabled: boolean;
  telegramForwardTargetChatId: string;
  pipelineDeleteAfterUpload: boolean;
};

export type AddTaskFormValues = {
  input: string;
  filter?: string;
};

export type DeleteTaskFormValues = {
  deleteFiles?: boolean;
};

export type YtdlpBinaryStatus = {
  path: string;
  platform: string;
  arch: string;
  assetName: string;
  downloadUrl: string;
  exists: boolean;
  executable: boolean;
  size?: number;
  mtime?: string;
  version?: string;
  error?: string;
};

export type TelegramLoginResponse = {
  loginId?: string;
  state: "code_sent" | "password_required" | "completed";
  phone?: string;
  expiresAt?: string;
  codeType?: string;
  codeLength?: number;
  timeout?: number;
  passwordHint?: string | null;
  user?: {
    id?: string;
    displayName?: string;
  };
  sessionPath?: string;
  error?: string;
};

export type ConsoleViewKey = "dashboard" | "tasks" | "plugins" | "settings";
