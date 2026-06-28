import { unlink } from "node:fs/promises";
import { NextResponse } from "next/server";
import { libsqlClient } from "@/db/client";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { deleteFiles?: boolean };
  const duplicates = await libsqlClient.execute(`
    SELECT id, save_path
    FROM (
      SELECT
        id,
        save_path,
        ROW_NUMBER() OVER (PARTITION BY file_sha256 ORDER BY id ASC) AS rn
      FROM downloads
      WHERE file_sha256 IS NOT NULL AND file_sha256 != ''
    )
    WHERE rn > 1
  `);

  if (!body.deleteFiles) {
    return NextResponse.json({
      candidates: duplicates.rows.length,
      deleted: 0,
      dryRun: true,
    });
  }

  let deletedFiles = 0;
  for (const row of duplicates.rows) {
    const savePath = typeof row.save_path === "string" ? row.save_path : "";
    if (savePath) {
      await unlink(savePath)
        .then(() => {
          deletedFiles += 1;
        })
        .catch(() => undefined);
    }
  }

  const ids = duplicates.rows.map((row) => Number(row.id)).filter(Number.isFinite);
  if (ids.length > 0) {
    await libsqlClient.execute({
      sql: `DELETE FROM downloads WHERE id IN (${ids.map(() => "?").join(",")})`,
      args: ids,
    });
  }

  return NextResponse.json({
    candidates: duplicates.rows.length,
    deleted: ids.length,
    deletedFiles,
    dryRun: false,
  });
}
