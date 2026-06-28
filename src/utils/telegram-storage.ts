import { basename, parse, join } from "node:path";
import type { AppConfig } from "@/config/schema";
import type { NormalizedMessage } from "@/types/download";
import { sanitizeFileName } from "@/utils/format";
import { getHostname } from "@/utils/url";

const mimeExtensionMap: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "application/epub+zip": "epub",
  "application/pdf": "pdf",
  "application/x-7z-compressed": "7z",
  "application/x-rar-compressed": "rar",
  "application/zip": "zip",
  "image/jpeg": "jpg",
  "image/png": "png",
  "text/plain": "txt",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv",
  "video/webm": "webm",
};

function formatMediaDate(date: string | undefined, format: string) {
  const source = date ? new Date(date) : new Date();
  const year = String(source.getUTCFullYear());
  const shortYear = year.slice(-2);
  const month = String(source.getUTCMonth() + 1).padStart(2, "0");
  const day = String(source.getUTCDate()).padStart(2, "0");
  const hour = String(source.getUTCHours()).padStart(2, "0");
  const minute = String(source.getUTCMinutes()).padStart(2, "0");
  const second = String(source.getUTCSeconds()).padStart(2, "0");
  return format
    .replace(/%Y/g, year)
    .replace(/%y/g, shortYear)
    .replace(/%m/g, month)
    .replace(/%d/g, day)
    .replace(/%H/g, hour)
    .replace(/%M/g, minute)
    .replace(/%S/g, second)
    .replace(/yyyy/g, year)
    .replace(/YYYY/g, year)
    .replace(/yy/g, shortYear)
    .replace(/YY/g, shortYear)
    .replace(/MM/g, month)
    .replace(/dd/g, day)
    .replace(/DD/g, day)
    .replace(/HH/g, hour)
    .replace(/mm/g, minute)
    .replace(/ss/g, second);
}

export function getConfiguredTelegramSavePath(
  config: AppConfig,
  message: NormalizedMessage,
  options: { mediaType?: string } = {},
) {
  const parts = config.storage.file_path_prefix.flatMap((prefix) => {
    if (prefix === "chat_title") {
      return [sanitizeFileName(effectiveMessageSourceTitle(message) ?? message.chatTitle ?? message.chatId)];
    }
    if (prefix === "media_datetime") {
      return [formatMediaDate(message.date, config.storage.date_format)];
    }
    if (prefix === "media_type") {
      return [sanitizeFileName(options.mediaType ?? message.mediaType ?? "document")];
    }
    return [];
  });

  return join(config.storage.save_path, ...parts);
}

export function effectiveMessageSourceTitle(message: NormalizedMessage) {
  return (
    message.forwardOrigin?.chatTitle ||
    message.forwardOrigin?.senderName ||
    message.forwardOrigin?.chatId ||
    message.forwardOrigin?.senderId ||
    message.chatTitle ||
    message.senderName ||
    message.chatId
  );
}

export function externalPlatformPathSegment(url: string) {
  const host = getHostname(url).replace(/^www\./, "");
  return sanitizeFileName((host || "unknown").replace(/\./g, "_"));
}

export function getConfiguredExternalSavePath(config: AppConfig, url: string, message: NormalizedMessage) {
  const mediaDate = formatMediaDate(message.date, config.storage.date_format);
  return join(config.storage.save_path, "External_URL", externalPlatformPathSegment(url), mediaDate);
}

export function getConfiguredTelegramFileName(config: AppConfig, message: NormalizedMessage) {
  const extension = telegramFileFormat(message.fileName, message.mimeType) ?? message.mediaType ?? "bin";
  const originalName = message.fileName ? parse(basename(message.fileName)).name : undefined;
  const caption = message.caption ?? message.text;
  const parts = config.storage.file_name_prefix.flatMap((prefix) => {
    if (prefix === "message_id") {
      return [String(message.id)];
    }
    if (prefix === "file_name" && originalName) {
      return [originalName];
    }
    if (prefix === "caption" && caption) {
      return [caption];
    }
    return [];
  });

  const baseName = parts.length > 0 ? parts.join(config.storage.file_name_prefix_split) : String(message.id);
  return sanitizeFileName(`${baseName}.${extension}`);
}

export function telegramFileFormat(fileName?: string, mimeType?: string) {
  const extension = fileName?.split(".").pop();
  if (extension && extension !== fileName) {
    return extension.toLowerCase();
  }
  if (!mimeType) {
    return undefined;
  }
  const normalizedMime = mimeType.toLowerCase();
  const mapped = mimeExtensionMap[normalizedMime];
  if (mapped) {
    return mapped;
  }
  const [, subtype] = normalizedMime.split("/");
  return subtype?.split("+").at(0);
}

function booleanField(record: Record<string, unknown>, field: string) {
  return typeof record[field] === "boolean" ? record[field] : undefined;
}

export function isNoAudioVideo(message: NormalizedMessage) {
  if (message.mediaType !== "video" || !message.media || typeof message.media !== "object") {
    return false;
  }

  const media = message.media as Record<string, unknown>;
  const directNoAudio =
    booleanField(media, "nosound") ??
    booleanField(media, "noSound") ??
    booleanField(media, "noAudio") ??
    booleanField(media, "nosoundVideo") ??
    booleanField(media, "isSilent");
  if (directNoAudio !== undefined) {
    return directNoAudio;
  }

  const hasAudio = booleanField(media, "hasAudio");
  if (hasAudio !== undefined) {
    return !hasAudio;
  }

  const attr = media.attr;
  if (attr && typeof attr === "object") {
    const attrRecord = attr as Record<string, unknown>;
    const attrNoAudio =
      booleanField(attrRecord, "nosound") ??
      booleanField(attrRecord, "noSound") ??
      booleanField(attrRecord, "noAudio") ??
      booleanField(attrRecord, "nosoundVideo");
    if (attrNoAudio !== undefined) {
      return attrNoAudio;
    }
  }

  return false;
}

export function canDownloadTelegramMessage(config: AppConfig, message: NormalizedMessage) {
  const mediaType = message.mediaType;
  if (!mediaType || !config.storage.media_types.includes(mediaType)) {
    return false;
  }

  if (config.download.drop_no_audio_video && isNoAudioVideo(message)) {
    return false;
  }

  const allowedFormats = config.storage.file_formats[mediaType] ?? [];
  if (allowedFormats.length === 0) {
    return true;
  }

  const normalizedAllowedFormats = allowedFormats.map((item) => item.toLowerCase());
  if (normalizedAllowedFormats.includes("all")) {
    return true;
  }

  const format = telegramFileFormat(message.fileName, message.mimeType);
  return Boolean(format && normalizedAllowedFormats.includes(format));
}
