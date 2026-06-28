import { closeSync, existsSync, openSync, readSync } from "node:fs";
import { createRequire } from "node:module";
import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { TelegramClient, type Message, type MessageMedia } from "@mtcute/node";
import type { AppConfig } from "@/config/schema";
import type { MediaType, NormalizedMessage } from "@/types/download";
import { sanitizeFileName } from "@/utils/format";

export type TelegramUserClient = TelegramClient;

export interface TelegramClientStatus {
  configured: boolean;
  started: boolean;
  sessionPath: string;
  sessionName: string;
  session: TelegramSessionStatus;
}

export interface TelegramSessionStatus {
  exists: boolean;
  sqlite: boolean;
  mtcuteStorage: boolean;
  pyrogramStorage: boolean;
  tables: string[];
  warning?: string;
}

let userClient: TelegramUserClient | null = null;
let userClientStartPromise: Promise<TelegramUserClient> | null = null;
let userClientStarted = false;

const require = createRequire(import.meta.url);

export function getUserSessionPath(config: AppConfig) {
  return join(config.telegram.sessions_dir, config.telegram.user_session);
}

export function createUserClient(config: AppConfig): TelegramUserClient {
  if (!config.telegram.api_id || !config.telegram.api_hash) {
    throw new Error("telegram.api_id and telegram.api_hash are required");
  }

  return new TelegramClient({
    apiId: config.telegram.api_id,
    apiHash: config.telegram.api_hash,
    storage: getUserSessionPath(config),
  });
}

export async function ensureStartedUserClient(config: AppConfig): Promise<TelegramUserClient> {
  if (userClient && userClientStarted) {
    return userClient;
  }

  if (userClientStartPromise) {
    return userClientStartPromise;
  }

  userClientStartPromise = (async () => {
    await mkdir(config.telegram.sessions_dir, { recursive: true });
    await assertUserSessionExists(config);
    const client = userClient ?? createUserClient(config);
    userClient = client;
    await client.start({});
    userClientStarted = true;
    return client;
  })();

  try {
    return await userClientStartPromise;
  } finally {
    userClientStartPromise = null;
  }
}

export async function assertUserSessionExists(config: AppConfig) {
  try {
    await access(getUserSessionPath(config));
  } catch {
    throw new Error(
      `Telegram user session not found at ${getUserSessionPath(config)}. Run "npm run telegram:login" first.`,
    );
  }
}

export async function startInteractiveUserClient(config: AppConfig): Promise<TelegramUserClient> {
  await mkdir(config.telegram.sessions_dir, { recursive: true });
  const client = createUserClient(config);
  const self = await client.start({
    phone: config.telegram.phone || (() => client.input("Phone > ")),
    code: () => client.input("Code > "),
    password: () => client.input("Password > "),
  });
  console.log(`Logged in as ${self.displayName}`);
  await client.destroy();
  return client;
}

function sqliteHeader(path: string) {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(16);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    return bytesRead === buffer.length && buffer.toString("utf8") === "SQLite format 3\0";
  } finally {
    closeSync(fd);
  }
}

export function inspectTelegramSession(config: AppConfig): TelegramSessionStatus {
  const sessionPath = getUserSessionPath(config);
  if (!existsSync(sessionPath)) {
    return {
      exists: false,
      sqlite: false,
      mtcuteStorage: false,
      pyrogramStorage: false,
      tables: [],
      warning: "session file is missing; run npm run telegram:login",
    };
  }

  if (!sqliteHeader(sessionPath)) {
    return {
      exists: true,
      sqlite: false,
      mtcuteStorage: false,
      pyrogramStorage: false,
      tables: [],
      warning: "session file is not a SQLite database",
    };
  }

  try {
    const Database = require("better-sqlite3") as new (
      path: string,
      options?: { readonly?: boolean; fileMustExist?: boolean },
    ) => {
      prepare(sql: string): { all(): Array<{ name: string }> };
      close(): void;
    };
    const db = new Database(sessionPath, { readonly: true, fileMustExist: true });
    try {
      const tables = db
        .prepare("select name from sqlite_master where type = 'table' order by name")
        .all()
        .map((row) => row.name);
      const tableSet = new Set(tables);
      const mtcuteStorage =
        tableSet.has("mtcute_migrations") && tableSet.has("auth_keys") && tableSet.has("key_value");
      const pyrogramStorage =
        tableSet.has("sessions") &&
        tableSet.has("peers") &&
        !mtcuteStorage;
      return {
        exists: true,
        sqlite: true,
        mtcuteStorage,
        pyrogramStorage,
        tables,
        warning: mtcuteStorage
          ? undefined
          : pyrogramStorage
            ? "session looks like a Pyrogram session; mtcute cannot reuse it directly, run npm run telegram:login"
            : "session is SQLite but does not look like mtcute storage; run npm run telegram:login if startup fails",
      };
    } finally {
      db.close();
    }
  } catch (error) {
    return {
      exists: true,
      sqlite: true,
      mtcuteStorage: false,
      pyrogramStorage: false,
      tables: [],
      warning: error instanceof Error ? error.message : String(error),
    };
  }
}

export function getUserClientStatus(config: AppConfig): TelegramClientStatus {
  return {
    configured: Boolean(config.telegram.api_id && config.telegram.api_hash),
    started: userClientStarted,
    sessionPath: getUserSessionPath(config),
    sessionName: config.telegram.user_session,
    session: inspectTelegramSession(config),
  };
}

export async function destroyUserClient() {
  if (!userClient) {
    return;
  }
  await userClient.destroy();
  userClient = null;
  userClientStarted = false;
}

