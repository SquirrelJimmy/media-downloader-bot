import { describe, expect, it } from "vitest";
import {
  botCommandDefinitions,
  botClientConfigKey,
  botHelpText,
  botHelpReplyMarkup,
  buildDownloadStatusText,
  externalDownloadUrl,
  formatBotStatusText,
  isAllowedSenderId,
  messageExternalDownloadUrl,
  parseDownloadCommandArgs,
  parseForwardCommandArgs,
  resolveAllowedUserIdsForBot,
} from "@/engine/bot-client";
import { parseAppConfig } from "@/config/schema";

describe("bot command parsing", () => {
  it("detects external URLs without taking Telegram message links", () => {
    expect(externalDownloadUrl("https://www.youtube.com/watch?v=abc")).toBe("https://www.youtube.com/watch?v=abc");
    expect(externalDownloadUrl("https://t.me/c/1492447836/456")).toBeUndefined();
    expect(externalDownloadUrl("看这个 https://telegram.me/example/12")).toBeUndefined();
  });

  it("extracts external URLs from Telegram webpage previews", () => {
    expect(
      messageExternalDownloadUrl(
        {
          media: {
            type: "webpage",
            preview: {
              url: "https://www.youtube.com/watch?v=preview",
            },
          },
        } as never,
        "preview title",
      ),
    ).toBe("https://www.youtube.com/watch?v=preview");
  });

  it("parses /download range from a private chat message link", () => {
    expect(parseDownloadCommandArgs("/download https://t.me/c/1492447836/456 10 0 media_type == 'video'")).toMatchObject({
      mode: "range",
      chatRef: "-1001492447836",
      startMessageId: 10,
      endMessageId: 0,
      explicitFilter: "media_type == 'video'",
    });
  });

  it("parses /download single message from chat and message id", () => {
    expect(parseDownloadCommandArgs("/download -1001492447836 456 file_size > 10MB")).toMatchObject({
      mode: "single",
      ref: {
        chatId: "-1001492447836",
        messageId: 456,
      },
      explicitFilter: "file_size > 10MB",
    });
  });

  it("parses /download single message links with filter", () => {
    expect(parseDownloadCommandArgs("/download https://t.me/c/1492447836/456 sender_id == '42'")).toMatchObject({
      mode: "single",
      ref: {
        chatId: "-1001492447836",
        messageId: 456,
      },
      explicitFilter: "sender_id == '42'",
    });
  });

  it("keeps the first filter token when /forward omits limit", () => {
    expect(parseForwardCommandArgs("/forward source target media_type == 'video'")).toMatchObject({
      sourceChat: "source",
      targetChat: "target",
      usesRange: false,
      limit: undefined,
      explicitFilter: "media_type == 'video'",
    });
  });

  it("parses /forward limit and preserves the remaining filter", () => {
    expect(parseForwardCommandArgs("/forward source target 20 file_size > 10MB")).toMatchObject({
      sourceChat: "source",
      targetChat: "target",
      usesRange: false,
      limit: 20,
      explicitFilter: "file_size > 10MB",
    });
  });

  it("parses /forward start/end range and filter", () => {
    expect(parseForwardCommandArgs("/forward source target 10 15 sender_id == '42'")).toMatchObject({
      sourceChat: "source",
      targetChat: "target",
      startMessageId: 10,
      endMessageId: 15,
      usesRange: true,
      limit: undefined,
      explicitFilter: "sender_id == '42'",
    });
  });
});

describe("bot command menu", () => {
  it("keeps the visible command menu aligned with the legacy bot", () => {
    expect(botCommandDefinitions().map((command) => command.command)).toEqual([
      "help",
      "get_info",
      "download",
      "forward",
      "listen_forward",
      "add_filter",
      "set_language",
      "stop",
    ]);
  });

  it("keeps status and scan as hidden commands while showing legacy forward_to_comments help", () => {
    const text = botHelpText();
    expect(text).toContain("/forward_to_comments");
    expect(text).not.toContain("/scan");
    expect(text).not.toContain("/status");
  });

  it("does not attach legacy project links to help", () => {
    expect(botHelpReplyMarkup()).toBeUndefined();
  });
});

