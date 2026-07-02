import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { nanoid } from "nanoid";
import type { AppConfig } from "@/config/schema";
import { createUserClient, getUserSessionPath, type TelegramUserClient } from "@/engine/user-client";

const LOGIN_TTL_MS = 10 * 60 * 1000;

type LoginState = "code_sent" | "password_required" | "completed";

type TelegramLoginClient = Pick<
  TelegramUserClient,
  "sendCode" | "signIn" | "checkPassword" | "destroy" | "getPasswordHint"
>;

export type TelegramLoginStartResult = {
  loginId?: string;
  state: LoginState;
  phone: string;
  expiresAt?: string;
  codeType?: string;
  codeLength?: number;
  timeout?: number;
  user?: TelegramLoginUser;
  sessionPath?: string;
};

export type TelegramLoginStepResult = {
  state: LoginState;
  expiresAt?: string;
  passwordHint?: string | null;
  user?: TelegramLoginUser;
  sessionPath?: string;
};

export type TelegramLoginUser = {
  id?: string;
  displayName?: string;
};

type LoginSession = {
  loginId: string;
  client: TelegramLoginClient;
  phone: string;
  phoneCodeHash: string;
  sessionPath: string;
  state: Exclude<LoginState, "completed">;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
};

export class TelegramLoginError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "TelegramLoginError";
  }
}

let loginClientFactory: (config: AppConfig) => TelegramLoginClient = createUserClient;
const sessions = new Map<string, LoginSession>();
const sessionByPath = new Map<string, string>();

