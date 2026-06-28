import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { BotKeyboard, TelegramClient, type CallbackQuery, type Message } from "@mtcute/node";
import type { AppConfig } from "@/config/schema";
import type { ChatDownloadConfig } from "@/config/schema";
import { loadAppConfig, saveAppConfig } from "@/config/load";
import { listActiveTasks } from "@/db/queries";
import { runConfiguredDownloads } from "@/engine/config-driven-download";
import { createListenForwardRule, disableListenForwardRules } from "@/engine/listen-forward";
import { processJob } from "@/engine/worker";
import {
  createDownloadJob,
  createTaskNode,
  enqueueMessageDownload,
  markTaskNodeFinished,
  persistTaskNode,
  stopTaskTransmission,
} from "@/engine/task-service";
import { ensureStartedUserClient, getTelegramMessage, iterTelegramHistory, normalizeMtcuteMessage } from "@/engine/user-client";
import { filterEngine } from "@/filter/dsl";
import { parseTelegramChatRef, parseTelegramMessageRef, type TelegramChatRef } from "@/utils/telegram-link";
import { logger } from "@/utils/logger";
import { createProgressBar, formatByte } from "@/utils/format";
import { effectiveMessageSourceTitle } from "@/utils/telegram-storage";
import { extractUrls, getHostname } from "@/utils/url";
import type { NormalizedMessage, TaskType } from "@/types/download";

export interface BotClientStatus {
  configured: boolean;
  started: boolean;
  allowedUserCount: number;
  sessionPath: string;
  commandsRegistered: boolean;
  startupNoticeSent: boolean;
}

type BotClient = TelegramClient;
type PeerRef = string | number;
type BotTextTarget = Parameters<BotClient["sendText"]>[0];
type BotInputText = Parameters<BotClient["sendText"]>[1];
type BotSendTextParams = Parameters<BotClient["sendText"]>[2];

interface BotClientState {
  client: BotClient | null;
  started: boolean;
  startPromise: Promise<BotClient> | null;
  handlerAttached: boolean;
  updatesStarted: boolean;
  commandsRegistered: boolean;
  startupNoticeSent: boolean;
  nextTaskId: number;
  displayTaskMap: Record<string, string>;
  downloadFilters: string[];
  allowedUserIds: Set<string>;
  allowedUsersConfigKey?: string;
  clientConfigKey?: string;
}

const globalBotState = globalThis as typeof globalThis & {
  __telegramDownloadBotClient?: BotClientState;
};

const botState =
  globalBotState.__telegramDownloadBotClient ??
  (globalBotState.__telegramDownloadBotClient = {
    client: null,
    started: false,
    startPromise: null,
    handlerAttached: false,
    updatesStarted: false,
    commandsRegistered: false,
    startupNoticeSent: false,
    nextTaskId: 0,
    displayTaskMap: {},
    downloadFilters: [],
    allowedUserIds: new Set(),
  });

botState.displayTaskMap ??= {};
botState.downloadFilters ??= [];
botState.allowedUserIds ??= new Set();

function botSessionPath(config: AppConfig) {
  return join(config.telegram.sessions_dir, "media_downloader_bot.session");
}

export function botClientConfigKey(config: AppConfig) {
  return JSON.stringify({
    apiId: config.telegram.api_id,
    apiHash: config.telegram.api_hash,
    botToken: config.telegram.bot_token,
    sessionPath: botSessionPath(config),
  });
}

function isBotClientCurrent(config: AppConfig) {
  return botState.started && botState.clientConfigKey === botClientConfigKey(config);
}

function resetBotRuntimeState() {
  botState.client = null;
  botState.started = false;
  botState.handlerAttached = false;
  botState.updatesStarted = false;
  botState.commandsRegistered = false;
  botState.startupNoticeSent = false;
  botState.allowedUserIds = new Set();
  botState.allowedUsersConfigKey = undefined;
  botState.clientConfigKey = undefined;
}

async function resetBotClientForConfigChange(config: AppConfig) {
  const nextKey = botClientConfigKey(config);
  if (!botState.clientConfigKey || botState.clientConfigKey === nextKey) {
    return;
  }

  const previousClient = botState.client;
  resetBotRuntimeState();
  if (previousClient) {
    try {
      await previousClient.destroy();
    } catch (error) {
      logger.warn({ error }, "failed to destroy previous bot client after config change");
    }
  }
}

export function isBotClientReadyForConfig(config: AppConfig) {
  return isBotClientCurrent(config);
}

export async function stopBotClient() {
  const previousClient = botState.client;
  resetBotRuntimeState();
  if (previousClient) {
    await previousClient.destroy().catch((error) => {
      logger.warn({ error }, "failed to destroy bot client");
    });
  }
}

function senderId(message: Message) {
  const sender = message.sender as unknown as Record<string, unknown> | undefined;
  const id = sender?.id ?? sender?.userId;
  return id === undefined ? undefined : String(id);
}

function toPeerRef(value: unknown): PeerRef | undefined {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value !== "string") {
    return undefined;
  }
  if (/^-?\d+$/.test(value)) {
    const numeric = Number(value);
    if (Number.isSafeInteger(numeric)) {
      return numeric;
    }
  }
  return value;
}

function chatId(message: Message) {
  const chat = message.chat as unknown as Record<string, unknown> | undefined;
  const id = chat?.id ?? chat?.chatId;
  return toPeerRef(id);
}

function messageTarget(message: Message): BotTextTarget | undefined {
  const chat = message.chat as unknown as { inputPeer?: unknown };
  if (chat?.inputPeer) {
    return chat as BotTextTarget;
  }
  return chatId(message);
}

function textOf(message: Message) {
  return message.text?.trim() ?? "";
}

function chatType(message: Message) {
  const chat = message.chat as unknown as Record<string, unknown> | undefined;
  return typeof chat?.type === "string" ? chat.type : undefined;
}

function isPrivateChat(message: Message) {
  const type = chatType(message);
  return type === "user" || type === "bot";
}

function isTelegramUrl(url: string) {
  const host = getHostname(url);
  return host === "t.me" || host.endsWith(".t.me") || host === "telegram.me" || host.endsWith(".telegram.me");
}

export function externalDownloadUrl(text: string) {
  return extractUrls(text).find((url) => !isTelegramUrl(url));
}

