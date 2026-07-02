import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseAppConfig } from "@/config/schema";

function createFakeClient() {
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
    getPasswordHint: vi.fn(async () => null),
  };
}

describe("/api/telegram/login routes", () => {
  let tempDir: string;
  let previousConfigPath: string | undefined;

  beforeEach(async () => {
    previousConfigPath = process.env.APP_CONFIG_PATH;
    tempDir = await mkdtemp(join(tmpdir(), "telegram-login-api-"));
    process.env.APP_CONFIG_PATH = join(tempDir, "app.yaml");
    vi.resetModules();
  });

  afterEach(async () => {
    const service = await import("@/engine/telegram-login-service");
    await service.__clearTelegramLoginSessionsForTest();
    service.__setTelegramLoginClientFactoryForTest(null);
    if (previousConfigPath === undefined) {
      delete process.env.APP_CONFIG_PATH;
    } else {
      process.env.APP_CONFIG_PATH = previousConfigPath;
    }
    await rm(tempDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it("starts and verifies a Telegram login flow through API routes", async () => {
    const { saveAppConfig } = await import("@/config/load");
    await saveAppConfig(
      parseAppConfig({
        telegram: {
          api_id: 12345,
          api_hash: "api-hash",
          sessions_dir: tempDir,
          user_session: "user.session",
          phone: "+10000000000",
        },
      }),
    );

    const client = createFakeClient();
    const service = await import("@/engine/telegram-login-service");
    service.__setTelegramLoginClientFactoryForTest(() => client as never);
    const startRoute = await import("./start/route");
    const verifyRoute = await import("./verify/route");

    const startResponse = await startRoute.POST(
      new Request("http://localhost/api/telegram/login/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    const startBody = await startResponse.json();

    expect(startResponse.status).toBe(200);
    expect(startBody).toMatchObject({
      state: "code_sent",
      phone: "+10000000000",
      codeType: "app",
    });

    const verifyResponse = await verifyRoute.POST(
      new Request("http://localhost/api/telegram/login/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ loginId: startBody.loginId, code: "12345" }),
      }),
    );
    const verifyBody = await verifyResponse.json();

    expect(verifyResponse.status).toBe(200);
    expect(verifyBody).toMatchObject({
      state: "completed",
      user: { id: "42", displayName: "Tester" },
      sessionPath: join(tempDir, "user.session"),
    });
  });

  it("returns 400 when Telegram config is incomplete", async () => {
    const startRoute = await import("./start/route");

    const response = await startRoute.POST(
      new Request("http://localhost/api/telegram/login/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: "+10000000000" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("请先配置 Telegram api_id");
  });
});
