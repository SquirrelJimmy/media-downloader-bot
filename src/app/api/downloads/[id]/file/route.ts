import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { libsqlClient } from "@/db/client";

export const runtime = "nodejs";

type FileRow = {
  save_path?: unknown;
  file_name?: unknown;
  status?: unknown;
};

const contentTypes: Record<string, string> = {
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".pdf": "application/pdf",
};

function contentTypeFor(filePath: string) {
  return contentTypes[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function contentDispositionName(fileName: string) {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\r\n]/g, "_");
  return `inline; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function parseRange(rangeHeader: string | null, size: number) {
  if (!rangeHeader) {
    return undefined;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) {
    return null;
  }

  const [, startText, endText] = match;
  if (!startText && !endText) {
    return null;
  }

  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return null;
    }
    const start = Math.max(size - suffixLength, 0);
    return { start, end: Math.max(size - 1, 0) };
  }

  const start = Number(startText);
  const end = endText ? Number(endText) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return null;
  }
  return { start, end: Math.min(end, size - 1) };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isSafeInteger(numericId) || numericId <= 0) {
    return NextResponse.json({ error: "download record not found" }, { status: 404 });
  }

  const result = await libsqlClient.execute({
    sql: `
      SELECT save_path, file_name, status
      FROM downloads
      WHERE id = ?
      LIMIT 1
    `,
    args: [numericId],
  });
  const row = result.rows.at(0) as FileRow | undefined;
  const savePath = typeof row?.save_path === "string" ? row.save_path : "";
  if (!row || row.status !== "success" || !savePath) {
    return NextResponse.json({ error: "download file not found" }, { status: 404 });
  }

  const info = await stat(savePath).catch(() => null);
  if (!info?.isFile()) {
    return NextResponse.json({ error: "download file not found" }, { status: 404 });
  }

  const fileName = typeof row.file_name === "string" && row.file_name ? row.file_name : basename(savePath);
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Content-Type": contentTypeFor(savePath),
    "Content-Disposition": contentDispositionName(fileName),
  });

  const range = parseRange(request.headers.get("range"), info.size);
  if (range === null) {
    return new Response(null, {
      status: 416,
      headers: {
        "Content-Range": `bytes */${info.size}`,
      },
    });
  }

  if (range) {
    const contentLength = range.end - range.start + 1;
    headers.set("Content-Length", String(contentLength));
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${info.size}`);
    return new Response(Readable.toWeb(createReadStream(savePath, range)) as ReadableStream, {
      status: 206,
      headers,
    });
  }

  headers.set("Content-Length", String(info.size));
  return new Response(Readable.toWeb(createReadStream(savePath)) as ReadableStream, {
    headers,
  });
}
