import { buildServer } from "./app.js";

const host = process.env.DIBAO_HOST ?? "0.0.0.0";
const port = Number(process.env.DIBAO_PORT ?? 8080);

const server = buildServer({
  backgroundJobs: process.env.DIBAO_BACKGROUND_JOBS !== "false",
  feedRefreshIntervalMs: parseOptionalPositiveInteger(process.env.DIBAO_FEED_REFRESH_INTERVAL_MS),
  retentionCleanupIntervalMs: parseOptionalPositiveInteger(
    process.env.DIBAO_RETENTION_CLEANUP_INTERVAL_MS
  ),
  profileDecayIntervalMs: parseOptionalPositiveInteger(process.env.DIBAO_PROFILE_DECAY_INTERVAL_MS),
  jobRunnerIntervalMs: parseOptionalPositiveInteger(process.env.DIBAO_JOB_RUNNER_INTERVAL_MS)
});

try {
  await server.listen({ host, port });
} catch (error) {
  server.log.error(error);
  process.exit(1);
}

function parseOptionalPositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}
