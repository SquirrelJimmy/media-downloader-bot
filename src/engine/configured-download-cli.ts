import { runConfiguredDownloads } from "@/engine/config-driven-download";
import { logger } from "@/utils/logger";

function readArgs(argv: string[]) {
  const chatIds: Array<string | number> = [];
  let limit: number | undefined;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--limit") {
      const value = Number(argv[index + 1]);
      if (Number.isFinite(value) && value > 0) {
        limit = value;
      }
      index += 1;
    } else if (arg === "--chat") {
      const value = argv[index + 1];
      if (value) {
        chatIds.push(value);
      }
      index += 1;
    }
  }

  return {
    chatIds: chatIds.length > 0 ? chatIds : undefined,
    limit,
    dryRun,
  };
}

const options = readArgs(process.argv.slice(2));

runConfiguredDownloads(options)
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    logger.error({ error }, "configured download run failed");
    process.exitCode = 1;
  });
