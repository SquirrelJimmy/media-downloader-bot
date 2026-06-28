import { describe, expect, it } from "vitest";
import { defaultYtdlpUserAgent, parseAppConfig } from "@/config/schema";
import type { NormalizedMessage } from "@/types/download";
import {
  canDownloadTelegramMessage,
  externalPlatformPathSegment,
  getConfiguredExternalSavePath,
  getConfiguredTelegramFileName,
  getConfiguredTelegramSavePath,
} from "@/utils/telegram-storage";
import { parseTelegramChatRef, parseTelegramMessageRef } from "@/utils/telegram-link";

const message: NormalizedMessage = {
  id: 42,
  chatId: "-1001",
  chatTitle: "Source/Chat",
  date: "2026-06-28T12:30:00.000Z",
  mediaType: "video",
  fileName: "clip.mp4",
  caption: "hello world",
};

describe("legacy config semantics", () => {
  it("parses legacy media, format and retry fields", () => {
    const config = parseAppConfig({
      api_id: 123,
      api_hash: "hash",
      bot_token: "bot-token",
      allowed_user_ids: ["me", 42],
      save_path: "legacy-downloads",
      media_types: ["video"],
      file_formats: { video: ["mp4"] },
      max_download_task: 3,
      chat: [
        {
          chat_id: -1001,
          ids_to_retry: [1, 2],
        },
      ],
    });

    expect(config.telegram.api_id).toBe(123);
    expect(config.telegram.api_hash).toBe("hash");
    expect(config.telegram.bot_token).toBe("bot-token");
    expect(config.telegram.allowed_user_ids).toEqual(["me", 42]);
    expect(config.storage.save_path).toBe("legacy-downloads");
    expect(config.storage.media_types).toEqual(["video"]);
    expect(config.storage.file_formats).toEqual({ video: ["mp4"] });
    expect(config.queue.max_download_tasks).toBe(3);
    expect(config.queue.max_concurrent_transmissions).toBe(15);
    expect(config.chats[0]?.ids_to_retry).toEqual([1, 2]);
  });

  it("parses legacy top-level language and explicit transmission concurrency", () => {
    const config = parseAppConfig({
      language: "en",
      max_download_task: 3,
      max_concurrent_transmissions: 7,
    });

    expect(config.app.language).toBe("EN");
    expect(config.queue.max_download_tasks).toBe(3);
    expect(config.queue.max_concurrent_transmissions).toBe(7);
  });

  it("parses legacy top-level single chat fields", () => {
    const config = parseAppConfig({
      chat_id: -1001,
      last_read_message_id: 50,
      ids_to_retry: [44, 45],
      upload_telegram_chat_id: -1002,
      download_filter: {
        "-1001": "media_type == 'video'",
      },
    });

    expect(config.chats).toHaveLength(1);
    expect(config.chats[0]).toMatchObject({
      chat_id: -1001,
      last_read_message_id: 50,
      ids_to_retry: [44, 45],
      upload_telegram_chat_id: "-1002",
      download_filter: "media_type == 'video'",
    });
  });

  it("keeps text message download disabled by default and maps legacy enable_download_txt", () => {
    expect(parseAppConfig({}).plugins.telegram_text.enabled).toBe(false);
    expect(parseAppConfig({ enable_download_txt: true }).plugins.telegram_text.enabled).toBe(true);
    expect(parseAppConfig({ plugins: { telegram_text: { enabled: true } } }).plugins.telegram_text.enabled).toBe(true);
  });

  it("fills configurable non-telegram plugin priorities", () => {
    expect(parseAppConfig({}).plugins.ytdlp.priority).toBe(1.5);
    expect(parseAppConfig({}).plugins.http.priority).toBe(1.75);
    expect(parseAppConfig({}).plugins.telegram_text.priority).toBe(2);
    expect(
      parseAppConfig({
        plugins: {
          ytdlp: { priority: 0.75 },
          http: { priority: 1.25 },
          telegram_text: { priority: 3 },
        },
      }).plugins,
    ).toMatchObject({
      ytdlp: { priority: 0.75 },
      http: { priority: 1.25 },
      telegram_text: { priority: 3 },
    });
  });

  it("fills and normalizes yt-dlp option defaults", () => {
    const config = parseAppConfig({
      plugins: {
        ytdlp: {
          options: {
            format: " best ",
            no_playlist: false,
            proxy: " socks5://127.0.0.1:7890 ",
            retries: 3,
            extra_args: [" --embed-thumbnail ", "", "--write-subs"],
          },
        },
      },
    });

    expect(config.plugins.ytdlp.options).toMatchObject({
      format: "best",
      no_playlist: false,
      proxy: "socks5://127.0.0.1:7890",
      retries: 3,
      fragment_retries: 0,
      concurrent_fragments: 0,
      extra_args: ["--embed-thumbnail", "--write-subs"],
    });
    expect(parseAppConfig({}).plugins.ytdlp.options.user_agent).toBe(defaultYtdlpUserAgent);
  });

  it("parses legacy download and forward behavior fields", () => {
    const config = parseAppConfig({
      hide_file_name: true,
      drop_no_audio_video: true,
      forward_limit: 12,
      after_upload_telegram_delete: false,
      filter_advertisement_list: ["promo"],
      replace_advertisement_list: ["ad"],
      group_add_advertisement: {
        "-1002": "footer",
      },
    });

    expect(config.download.hide_file_name).toBe(true);
    expect(config.download.drop_no_audio_video).toBe(true);
    expect(config.forward.limit_per_minute).toBe(12);
    expect(config.forward.delete_after_upload).toBe(false);
    expect(config.forward.filter_advertisement_list).toEqual(["promo"]);
    expect(config.forward.replace_advertisement_list).toEqual(["ad"]);
    expect(config.forward.group_add_advertisement).toEqual({ "-1002": "footer" });
  });

  it("builds old-style save path and file name prefixes", () => {
    const config = parseAppConfig({
      storage: {
        save_path: "downloads",
        file_path_prefix: ["chat_title", "media_datetime", "media_type"],
        file_name_prefix: ["message_id", "caption", "file_name"],
        file_name_prefix_split: " - ",
        date_format: "%Y_%m",
      },
    });

    expect(getConfiguredTelegramSavePath(config, message)).toBe("downloads/Source_Chat/2026_06/video");
    expect(getConfiguredTelegramFileName(config, message)).toBe("42 - hello world - clip.mp4");
  });

  it("uses forward origin title for the chat_title path segment", () => {
    const config = parseAppConfig({
      storage: {
        save_path: "downloads",
        file_path_prefix: ["chat_title", "media_datetime", "media_type"],
        date_format: "%Y_%m",
      },
    });
    const forwardedMessage: NormalizedMessage = {
      ...message,
      chatTitle: "DaZuo Ka",
      senderName: "DaZuo Ka",
      forwardOrigin: {
        senderName: "如何与沙雕相处",
      },
    };

    expect(getConfiguredTelegramSavePath(config, forwardedMessage)).toBe("downloads/如何与沙雕相处/2026_06/video");
  });

  it("detects external platform names for external URL paths", () => {
    const config = parseAppConfig({
      storage: {
        save_path: "downloads",
        date_format: "%Y_%m",
      },
    });

    expect(externalPlatformPathSegment("https://x.com/user/status/1")).toBe("x_com");
    expect(externalPlatformPathSegment("https://www.youtube.com/watch?v=1")).toBe("youtube_com");
    expect(getConfiguredExternalSavePath(config, "https://x.com/user/status/1", message)).toBe(
      "downloads/External_URL/x_com/2026_06",
    );
  });

  it("keeps compatibility with yyyy style date format", () => {
    const config = parseAppConfig({
      storage: {
        save_path: "downloads",
        file_path_prefix: ["media_datetime"],
        date_format: "yyyy-MM-dd_HH-mm-ss",
      },
    });

    expect(getConfiguredTelegramSavePath(config, message)).toBe("downloads/2026-06-28_12-30-00");
  });

  it("filters telegram media by media_types and file_formats", () => {
    const config = parseAppConfig({
      storage: {
        media_types: ["video"],
        file_formats: { video: ["mkv"] },
      },
    });

    expect(canDownloadTelegramMessage(config, message)).toBe(false);
    expect(
      canDownloadTelegramMessage(
        parseAppConfig({ storage: { media_types: ["video"], file_formats: { video: ["mp4"] } } }),
        message,
      ),
    ).toBe(true);
  });

  it("uses mime type as a legacy file format fallback when file name is missing", () => {
    const unnamedVideo: NormalizedMessage = {
      ...message,
      fileName: undefined,
      mimeType: "video/mp4",
    };
    const config = parseAppConfig({
      storage: {
        media_types: ["video"],
        file_formats: { video: ["mp4"] },
        file_name_prefix: ["message_id", "file_name"],
      },
    });

    expect(canDownloadTelegramMessage(config, unnamedVideo)).toBe(true);
    expect(getConfiguredTelegramFileName(config, unnamedVideo)).toBe("42.mp4");
  });

  it("treats legacy file_formats all as every file extension", () => {
    const config = parseAppConfig({
      storage: {
        media_types: ["video"],
        file_formats: { video: ["all"] },
      },
    });

    expect(canDownloadTelegramMessage(config, message)).toBe(true);
  });

  it("drops no-audio videos only when legacy drop_no_audio_video is enabled", () => {
    const noAudioVideo: NormalizedMessage = {
      ...message,
      media: {
        type: "video",
        attr: {
          _: "documentAttributeVideo",
          nosound: true,
        },
      },
    };

    expect(canDownloadTelegramMessage(parseAppConfig({}), noAudioVideo)).toBe(true);
    expect(canDownloadTelegramMessage(parseAppConfig({ drop_no_audio_video: true }), noAudioVideo)).toBe(false);
  });

  it("parses cloud upload zip compatibility option", () => {
    const config = parseAppConfig({
      upload_drive: {
        enable_upload_file: true,
        remote_dir: "drive:/telegram",
        upload_adapter: "rclone",
        rclone_path: "/usr/bin/rclone",
        before_upload_file_zip: true,
        after_upload_file_delete: true,
      },
    });

    expect(config.pipeline.cloud_upload.enabled).toBe(true);
    expect(config.pipeline.cloud_upload.remote_dir).toBe("drive:/telegram");
    expect(config.pipeline.cloud_upload.adapter).toBe("rclone");
    expect(config.pipeline.cloud_upload.rclone_path).toBe("/usr/bin/rclone");
    expect(config.pipeline.cloud_upload.before_upload_file_zip).toBe(true);
    expect(config.pipeline.cloud_upload.delete_after_upload).toBe(true);
  });

  it("accepts legacy aligo upload adapter value", () => {
    const config = parseAppConfig({
      upload_drive: {
        enable_upload_file: true,
        upload_adapter: "aligo",
        remote_dir: "/telegram",
      },
    });

    expect(config.pipeline.cloud_upload.enabled).toBe(true);
    expect(config.pipeline.cloud_upload.adapter).toBe("aligo");
    expect(config.pipeline.cloud_upload.remote_dir).toBe("/telegram");
  });

  it("parses legacy bot default download filter", () => {
    expect(parseAppConfig({ download_filter: "media_type == 'video'" }).bot.download_filter).toEqual([
      "media_type == 'video'",
    ]);
    expect(parseAppConfig({ bot: { download_filter: ["file_size > 10MB"] } }).bot.download_filter).toEqual([
      "file_size > 10MB",
    ]);
  });

  it("parses legacy per-chat download filter map", () => {
    const config = parseAppConfig({
      download_filter: {
        "-1001": "media_type == 'video'",
      },
      chat: [
        {
          chat_id: -1001,
        },
      ],
    });

    expect(config.bot.download_filter).toEqual([]);
    expect(config.chats[0]?.download_filter).toBe("media_type == 'video'");
  });

  it("parses telegram chat, topic and comment links", () => {
    expect(parseTelegramChatRef("https://t.me/c/1492447836/251015/251021")).toEqual({
      chatId: "-1001492447836",
      topicId: 251015,
      messageId: 251021,
      commentId: undefined,
    });
    expect(parseTelegramMessageRef("https://t.me/opencfdchannel/4434?comment=360409")).toEqual({
      chatId: "opencfdchannel",
      messageId: 4434,
      topicId: undefined,
      commentId: 360409,
    });
  });
});
