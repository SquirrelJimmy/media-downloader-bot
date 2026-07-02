import type { AppConfig } from "@/config/schema";
import type { DownloadPlugin, DownloadRequest, DownloadResult, PluginContext } from "@/plugins/types";
import { logger } from "@/utils/logger";

function configuredPriority(plugin: DownloadPlugin, config?: AppConfig) {
  if (!config) {
    return plugin.priority;
  }
  switch (plugin.name) {
    case "telegram-text":
      return config.plugins.telegram_text.priority;
    case "ytdlp":
      return config.plugins.ytdlp.priority;
    case "http-direct":
      return config.plugins.http.priority;
    default:
      return plugin.priority;
  }
}

export class PluginRegistry {
  private plugins: DownloadPlugin[] = [];

  register(...plugins: DownloadPlugin[]) {
    this.plugins.push(...plugins);
    this.plugins.sort((a, b) => a.priority - b.priority);
  }

  private sortedPlugins(config?: AppConfig) {
    return [...this.plugins].sort((a, b) => configuredPriority(a, config) - configuredPriority(b, config));
  }

  list(config?: AppConfig) {
    return this.sortedPlugins(config).map((plugin) => ({
      name: plugin.name,
      priority: configuredPriority(plugin, config),
    }));
  }

  async download(req: DownloadRequest, ctx: PluginContext): Promise<DownloadResult> {
    for (const plugin of this.sortedPlugins(ctx.config)) {
      try {
        if (await plugin.canHandle(req, ctx)) {
          const result = await plugin.download(req, ctx);
          if (result.status !== "skip") {
            return { ...result, pluginName: plugin.name };
          }
        }
      } catch (error) {
        logger.error({ error, plugin: plugin.name }, "download plugin failed");
        return {
          status: "failed",
          error: error instanceof Error ? error : new Error(String(error)),
          pluginName: plugin.name,
        };
      }
    }
    return { status: "skip" };
  }
}

export const pluginRegistry = new PluginRegistry();
