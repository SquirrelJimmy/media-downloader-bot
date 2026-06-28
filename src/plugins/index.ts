import { httpDirectPlugin } from "@/plugins/builtin/http-direct";
import { telegramPlugin } from "@/plugins/builtin/telegram";
import { telegramTextPlugin } from "@/plugins/builtin/telegram-text";
import { ytdlpPlugin } from "@/plugins/builtin/ytdlp";
import { pluginRegistry } from "@/plugins/registry";

let registered = false;

export function registerBuiltinPlugins() {
  if (registered) {
    return pluginRegistry;
  }
  pluginRegistry.register(telegramPlugin, telegramTextPlugin, ytdlpPlugin, httpDirectPlugin);
  registered = true;
  return pluginRegistry;
}

export { pluginRegistry };