export function isAllowedSenderId(allowedUserIds: ReadonlySet<string>, sender: string | undefined) {
  return Boolean(sender && allowedUserIds.has(sender));
}

function allowedUsersConfigKey(config: AppConfig) {
  return JSON.stringify(config.telegram.allowed_user_ids);
}

function staticAllowedUserId(value: string | number) {
  return /^-?\d+$/.test(String(value)) ? String(value) : undefined;
}

function peerIdFromResolvedPeer(peer: unknown) {
  if (!peer || typeof peer !== "object") {
    return undefined;
  }
  const record = peer as Record<string, unknown>;
  const id = record.id ?? record.userId ?? record.chatId;
  return id === undefined ? undefined : String(id);
}

async function ensureAllowedUserIds(config: AppConfig) {
  const key = allowedUsersConfigKey(config);
  if (botState.allowedUsersConfigKey === key) {
    return botState.allowedUserIds;
  }

  const allowedUserIds = new Set<string>();
  for (const configured of config.telegram.allowed_user_ids) {
    const staticId = staticAllowedUserId(configured);
    if (staticId) {
      allowedUserIds.add(staticId);
    }
  }

  let resolvedUserClient = false;
  try {
    const userClient = await ensureStartedUserClient(config);
    resolvedUserClient = true;
    for (const configured of config.telegram.allowed_user_ids) {
      if (staticAllowedUserId(configured)) {
        continue;
      }
      try {
        const peer = await userClient.getPeer(String(configured));
        const id = peerIdFromResolvedPeer(peer);
        if (id) {
          allowedUserIds.add(id);
        }
      } catch (error) {
        logger.warn({ error, configured }, "failed to resolve bot allowed user");
      }
    }

    const me = await userClient.getMe();
    allowedUserIds.add(String(me.id));
  } catch (error) {
    logger.warn({ error }, "failed to resolve bot admin user");
  }

  botState.allowedUserIds = allowedUserIds;
  botState.allowedUsersConfigKey = resolvedUserClient ? key : undefined;
  return allowedUserIds;
}

async function isAllowed(config: AppConfig, message: Message) {
  const allowed = await ensureAllowedUserIds(config);
  return isAllowedSenderId(allowed, senderId(message));
}

function commandParts(text: string) {
  return text.split(/\s+/).filter(Boolean);
}

function commandArgText(text: string) {
  return text.trim().split(/\s+/, 1)[0]
    ? text.trim().slice(text.trim().split(/\s+/, 1)[0].length).trim()
    : "";
}

export function botHelpText() {
  return [
    "🤖 文件中转下载器",
    "",
    "可用命令:",
    "/help - 显示可用命令",
    "/get_info - 获取当前会话和用户信息",
    "/download - 下载单条消息或指定范围",
    "/forward - 批量下载并转发",
    "/listen_forward - 监听源会话并转发",
    "/forward_to_comments - 转发到目标消息评论区",
    "/set_language - 设置语言",
    "/stop - 停止下载、转发或监听转发",
    "",
    "说明: 1 表示整个会话开头，0 表示直到整个会话末尾。",
    "[ ] 表示可选参数。",
    "",
    "用法:",
    "/download <t.me消息链接> [filter]",
    "/download <chatId> <messageId> [filter]",
    "/download <chat链接> <startId> <endId> [filter]",
    "/forward <sourceChat> <targetChat> [limit] [filter]",
    "/forward_to_comments <sourceChat> <targetMessageLink> <startId> <endId> [filter]",
    "/listen_forward <sourceChat> <targetChat> [filter]",
    "/add_filter <filter>",
    "/set_language en|zh|ru|ua",
    "/stop all 或 /stop <task_id>",
    "",
    "直接转发图片、视频、文件、音频给机器人会自动下载。",
    "直接发送 t.me 消息链接会下载对应消息。",
  ].join("\n");
}

function helpText() {
  return botHelpText();
}

export function botHelpReplyMarkup() {
  return undefined;
}

async function reply(client: BotClient, message: Message, text: string, params?: BotSendTextParams) {
  const target = messageTarget(message);
  if (!target) {
    return null;
  }
  try {
    return await client.sendText(target, text, params);
  } catch (error) {
    logger.error({ error, target }, "bot reply failed");
    return null;
  }
}

