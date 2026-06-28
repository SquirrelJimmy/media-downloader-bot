import { NextResponse } from "next/server";
import { loadAppConfig, saveAppConfig } from "@/config/load";
import { parseAppConfig } from "@/config/schema";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await loadAppConfig());
}

export async function PUT(request: Request) {
  const body = await request.json();
  const config = parseAppConfig(body);
  return NextResponse.json(await saveAppConfig(config));
}
