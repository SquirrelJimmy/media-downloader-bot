export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") {
    return;
  }

  const { startServerRuntime } = await import("@/engine/server-bootstrap");
  await startServerRuntime().catch(async (error) => {
    const { logger } = await import("@/utils/logger");
    logger.error({ error }, "server runtime instrumentation start failed");
  });
}
