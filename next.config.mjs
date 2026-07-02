import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const runtimeDataExcludes = [
  "./config/app.yaml",
  "./config/*.local.yaml",
  "./config/*.local.yml",
  "./data/**/*",
  "./downloads/**/*",
  "./log/**/*",
  "./storage/**/*",
  "./telegram_media_downloader/**/*",
];

const nextConfig = {
  output: "standalone",
  outputFileTracingExcludes: {
    "/*": runtimeDataExcludes,
    "/api/**/*": runtimeDataExcludes,
    "/_not-found": runtimeDataExcludes,
  },
  reactStrictMode: true,
  typedRoutes: true,
  serverExternalPackages: ["@mtcute/node", "@mtcute/core"],
  turbopack: {
    root: __dirname,
  },
  allowedDevOrigins: ["*"],
};

export default nextConfig;
