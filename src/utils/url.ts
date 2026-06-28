const urlPattern = /https?:\/\/[^\s<>"']+/gi;

export function extractUrls(text?: string | null) {
  if (!text) {
    return [];
  }
  return Array.from(text.matchAll(urlPattern), (match) => match[0]);
}

export function getHostname(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function isDirectFileUrl(url: string) {
  return /\.(mp4|mkv|mov|zip|rar|7z|pdf|epub|mp3|flac|wav|jpg|jpeg|png|webp)(\?.*)?$/i.test(url);
}
