import { NextResponse } from "next/server";
import { verifyTelegramLoginCode } from "@/engine/telegram-login-service";
import { requestJson, telegramLoginJsonError } from "../route-utils";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await requestJson(request);
    const result = await verifyTelegramLoginCode({
      loginId: typeof body.loginId === "string" ? body.loginId : undefined,
      code: typeof body.code === "string" ? body.code : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return telegramLoginJsonError(error);
  }
}
