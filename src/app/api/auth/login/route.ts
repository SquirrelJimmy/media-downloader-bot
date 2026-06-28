import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  consoleCookieOptions,
  consoleSessionCookieName,
  isConsoleAuthConfigured,
  signConsoleSession,
  verifyConsolePassword,
} from "@/auth/console-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isConsoleAuthConfigured()) {
    return NextResponse.json({ error: "CONSOLE_PASSWORD is not configured" }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  if (!verifyConsolePassword((body as { password?: unknown }).password)) {
    return NextResponse.json({ error: "密码错误" }, { status: 401 });
  }

  const token = await signConsoleSession();
  const cookieStore = await cookies();
  cookieStore.set(consoleSessionCookieName, token, consoleCookieOptions());
  return NextResponse.json({ ok: true, configured: true, disabled: false });
}
