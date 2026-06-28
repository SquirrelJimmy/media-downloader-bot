export const consoleSessionCookieName = "console_session";

const defaultSessionTtlDays = 30;
const encoder = new TextEncoder();

function consolePassword() {
  return process.env.CONSOLE_PASSWORD?.trim() ?? "";
}

export function isConsoleAuthConfigured() {
  return consolePassword().length > 0;
}

export function consoleSessionMaxAgeSeconds() {
  const days = Number(process.env.CONSOLE_SESSION_TTL_DAYS ?? defaultSessionTtlDays);
  const safeDays = Number.isFinite(days) && days > 0 ? days : defaultSessionTtlDays;
  return Math.floor(safeDays * 24 * 60 * 60);
}

export function consoleCookieSecure() {
  return process.env.CONSOLE_COOKIE_SECURE === "1";
}

export function consoleCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: consoleCookieSecure(),
    path: "/",
    maxAge: consoleSessionMaxAgeSeconds(),
  };
}

function hex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return hex(signature);
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

export function verifyConsolePassword(input: unknown) {
  const password = consolePassword();
  if (!password || typeof input !== "string") {
    return false;
  }
  return constantTimeEqual(input, password);
}

function sessionSignaturePayload(expiresAt: number) {
  return `console_session:${expiresAt}`;
}

export async function signConsoleSession(now = Date.now()) {
  const password = consolePassword();
  if (!password) {
    throw new Error("CONSOLE_PASSWORD is not configured");
  }
  const expiresAt = now + consoleSessionMaxAgeSeconds() * 1000;
  const signature = await hmacSha256(password, sessionSignaturePayload(expiresAt));
  return `${expiresAt}.${signature}`;
}

export async function verifyConsoleSession(token: string | undefined | null, now = Date.now()) {
  const password = consolePassword();
  if (!password || !token) {
    return false;
  }
  const [expiresAtText, signature] = token.split(".");
  if (!expiresAtText || !signature) {
    return false;
  }
  const expiresAt = Number(expiresAtText);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) {
    return false;
  }
  const expected = await hmacSha256(password, sessionSignaturePayload(expiresAt));
  return constantTimeEqual(signature, expected);
}

export function isPublicAuthPath(pathname: string) {
  return pathname === "/login" || pathname.startsWith("/api/auth/") || pathname === "/api/health";
}

export function isStaticAssetPath(pathname: string) {
  return (
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname.startsWith("/assets/")
  );
}

export function isApiPath(pathname: string) {
  return pathname.startsWith("/api/");
}

export function isProtectedConsolePath(pathname: string) {
  return (
    pathname === "/" ||
    pathname.startsWith("/tasks") ||
    pathname.startsWith("/plugins") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/downloads") ||
    pathname.startsWith("/files")
  );
}

export function isProtectedRequestPath(pathname: string) {
  if (isStaticAssetPath(pathname) || isPublicAuthPath(pathname)) {
    return false;
  }
  return isApiPath(pathname) || isProtectedConsolePath(pathname);
}
