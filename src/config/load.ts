import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import * as yaml from "js-yaml";
import { parseAppConfig, type AppConfig } from "@/config/schema";

const defaultConfigPath = process.env.APP_CONFIG_PATH ?? "config/app.yaml";

function mergeConfig(base: unknown, override: unknown): unknown {
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    return override ?? base;
  }
  if (!base || typeof base !== "object" || Array.isArray(base)) {
    return override;
  }
  return Object.fromEntries(
    Array.from(new Set([...Object.keys(base), ...Object.keys(override)])).map((key) => [
      key,
      mergeConfig(
        (base as Record<string, unknown>)[key],
        (override as Record<string, unknown>)[key],
      ),
    ]),
  );
}

export async function loadAppConfig(configPath = defaultConfigPath): Promise<AppConfig> {
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = yaml.load(raw) ?? {};
    return parseAppConfig(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return parseAppConfig({});
    }
    throw error;
  }
}

export async function saveAppConfig(config: AppConfig, configPath = defaultConfigPath) {
  await mkdir(dirname(configPath), { recursive: true });
  const normalized = parseAppConfig(mergeConfig({}, config));
  await writeFile(configPath, yaml.dump(normalized, { lineWidth: 120 }), "utf8");
  return normalized;
}
