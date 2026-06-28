import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("/api/config", () => {
  let tempDir: string;
  let previousConfigPath: string | undefined;

  beforeEach(async () => {
    previousConfigPath = process.env.APP_CONFIG_PATH;
    tempDir = await mkdtemp(join(tmpdir(), "telegram-download-api-config-"));
    process.env.APP_CONFIG_PATH = join(tempDir, "app.yaml");
    vi.resetModules();
  });

  afterEach(async () => {
    if (previousConfigPath === undefined) {
      delete process.env.APP_CONFIG_PATH;
    } else {
      process.env.APP_CONFIG_PATH = previousConfigPath;
    }
    await rm(tempDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it("saves plugin and runtime settings through the normalized config route", async () => {
    const { GET, PUT } = await import("./route");

    const payload = {
      app: {
        name: "Custom Console",
        language: "EN",
      },
      bot: {
        download_filter: ["media_type == 'video'"],
      },
      telegram: {
        api_id: 12345,
        api_hash: "configured-api-hash",
        bot_token: "configured-bot-token",
        allowed_user_ids: [42, "84"],
        sessions_dir: "storage/sessions",
        user_session: "media_downloader.session",
        phone: "+10000000000",
      },
      chats: [
        {
          chat_id: -1001,
          chat_title: "Source",
          enabled: true,
          last_read_message_id: 9,
        },
      ],
      storage: {
        save_path: "custom-downloads",
        temp_path: "custom-tmp",
        media_types: ["video", "external"],
        file_path_prefix: ["chat_title", "media_datetime"],
        file_name_prefix: ["message_id", "file_name"],
        file_name_prefix_split: " - ",
        date_format: "%Y_%m_%d",
      },
      download: {
        hide_file_name: true,
        drop_no_audio_video: true,
      },
      forward: {
        limit_per_minute: 11,
        delete_after_upload: false,
      },
      queue: {
        max_download_tasks: 3,
        max_concurrent_transmissions: 8,
      },
      plugins: {
        telegram: {
          enabled: true,
        },
        telegram_text: {
          enabled: true,
        },
        ytdlp: {
          enabled: true,
          path: "data/bin/yt-dlp_macos",
          options: {
            format: "best",
            no_playlist: false,
            merge_output_format: "mp4",
            proxy: "socks5://127.0.0.1:7890",
            cookies: "/tmp/cookies.txt",
            cookies_from_browser: "chrome",
            user_agent: "Agent",
            referer: "https://example.com",
            rate_limit: "2M",
            retries: 3,
            fragment_retries: 4,
            concurrent_fragments: 5,
            extra_args: ["--embed-thumbnail"],
          },
        },
        http: {
          enabled: false,
          max_file_size: 1024,
        },
      },
      pipeline: {
        cloud_upload: {
          enabled: true,
          adapter: "rclone",
          remote_dir: "remote:path",
          rclone_path: "rclone",
          before_upload_file_zip: true,
          delete_after_upload: true,
        },
        telegram_forward: {
          enabled: true,
          target_chat_id: "-1002",
        },
        delete_after_upload: false,
      },
    };

    const putResponse = await PUT(
      new Request("http://localhost/api/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
    expect(putResponse.status).toBe(200);

    const saved = await putResponse.json();
    expect(saved.plugins.telegram).toMatchObject(payload.plugins.telegram);
    expect(saved.plugins.telegram_text).toMatchObject(payload.plugins.telegram_text);
    expect(saved.plugins.ytdlp).toMatchObject({
      enabled: true,
      path: "./data/bin/yt-dlp_macos",
      options: payload.plugins.ytdlp.options,
    });
    expect(saved.plugins.http).toMatchObject(payload.plugins.http);
    expect(saved.storage.save_path).toBe("custom-downloads");
    expect(saved.queue.max_download_tasks).toBe(3);
    expect(saved.pipeline.cloud_upload).toMatchObject(payload.pipeline.cloud_upload);
    expect(saved.telegram.api_hash).toBe("configured-api-hash");
    expect(saved.telegram.bot_token).toBe("configured-bot-token");
    expect(saved.chats[0]).toMatchObject({ chat_id: -1001, last_read_message_id: 9 });

    const getResponse = await GET();
    expect(getResponse.status).toBe(200);

    const loaded = await getResponse.json();
    expect(loaded.plugins.ytdlp.path).toBe("./data/bin/yt-dlp_macos");
    expect(loaded.plugins.ytdlp.options.format).toBe("best");
    expect(loaded.plugins.ytdlp.options.extra_args).toEqual(["--embed-thumbnail"]);
    expect(loaded.plugins.http.enabled).toBe(false);
    expect(loaded.storage.media_types).toEqual(["video", "external"]);
    expect(loaded.bot.download_filter).toEqual(["media_type == 'video'"]);
    expect(loaded.telegram.allowed_user_ids).toEqual([42, "84"]);
  });
});
