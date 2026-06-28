import { loadAppConfig } from "@/config/load";
import { startInteractiveUserClient } from "@/engine/user-client";

const config = await loadAppConfig();

await startInteractiveUserClient(config).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
