import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consoleSessionCookieName, signConsoleSession, verifyConsoleSession } from "@/auth/console-auth";

function mockCookieStore(store: { get?: ReturnType<typeof vi.fn>; set?: ReturnType<typeof vi.fn> }) {
  const cookieStore = {
    get: store.get ?? vi.fn(),
    set: store.set ?? vi.fn(),
  };
  vi.doMock("next/headers", () => ({
    cookies: vi.fn(async () => cookieStore),
  }));
  return cookieStore;
}

describe("/api/auth routes", () => {
  const previousEnv = { ...process.env };

  beforeEach(() => {
    process.env.CONSOLE_PASSWORD = "secret";
    process.env.CONSOLE_SESSION_TTL_DAYS = "30";
    process.env.CONSOLE_COOKIE_SECURE = "0";
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    process.env = { ...previousEnv };
    vi.doUnmock("next/headers");
    vi.resetModules();
  });

  it("sets an http-only session cookie after successful login", async () => {
    const cookieStore = mockCookieStore({});
    const { POST } = await import("./login/route");

    const response = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "secret" }),
      }),
    );
    const data = await response.json();
    const [name, token, options] = cookieStore.set.mock.calls[0];

    expect(response.status).toBe(200);
    expect(data).toMatchObject({ ok: true, configured: true, disabled: false });
    expect(name).toBe(consoleSessionCookieName);
    await expect(verifyConsoleSession(token)).resolves.toBe(true);
    expect(options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });
  });

  it("rejects invalid login password", async () => {
    const cookieStore = mockCookieStore({});
    const { POST } = await import("./login/route");

    const response = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "wrong" }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("密码错误");
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("clears the session cookie on logout", async () => {
    const cookieStore = mockCookieStore({});
    const { POST } = await import("./logout/route");

    const response = await POST();
    const [name, value, options] = cookieStore.set.mock.calls[0];

    expect(response.status).toBe(200);
    expect(name).toBe(consoleSessionCookieName);
    expect(value).toBe("");
    expect(options).toMatchObject({ maxAge: 0, path: "/" });
  });

  it("returns authenticated session state", async () => {
    const token = await signConsoleSession();
    mockCookieStore({
      get: vi.fn(() => ({ value: token })),
    });
    const { GET } = await import("./session/route");

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      authenticated: true,
      configured: true,
      disabled: false,
    });
  });

  it("reports missing password as not configured in every environment", async () => {
    delete process.env.CONSOLE_PASSWORD;
    mockCookieStore({});
    const { POST } = await import("./login/route");

    const response = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "secret" }),
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.error).toBe("CONSOLE_PASSWORD is not configured");
  });
});
