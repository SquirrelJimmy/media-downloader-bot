import { closeSync, existsSync, openSync, readSync } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { createClient } from "@libsql/client";
import { TelegramClient, type Message, type MessageMedia } from "@mtcute/node";
import type { AppConfig } from "@/config/schema";
import type { NormalizedMessage } from "@/types/download";
import { sanitizeFileName } from "@/utils/format";
import { telegramMediaType } from "@/utils/telegram-media";

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

let userClientFactory: (config: AppConfig) => TelegramUserClient = createUserClient;
let telegramSessionTableReader: (sessionPath: string) => Promise<string[]> = async (sessionPath) => {
  const db = createClient({ url: `file:${sessionPath}` });
  try {
    const result = await db.execute("select name from sqlite_master where type = 'table' order by name");
    return result.rows.map((row) => String(row.name));
  } finally {
    db.close();
  }
};
let userClient: TelegramUserClient | null = null;
let userClientStartPromise: Promise<TelegramUserClient> | null = null;
let userClientStarted = false;

function runtimePath(path: string) {
  return isAbsolute(path) ? path : join(/*turbopackIgnore: true*/ process.cwd(), path);
}

export function getUserSessionPath(config: AppConfig) {
  return join(getUserSessionsDir(config), config.telegram.user_session);
}

function getUserSessionsDir(config: AppConfig) {
  return runtimePath(config.telegram.sessions_dir);
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

function isSqliteSessionReadError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as Record<string, unknown>;
  const code = String(record.code ?? "");
  const message = String(record.message ?? "");
  return (
    code.startsWith("SQLITE_IOERR") ||
    code === "SQLITE_CORRUPT" ||
    message.includes("SQLITE_IOERR") ||
    message.includes("disk I/O error") ||
    message.includes("database disk image is malformed") ||
    message.includes("short read")
  );
}

function sessionRepairMessage(detail: string) {
  return `${detail}; session file may be corrupted or unreadable. Back up/delete the session file and log in again from the console.`;
}

function sessionErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const code = record.code ? `${record.code}: ` : "";
    const message = record.message ? String(record.message) : String(error);
    return `${code}${message}`;
  }
  return String(error);
}

async function resetFailedUserClient(client?: TelegramUserClient | null) {
  const current = client ?? userClient;
  try {
    if (current) {
      await current.destroy().catch(() => undefined);
    }
  } finally {
    if (!client || userClient === client) {
      userClient = null;
    }
    userClientStarted = false;
  }
}

export async function ensureStartedUserClient(config: AppConfig): Promise<TelegramUserClient> {
  if (userClient && userClientStarted) {
    return userClient;
  }

  if (userClientStartPromise) {
    return userClientStartPromise;
  }

  userClientStartPromise = (async () => {
    await mkdir(getUserSessionsDir(config), { recursive: true });
    await assertUserSessionHealthy(config);
    const client = userClient ?? userClientFactory(config);
    userClient = client;
    try {
      await client.start({});
      userClientStarted = true;
      return client;
    } catch (error) {
      await resetFailedUserClient(client);
      if (isSqliteSessionReadError(error)) {
        throw new Error(sessionRepairMessage(sessionErrorMessage(error)));
      }
      throw error;
    }
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
      `Telegram user session not found at ${getUserSessionPath(config)}. Create or mount a valid session file first.`,
    );
  }
}

export async function assertUserSessionHealthy(config: AppConfig) {
  await assertUserSessionExists(config);
  const status = await inspectTelegramSession(config);
  const sessionPath = getUserSessionPath(config);
  if (!status.sqlite) {
    throw new Error(`Telegram user session at ${sessionPath} is not a valid SQLite database. Log in again from the console.`);
  }
  if (status.warning && isSessionRepairWarning(status.warning)) {
    throw new Error(`Telegram user session at ${sessionPath}: ${status.warning}`);
  }
  if (status.pyrogramStorage) {
    throw new Error(`Telegram user session at ${sessionPath} is a Pyrogram session. Log in again from the console to create an mtcute session.`);
  }
  if (!status.mtcuteStorage) {
    throw new Error(`Telegram user session at ${sessionPath} is not an mtcute session. Log in again from the console.`);
  }
}

export async function startInteractiveUserClient(config: AppConfig): Promise<TelegramUserClient> {
  await mkdir(getUserSessionsDir(config), { recursive: true });
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

export async function inspectTelegramSession(config: AppConfig): Promise<TelegramSessionStatus> {
  const sessionPath = getUserSessionPath(config);
  if (!existsSync(sessionPath)) {
    return {
      exists: false,
      sqlite: false,
      mtcuteStorage: false,
      pyrogramStorage: false,
      tables: [],
      warning: "session file is missing; create or mount a valid session file first",
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
    const tables = await telegramSessionTableReader(sessionPath);
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
          ? "session looks like a Pyrogram session; mtcute cannot reuse it directly"
          : "session is SQLite but does not look like mtcute storage",
    };
  } catch (error) {
    const detail = sessionErrorMessage(error);
    return {
      exists: true,
      sqlite: true,
      mtcuteStorage: false,
      pyrogramStorage: false,
      tables: [],
      warning: isSqliteSessionReadError(error) ? sessionRepairMessage(detail) : detail,
    };
  }
}

function isSessionRepairWarning(warning: string) {
  return warning.includes("session file may be corrupted") || warning.includes("SQLITE_IOERR") || warning.includes("SQLITE_CORRUPT");
}

export async function getUserClientStatus(config: AppConfig): Promise<TelegramClientStatus> {
  return {
    configured: Boolean(config.telegram.api_id && config.telegram.api_hash),
    started: userClientStarted,
    sessionPath: getUserSessionPath(config),
    sessionName: config.telegram.user_session,
    session: await inspectTelegramSession(config),
  };
}

export async function destroyUserClient() {
  const current = userClient;
  userClient = null;
  userClientStartPromise = null;
  userClientStarted = false;
  if (!current) {
    userClientStarted = false;
    return;
  }
  await current.destroy();
}

export function __setUserClientFactoryForTest(factory: ((config: AppConfig) => TelegramUserClient) | null) {
  userClientFactory = factory ?? createUserClient;
}

export async function __resetUserClientForTest() {
  await resetFailedUserClient();
  userClientStartPromise = null;
}

export function __setTelegramSessionTableReaderForTest(
  reader: ((sessionPath: string) => Promise<string[]>) | null,
) {
  telegramSessionTableReader = reader ?? (async (sessionPath) => {
    const db = createClient({ url: `file:${sessionPath}` });
    try {
      const result = await db.execute("select name from sqlite_master where type = 'table' order by name");
      return result.rows.map((row) => String(row.name));
    } finally {
      db.close();
    }
  });
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

function mediaFileName(message: Message, media: MessageMedia, mediaType?: NormalizedMessage["mediaType"]): string | undefined {
  if (!media || !mediaType) {
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
  const mediaType = telegramMediaType(media);
  const chatId = peerId(message.chat) ?? "unknown";
  const senderId = peerId(message.sender);
  const fileName = mediaFileName(message, media, mediaType);
  const hasDownloadableMedia = Boolean(mediaType);

  return {
    id: message.id,
    chatId,
    chatTitle: peerTitle(message.chat) ?? chatId,
    date: message.date.toISOString(),
    text: hasDownloadableMedia ? undefined : message.text,
    caption: hasDownloadableMedia ? message.text : undefined,
    media: hasDownloadableMedia ? media : undefined,
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