function peerId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const id = record.id ?? record.userId ?? record.chatId;
  return id === undefined ? undefined : String(id);
}

function peerTitle(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const title = record.displayName ?? record.title ?? record.username ?? record.firstName ?? record.lastName;
  return typeof title === "string" && title.length > 0 ? title : undefined;
}

function maybeDate(value: unknown) {
  return value instanceof Date ? value.toISOString() : undefined;
}

function mediaTypeFromMtcute(media: MessageMedia): MediaType | undefined {
  if (!media) {
    return undefined;
  }
  if (media.type === "video") {
    return media.isAnimation ? "animation" : media.isRound ? "video_note" : "video";
  }
  if (
    media.type === "audio" ||
    media.type === "document" ||
    media.type === "photo" ||
    media.type === "voice"
  ) {
    return media.type;
  }
  return "external";
}

function mediaFileName(message: Message, media: MessageMedia, mediaType?: MediaType): string | undefined {
  if (!media) {
    return undefined;
  }
  if ("fileName" in media && typeof media.fileName === "string" && media.fileName) {
    return media.fileName;
  }
  if ("uniqueFileId" in media && typeof media.uniqueFileId === "string") {
    const extension = mediaType === "photo" ? ".jpg" : "";
    return `${media.uniqueFileId}${extension}`;
  }
  return `${message.id}${mediaType ? `.${mediaType}` : ""}`;
}

function forwardOrigin(message: Message): NormalizedMessage["forwardOrigin"] {
  const forward = message.forward;
  if (!forward) {
    return undefined;
  }

  let sender: unknown;
  let fromChat: unknown;
  try {
    sender = forward.sender;
  } catch {
    sender = undefined;
  }
  try {
    fromChat = forward.fromChat();
  } catch {
    fromChat = undefined;
  }

  const forwardRecord = forward as unknown as Record<string, unknown>;
  const messageId =
    typeof forward.fromMessageId === "number"
      ? forward.fromMessageId
      : typeof forwardRecord.savedFromMessageId === "number"
        ? forwardRecord.savedFromMessageId
        : undefined;
  const date = maybeDate(forward.date) ?? maybeDate(forwardRecord.savedFromDate);

  return {
    senderId: peerId(sender),
    senderName: peerTitle(sender),
    chatId: peerId(fromChat) ?? peerId(sender),
    chatTitle: peerTitle(fromChat) ?? peerTitle(sender) ?? (typeof forward.signature === "string" ? forward.signature : undefined),
    messageId,
    date,
  };
}

export function normalizeMtcuteMessage(message: Message, options: { mediaGroupExpectedCount?: number } = {}): NormalizedMessage {
  const media = message.media;
  const mediaType = mediaTypeFromMtcute(media);
  const chatId = peerId(message.chat) ?? "unknown";
  const senderId = peerId(message.sender);
  const fileName = mediaFileName(message, media, mediaType);

  return {
    id: message.id,
    chatId,
    chatTitle: peerTitle(message.chat) ?? chatId,
    date: message.date.toISOString(),
    text: media ? undefined : message.text,
    caption: media ? message.text : undefined,
    media,
    mediaType,
    mediaGroupId: message.groupedIdUnique ?? undefined,
    mediaGroupExpectedCount: options.mediaGroupExpectedCount,
    fileName,
    fileSize: media && "fileSize" in media ? media.fileSize : undefined,
    mimeType: media && "mimeType" in media ? media.mimeType : undefined,
    senderId,
    senderName: peerTitle(message.sender),
    forwardOrigin: forwardOrigin(message),
    replyToMessageId: message.replyToMessage?.id ?? undefined,
    source: {
      kind: "mtcute",
      chatId,
      messageId: message.id,
    },
  };
}

async function mediaGroupExpectedCount(client: TelegramUserClient, message: Message) {
  if (!message.groupedIdUnique) {
    return undefined;
  }

  try {
    const group = await client.getMessageGroup({ message });
    return group.length > 0 ? group.length : undefined;
  } catch {
    return undefined;
  }
}

export async function getTelegramMessage(
  config: AppConfig,
  chatId: string | number,
  messageId: number,
) {
  const client = await ensureStartedUserClient(config);
  const [message] = await client.getMessages(chatId, messageId);
  return message
    ? normalizeMtcuteMessage(message, {
        mediaGroupExpectedCount: await mediaGroupExpectedCount(client, message),
      })
    : null;
}

export async function* iterTelegramHistory(
  config: AppConfig,
  chatId: string | number,
  params?: {
    limit?: number;
    offsetId?: number;
    minId?: number;
    maxId?: number;
    reverse?: boolean;
  },
) {
  const client = await ensureStartedUserClient(config);
  for await (const message of client.iterHistory(chatId, {
    limit: params?.limit,
    offset: params?.offsetId ? { id: params.offsetId, date: 0 } : undefined,
    minId: params?.minId,
    maxId: params?.maxId,
    reverse: params?.reverse,
  })) {
    yield normalizeMtcuteMessage(message, {
      mediaGroupExpectedCount: await mediaGroupExpectedCount(client, message),
    });
  }
}

export function getTelegramSavePath(config: AppConfig, message: NormalizedMessage) {
  const chatTitle = sanitizeFileName(message.chatTitle ?? message.chatId);
  const mediaType = message.mediaType ?? "document";
  const mediaDate = message.date?.slice(0, 7).replace("-", "_") ?? "unknown_date";
  return join(config.storage.save_path, chatTitle, mediaDate, mediaType);
}
