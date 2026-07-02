import { NextResponse } from "next/server";
import { TelegramLoginError } from "@/engine/telegram-login-service";

export async function requestJson(request: Request) {
  return await request.json().catch(() => ({}));
}

export function telegramLoginJsonError(error: unknown) {
  if (error instanceof TelegramLoginError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Telegram 登录失败" },
    { status: 500 },
  );
}
