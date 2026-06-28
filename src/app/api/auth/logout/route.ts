import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { consoleCookieOptions, consoleSessionCookieName } from "@/auth/console-auth";

export const runtime = "nodejs";

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.set(consoleSessionCookieName, "", {
    ...consoleCookieOptions(),
    maxAge: 0,
  });
  return NextResponse.json({ ok: true });
}
