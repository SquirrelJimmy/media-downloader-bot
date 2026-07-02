import { describe, expect, it } from "vitest";
import {
  isSupportedCloudAdapter,
  mergePluginConfig,
  mergeSettingsConfig,
  mergeTelegramSettingsConfig,
  settingsFormValues,
  validateCloudSettings,
  validateTelegramForwardSettings,
  validateTelegramLoginSettings,
} from "@/components/console/utils";
import { defaultYtdlpUserAgent } from "@/config/schema";
import type { AppConfigPayload, PluginFormValues } from "@/types/console";

const baseConfig: AppConfigPayload = {
  app: {
    name: "媒体下载器",
    language: "ZH",
  },
  bot: {
    download_filter: [],
  },
  telegram: {
    api_id: 0,
    api_hash: "",
    bot_token: "",
    allowed_user_ids: [],
    sessions_dir: "storage/sessions",
    user_session: "media_downloader.session",
    phone: "",
  },
  storage: {
    save_path: "downloads",
    temp_path: "storage/tmp",
    media_types: [],
    file_path_prefix: [],
    file_name_prefix: [],
    file_name_prefix_split: " - ",
    date_format: "%Y_%m",
  },
  download: {
    hide_file_name: false,
    drop_no_audio_video: false,
  },
  forward: {
    limit_per_minute: 33,
    delete_after_upload: true,
  },
  queue: {
    max_download_tasks: 5,
    max_concurrent_transmissions: 25,
  },
  plugins: {
    telegram: {
      enabled: true,
    },
    telegram_text: {
      enabled: false,
      priority: 2,
    },
    ytdlp: {
      enabled: true,
      priority: 1.5,
      path: "./data/bin/yt-dlp_macos",
      options: {
        format: "bestvideo*+bestaudio/best",
        no_playlist: true,
        merge_output_format: "",
        proxy: "",
        cookies: "",
        cookies_from_browser: "",
        user_agent: defaultYtdlpUserAgent,
        referer: "",
        rate_limit: "",
        retries: 0,
        fragment_retries: 0,
        concurrent_fragments: 0,
        extra_args: [],
      },
    },
    http: {
      enabled: true,
      priority: 1.75,
      max_file_size: 1024,
    },
  },
  pipeline: {
    cloud_upload: {
      enabled: false,
      adapter: "rclone",
      remote_dir: "",
      rclone_path: "rclone",
      before_upload_file_zip: false,
      delete_after_upload: false,
    },
    telegram_forward: {
      enabled: false,
      target_chat_id: "",
    },
    delete_after_upload: false,
  },
};

