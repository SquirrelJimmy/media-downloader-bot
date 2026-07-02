import { NextResponse } from "next/server";
import { verifyTelegramLoginPassword } from "@/engine/telegram-login-service";
import { requestJson, telegramLoginJsonError } from "../route-utils";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await requestJson(request);
    const result = await verifyTelegramLoginPassword({
      loginId: typeof body.loginId === "string" ? body.loginId : undefined,
      password: typeof body.password === "string" ? body.password : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return telegramLoginJsonError(error);
  }
}
