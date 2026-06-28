import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  consoleSessionMaxAgeSeconds,
  isProtectedRequestPath,
  isPublicAuthPath,
  signConsoleSession,
  verifyConsolePassword,
  verifyConsoleSession,
} from "@/auth/console-auth";

describe("console auth", () => {
  const previousEnv = { ...process.env };

  beforeEach(() => {
    process.env.CONSOLE_PASSWORD = "secret";
    process.env.CONSOLE_SESSION_TTL_DAYS = "1";
    process.env.CONSOLE_COOKIE_SECURE = "0";
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    process.env = { ...previousEnv };
  });

  it("signs and verifies console session tokens", async () => {
    const token = await signConsoleSession(1_000);

    await expect(verifyConsoleSession(token, 1_000)).resolves.toBe(true);
    await expect(verifyConsoleSession(token, 86_400_999)).resolves.toBe(true);
    await expect(verifyConsoleSession(token, 86_401_000)).resolves.toBe(false);
  });

  it("invalidates tokens when signature or password changes", async () => {
    const token = await signConsoleSession(1_000);
    const tampered = token.replace(/\.[^.]+$/, ".bad-signature");

    await expect(verifyConsoleSession(tampered, 1_000)).resolves.toBe(false);
    process.env.CONSOLE_PASSWORD = "changed";
    await expect(verifyConsoleSession(token, 1_000)).resolves.toBe(false);
  });

  it("does not bypass auth when local development password is missing", async () => {
    delete process.env.CONSOLE_PASSWORD;
    vi.stubEnv("NODE_ENV", "development");

    await expect(verifyConsoleSession(undefined, 1_000)).resolves.toBe(false);
  });

  it("validates configured password without exposing user concepts", () => {
    expect(verifyConsolePassword("secret")).toBe(true);
    expect(verifyConsolePassword("wrong")).toBe(false);
    expect(verifyConsolePassword(undefined)).toBe(false);
  });

  it("uses a safe default session ttl", () => {
    process.env.CONSOLE_SESSION_TTL_DAYS = "bad";
    expect(consoleSessionMaxAgeSeconds()).toBe(30 * 24 * 60 * 60);
  });

  it("classifies public and protected paths", () => {
    expect(isPublicAuthPath("/login")).toBe(true);
    expect(isPublicAuthPath("/api/auth/login")).toBe(true);
    expect(isPublicAuthPath("/api/health")).toBe(true);

    expect(isProtectedRequestPath("/")).toBe(true);
    expect(isProtectedRequestPath("/tasks?tab=downloads")).toBe(true);
    expect(isProtectedRequestPath("/api/status")).toBe(true);
    expect(isProtectedRequestPath("/api/events")).toBe(true);
    expect(isProtectedRequestPath("/api/health")).toBe(false);
    expect(isProtectedRequestPath("/_next/static/chunk.js")).toBe(false);
  });
});