describe("console config utils", () => {
  it("merges yt-dlp form values into plugin options", () => {
    const values: PluginFormValues = {
      telegramEnabled: true,
      telegramTextEnabled: false,
      telegramTextPriority: 2.5,
      ytdlpEnabled: true,
      ytdlpPriority: 1.25,
      ytdlpPath: "./data/bin/yt-dlp_macos",
      ytdlpFormat: "best",
      ytdlpNoPlaylist: false,
      ytdlpMergeOutputFormat: "mp4",
      ytdlpProxy: "socks5://127.0.0.1:7890",
      ytdlpCookies: "",
      ytdlpCookiesFromBrowser: "chrome",
      ytdlpUserAgent: "Agent",
      ytdlpReferer: "https://example.com",
      ytdlpRateLimit: "2M",
      ytdlpRetries: 3,
      ytdlpFragmentRetries: 0,
      ytdlpConcurrentFragments: null as unknown as number,
      ytdlpExtraArgs: "\n--embed-thumbnail\n\n--write-subs\n",
      httpEnabled: true,
      httpPriority: 1.75,
      httpMaxFileSize: 1024,
    };

    const config = mergePluginConfig(baseConfig, values);

    expect(config.plugins.ytdlp.options).toMatchObject({
      format: "best",
      no_playlist: false,
      merge_output_format: "mp4",
      proxy: "socks5://127.0.0.1:7890",
      cookies_from_browser: "chrome",
      user_agent: "Agent",
      referer: "https://example.com",
      rate_limit: "2M",
      retries: 3,
      fragment_retries: 0,
      concurrent_fragments: 0,
      extra_args: ["--embed-thumbnail", "--write-subs"],
    });
    expect(config.plugins.telegram_text.priority).toBe(2.5);
    expect(config.plugins.ytdlp.priority).toBe(1.25);
    expect(config.plugins.http.priority).toBe(1.75);
  });

  it("syncs telegram values into settings form values", () => {
    const currentConfig: AppConfigPayload = {
      ...baseConfig,
      telegram: {
        ...baseConfig.telegram,
        api_id: 12345,
        api_hash: "configured-api-hash",
        bot_token: "configured-bot-token",
        allowed_user_ids: [1, "alice"],
        sessions_dir: "storage/custom-sessions",
        user_session: "custom.session",
        phone: "+10000000000",
      },
    };

    const values = settingsFormValues(currentConfig);

    expect(values).toMatchObject({
      telegramApiId: 12345,
      telegramApiHash: "configured-api-hash",
      telegramBotToken: "configured-bot-token",
      telegramAllowedUserIds: ["1", "alice"],
      telegramSessionsDir: "storage/custom-sessions",
      telegramUserSession: "custom.session",
      telegramPhone: "+10000000000",
    });
  });

  it("merges telegram form values directly into config", () => {
    const currentConfig: AppConfigPayload = {
      ...baseConfig,
      telegram: {
        ...baseConfig.telegram,
        api_id: 12345,
        api_hash: "old-api-hash",
        bot_token: "old-bot-token",
        allowed_user_ids: [1],
      },
    };
    const values = {
      ...settingsFormValues(currentConfig),
      telegramApiId: 54321,
      telegramApiHash: " new-api-hash ",
      telegramBotToken: " new-bot-token ",
      telegramAllowedUserIds: ["42", "alice", "9007199254740993", "-100"],
      telegramSessionsDir: "storage/custom-sessions",
      telegramUserSession: "custom.session",
      telegramPhone: "+10000000000",
    };

    const config = mergeSettingsConfig(currentConfig, values);

    expect(config.telegram).toMatchObject({
      api_id: 54321,
      api_hash: "new-api-hash",
      bot_token: "new-bot-token",
      allowed_user_ids: [42, "alice", "9007199254740993", -100],
      sessions_dir: "storage/custom-sessions",
      user_session: "custom.session",
      phone: "+10000000000",
    });
  });

  it("allows clearing telegram secret values from the form", () => {
    const currentConfig: AppConfigPayload = {
      ...baseConfig,
      telegram: {
        ...baseConfig.telegram,
        api_hash: "old-api-hash",
        bot_token: "old-bot-token",
      },
    };
    const values = {
      ...settingsFormValues(currentConfig),
      telegramApiHash: "",
      telegramBotToken: "",
    };

    const config = mergeSettingsConfig(currentConfig, values);

    expect(config.telegram.api_hash).toBe("");
    expect(config.telegram.bot_token).toBe("");
  });

  it("merges only telegram form values for login preparation", () => {
    const values = {
      ...settingsFormValues(baseConfig),
      telegramApiId: 54321,
      telegramApiHash: " api-hash ",
      telegramBotToken: " bot-token ",
      telegramAllowedUserIds: ["42"],
      telegramSessionsDir: "storage/custom-sessions",
      telegramUserSession: "custom.session",
      telegramPhone: "+10000000000",
      savePath: "should-not-change",
    };

    const config = mergeTelegramSettingsConfig(baseConfig, values);

    expect(config.telegram).toMatchObject({
      api_id: 54321,
      api_hash: "api-hash",
      bot_token: "bot-token",
      allowed_user_ids: [42],
      sessions_dir: "storage/custom-sessions",
      user_session: "custom.session",
      phone: "+10000000000",
    });
    expect(config.storage.save_path).toBe(baseConfig.storage.save_path);
  });

  it("validates telegram login settings before sending a code", () => {
    const emptyValues = settingsFormValues(baseConfig);
    expect(validateTelegramLoginSettings(emptyValues)).toContain("请先配置 Telegram api_id");

    const configuredValues = {
      ...emptyValues,
      telegramApiId: 12345,
      telegramApiHash: "api-hash",
      telegramSessionsDir: "storage/sessions",
      telegramUserSession: "user.session",
      telegramPhone: "+10000000000",
    };
    expect(validateTelegramLoginSettings(configuredValues)).toEqual([]);
  });

  it("merges cloud upload and pipeline settings into config", () => {
    const values = {
      ...settingsFormValues(baseConfig),
      cloudUploadEnabled: true,
      cloudUploadAdapter: "rclone" as const,
      cloudRemoteDir: "drive:/telegram",
      rclonePath: "/usr/local/bin/rclone",
      beforeUploadFileZip: true,
      cloudDeleteAfterUpload: true,
      telegramForwardEnabled: true,
      telegramForwardTargetChatId: "-1001",
      forwardLimitPerMinute: 12,
      forwardDeleteAfterUpload: true,
      pipelineDeleteAfterUpload: true,
    };

    const config = mergeSettingsConfig(baseConfig, values);

    expect(config.pipeline.cloud_upload).toMatchObject({
      enabled: true,
      adapter: "rclone",
      remote_dir: "drive:/telegram",
      rclone_path: "/usr/local/bin/rclone",
      before_upload_file_zip: true,
      delete_after_upload: true,
    });
    expect(config.pipeline.telegram_forward).toMatchObject({
      enabled: true,
      target_chat_id: "-1001",
    });
    expect(config.forward).toMatchObject({
      limit_per_minute: 12,
      delete_after_upload: true,
    });
    expect(config.pipeline.delete_after_upload).toBe(true);
  });

  it("validates supported cloud adapters", () => {
    expect(isSupportedCloudAdapter("rclone")).toBe(true);
    expect(isSupportedCloudAdapter("aligo")).toBe(false);
    expect(isSupportedCloudAdapter("webdav")).toBe(false);
    expect(isSupportedCloudAdapter("none")).toBe(false);
  });

  it("does not require rclone fields when cloud upload is disabled", () => {
    const values = {
      ...settingsFormValues(baseConfig),
      cloudUploadEnabled: false,
      cloudUploadAdapter: "aligo" as const,
      cloudRemoteDir: "",
      rclonePath: "",
    };

    expect(validateCloudSettings(values)).toEqual([]);
  });

  it("requires rclone remote dir and path when cloud upload is enabled", () => {
    const values = {
      ...settingsFormValues(baseConfig),
      cloudUploadEnabled: true,
      cloudUploadAdapter: "rclone" as const,
      cloudRemoteDir: "",
      rclonePath: "",
    };

    expect(validateCloudSettings(values)).toEqual([
      "启用 rclone 云盘上传时需要填写云盘远端目录",
      "启用 rclone 云盘上传时需要填写 rclone 路径",
    ]);
  });

  it("rejects unsupported cloud adapters when cloud upload is enabled", () => {
    const values = {
      ...settingsFormValues(baseConfig),
      cloudUploadEnabled: true,
      cloudUploadAdapter: "webdav" as const,
      cloudRemoteDir: "drive:/telegram",
      rclonePath: "rclone",
    };

    expect(validateCloudSettings(values)).toEqual(["当前后端未注册该云盘适配器，启用云盘上传时请选择 rclone"]);
  });

  it("requires telegram forward target only when forwarding is enabled", () => {
    const disabledValues = {
      ...settingsFormValues(baseConfig),
      telegramForwardEnabled: false,
      telegramForwardTargetChatId: "",
    };
    const enabledValues = {
      ...settingsFormValues(baseConfig),
      telegramForwardEnabled: true,
      telegramForwardTargetChatId: "",
    };

    expect(validateTelegramForwardSettings(disabledValues)).toEqual([]);
    expect(validateTelegramForwardSettings(enabledValues)).toEqual(["启用 Telegram 转发时需要填写转发目标"]);
  });
});
