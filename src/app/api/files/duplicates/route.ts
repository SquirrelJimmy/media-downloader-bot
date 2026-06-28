import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/client";

export const runtime = "nodejs";

export async function GET() {
  const data = await db.all(sql`
    SELECT file_sha256 AS sha256, COUNT(*) AS refCount, MAX(file_size) AS fileSize
    FROM downloads
    WHERE file_sha256 IS NOT NULL
    GROUP BY file_sha256
    HAVING refCount > 1
    ORDER BY refCount DESC
  `);
  return NextResponse.json({ data });
}
