import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@/db/schema";

export const databaseUrl = process.env.DATABASE_URL ?? "file:data/app.db";

if (databaseUrl.startsWith("file:")) {
  const filePath = databaseUrl.slice("file:".length);
  mkdirSync(dirname(filePath), { recursive: true });
}

export const libsqlClient = createClient({
  url: databaseUrl,
});

export const db = drizzle(libsqlClient, { schema });
