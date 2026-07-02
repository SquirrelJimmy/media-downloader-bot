import { NextResponse } from "next/server";
import { loadAppConfig } from "@/config/load";
import { startTelegramLogin } from "@/engine/telegram-login-service";
import { requestJson, telegramLoginJsonError } from "../route-utils";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await requestJson(request);
    const config = await loadAppConfig();
    const result = await startTelegramLogin(config, {
      phone: typeof body.phone === "string" ? body.phone : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return telegramLoginJsonError(error);
  }
}
