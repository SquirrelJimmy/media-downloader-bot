import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  consoleSessionCookieName,
  isConsoleAuthConfigured,
  verifyConsoleSession,
} from "@/auth/console-auth";

export const runtime = "nodejs";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(consoleSessionCookieName)?.value;
  return NextResponse.json({
    authenticated: await verifyConsoleSession(token),
    configured: isConsoleAuthConfigured(),
    disabled: false,
  });
}
