import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseAppConfig, type AppConfig } from "@/config/schema";
import {
  __clearTelegramLoginSessionsForTest,
  __setTelegramLoginClientFactoryForTest,
  cancelTelegramLogin,
  startTelegramLogin,
  verifyTelegramLoginCode,
  verifyTelegramLoginPassword,
} from "@/engine/telegram-login-service";

type FakeLoginClient = {
  sendCode: ReturnType<typeof vi.fn>;
  signIn: ReturnType<typeof vi.fn>;
  checkPassword: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  getPasswordHint: ReturnType<typeof vi.fn>;
};

function createFakeClient(overrides: Partial<FakeLoginClient> = {}): FakeLoginClient {
  return {
    sendCode: vi.fn(async () => ({
      phoneCodeHash: "hash-1",
      type: "app",
      length: 5,
      timeout: 60,
    })),
    signIn: vi.fn(async () => ({ id: 42, displayName: "Tester" })),
    checkPassword: vi.fn(async () => ({ id: 42, displayName: "Tester" })),
    destroy: vi.fn(async () => undefined),
    getPasswordHint: vi.fn(async () => "hint"),
    ...overrides,
  };
}

function loginConfig(tempDir: string): AppConfig {
  return parseAppConfig({
    telegram: {
      api_id: 12345,
      api_hash: "api-hash",
      sessions_dir: tempDir,
      user_session: "user.session",
      phone: "+10000000000",
    },
  });
}

describe("telegram login service", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "telegram-login-service-"));
  });

  afterEach(async () => {
    await __clearTelegramLoginSessionsForTest();
    __setTelegramLoginClientFactoryForTest(null);
    await rm(tempDir, { recursive: true, force: true });
  });

  it("rejects login start when required Telegram config is missing", async () => {
    await expect(startTelegramLogin(parseAppConfig({}))).rejects.toMatchObject({
      status: 400,
      message: "请先配置 Telegram api_id",
    });
  });

  it("starts login by sending a code and keeps the temporary client", async () => {
    const client = createFakeClient();
    __setTelegramLoginClientFactoryForTest(() => client as never);

    const result = await startTelegramLogin(loginConfig(tempDir));

    expect(result).toMatchObject({
      state: "code_sent",
      phone: "+10000000000",
      codeType: "app",
      codeLength: 5,
      timeout: 60,
    });
    expect(result.loginId).toBeTruthy();
    expect(client.sendCode).toHaveBeenCalledWith({ phone: "+10000000000" });
    expect(client.destroy).not.toHaveBeenCalled();

    await cancelTelegramLogin(result.loginId);
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });

  it("verifies the code, saves the session and clears the login flow", async () => {
    const client = createFakeClient();
    __setTelegramLoginClientFactoryForTest(() => client as never);

    const started = await startTelegramLogin(loginConfig(tempDir));
    const completed = await verifyTelegramLoginCode({
      loginId: started.loginId,
      code: "12345",
    });

    expect(client.signIn).toHaveBeenCalledWith({
      phone: "+10000000000",
      phoneCodeHash: "hash-1",
      phoneCode: "12345",
    });
    expect(completed).toMatchObject({
      state: "completed",
      user: { id: "42", displayName: "Tester" },
      sessionPath: join(tempDir, "user.session"),
    });
    expect(client.destroy).toHaveBeenCalledTimes(1);
    await expect(verifyTelegramLoginCode({ loginId: started.loginId, code: "12345" })).rejects.toMatchObject({
      status: 404,
    });
  });

  it("supports accounts that require a two-step verification password", async () => {
    const passwordNeeded = {
      text: "SESSION_PASSWORD_NEEDED",
      is: (text: string) => text === "SESSION_PASSWORD_NEEDED",
    };
    const client = createFakeClient({
      signIn: vi.fn(async () => {
        throw passwordNeeded;
      }),
    });
    __setTelegramLoginClientFactoryForTest(() => client as never);

    const started = await startTelegramLogin(loginConfig(tempDir));
    const passwordRequired = await verifyTelegramLoginCode({
      loginId: started.loginId,
      code: "12345",
    });

    expect(passwordRequired).toMatchObject({
      state: "password_required",
      passwordHint: "hint",
    });

    const completed = await verifyTelegramLoginPassword({
      loginId: started.loginId,
      password: "secret",
    });

    expect(client.checkPassword).toHaveBeenCalledWith({ password: "secret" });
    expect(completed).toMatchObject({
      state: "completed",
      user: { id: "42", displayName: "Tester" },
    });
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });

  it("replaces an existing login flow for the same session path", async () => {
    const firstClient = createFakeClient();
    const secondClient = createFakeClient();
    __setTelegramLoginClientFactoryForTest(
      vi
        .fn(() => firstClient as never)
        .mockImplementationOnce(() => firstClient as never)
        .mockImplementationOnce(() => secondClient as never),
    );

    const first = await startTelegramLogin(loginConfig(tempDir));
    const second = await startTelegramLogin(loginConfig(tempDir));

    expect(firstClient.destroy).toHaveBeenCalledTimes(1);
    expect(second.loginId).not.toBe(first.loginId);
    await expect(verifyTelegramLoginCode({ loginId: first.loginId, code: "12345" })).rejects.toMatchObject({
      status: 404,
    });
  });
});
