import { NextResponse } from "next/server";
import { cancelTelegramLogin } from "@/engine/telegram-login-service";
import { requestJson, telegramLoginJsonError } from "../route-utils";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await requestJson(request);
    const cancelled = await cancelTelegramLogin(typeof body.loginId === "string" ? body.loginId : undefined);
    return NextResponse.json({ cancelled });
  } catch (error) {
    return telegramLoginJsonError(error);
  }
}