describe("bot status text", () => {
  it("shows an idle status when no task is active", () => {
    expect(formatBotStatusText({ tasks: [], displayIdFor: () => "1" })).toContain("当前没有运行中或排队任务");
  });

  it("lists active tasks with stop ids and counters", () => {
    expect(
      formatBotStatusText({
        displayIdFor: () => "7",
        tasks: [
          {
            id: 1,
            externalId: "task-1",
            chatId: "-1001",
            chatTitle: "Source",
            taskType: "forward",
            source: "bot",
            startTime: "2026-06-29T00:00:00.000Z",
            endTime: null,
            totalCount: 10,
            successCount: 3,
            failedCount: 1,
            skipCount: 2,
            stoppedCount: 0,
            totalBytes: 2048,
            status: "running",
            filter: "media_type == 'video'",
          },
        ],
      }),
    ).toContain("#7 转发 running\nchat=Source\nprogress=6/10 success=3 failed=1 skip=2 stopped=0");
  });
});

describe("bot permissions", () => {
  it("does not allow everyone when the resolved allowlist is empty", () => {
    expect(isAllowedSenderId(new Set(), "42")).toBe(false);
  });

  it("allows only resolved sender ids", () => {
    expect(isAllowedSenderId(new Set(["42"]), "42")).toBe(true);
    expect(isAllowedSenderId(new Set(["42"]), "43")).toBe(false);
    expect(isAllowedSenderId(new Set(["42"]), undefined)).toBe(false);
  });

  it("keeps numeric allowed users when the user session cannot be started", async () => {
    const result = await resolveAllowedUserIdsForBot(
      parseAppConfig({
        telegram: {
          allowed_user_ids: [42, "84"],
        },
      }),
      {
        ensureUserClient: async () => {
          throw new Error("session file may be corrupted");
        },
      },
    );

    expect(result.resolvedUserClient).toBe(false);
    expect(result.allowedUserIds).toEqual(new Set(["42", "84"]));
  });

  it("resolves username allowlist entries and the current user when the session is healthy", async () => {
    const result = await resolveAllowedUserIdsForBot(
      parseAppConfig({
        telegram: {
          allowed_user_ids: ["alice"],
        },
      }),
      {
        ensureUserClient: async () =>
          ({
            getPeer: async () => ({ id: 1001 }),
            getMe: async () => ({ id: 1002 }),
          }) as never,
      },
    );

    expect(result.resolvedUserClient).toBe(true);
    expect(result.allowedUserIds).toEqual(new Set(["1001", "1002"]));
  });
});

describe("bot lifecycle config key", () => {
  it("changes when bot token or session path changes", () => {
    const base = parseAppConfig({
      telegram: {
        api_id: 1,
        api_hash: "hash",
        bot_token: "token-a",
        sessions_dir: "storage/sessions-a",
      },
    });

    expect(botClientConfigKey(base)).not.toBe(
      botClientConfigKey(
        parseAppConfig({
          telegram: {
            api_id: 1,
            api_hash: "hash",
            bot_token: "token-b",
            sessions_dir: "storage/sessions-a",
          },
        }),
      ),
    );
    expect(botClientConfigKey(base)).not.toBe(
      botClientConfigKey(
        parseAppConfig({
          telegram: {
            api_id: 1,
            api_hash: "hash",
            bot_token: "token-a",
            sessions_dir: "storage/sessions-b",
          },
        }),
      ),
    );
  });
});

describe("bot download progress text", () => {
  it("keeps the completion summary while hiding the progress block", () => {
    const text = buildDownloadStatusText({
      taskId: 2,
      messageId: 412,
      sourceName: "External URL",
      fileName: "clip.mp4",
      downloaded: 2048,
      total: 2048,
      speed: 0,
      totalCount: 1,
      successCount: 1,
      failedCount: 0,
      skippedCount: 0,
      stoppedCount: 0,
      state: "success",
    });

    expect(text).toContain("├ ✅ 成功: 1");
    expect(text).toContain("📥 下载: 2.00 KB");
    expect(text).not.toContain("📥 下载进度:");
  });

  it("renders stopped downloads separately from skipped downloads", () => {
    const text = buildDownloadStatusText({
      taskId: 1,
      messageId: 42,
      sourceName: "Source",
      fileName: "clip.mp4",
      downloaded: 0,
      total: 100,
      speed: 0,
      totalCount: 1,
      successCount: 0,
      failedCount: 0,
      skippedCount: 0,
      stoppedCount: 1,
      state: "stopped",
      error: "stopped by command",
    });

    expect(text).toContain("└ ⏹️ 停止: 1");
    expect(text).toContain("错误: stopped by command");
    expect(text).not.toContain("└ ⏭️ 跳过: 1");
  });
});