function shortText(value: string | undefined, maxLength: number) {
  if (!value) {
    return "";
  }
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function nextBotTaskId() {
  botState.nextTaskId += 1;
  return botState.nextTaskId;
}

function bindDisplayTaskId(displayTaskId: number, taskExternalId: string) {
  botState.displayTaskMap[String(displayTaskId)] = taskExternalId;
}

function displayTaskIdFor(taskExternalId: string) {
  const existing = Object.entries(botState.displayTaskMap).find(([, externalId]) => externalId === taskExternalId)?.[0];
  if (existing) {
    return existing;
  }
  const displayTaskId = nextBotTaskId();
  bindDisplayTaskId(displayTaskId, taskExternalId);
  return String(displayTaskId);
}

function resolveTaskExternalId(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  return botState.displayTaskMap[value] ?? value;
}

function hasDownloadableMedia(message: Message) {
  return Boolean(message.media);
}

function currentDownloadFilter(config: AppConfig) {
  return (botState.downloadFilters.length > 0 ? botState.downloadFilters : config.bot.download_filter)
    .filter(Boolean)
    .join(" and ");
}

function currentBotDownloadFilters(config: AppConfig) {
  return botState.downloadFilters.length > 0 ? botState.downloadFilters : config.bot.download_filter;
}

function effectiveDownloadFilter(config: AppConfig, explicitFilter?: string) {
  return explicitFilter?.trim() || currentDownloadFilter(config) || undefined;
}

async function validateAndReplyFilter(client: BotClient, message: Message, filter: string | undefined) {
  if (!filter) {
    return true;
  }
  const checked = filterEngine.check(filter);
  if (!checked.ok) {
    await reply(client, message, `过滤器错误: ${checked.error}`);
    return false;
  }
  return true;
}

function languageValue(value: string | undefined): AppConfig["app"]["language"] | null {
  const normalized = value?.trim().toUpperCase();
  if (normalized === "EN" || normalized === "ZH" || normalized === "RU" || normalized === "UA") {
    return normalized;
  }
  return null;
}

function parsePositiveId(value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function parseForwardCommandArgs(text: string) {
  const [, sourceChat, targetChat, firstValue, secondValue, ...rest] = commandParts(text);
  const startMessageId = parsePositiveId(firstValue);
  const endMessageId = parsePositiveId(secondValue);
  const usesRange = startMessageId !== undefined && endMessageId !== undefined;
  const limit = !usesRange ? parsePositiveId(firstValue) : undefined;
  const explicitFilter = usesRange
    ? rest.join(" ")
    : limit !== undefined
      ? [secondValue, ...rest].filter(Boolean).join(" ")
      : [firstValue, secondValue, ...rest].filter(Boolean).join(" ");

  return {
    sourceChat,
    targetChat,
    startMessageId,
    endMessageId,
    usesRange,
    limit,
    explicitFilter,
  };
}

export function parseDownloadCommandArgs(text: string) {
  const [, first, second, third, ...rest] = commandParts(text);
  const startMessageId = parsePositiveId(second);
  const endMessageId = parsePositiveId(third);
  if (first && startMessageId !== undefined && endMessageId !== undefined) {
    const chatRef = parseTelegramChatRef(first);
    return {
      mode: "range" as const,
      chatRef: chatRef?.chatId ?? first,
      startMessageId,
      endMessageId,
      explicitFilter: rest.join(" "),
    };
  }

  const ref = first?.startsWith("http")
    ? parseTelegramMessageRef(first)
    : first && second
      ? parseTelegramMessageRef(`${first} ${second}`)
      : null;
  return {
    mode: "single" as const,
    ref,
    explicitFilter: first?.startsWith("http")
      ? [second, third, ...rest].filter(Boolean).join(" ")
      : [third, ...rest].filter(Boolean).join(" "),
  };
}

function toChatRef(input: string): TelegramChatRef {
  return parseTelegramChatRef(input) ?? { chatId: input };
}

function taskTypeLabel(type: TaskType) {
  if (type === "download") {
    return "下载";
  }
  if (type === "forward") {
    return "转发";
  }
  return "监听转发";
}

function stopCallbackForType(type: TaskType) {
  if (type === "download") {
    return "stop:type:download";
  }
  if (type === "forward") {
    return "stop:type:forward";
  }
  return "stop:type:listen_forward";
}

function taskButtonLabel(input: {
  displayId?: string;
  externalId: string;
  chatTitle?: string | null;
  chatId: string;
}) {
  const prefix = input.displayId ?? input.externalId.slice(0, 8);
  return `${prefix} ${shortText(input.chatTitle ?? input.chatId, 18)}`;
}

function stopResultText(result: {
  stoppedTasks: number | bigint;
  stoppedQueueItems: number | bigint;
  abortedTransmissions?: number | bigint;
  disabledListenRules?: number | bigint;
}) {
  const base = `tasks=${result.stoppedTasks}, queue=${result.stoppedQueueItems}, aborted=${result.abortedTransmissions ?? 0}`;
  return result.disabledListenRules === undefined
    ? base
    : `${base}, listen_rules=${result.disabledListenRules}`;
}

type BotStatusTask = Awaited<ReturnType<typeof listActiveTasks>>[number];

export function formatBotStatusText(input: {
  tasks: BotStatusTask[];
  displayIdFor: (taskExternalId: string) => string;
}) {
  if (input.tasks.length === 0) {
    return "Bot 已运行。\n当前没有运行中或排队任务。";
  }

  return [
    "Bot 已运行。",
    `Active tasks: ${input.tasks.length}`,
    "",
    ...input.tasks.map((task) => {
      const displayId = input.displayIdFor(task.externalId);
      const done = task.successCount + task.failedCount + task.skipCount + task.stoppedCount;
      const total = task.totalCount || 0;
      const chat = shortText(task.chatTitle ?? task.chatId, 28);
      const filter = task.filter ? ` filter=${shortText(task.filter, 40)}` : "";
      return [
        `#${displayId} ${taskTypeLabel(task.taskType)} ${task.status}`,
        `chat=${chat}`,
        `progress=${done}/${total} success=${task.successCount} failed=${task.failedCount} skip=${task.skipCount} stopped=${task.stoppedCount}`,
        `bytes=${formatByte(task.totalBytes ?? 0)}${filter}`,
        `stop=/stop ${displayId}`,
      ].join("\n");
    }),
  ].join("\n");
}

async function handleStatusCommand(client: BotClient, message: Message) {
  const tasks = await listActiveTasks(20);
  await reply(
    client,
    message,
    formatBotStatusText({
      tasks,
      displayIdFor: displayTaskIdFor,
    }),
  );
}

async function stopTaskAndReport(client: BotClient, target: BotTextTarget, taskExternalId: string | undefined, label: string) {
  const result = await stopTaskTransmission(taskExternalId);
  await client.sendText(
    target,
    taskExternalId
      ? `已停止任务 ${label}: ${stopResultText(result)}`
      : `已停止全部任务: ${stopResultText(result)}`,
  );
}

async function stopTasksByType(taskType: TaskType) {
  const activeTasks = (await listActiveTasks(200)).filter((task) => task.taskType === taskType);
  let stoppedTasks = 0;
  let stoppedQueueItems = 0;
  let abortedTransmissions = 0;
  let disabledListenRules = 0;

  for (const task of activeTasks) {
    const result = await stopTaskTransmission(task.externalId);
    stoppedTasks += Number(result.stoppedTasks);
    stoppedQueueItems += Number(result.stoppedQueueItems);
    abortedTransmissions += Number(result.abortedTransmissions);
    disabledListenRules += Number(result.disabledListenRules ?? 0);
  }

  if (taskType === "listen_forward") {
    disabledListenRules += Number(await disableListenForwardRules());
    return {
      stoppedTasks,
      stoppedQueueItems,
      abortedTransmissions,
      disabledListenRules,
    };
  }

  return { stoppedTasks, stoppedQueueItems, abortedTransmissions };
}

interface BotDownloadStatus {
  taskId: number;
  messageId: number;
  sourceName: string;
  fileName: string;
  downloaded: number;
  total: number;
  speed: number;
  totalCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  stoppedCount: number;
  state: "queued" | "downloading" | "success" | "failed" | "skip" | "stopped";
  error?: string;
}

export function buildDownloadStatusText(status: BotDownloadStatus) {
  const hasTotal = status.total > 0;
  const percent = hasTotal ? `${Math.floor((status.downloaded / status.total) * 100)}%` : "--";
  const progress = hasTotal ? `${createProgressBar(status.downloaded, status.total, 12)} (${percent})` : "------------ (--)";
  const showProgress = status.state === "queued" || status.state === "downloading";
  const stateLabel =
    status.state === "success"
      ? "完成"
      : status.state === "failed"
        ? "失败"
        : status.state === "skip"
          ? "跳过"
          : status.state === "stopped"
            ? "已停止"
          : status.state === "queued"
            ? "等待"
            : "下载中";

  const lines = [
    `ID task id: ${status.taskId}`,
    `📥 下载: ${formatByte(status.downloaded)}`,
    `├ 📁 总数: ${status.totalCount}`,
    `├ ✅ 成功: ${status.successCount}`,
    `├ ❌ 失败: ${status.failedCount}`,
    `├ ⏭️ 跳过: ${status.skippedCount}`,
    `└ ⏹️ 停止: ${status.stoppedCount}`,
  ];

  if (showProgress) {
    lines.push(
      "",
      "📥 下载进度:",
      ` ├ 🆔 Message ID: ${status.messageId}`,
      ` │  ├ 👤: ${shortText(status.sourceName, 28)}`,
      ` │  ├ 📁: ${shortText(status.fileName, 30)}`,
      ` │  ├ 📏: ${hasTotal ? formatByte(status.total) : "unknown"}`,
      ` │  ├ ⏬: ${formatByte(status.speed)}/s`,
      ` │  ├ 📌: ${stateLabel}`,
      ` │  └ 📊: [${progress}]`,
    );
  }

  if (status.error) {
    lines.push(`错误: ${shortText(status.error, 120)}`);
  }

  return lines.join("\n");
}

function asPreformattedText(text: string): BotInputText {
  return {
    text,
    entities: [
      {
        _: "messageEntityPre",
        offset: 0,
        length: text.length,
        language: "",
      },
    ],
  };
}

function createStatusEditor(client: BotClient, statusMessage: Message | null, status: BotDownloadStatus) {
  let lastEditAt = 0;
  let lastText = "";
  let editChain = Promise.resolve();

  async function apply(force = false) {
    if (!statusMessage) {
      return;
    }

    const now = Date.now();
    if (!force && now - lastEditAt < 1200) {
      return;
    }

    const text = buildDownloadStatusText(status);
    if (text === lastText) {
      return;
    }

    lastEditAt = now;
    lastText = text;
    editChain = editChain
      .then(async () => {
        try {
          await client.editMessage({ message: statusMessage, text: asPreformattedText(text) });
        } catch (error) {
          logger.warn({ error }, "bot status edit failed");
        }
      })
      .catch((error) => {
        logger.warn({ error }, "bot status edit chain failed");
      });
    await editChain;
  }

  return {
    status,
    update(patch: Partial<BotDownloadStatus>, force = false) {
      Object.assign(status, patch);
      return apply(force);
    },
    finalize(patch: Partial<BotDownloadStatus>) {
      Object.assign(status, patch);
      return apply(true);
    },
  };
}

export function botCommandDefinitions() {
  return [
    { _: "botCommand" as const, command: "help", description: "Help" },
    { _: "botCommand" as const, command: "get_info", description: "Get group and user info from message link" },
    { _: "botCommand" as const, command: "download", description: "To download the video, use the method to directly enter /download to view" },
    { _: "botCommand" as const, command: "forward", description: "Forward video, use the method to directly enter /forward to view" },
    { _: "botCommand" as const, command: "listen_forward", description: "Listen forward, use the method to directly enter /listen_forward to view" },
    { _: "botCommand" as const, command: "add_filter", description: "Add download filter, use the method to directly enter /add_filter to view" },
    { _: "botCommand" as const, command: "set_language", description: "Set language" },
    { _: "botCommand" as const, command: "stop", description: "Stop bot download or forward" },
  ];
}

async function registerBotCommands(client: BotClient) {
  if (botState.commandsRegistered) {
    return;
  }

  await client.setMyCommands({
    commands: botCommandDefinitions(),
  });
  botState.commandsRegistered = true;
}

async function startupNoticeRecipients(config: AppConfig): Promise<PeerRef[]> {
  const allowed = await ensureAllowedUserIds(config);
  return Array.from(allowed)
    .map((id) => toPeerRef(id))
    .filter((id): id is PeerRef => id !== undefined);
}

async function sendStartupNotice(config: AppConfig, client: BotClient) {
  if (botState.startupNoticeSent) {
    return;
  }

  const recipients = await startupNoticeRecipients(config);
  for (const recipient of recipients) {
    try {
      await client.sendText(recipient, helpText(), { replyMarkup: botHelpReplyMarkup() });
    } catch (error) {
      logger.error({ error, recipient }, "bot startup notice failed");
    }
  }
  botState.startupNoticeSent = recipients.length > 0;
}

async function processBotDownloadMessage(
  config: AppConfig,
  client: BotClient,
  message: Message,
  normalized: NormalizedMessage,
) {
  const node = createTaskNode({
    chatId: normalized.chatId,
    chatTitle: effectiveMessageSourceTitle(normalized) ?? normalized.chatTitle,
    source: "bot",
    filter: effectiveDownloadFilter(config),
  });
  node.status = "running";
  const job = createDownloadJob(normalized, node);
  await persistTaskNode(node);

  const displayTaskId = nextBotTaskId();
  bindDisplayTaskId(displayTaskId, node.id);
  const initialStatus: BotDownloadStatus = {
    taskId: displayTaskId,
    messageId: normalized.id,
    sourceName: effectiveMessageSourceTitle(normalized) ?? normalized.senderName ?? normalized.chatTitle ?? normalized.chatId,
    fileName: config.download.hide_file_name
      ? "[hidden]"
      : normalized.fileName ?? `${normalized.id}.${normalized.mediaType ?? "bin"}`,
    downloaded: 0,
    total: normalized.fileSize ?? 0,
    speed: 0,
    totalCount: 1,
    successCount: 0,
    failedCount: 0,
    skippedCount: 0,
    stoppedCount: 0,
    state: "queued",
  };
  const target = messageTarget(message);
  const statusMessage = target
    ? await client
        .sendText(target, asPreformattedText(buildDownloadStatusText(initialStatus)), {
          replyTo: message,
          disableWebPreview: true,
        })
        .catch((error) => {
          logger.error({ error }, "bot status message failed");
          return null;
        })
    : null;
  const editor = createStatusEditor(client, statusMessage, initialStatus);

  try {
    await editor.update({ state: "downloading" }, true);
    const result = await processJob(job, {
      telegramClient: client,
      onProgress(downloaded, total, speed) {
        void editor.update({
          state: "downloading",
          downloaded,
          total: total || normalized.fileSize || 0,
          speed,
        });
      },
    });
    const finishedStatus =
      result.status === "failed" ? "failed" : result.status === "stopped" ? "stopped" : "completed";
    await markTaskNodeFinished(node.id, finishedStatus);

    if (result.status === "success") {
      await editor.finalize({
        state: "success",
        downloaded: result.fileSize ?? editor.status.downloaded,
        total: result.fileSize ?? editor.status.total,
        speed: 0,
        successCount: 1,
      });
    } else if (result.status === "skip") {
      await editor.finalize({ state: "skip", speed: 0, skippedCount: 1 });
    } else if (result.status === "stopped") {
      await editor.finalize({ state: "stopped", speed: 0, stoppedCount: 1, error: "stopped by command" });
    } else {
      await editor.finalize({
        state: "failed",
        speed: 0,
        failedCount: 1,
        error: result.error?.message ?? "unknown error",
      });
    }
  } catch (error) {
    await markTaskNodeFinished(node.id, "failed");
    logger.error({ error, messageId: normalized.id, mediaType: normalized.mediaType }, "direct bot download failed");
    await editor.finalize({
      state: "failed",
      speed: 0,
      failedCount: 1,
      error: error instanceof Error ? error.message : "下载失败",
    });
  }
}

async function handleDirectMediaDownload(config: AppConfig, client: BotClient, message: Message) {
  const normalized = normalizeMtcuteMessage(message);
  if (!normalized.media) {
    await reply(client, message, "请直接转发图片、视频、文件、音频，或发送 t.me 消息链接。");
    return;
  }
  await processBotDownloadMessage(config, client, message, normalized);
}

async function handleExternalUrlDownload(config: AppConfig, client: BotClient, message: Message, url: string) {
  const id = Number.isSafeInteger(message.id) ? message.id : Date.now();
  const chat = message.chat as unknown as Record<string, unknown> | undefined;
  const chatRef = chatId(message);
  const normalized: NormalizedMessage = {
    id,
    chatId: chatRef === undefined ? "external" : String(chatRef),
    chatTitle: typeof chat?.title === "string" ? chat.title : "External URL",
    date: new Date().toISOString(),
    text: url,
    mediaType: "external",
    fileName: url,
    senderId: senderId(message),
    source: undefined,
  };
  await processBotDownloadMessage(config, client, message, normalized);
}

async function handleDownloadCommand(config: AppConfig, client: BotClient, message: Message, text: string) {
  const args = parseDownloadCommandArgs(text);
  if (args.mode === "range") {
    await handleDownloadRangeCommand(config, client, message, {
      chatRef: args.chatRef,
      startMessageId: args.startMessageId,
      endMessageId: args.endMessageId,
      explicitFilter: args.explicitFilter,
    });
    return;
  }

  if (!args.ref) {
    await reply(
      client,
      message,
      [
        "用法:",
        "/download <t.me消息链接> [filter]",
        "/download <chatId> <messageId> [filter]",
        "/download <chat链接> <startId> <endId> [filter]",
      ].join("\n"),
    );
    return;
  }

  const filter = effectiveDownloadFilter(config, args.explicitFilter);
  if (!(await validateAndReplyFilter(client, message, filter))) {
    return;
  }

  const telegramMessage = await getTelegramMessage(config, args.ref.chatId, args.ref.messageId);
  if (!telegramMessage) {
    await reply(client, message, "消息不存在或当前账号无权访问。");
    return;
  }

  const node = createTaskNode({
    chatId: args.ref.chatId,
    chatTitle: telegramMessage.chatTitle,
    source: "bot",
    filter,
  });
  await enqueueMessageDownload(telegramMessage, node);
  await reply(client, message, `已入队: ${args.ref.chatId}/${args.ref.messageId}`);
}

async function handleDownloadRangeCommand(
  config: AppConfig,
  client: BotClient,
  message: Message,
  input: {
    chatRef: string;
    startMessageId: number;
    endMessageId: number;
    explicitFilter?: string;
  },
) {
  const chat = toChatRef(input.chatRef);
  const startMessageId = input.startMessageId;
  const endMessageId = input.endMessageId;

  if (!Number.isSafeInteger(startMessageId) || !Number.isSafeInteger(endMessageId)) {
    await reply(client, message, "消息 ID 必须是有效数字。");
    return;
  }
  if (endMessageId !== 0 && endMessageId < startMessageId) {
    await reply(client, message, `endId(${endMessageId}) 必须大于等于 startId(${startMessageId})，或使用 0 表示直到末尾。`);
    return;
  }

  const filter = effectiveDownloadFilter(config, input.explicitFilter);
  if (!(await validateAndReplyFilter(client, message, filter))) {
    return;
  }

  const chatConfig: ChatDownloadConfig = {
    chat_id: chat.chatId,
    enabled: true,
    last_read_message_id: Math.max(0, startMessageId - 1),
    ids_to_retry: [],
    download_filter: filter ?? "",
    upload_telegram_chat_id: "",
    limit: endMessageId > 0 ? endMessageId - startMessageId + 1 : undefined,
    start_offset_id: Math.max(0, startMessageId - 1),
    end_offset_id: endMessageId > 0 ? endMessageId : undefined,
    reverse: true,
  };

  const result = await runConfiguredDownloads({
    chats: [chatConfig],
    taskType: "download",
    source: "bot",
  }, config);

  await reply(
    client,
    message,
    `下载任务已入队: chat=${chat.chatId}, range=${startMessageId}-${endMessageId || "latest"}, queued=${result.queued}, skipped=${result.skipped}`,
  );
}

async function handleScanCommand(config: AppConfig, client: BotClient, message: Message, text: string) {
  const [, chat, limitValue] = commandParts(text);
  const limit = limitValue ? Number(limitValue) : undefined;
  const result = await runConfiguredDownloads({
    chatIds: chat ? [chat] : undefined,
    limit: Number.isFinite(limit) ? limit : undefined,
  }, config);

  await reply(
    client,
    message,
    `配置扫描完成: chats=${result.processedChats}, queued=${result.queued}, skipped=${result.skipped}`,
  );
}

async function handleGetInfoCommand(config: AppConfig, client: BotClient, message: Message, text: string) {
  const [, link] = commandParts(text);
  if (!link) {
    await reply(client, message, `chat_id=${chatId(message) ?? "unknown"}\nsender_id=${senderId(message) ?? "unknown"}`);
    return;
  }

  const ref = parseTelegramMessageRef(link);
  if (!ref) {
    await reply(client, message, "用法: /get_info <t.me消息链接>");
    return;
  }

  const telegramMessage = await getTelegramMessage(config, ref.chatId, ref.messageId);
  if (!telegramMessage) {
    await reply(client, message, "消息不存在或当前账号无权访问。");
    return;
  }

  await reply(
    client,
    message,
    [
      `chat_id=${telegramMessage.chatId}`,
      `chat_title=${telegramMessage.chatTitle ?? ""}`,
      `message_id=${telegramMessage.id}`,
      `sender_id=${telegramMessage.senderId ?? ""}`,
      `sender_name=${telegramMessage.senderName ?? ""}`,
      `forward_sender_id=${telegramMessage.forwardOrigin?.senderId ?? ""}`,
      `forward_sender_name=${telegramMessage.forwardOrigin?.senderName ?? ""}`,
      `forward_chat_id=${telegramMessage.forwardOrigin?.chatId ?? ""}`,
      `forward_chat_title=${telegramMessage.forwardOrigin?.chatTitle ?? ""}`,
      `forward_message_id=${telegramMessage.forwardOrigin?.messageId ?? ""}`,
      `media_type=${telegramMessage.mediaType ?? ""}`,
      `file_name=${telegramMessage.fileName ?? ""}`,
      `file_size=${telegramMessage.fileSize ?? ""}`,
      `caption=${shortText(telegramMessage.caption ?? telegramMessage.text, 160)}`,
    ].join("\n"),
  );
}

async function handleAddFilterCommand(config: AppConfig, client: BotClient, message: Message, text: string) {
  const filter = commandArgText(text);
  if (!filter) {
    await reply(client, message, "用法: /add_filter <filter>\n发送 /add_filter clear 可清空默认过滤器。");
    return;
  }

  if (filter.toLowerCase() === "clear") {
    botState.downloadFilters = [];
    await saveAppConfig({ ...config, bot: { ...config.bot, download_filter: [] } });
    await reply(client, message, "已清空 Bot 默认下载过滤器。");
    return;
  }

  const checked = filterEngine.check(filter);
  if (!checked.ok) {
    await reply(client, message, `${checked.error}\n检查失败，请重新添加。`);
    return;
  }

  botState.downloadFilters = [...currentBotDownloadFilters(config), filter];
  await saveAppConfig({ ...config, bot: { ...config.bot, download_filter: botState.downloadFilters } });
  await reply(client, message, `已添加 Bot 默认下载过滤器: ${filter}`);
}

async function handleSetLanguageCommand(config: AppConfig, client: BotClient, message: Message, text: string) {
  const [, value] = commandParts(text);
  const language = languageValue(value);
  if (!language) {
    await reply(client, message, "无效的命令格式。请使用 /set_language en/ru/zh/ua");
    return;
  }

  await saveAppConfig({ ...config, app: { ...config.app, language } });
  await reply(client, message, `Language set to ${language}`);
}

async function handleForwardCommand(config: AppConfig, client: BotClient, message: Message, text: string) {
  const {
    sourceChat,
    targetChat,
    startMessageId,
    endMessageId,
    usesRange,
    limit,
    explicitFilter,
  } = parseForwardCommandArgs(text);
  if (!sourceChat || !targetChat) {
    await reply(client, message, "用法: /forward <sourceChat> <targetChat> [limit] [filter] 或 /forward <sourceChat> <targetChat> <startId> <endId> [filter]");
    return;
  }

  const source = toChatRef(sourceChat);
  const target = toChatRef(targetChat);
  const rangeStart = usesRange ? startMessageId : undefined;
  const rangeEnd = usesRange ? endMessageId : undefined;
  const filter = effectiveDownloadFilter(config, explicitFilter);
  if (!(await validateAndReplyFilter(client, message, filter))) {
    return;
  }
  if (rangeStart !== undefined && rangeEnd !== undefined && rangeEnd !== 0 && rangeEnd < rangeStart) {
    await reply(client, message, `endId(${rangeEnd}) 必须大于等于 startId(${rangeStart})，或使用 0 表示直到末尾。`);
    return;
  }

  const result = await runConfiguredDownloads({
    chats: [
      {
        chat_id: source.chatId,
        enabled: true,
        last_read_message_id: rangeStart !== undefined ? Math.max(0, rangeStart - 1) : 0,
        ids_to_retry: [],
        download_filter: filter ?? "",
        upload_telegram_chat_id: target.chatId,
        limit: rangeStart !== undefined && rangeEnd !== undefined && rangeEnd > 0 ? rangeEnd - rangeStart + 1 : limit,
        start_offset_id: rangeStart !== undefined ? Math.max(0, rangeStart - 1) : undefined,
        end_offset_id: rangeEnd !== undefined && rangeEnd > 0 ? rangeEnd : undefined,
        reverse: true,
      },
    ],
    taskType: "forward",
    source: "bot",
    uploadTelegramChatId: target.chatId,
    uploadTelegramReplyToMessageId: target.messageId ?? target.topicId,
  }, config);

  await reply(client, message, `转发任务已入队: queued=${result.queued}, skipped=${result.skipped}`);
}

async function handleForwardToCommentsCommand(config: AppConfig, client: BotClient, message: Message, text: string) {
  const [, sourceChat, targetChat, startValue, endValue, ...filterParts] = commandParts(text);
  if (!sourceChat || !targetChat || !startValue || !endValue) {
    await reply(
      client,
      message,
      "用法: /forward_to_comments <sourceChat> <targetMessageLink> <startId> <endId> [filter]",
    );
    return;
  }

  const startMessageId = parsePositiveId(startValue);
  const endMessageId = parsePositiveId(endValue);
  if (startMessageId === undefined || endMessageId === undefined) {
    await reply(client, message, "startId 和 endId 必须是有效数字，endId 可为 0 表示直到末尾。");
    return;
  }
  if (endMessageId !== 0 && endMessageId < startMessageId) {
    await reply(client, message, `endId(${endMessageId}) 必须大于等于 startId(${startMessageId})，或使用 0 表示直到末尾。`);
    return;
  }

  const source = toChatRef(sourceChat);
  const target = toChatRef(targetChat);
  const filter = effectiveDownloadFilter(config, filterParts.join(" "));
  if (!(await validateAndReplyFilter(client, message, filter))) {
    return;
  }

  const result = await runConfiguredDownloads({
    chats: [
      {
        chat_id: source.chatId,
        enabled: true,
        last_read_message_id: Math.max(0, startMessageId - 1),
        ids_to_retry: [],
        download_filter: filter ?? "",
        upload_telegram_chat_id: target.chatId,
        limit: endMessageId > 0 ? endMessageId - startMessageId + 1 : undefined,
        start_offset_id: Math.max(0, startMessageId - 1),
        end_offset_id: endMessageId > 0 ? endMessageId : undefined,
        reverse: true,
      },
    ],
    taskType: "forward",
    source: "bot",
    uploadTelegramChatId: target.chatId,
    uploadTelegramReplyToMessageId: target.topicId,
    uploadTelegramCommentToMessageId: target.commentId ?? target.messageId,
  }, config);

  await reply(
    client,
    message,
    `评论区转发任务已入队: queued=${result.queued}, skipped=${result.skipped}`,
  );
}

async function latestMessageId(config: AppConfig, chatId: string) {
  for await (const item of iterTelegramHistory(config, chatId, { limit: 1 })) {
    return item.id;
  }
  return 0;
}

async function handleListenForwardCommand(config: AppConfig, client: BotClient, message: Message, text: string) {
  const [, sourceChat, targetChat, ...filterParts] = commandParts(text);
  if (!sourceChat || !targetChat) {
    await reply(client, message, "用法: /listen_forward <sourceChatId> <targetChatId> [filter]");
    return;
  }
  const filter = effectiveDownloadFilter(config, filterParts.join(" "));
  if (!(await validateAndReplyFilter(client, message, filter))) {
    return;
  }
  const source = toChatRef(sourceChat);
  const target = toChatRef(targetChat);
  const rule = await createListenForwardRule({
    sourceChatId: source.chatId,
    targetChatId: target.chatId,
    filter: filter || undefined,
    lastReadMessageId: await latestMessageId(config, source.chatId),
  });
  await reply(client, message, `监听转发规则已创建: #${rule?.id ?? ""}`);
}

async function sendStopPanel(client: BotClient, message: Message) {
  const target = messageTarget(message);
  if (!target) {
    return;
  }

  await client.sendText(
    target,
    [
      "请选择:",
      "",
      "也可以直接发送:",
      "/stop all",
      "/stop <task_id>",
    ].join("\n"),
    {
      replyMarkup: BotKeyboard.inline([
        [
          BotKeyboard.callback("停止下载", stopCallbackForType("download")),
          BotKeyboard.callback("停止转发", stopCallbackForType("forward")),
        ],
        [BotKeyboard.callback("停止监听转发", stopCallbackForType("listen_forward"))],
        [BotKeyboard.callback("停止全部任务", "stop:all")],
      ]),
    },
  );
}

async function sendStopTaskList(client: BotClient, query: CallbackQuery, taskType: TaskType) {
  const target = query.chat as BotTextTarget;
  const tasks = (await listActiveTasks(80)).filter((task) => task.taskType === taskType);

  if (tasks.length === 0) {
    await client.sendText(target, "No Task");
    return;
  }

  const rows = [
    [BotKeyboard.callback("all", `stop:task:${taskType}:all`)],
  ];

  let row: ReturnType<typeof BotKeyboard.callback>[] = [];
  for (const task of tasks) {
    const displayId = displayTaskIdFor(task.externalId);
    row.push(
      BotKeyboard.callback(
        taskButtonLabel({
          displayId,
          externalId: task.externalId,
          chatTitle: task.chatTitle,
          chatId: task.chatId,
        }),
        `stop:task:${taskType}:${displayId}`,
      ),
    );
    if (row.length === 2) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length > 0) {
    rows.push(row);
  }

  await client.sendText(target, `Stop ${taskTypeLabel(taskType)}...`, {
    replyMarkup: BotKeyboard.inline(rows),
  });
}

async function handleStopCommand(client: BotClient, message: Message, text: string) {
  const [, target] = commandParts(text);
  if (!target) {
    await sendStopPanel(client, message);
    return;
  }

  const normalizedTarget = target.toLowerCase();
  const taskExternalId =
    normalizedTarget === "all" || normalizedTarget === "*" ? undefined : resolveTaskExternalId(target);
  const result = await stopTaskTransmission(taskExternalId);
  await reply(
    client,
    message,
    taskExternalId
      ? `已停止任务 ${target}: ${stopResultText(result)}`
      : `已停止全部任务: ${stopResultText(result)}`,
  );
}

async function isAllowedCallback(config: AppConfig, query: CallbackQuery) {
  const allowed = await ensureAllowedUserIds(config);
  return isAllowedSenderId(allowed, String(query.user.id));
}

async function handleBotCallback(config: AppConfig, client: BotClient, query: CallbackQuery) {
  if (!(await isAllowedCallback(config, query))) {
    return;
  }

  const target = query.chat as BotTextTarget;
  if (query.dataStr?.startsWith("stop:type:")) {
    const taskType = query.dataStr.slice("stop:type:".length) as TaskType;
    if (taskType !== "download" && taskType !== "forward" && taskType !== "listen_forward") {
      return;
    }
    await client.answerCallbackQuery(query, { text: `选择${taskTypeLabel(taskType)}任务` });
    await sendStopTaskList(client, query, taskType);
    return;
  }

  if (query.dataStr?.startsWith("stop:task:")) {
    const [, , taskTypeValue, taskExternalId] = query.dataStr.split(":");
    const taskType = taskTypeValue as TaskType;
    if (taskType !== "download" && taskType !== "forward" && taskType !== "listen_forward") {
      return;
    }
    const normalizedTarget = taskExternalId === "all" ? undefined : resolveTaskExternalId(taskExternalId);
    const result = normalizedTarget ? await stopTaskTransmission(normalizedTarget) : await stopTasksByType(taskType);
    await client.answerCallbackQuery(query, {
      text: normalizedTarget ? "已停止任务" : "已停止全部任务",
    });
    await client.sendText(
      target,
      normalizedTarget
        ? `已停止${taskTypeLabel(taskType)}任务: ${stopResultText(result)}`
        : `已停止全部${taskTypeLabel(taskType)}任务: ${stopResultText(result)}`,
    );
    return;
  }

  if (query.dataStr === "stop:all") {
    await client.answerCallbackQuery(query, { text: "正在停止全部任务" });
    await stopTaskAndReport(client, target, undefined, "all");
    return;
  }

  if (query.dataStr?.startsWith("stop:")) {
    const taskExternalId = resolveTaskExternalId(query.dataStr.slice("stop:".length));
    const result = await stopTaskTransmission(taskExternalId);
    await client.answerCallbackQuery(query, {
      text: `已停止任务: ${result.stoppedQueueItems}`,
    });
    await client.sendText(
      target,
      `已停止任务: ${stopResultText(result)}`,
    );
  }
}

async function handleBotMessage(config: AppConfig, client: BotClient, message: Message) {
  if (!(await isAllowed(config, message))) {
    return;
  }

  const text = textOf(message);
  const externalUrl = externalDownloadUrl(text);

  try {
    logger.info(
      {
        chatId: chatId(message),
        senderId: senderId(message),
        messageId: message.id,
        hasText: Boolean(text),
        hasMedia: hasDownloadableMedia(message),
      },
      "bot message received",
    );

    if (externalUrl && !text.startsWith("/")) {
      await handleExternalUrlDownload(config, client, message, externalUrl);
    } else if (hasDownloadableMedia(message) && !text.startsWith("/")) {
      await handleDirectMediaDownload(config, client, message);
    } else if (text.startsWith("/start") || text.startsWith("/help")) {
      await reply(client, message, helpText(), { replyMarkup: botHelpReplyMarkup() });
    } else if (text.startsWith("/get_info")) {
      await handleGetInfoCommand(config, client, message, text);
    } else if (text.startsWith("/add_filter")) {
      await handleAddFilterCommand(config, client, message, text);
    } else if (text.startsWith("/set_language")) {
      await handleSetLanguageCommand(config, client, message, text);
    } else if (text.startsWith("/stop")) {
      await handleStopCommand(client, message, text);
    } else if (text.startsWith("/status")) {
      await handleStatusCommand(client, message);
    } else if (text.startsWith("/download")) {
      await handleDownloadCommand(config, client, message, text);
    } else if (text.startsWith("/scan")) {
      await handleScanCommand(config, client, message, text);
    } else if (text.startsWith("/forward_to_comments")) {
      await handleForwardToCommentsCommand(config, client, message, text);
    } else if (text.startsWith("/forward")) {
      await handleForwardCommand(config, client, message, text);
    } else if (text.startsWith("/listen_forward")) {
      await handleListenForwardCommand(config, client, message, text);
    } else if (text.startsWith("https://t.me") || text.startsWith("https://telegram.me")) {
      await handleDownloadCommand(config, client, message, `/download ${text}`);
    } else if (externalUrl) {
      await handleExternalUrlDownload(config, client, message, externalUrl);
    } else if (text.startsWith("/")) {
      await reply(client, message, `未知命令。\n${helpText()}`);
    } else if (isPrivateChat(message)) {
      await reply(client, message, helpText());
    }
  } catch (error) {
    logger.error({ error }, "bot message handler failed");
    await reply(client, message, error instanceof Error ? error.message : "Bot command failed");
  }
}

export function getBotClientStatus(config: AppConfig): BotClientStatus {
  const current = isBotClientCurrent(config);
  return {
    configured: Boolean(config.telegram.bot_token),
    started: current,
    allowedUserCount: current ? botState.allowedUserIds.size : 0,
    sessionPath: botSessionPath(config),
    commandsRegistered: current && botState.commandsRegistered,
    startupNoticeSent: current && botState.startupNoticeSent,
  };
}

export async function ensureStartedBotClient(config: AppConfig): Promise<BotClient> {
  if (!config.telegram.bot_token) {
    throw new Error("telegram.bot_token is required");
  }

  await resetBotClientForConfigChange(config);
  if (botState.client && isBotClientCurrent(config)) {
    return botState.client;
  }

  if (botState.startPromise) {
    return botState.startPromise;
  }

  botState.startPromise = (async () => {
    await mkdir(config.telegram.sessions_dir, { recursive: true });
    botState.downloadFilters = config.bot.download_filter;
    botState.clientConfigKey = botClientConfigKey(config);
    const client =
      botState.client ??
      new TelegramClient({
        apiId: config.telegram.api_id,
        apiHash: config.telegram.api_hash,
        storage: botSessionPath(config),
      });
    botState.client = client;
    if (!botState.handlerAttached) {
      client.onNewMessage.add((message) => {
        void loadAppConfig()
          .then((latestConfig) => handleBotMessage(latestConfig, client, message))
          .catch((error) => {
            logger.error({ error }, "bot message config load failed");
            void reply(client, message, error instanceof Error ? error.message : "Bot config load failed");
          });
      });
      client.onCallbackQuery.add((query) => {
        void loadAppConfig()
          .then((latestConfig) => handleBotCallback(latestConfig, client, query))
          .catch((error) => {
            logger.error({ error }, "bot callback config load failed");
          });
      });
      botState.handlerAttached = true;
    }
    await client.start({ botToken: config.telegram.bot_token });
    await ensureAllowedUserIds(config);
    await registerBotCommands(client);
    if (!botState.updatesStarted) {
      await client.startUpdatesLoop();
      botState.updatesStarted = true;
    }
    await sendStartupNotice(config, client);
    botState.started = true;
    return client;
  })().catch(async (error) => {
    const failedClient = botState.client;
    resetBotRuntimeState();
    if (failedClient) {
      await failedClient.destroy().catch((destroyError) => {
        logger.warn({ error: destroyError }, "failed to destroy bot client after start failure");
      });
    }
    throw error;
  });

  try {
    return await botState.startPromise;
  } finally {
    botState.startPromise = null;
  }
}

export async function runBot() {
  const config = await loadAppConfig();
  await ensureStartedBotClient(config);
  logger.info("telegram bot started");
  await new Promise(() => undefined);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runBot().catch((error) => {
    logger.error({ error }, "telegram bot crashed");
    process.exitCode = 1;
  });
}
