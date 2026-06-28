import { NextResponse } from "next/server";
import { loadAppConfig, saveAppConfig } from "@/config/load";
import { defaultYtdlpPath, downloadYtdlpBinary, ytdlpStatus } from "@/utils/ytdlp-binary";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const config = await loadAppConfig();
  const includeVersion = new URL(request.url).searchParams.get("version") === "1";
  return NextResponse.json(await ytdlpStatus(config.plugins.ytdlp.path, { includeVersion }));
}

export async function POST() {
  try {
    const config = await loadAppConfig();
    const targetPath = config.plugins.ytdlp.path || defaultYtdlpPath();
    const status = await downloadYtdlpBinary({ targetPath });
    const savedConfig = await saveAppConfig({
      ...config,
      plugins: {
        ...config.plugins,
        ytdlp: {
          ...config.plugins.ytdlp,
          path: status.path,
        },
      },
    });
    return NextResponse.json({
      ...status,
      configPath: savedConfig.plugins.ytdlp.path,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "yt-dlp download failed" },
      { status: 502 },
    );
  }
}
