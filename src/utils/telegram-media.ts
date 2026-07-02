import type { MessageMedia } from "@mtcute/node";
import type { MediaType } from "@/types/download";

const downloadableMediaTypes = new Set(["audio", "document", "photo", "video", "voice"]);
const downloadableNormalizedMediaTypes = new Set<MediaType>([
  "audio",
  "document",
  "photo",
  "video",
  "video_note",
  "voice",
  "animation",
]);

export function isDownloadableTelegramMedia(media: unknown) {
  if (!media || typeof media !== "object") {
    return false;
  }
  const type = (media as { type?: unknown }).type;
  return typeof type === "string" && downloadableMediaTypes.has(type);
}

export function telegramMediaType(media: MessageMedia): MediaType | undefined {
  if (!isDownloadableTelegramMedia(media)) {
    return undefined;
  }
  const record = media as { type?: unknown; isAnimation?: unknown; isRound?: unknown };
  if (record.type === "video") {
    return record.isAnimation ? "animation" : record.isRound ? "video_note" : "video";
  }
  if (
    record.type === "audio" ||
    record.type === "document" ||
    record.type === "photo" ||
    record.type === "voice"
  ) {
    return record.type;
  }
  return undefined;
}

export function isDownloadableTelegramMediaType(mediaType: unknown): mediaType is MediaType {
  return typeof mediaType === "string" && downloadableNormalizedMediaTypes.has(mediaType as MediaType);
}

export function telegramWebpagePreviewUrl(media: unknown) {
  if (!media || typeof media !== "object") {
    return undefined;
  }
  const record = media as { type?: unknown; preview?: unknown };
  if (record.type !== "webpage" || !record.preview || typeof record.preview !== "object") {
    return undefined;
  }
  const preview = record.preview as { url?: unknown };
  return typeof preview.url === "string" && preview.url.length > 0 ? preview.url : undefined;
}
