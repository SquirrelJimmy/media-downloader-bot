import { NextResponse } from "next/server";
import { getDownloadStats } from "@/db/queries";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await getDownloadStats());
}