function safeTrim(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function ensureTelegramLoginConfig(config: AppConfig, phoneOverride?: string) {
  const phone = safeTrim(phoneOverride) || safeTrim(config.telegram.phone);
  const sessionPath = getUserSessionPath(config);

  if (!config.telegram.api_id) {
    throw new TelegramLoginError("请先配置 Telegram api_id", 400);
  }
  if (!safeTrim(config.telegram.api_hash)) {
    throw new TelegramLoginError("请先配置 Telegram api_hash", 400);
  }
  if (!phone) {
    throw new TelegramLoginError("请先配置或输入 Telegram 手机号", 400);
  }
  if (!safeTrim(config.telegram.sessions_dir) || !safeTrim(config.telegram.user_session)) {
    throw new TelegramLoginError("请先配置 Telegram session 保存路径", 400);
  }

  return { phone, sessionPath };
}

function scheduleCleanup(loginId: string) {
  const timer = setTimeout(() => {
    void cancelTelegramLogin(loginId);
  }, LOGIN_TTL_MS);
  timer.unref?.();
  return timer;
}

async function removeSession(session: LoginSession) {
  clearTimeout(session.timer);
  sessions.delete(session.loginId);
  if (sessionByPath.get(session.sessionPath) === session.loginId) {
    sessionByPath.delete(session.sessionPath);
  }
  await session.client.destroy().catch(() => undefined);
}

async function replaceSessionForPath(sessionPath: string) {
  const existingLoginId = sessionByPath.get(sessionPath);
  const existing = existingLoginId ? sessions.get(existingLoginId) : undefined;
  if (existing) {
    await removeSession(existing);
  }
}

function getSession(loginId: string, expectedState?: LoginSession["state"]) {
  const session = sessions.get(loginId);
  if (!session) {
    throw new TelegramLoginError("Telegram 登录流程不存在或已过期", 404);
  }
  if (Date.now() > session.expiresAt) {
    void removeSession(session);
    throw new TelegramLoginError("Telegram 登录流程已过期，请重新发送验证码", 410);
  }
  if (expectedState && session.state !== expectedState) {
    throw new TelegramLoginError("Telegram 登录流程状态不匹配，请重新开始", 409);
  }
  return session;
}

function phoneCodeHash(value: unknown) {
  if (!value || typeof value !== "object") {
    return "";
  }
  const hash = (value as { phoneCodeHash?: unknown }).phoneCodeHash;
  return typeof hash === "string" ? hash : "";
}

function sentCodeMetadata(value: unknown) {
  if (!value || typeof value !== "object") {
    return {};
  }
  const record = value as { type?: unknown; length?: unknown; timeout?: unknown };
  return {
    codeType: typeof record.type === "string" ? record.type : undefined,
    codeLength: typeof record.length === "number" ? record.length : undefined,
    timeout: typeof record.timeout === "number" ? record.timeout : undefined,
  };
}

function telegramUser(value: unknown): TelegramLoginUser {
  if (!value || typeof value !== "object") {
    return {};
  }
  const record = value as Record<string, unknown>;
  const id = record.id ?? record.userId;
  const displayName = record.displayName ?? record.username ?? record.firstName ?? record.lastName;
  return {
    id: id === undefined ? undefined : String(id),
    displayName: typeof displayName === "string" ? displayName : undefined,
  };
}

function isPasswordNeeded(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as { text?: unknown; message?: unknown; is?: unknown };
  if (typeof record.is === "function") {
    try {
      if (record.is("SESSION_PASSWORD_NEEDED")) {
        return true;
      }
    } catch {
      // Fall back to text/message checks below.
    }
  }
  return (
    record.text === "SESSION_PASSWORD_NEEDED" ||
    (typeof record.message === "string" && record.message.includes("SESSION_PASSWORD_NEEDED"))
  );
}

function telegramErrorMessage(error: unknown, fallback: string) {
  if (!error || typeof error !== "object") {
    return fallback;
  }
  const record = error as { text?: unknown; message?: unknown };
  if (typeof record.text === "string") {
    return record.text;
  }
  if (typeof record.message === "string" && record.message.trim()) {
    return record.message;
  }
  return fallback;
}

async function completeLogin(session: LoginSession, user: unknown): Promise<TelegramLoginStepResult> {
  const result = {
    state: "completed" as const,
    user: telegramUser(user),
    sessionPath: session.sessionPath,
  };
  await removeSession(session);
  return result;
}

export async function startTelegramLogin(
  config: AppConfig,
  params: { phone?: string } = {},
): Promise<TelegramLoginStartResult> {
  const { phone, sessionPath } = ensureTelegramLoginConfig(config, params.phone);
  await mkdir(dirname(sessionPath), { recursive: true });
  await replaceSessionForPath(sessionPath);

  const client = loginClientFactory(config);
  try {
    const sentCodeOrUser = await client.sendCode({ phone });
    const hash = phoneCodeHash(sentCodeOrUser);
    if (!hash) {
      await client.destroy().catch(() => undefined);
      return {
        state: "completed",
        phone,
        user: telegramUser(sentCodeOrUser),
        sessionPath,
      };
    }

    const loginId = nanoid();
    const expiresAt = Date.now() + LOGIN_TTL_MS;
    const session: LoginSession = {
      loginId,
      client,
      phone,
      phoneCodeHash: hash,
      sessionPath,
      state: "code_sent",
      expiresAt,
      timer: scheduleCleanup(loginId),
    };
    sessions.set(loginId, session);
    sessionByPath.set(sessionPath, loginId);

    return {
      loginId,
      state: "code_sent",
      phone,
      expiresAt: new Date(expiresAt).toISOString(),
      ...sentCodeMetadata(sentCodeOrUser),
    };
  } catch (error) {
    await client.destroy().catch(() => undefined);
    throw new TelegramLoginError(telegramErrorMessage(error, "发送 Telegram 验证码失败"), 400);
  }
}

export async function verifyTelegramLoginCode(
  params: { loginId?: string; code?: string },
): Promise<TelegramLoginStepResult> {
  const loginId = safeTrim(params.loginId);
  const code = safeTrim(params.code);
  if (!loginId || !code) {
    throw new TelegramLoginError("请输入 Telegram 登录验证码", 400);
  }

  const session = getSession(loginId, "code_sent");
  try {
    const user = await session.client.signIn({
      phone: session.phone,
      phoneCodeHash: session.phoneCodeHash,
      phoneCode: code,
    });
    return await completeLogin(session, user);
  } catch (error) {
    if (isPasswordNeeded(error)) {
      session.state = "password_required";
      const passwordHint = await session.client.getPasswordHint().catch(() => null);
      return {
        state: "password_required",
        expiresAt: new Date(session.expiresAt).toISOString(),
        passwordHint,
      };
    }
    throw new TelegramLoginError(telegramErrorMessage(error, "Telegram 验证码错误或已过期"), 400);
  }
}

export async function verifyTelegramLoginPassword(
  params: { loginId?: string; password?: string },
): Promise<TelegramLoginStepResult> {
  const loginId = safeTrim(params.loginId);
  const password = typeof params.password === "string" ? params.password : "";
  if (!loginId || !password) {
    throw new TelegramLoginError("请输入 Telegram 二步验证密码", 400);
  }

  const session = getSession(loginId, "password_required");
  try {
    const user = await session.client.checkPassword({ password });
    return await completeLogin(session, user);
  } catch (error) {
    throw new TelegramLoginError(telegramErrorMessage(error, "Telegram 二步验证密码错误"), 400);
  }
}

export async function cancelTelegramLogin(loginId?: string) {
  const normalizedLoginId = safeTrim(loginId);
  const session = normalizedLoginId ? sessions.get(normalizedLoginId) : undefined;
  if (!session) {
    return false;
  }
  await removeSession(session);
  return true;
}

export function __setTelegramLoginClientFactoryForTest(
  factory: ((config: AppConfig) => TelegramLoginClient) | null,
) {
  loginClientFactory = factory ?? createUserClient;
}

export async function __clearTelegramLoginSessionsForTest() {
  await Promise.all(Array.from(sessions.values()).map((session) => removeSession(session)));
}
