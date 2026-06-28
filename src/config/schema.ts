import { z } from "zod";
import { defaultYtdlpPath, normalizeYtdlpPath } from "@/utils/ytdlp-binary";

const languageSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.toUpperCase() : value),
  z.enum(["EN", "ZH", "RU", "UA"]),
);

const ytdlpOptionsSchema = z
  .object({
    format: z.string().optional(),
    no_playlist: z.boolean().optional(),
    merge_output_format: z.string().optional(),
    proxy: z.string().optional(),
    cookies: z.string().optional(),
    cookies_from_browser: z.string().optional(),
    user_agent: z.string().optional(),
    referer: z.string().optional(),
    rate_limit: z.string().optional(),
    retries: z.number().int().nonnegative().optional(),
    fragment_retries: z.number().int().nonnegative().optional(),
    concurrent_fragments: z.number().int().nonnegative().optional(),
    extra_args: z.array(z.string()).optional(),
  })
  .optional();

export const defaultYtdlpUserAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

export const appConfigSchema = z.object({
  api_id: z.number().int().nonnegative().optional(),
  api_hash: z.string().optional(),
  bot_token: z.string().optional(),
  allowed_user_ids: z.array(z.union([z.string(), z.number()])).optional(),
  chat_id: z.union([z.string(), z.number()]).optional(),
  last_read_message_id: z.number().int().nonnegative().optional(),
  ids_to_retry: z.array(z.number().int().positive()).optional(),
  upload_telegram_chat_id: z.union([z.string(), z.number()]).optional(),
  save_path: z.string().optional(),
  media_types: z.array(z.string()).optional(),
  file_formats: z.record(z.string(), z.array(z.string())).optional(),
  file_path_prefix: z.array(z.string()).optional(),
  file_name_prefix: z.array(z.string()).optional(),
  file_name_prefix_split: z.string().optional(),
  date_format: z.string().optional(),
  language: languageSchema.optional(),
  enable_download_txt: z.boolean().optional(),
  hide_file_name: z.boolean().optional(),
  drop_no_audio_video: z.boolean().optional(),
  forward_limit: z.number().int().nonnegative().optional(),
  after_upload_telegram_delete: z.boolean().optional(),
  filter_advertisement_list: z.array(z.string()).optional(),
  replace_advertisement_list: z.array(z.string()).optional(),
  group_add_advertisement: z.record(z.string(), z.string()).optional(),
  max_download_task: z.number().int().positive().optional(),
  max_download_tasks: z.number().int().positive().optional(),
  max_concurrent_transmissions: z.number().int().positive().optional(),
  upload_drive: z
    .object({
      enable_upload_file: z.boolean().optional(),
      enabled: z.boolean().optional(),
      remote_dir: z.string().optional(),
      upload_adapter: z.enum(["rclone", "aligo", "webdav", "none"]).optional(),
      adapter: z.enum(["rclone", "aligo", "webdav", "none"]).optional(),
      rclone_path: z.string().optional(),
      before_upload_file_zip: z.boolean().optional(),
      after_upload_file_delete: z.boolean().optional(),
      delete_after_upload: z.boolean().optional(),
    })
    .optional(),
  app: z
    .object({
      name: z.string().optional(),
      language: languageSchema.optional(),
    })
    .optional(),
  download_filter: z
    .union([z.string(), z.array(z.string()), z.record(z.string(), z.string())])
    .optional(),
  bot: z
    .object({
      download_filter: z.union([z.string(), z.array(z.string())]).optional(),
    })
    .optional(),
  telegram: z
    .object({
      api_id: z.number().int().nonnegative().optional(),
      api_hash: z.string().optional(),
      bot_token: z.string().optional(),
      allowed_user_ids: z.array(z.union([z.string(), z.number()])).optional(),
      sessions_dir: z.string().optional(),
      user_session: z.string().optional(),
      phone: z.string().optional(),
    })
    .optional(),
  chats: z
    .array(
      z.object({
        chat_id: z.union([z.string(), z.number()]),
        chat_title: z.string().optional(),
        enabled: z.boolean().optional(),
        last_read_message_id: z.number().int().nonnegative().optional(),
        download_filter: z.string().optional(),
        upload_telegram_chat_id: z.union([z.string(), z.number()]).optional(),
        ids_to_retry: z.array(z.number().int().positive()).optional(),
        limit: z.number().int().positive().optional(),
        start_offset_id: z.number().int().nonnegative().optional(),
        end_offset_id: z.number().int().nonnegative().optional(),
        reverse: z.boolean().optional(),
      }),
    )
    .optional(),
  chat: z
    .array(
      z.object({
        chat_id: z.union([z.string(), z.number()]),
        chat_title: z.string().optional(),
        enabled: z.boolean().optional(),
        last_read_message_id: z.number().int().nonnegative().optional(),
        download_filter: z.string().optional(),
        upload_telegram_chat_id: z.union([z.string(), z.number()]).optional(),
        ids_to_retry: z.array(z.number().int().positive()).optional(),
        limit: z.number().int().positive().optional(),
        start_offset_id: z.number().int().nonnegative().optional(),
        end_offset_id: z.number().int().nonnegative().optional(),
        reverse: z.boolean().optional(),
      }),
    )
    .optional(),
  storage: z
    .object({
      save_path: z.string().optional(),
      temp_path: z.string().optional(),
      media_types: z.array(z.string()).optional(),
      file_formats: z.record(z.string(), z.array(z.string())).optional(),
      file_path_prefix: z.array(z.string()).optional(),
      file_name_prefix: z.array(z.string()).optional(),
      file_name_prefix_split: z.string().optional(),
      date_format: z.string().optional(),
    })
    .optional(),
  download: z
    .object({
      hide_file_name: z.boolean().optional(),
      drop_no_audio_video: z.boolean().optional(),
    })
    .optional(),
  forward: z
    .object({
      limit_per_minute: z.number().int().nonnegative().optional(),
      delete_after_upload: z.boolean().optional(),
      filter_advertisement_list: z.array(z.string()).optional(),
      replace_advertisement_list: z.array(z.string()).optional(),
      group_add_advertisement: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
  queue: z
    .object({
      adapter: z.enum(["sqlite", "bullmq"]).optional(),
      max_download_tasks: z.number().int().positive().optional(),
      max_concurrent_transmissions: z.number().int().positive().optional(),
      redis_url: z.string().optional(),
    })
    .optional(),
  plugins: z
    .object({
      telegram: z.object({ enabled: z.boolean().optional() }).optional(),
      telegram_text: z.object({ enabled: z.boolean().optional(), priority: z.number().positive().optional() }).optional(),
      ytdlp: z
        .object({
          enabled: z.boolean().optional(),
          priority: z.number().positive().optional(),
          path: z.string().optional(),
          options: ytdlpOptionsSchema,
          sites: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
        })
        .optional(),
      http: z
        .object({
          enabled: z.boolean().optional(),
          priority: z.number().positive().optional(),
          max_file_size: z.number().int().positive().optional(),
        })
        .optional(),
    })
    .optional(),
  pipeline: z
    .object({
      cloud_upload: z
        .object({
          enabled: z.boolean().optional(),
          adapter: z.enum(["rclone", "aligo", "webdav", "none"]).optional(),
          remote_dir: z.string().optional(),
          rclone_path: z.string().optional(),
          before_upload_file_zip: z.boolean().optional(),
          delete_after_upload: z.boolean().optional(),
        })
        .optional(),
      telegram_forward: z
        .object({
          enabled: z.boolean().optional(),
          target_chat_id: z.string().optional(),
        })
        .optional(),
      delete_after_upload: z.boolean().optional(),
    })
    .optional(),
});

export type AppConfigInput = z.input<typeof appConfigSchema>;

export interface ChatDownloadConfig {
  chat_id: string | number;
  chat_title?: string;
  enabled: boolean;
  last_read_message_id: number;
  download_filter: string;
  upload_telegram_chat_id: string;
  ids_to_retry: number[];
  limit?: number;
  start_offset_id?: number;
  end_offset_id?: number;
  reverse: boolean;
}

export interface YtdlpOptionsConfig {
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
}

export interface AppConfig {
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
  chats: ChatDownloadConfig[];
  storage: {
    save_path: string;
    temp_path: string;
    media_types: string[];
    file_formats: Record<string, string[]>;
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
    filter_advertisement_list: string[];
    replace_advertisement_list: string[];
    group_add_advertisement: Record<string, string>;
  };
  queue: {
    adapter: "sqlite" | "bullmq";
    max_download_tasks: number;
    max_concurrent_transmissions: number;
    redis_url: string;
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
      options: YtdlpOptionsConfig;
      sites: Record<string, Record<string, unknown>>;
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
}

export const defaultAppConfig: AppConfig = {
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
  chats: [],
  storage: {
    save_path: "downloads",
    temp_path: "storage/tmp",
    media_types: ["audio", "document", "photo", "video", "voice", "video_note", "animation"],
    file_formats: {
      audio: [],
      document: [],
      video: [],
    },
    file_path_prefix: ["chat_title", "media_datetime", "media_type"],
    file_name_prefix: ["message_id", "file_name"],
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
    filter_advertisement_list: [],
    replace_advertisement_list: [],
    group_add_advertisement: {},
  },
  queue: {
    adapter: "sqlite",
    max_download_tasks: 5,
    max_concurrent_transmissions: 25,
    redis_url: "",
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
      path: defaultYtdlpPath(),
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
      sites: {},
    },
    http: {
      enabled: true,
      priority: 1.75,
      max_file_size: 5 * 1024 * 1024 * 1024,
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

export function parseAppConfig(input: unknown): AppConfig {
  const parsed = appConfigSchema.parse(input);
  const ytdlpOptions = parsed.plugins?.ytdlp?.options;
  const maxDownloadTasks =
    parsed.queue?.max_download_tasks ??
    parsed.max_download_tasks ??
    parsed.max_download_task ??
    defaultAppConfig.queue.max_download_tasks;
  const hasConfiguredDownloadTaskCount =
    parsed.queue?.max_download_tasks !== undefined ||
    parsed.max_download_tasks !== undefined ||
    parsed.max_download_task !== undefined;
  const maxConcurrentTransmissions =
    parsed.queue?.max_concurrent_transmissions ??
    parsed.max_concurrent_transmissions ??
    (hasConfiguredDownloadTaskCount
      ? maxDownloadTasks * 5
      : defaultAppConfig.queue.max_concurrent_transmissions);
  const parsedChats =
    parsed.chats ??
    parsed.chat ??
    (parsed.chat_id === undefined
      ? []
      : [
          {
            chat_id: parsed.chat_id,
            last_read_message_id: parsed.last_read_message_id,
            ids_to_retry: parsed.ids_to_retry,
            upload_telegram_chat_id: parsed.upload_telegram_chat_id,
          },
        ]);
  const legacyUploadDrive = parsed.upload_drive;
  return {
    app: {
      ...defaultAppConfig.app,
      ...parsed.app,
      language: parsed.app?.language ?? parsed.language ?? defaultAppConfig.app.language,
    },
    bot: {
      ...defaultAppConfig.bot,
      ...parsed.bot,
      download_filter: [
        parsed.bot?.download_filter ??
          (typeof parsed.download_filter === "string" || Array.isArray(parsed.download_filter)
            ? parsed.download_filter
            : []),
      ]
        .flat()
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0),
    },
    telegram: {
      ...defaultAppConfig.telegram,
      ...parsed.telegram,
      api_id: parsed.telegram?.api_id ?? parsed.api_id ?? defaultAppConfig.telegram.api_id,
      api_hash: parsed.telegram?.api_hash ?? parsed.api_hash ?? defaultAppConfig.telegram.api_hash,
      bot_token: parsed.telegram?.bot_token ?? parsed.bot_token ?? defaultAppConfig.telegram.bot_token,
      allowed_user_ids:
        parsed.telegram?.allowed_user_ids ??
        parsed.allowed_user_ids ??
        defaultAppConfig.telegram.allowed_user_ids,
    },
    chats: parsedChats.map((chat): ChatDownloadConfig => {
      const downloadFilterMap =
        parsed.download_filter && typeof parsed.download_filter === "object" && !Array.isArray(parsed.download_filter)
          ? parsed.download_filter
          : {};
      return {
        chat_id: chat.chat_id,
        chat_title: chat.chat_title,
        enabled: chat.enabled ?? true,
        last_read_message_id: chat.last_read_message_id ?? 0,
        download_filter: chat.download_filter ?? downloadFilterMap[String(chat.chat_id)] ?? "",
        upload_telegram_chat_id:
          chat.upload_telegram_chat_id === undefined ? "" : String(chat.upload_telegram_chat_id),
        ids_to_retry: chat.ids_to_retry ?? [],
        limit: chat.limit,
        start_offset_id: chat.start_offset_id,
        end_offset_id: chat.end_offset_id,
        reverse: chat.reverse ?? true,
      };
    }),
    storage: {
      ...defaultAppConfig.storage,
      ...parsed.storage,
      media_types:
        parsed.media_types ?? parsed.storage?.media_types ?? defaultAppConfig.storage.media_types,
      file_formats:
        parsed.file_formats ?? parsed.storage?.file_formats ?? defaultAppConfig.storage.file_formats,
      save_path: parsed.save_path ?? parsed.storage?.save_path ?? defaultAppConfig.storage.save_path,
      file_path_prefix:
        parsed.file_path_prefix ?? parsed.storage?.file_path_prefix ?? defaultAppConfig.storage.file_path_prefix,
      file_name_prefix:
        parsed.file_name_prefix ?? parsed.storage?.file_name_prefix ?? defaultAppConfig.storage.file_name_prefix,
      file_name_prefix_split:
        parsed.file_name_prefix_split ??
        parsed.storage?.file_name_prefix_split ??
        defaultAppConfig.storage.file_name_prefix_split,
      date_format: parsed.date_format ?? parsed.storage?.date_format ?? defaultAppConfig.storage.date_format,
    },
    queue: {
      ...defaultAppConfig.queue,
      ...parsed.queue,
      max_download_tasks: maxDownloadTasks,
      max_concurrent_transmissions: maxConcurrentTransmissions,
    },
    download: {
      ...defaultAppConfig.download,
      ...parsed.download,
      hide_file_name:
        parsed.download?.hide_file_name ??
        parsed.hide_file_name ??
        defaultAppConfig.download.hide_file_name,
      drop_no_audio_video:
        parsed.download?.drop_no_audio_video ??
        parsed.drop_no_audio_video ??
        defaultAppConfig.download.drop_no_audio_video,
    },
    forward: {
      ...defaultAppConfig.forward,
      ...parsed.forward,
      limit_per_minute:
        parsed.forward?.limit_per_minute ??
        parsed.forward_limit ??
        defaultAppConfig.forward.limit_per_minute,
      delete_after_upload:
        parsed.forward?.delete_after_upload ??
        parsed.after_upload_telegram_delete ??
        defaultAppConfig.forward.delete_after_upload,
      filter_advertisement_list:
        parsed.forward?.filter_advertisement_list ??
        parsed.filter_advertisement_list ??
        defaultAppConfig.forward.filter_advertisement_list,
      replace_advertisement_list:
        parsed.forward?.replace_advertisement_list ??
        parsed.replace_advertisement_list ??
        defaultAppConfig.forward.replace_advertisement_list,
      group_add_advertisement:
        parsed.forward?.group_add_advertisement ??
        parsed.group_add_advertisement ??
        defaultAppConfig.forward.group_add_advertisement,
    },
    plugins: {
      telegram: {
        ...defaultAppConfig.plugins.telegram,
        ...parsed.plugins?.telegram,
      },
      telegram_text: {
        ...defaultAppConfig.plugins.telegram_text,
        ...parsed.plugins?.telegram_text,
        enabled:
          parsed.plugins?.telegram_text?.enabled ??
          parsed.enable_download_txt ??
          defaultAppConfig.plugins.telegram_text.enabled,
      },
      ytdlp: {
        ...defaultAppConfig.plugins.ytdlp,
        ...parsed.plugins?.ytdlp,
        path: normalizeYtdlpPath(parsed.plugins?.ytdlp?.path) ?? defaultAppConfig.plugins.ytdlp.path,
        options: {
          ...defaultAppConfig.plugins.ytdlp.options,
          ...ytdlpOptions,
          format:
            ytdlpOptions?.format?.trim() ||
            defaultAppConfig.plugins.ytdlp.options.format,
          merge_output_format: ytdlpOptions?.merge_output_format?.trim() ?? "",
          proxy: ytdlpOptions?.proxy?.trim() ?? "",
          cookies: ytdlpOptions?.cookies?.trim() ?? "",
          cookies_from_browser: ytdlpOptions?.cookies_from_browser?.trim() ?? "",
          user_agent: ytdlpOptions?.user_agent?.trim() ?? defaultAppConfig.plugins.ytdlp.options.user_agent,
          referer: ytdlpOptions?.referer?.trim() ?? "",
          rate_limit: ytdlpOptions?.rate_limit?.trim() ?? "",
          retries: ytdlpOptions?.retries ?? defaultAppConfig.plugins.ytdlp.options.retries,
          fragment_retries:
            ytdlpOptions?.fragment_retries ??
            defaultAppConfig.plugins.ytdlp.options.fragment_retries,
          concurrent_fragments:
            ytdlpOptions?.concurrent_fragments ??
            defaultAppConfig.plugins.ytdlp.options.concurrent_fragments,
          extra_args: (ytdlpOptions?.extra_args ?? [])
            .map((item) => item.trim())
            .filter(Boolean),
        },
        sites: parsed.plugins?.ytdlp?.sites ?? defaultAppConfig.plugins.ytdlp.sites,
      },
      http: {
        ...defaultAppConfig.plugins.http,
        ...parsed.plugins?.http,
      },
    },
    pipeline: {
      cloud_upload: {
        ...defaultAppConfig.pipeline.cloud_upload,
        enabled:
          parsed.pipeline?.cloud_upload?.enabled ??
          legacyUploadDrive?.enabled ??
          legacyUploadDrive?.enable_upload_file ??
          defaultAppConfig.pipeline.cloud_upload.enabled,
        adapter:
          parsed.pipeline?.cloud_upload?.adapter ??
          legacyUploadDrive?.adapter ??
          legacyUploadDrive?.upload_adapter ??
          defaultAppConfig.pipeline.cloud_upload.adapter,
        remote_dir:
          parsed.pipeline?.cloud_upload?.remote_dir ??
          legacyUploadDrive?.remote_dir ??
          defaultAppConfig.pipeline.cloud_upload.remote_dir,
        rclone_path:
          parsed.pipeline?.cloud_upload?.rclone_path ??
          legacyUploadDrive?.rclone_path ??
          defaultAppConfig.pipeline.cloud_upload.rclone_path,
        before_upload_file_zip:
          parsed.pipeline?.cloud_upload?.before_upload_file_zip ??
          legacyUploadDrive?.before_upload_file_zip ??
          defaultAppConfig.pipeline.cloud_upload.before_upload_file_zip,
        delete_after_upload:
          parsed.pipeline?.cloud_upload?.delete_after_upload ??
          legacyUploadDrive?.delete_after_upload ??
          legacyUploadDrive?.after_upload_file_delete ??
          defaultAppConfig.pipeline.cloud_upload.delete_after_upload,
        ...parsed.pipeline?.cloud_upload,
      },
      telegram_forward: {
        ...defaultAppConfig.pipeline.telegram_forward,
        ...parsed.pipeline?.telegram_forward,
      },
      delete_after_upload:
        parsed.pipeline?.delete_after_upload ?? defaultAppConfig.pipeline.delete_after_upload,
    },
  };
}
