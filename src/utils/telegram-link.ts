export interface TelegramMessageRef {
  chatId: string;
  messageId: number;
  topicId?: number;
  commentId?: number;
}

export interface TelegramChatRef {
  chatId: string;
  messageId?: number;
  topicId?: number;
  commentId?: number;
}

export function parseTelegramChatRef(input: string): TelegramChatRef | null {
  const trimmed = input.trim();
  if (trimmed === "me" || trimmed === "self") {
    return { chatId: trimmed };
  }

  const direct = trimmed.match(/^(\S+)\s+(\d+)$/);
  if (direct) {
    return { chatId: direct[1], messageId: Number(direct[2]) };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.hostname !== "t.me" && url.hostname !== "telegram.me") {
    return null;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 1) {
    return null;
  }

  const commentValue = url.searchParams.get("comment");
  const commentId = commentValue ? Number(commentValue) : undefined;

  if (parts[0] === "c" && parts.length >= 2) {
    return {
      chatId: `-100${parts[1]}`,
      topicId: parts.length >= 4 ? Number(parts[2]) : undefined,
      messageId: parts.length >= 4 ? Number(parts[3]) : parts[2] ? Number(parts[2]) : undefined,
      commentId: Number.isFinite(commentId) ? commentId : undefined,
    };
  }

  return {
    chatId: parts[0],
    topicId: parts.length >= 3 ? Number(parts[1]) : undefined,
    messageId: parts.length >= 3 ? Number(parts[2]) : parts[1] ? Number(parts[1]) : undefined,
    commentId: Number.isFinite(commentId) ? commentId : undefined,
  };
}

export function parseTelegramMessageRef(input: string): TelegramMessageRef | null {
  const ref = parseTelegramChatRef(input);
  if (!ref?.messageId || !Number.isFinite(ref.messageId)) {
    return null;
  }
  return {
    chatId: ref.chatId,
    messageId: ref.messageId,
    topicId: ref.topicId,
    commentId: ref.commentId,
  };
}
