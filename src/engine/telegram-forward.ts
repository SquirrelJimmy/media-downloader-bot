import type { AppConfig } from "@/config/schema";
import type { NormalizedMessage } from "@/types/download";

const captionLimit = 1024;

class ForwardRateLimiter {
  private limitPerMinute = 0;
  private tokens = 0;
  private lastRefillAt = Date.now();

  async wait(limitPerMinute: number) {
    const limit = Math.max(0, Math.floor(limitPerMinute));
    if (limit <= 0) {
      return;
    }

    this.refill(limit);
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    const waitMs = Math.ceil(60_000 / limit);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    this.refill(limit);
    this.tokens = Math.max(0, this.tokens - 1);
  }

  private refill(limit: number) {
    const now = Date.now();
    if (this.limitPerMinute !== limit) {
      this.limitPerMinute = limit;
      this.tokens = limit;
      this.lastRefillAt = now;
      return;
    }

    const elapsedMs = now - this.lastRefillAt;
    if (elapsedMs <= 0) {
      return;
    }

    this.tokens = Math.min(limit, this.tokens + (elapsedMs / 60_000) * limit);
    this.lastRefillAt = now;
  }
}

const globalForwardState = globalThis as typeof globalThis & {
  __telegramDownloadForwardRateLimiter?: ForwardRateLimiter;
};

export const forwardRateLimiter =
  globalForwardState.__telegramDownloadForwardRateLimiter ??
  (globalForwardState.__telegramDownloadForwardRateLimiter = new ForwardRateLimiter());

export function captionMatchesAdvertisement(config: AppConfig, caption?: string) {
  if (!caption) {
    return false;
  }
  return config.forward.filter_advertisement_list.some((item) => item.length > 0 && caption.includes(item));
}

export function processForwardCaption(config: AppConfig, targetChatId: string, caption?: string) {
  if (!caption) {
    const advertisement = config.forward.group_add_advertisement[String(targetChatId)] ?? "";
    return advertisement || undefined;
  }

  let nextCaption = caption;
  for (const adText of config.forward.replace_advertisement_list) {
    if (adText) {
      nextCaption = nextCaption.replaceAll(adText, "");
    }
  }

  const advertisement = config.forward.group_add_advertisement[String(targetChatId)] ?? "";
  if (advertisement) {
    nextCaption = nextCaption ? `${nextCaption}\n${advertisement}` : advertisement;
  }

  return nextCaption.length > captionLimit ? nextCaption.slice(0, captionLimit) : nextCaption || undefined;
}

export function buildForwardCaption(
  config: AppConfig,
  targetChatId: string,
  message?: NormalizedMessage,
) {
  const caption = message?.caption ?? message?.text;
  if (captionMatchesAdvertisement(config, caption)) {
    return { skip: true as const, caption: undefined };
  }
  return {
    skip: false as const,
    caption: processForwardCaption(config, targetChatId, caption),
  };
}
