import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  serverExternalPackages: ["@mtcute/node", "@mtcute/core", "better-sqlite3"],
  turbopack: {
    root: __dirname,
  },
  allowedDevOrigins: ["*"],
};

export default nextConfig;
