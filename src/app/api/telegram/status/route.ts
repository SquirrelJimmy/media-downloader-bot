import { NextResponse } from "next/server";
import { loadAppConfig } from "@/config/load";
import { getUserClientStatus } from "@/engine/user-client";

export const runtime = "nodejs";

export async function GET() {
  const config = await loadAppConfig();
  return NextResponse.json(await getUserClientStatus(config));
}
