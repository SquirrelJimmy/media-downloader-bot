import { describe, expect, it } from "vitest";
import { isDownloadableTelegramMedia, telegramMediaType, telegramWebpagePreviewUrl } from "@/utils/telegram-media";

describe("telegram media helpers", () => {
  it("accepts only media types that mtcute can download as files", () => {
    expect(isDownloadableTelegramMedia({ type: "photo" })).toBe(true);
    expect(isDownloadableTelegramMedia({ type: "video" })).toBe(true);
    expect(isDownloadableTelegramMedia({ type: "document" })).toBe(true);
    expect(isDownloadableTelegramMedia({ type: "webpage" })).toBe(false);
    expect(isDownloadableTelegramMedia({ type: "poll" })).toBe(false);
  });

  it("maps video variants without treating webpage previews as external media", () => {
    expect(telegramMediaType({ type: "video", isAnimation: true } as never)).toBe("animation");
    expect(telegramMediaType({ type: "video", isRound: true } as never)).toBe("video_note");
    expect(telegramMediaType({ type: "webpage" } as never)).toBeUndefined();
  });

  it("extracts webpage preview urls", () => {
    expect(
      telegramWebpagePreviewUrl({
        type: "webpage",
        preview: {
          url: "https://example.com/video",
        },
      }),
    ).toBe("https://example.com/video");
  });
});
