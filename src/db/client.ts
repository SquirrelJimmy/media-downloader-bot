import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@/db/schema";

export const databaseUrl = process.env.DATABASE_URL ?? "file:data/app.db";

function runtimeFilePath(path: string) {
  return isAbsolute(path) ? path : join(/*turbopackIgnore: true*/ process.cwd(), path);
}

if (databaseUrl.startsWith("file:")) {
  const filePath = databaseUrl.slice("file:".length);
  mkdirSync(dirname(runtimeFilePath(filePath)), { recursive: true });
}

export const libsqlClient = createClient({
  url: databaseUrl,
});

export const db = drizzle(libsqlClient, { schema });
