import { existsSync } from "node:fs";
import { loadDefaultMigrations, openDatabase } from "@dibao/db";
import { buildServer } from "./app.js";
import { DEFAULT_FOREGROUND_QUIET_WINDOW_MS } from "./foreground-activity.js";

await waitForCoreMigrationsReady();

const server = buildServer({
  backgroundJobs: true,
  recordForegroundActivity: false,
  webDistDir: false,
  feedRefreshIntervalMs: parseOptionalPositiveInteger(process.env.DIBAO_FEED_REFRESH_INTERVAL_MS),
  retentionCleanupIntervalMs: parseOptionalPositiveInteger(
    process.env.DIBAO_RETENTION_CLEANUP_INTERVAL_MS
  ),
  jobHistoryCleanupIntervalMs: parseOptionalPositiveInteger(
    process.env.DIBAO_JOB_HISTORY_CLEANUP_INTERVAL_MS
  ),
  jobHistoryRetentionDays: parseOptionalPositiveInteger(
    process.env.DIBAO_JOB_HISTORY_RETENTION_DAYS
  ),
  profileDecayIntervalMs: parseOptionalPositiveInteger(process.env.DIBAO_PROFILE_DECAY_INTERVAL_MS),
  recommendationMaintenanceIntervalMs: parseOptionalPositiveInteger(
    process.env.DIBAO_RECOMMENDATION_MAINTENANCE_INTERVAL_MS
  ),
  jobRunnerIntervalMs: parseOptionalPositiveInteger(process.env.DIBAO_JOB_RUNNER_INTERVAL_MS),
  jobRunnerMaxJobsPerDrain:
    parseOptionalPositiveInteger(process.env.DIBAO_JOB_RUNNER_MAX_JOBS_PER_DRAIN) ?? 5,
  foregroundQuietWindowMs:
    parseOptionalPositiveInteger(process.env.DIBAO_FOREGROUND_QUIET_WINDOW_MS) ??
    DEFAULT_FOREGROUND_QUIET_WINDOW_MS,
  rankingTargetChunkMs: parseOptionalPositiveInteger(process.env.DIBAO_RANKING_TARGET_CHUNK_MS)
});

let closing = false;
const keepAlive = setInterval(() => {
  // The background timers are unref'd so this keeps the worker process alive.
}, 60 * 60 * 1000);

try {
  await server.ready();
  server.log.info(
    {
      processRole: "worker",
      foregroundQuietWindowMs:
        parseOptionalPositiveInteger(process.env.DIBAO_FOREGROUND_QUIET_WINDOW_MS) ??
        DEFAULT_FOREGROUND_QUIET_WINDOW_MS
    },
    "background worker ready"
  );
} catch (error) {
  server.log.error(error);
  clearInterval(keepAlive);
  process.exit(1);
}

process.on("SIGTERM", () => {
  void closeAndExit(0);
});

process.on("SIGINT", () => {
  void closeAndExit(0);
});

async function closeAndExit(code: number): Promise<void> {
  if (closing) {
    return;
  }

  closing = true;
  clearInterval(keepAlive);
  try {
    await server.close();
  } catch (error) {
    server.log.error(error);
    process.exit(code === 0 ? 1 : code);
  }
  process.exit(code);
}

function parseOptionalPositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

async function waitForCoreMigrationsReady(): Promise<void> {
  const databasePath = process.env.DIBAO_DATABASE_PATH ?? "/data/dibao.sqlite";
  if (databasePath === ":memory:") {
    return;
  }

  const timeoutMs =
    parseOptionalPositiveInteger(process.env.DIBAO_WORKER_CORE_MIGRATION_WAIT_MS) ?? 10 * 60_000;
  const deadline = Date.now() + timeoutMs;
  const latestVersion = loadDefaultMigrations().at(-1)?.version ?? null;
  while (Date.now() < deadline) {
    if (latestVersion && coreMigrationVersionApplied(databasePath, latestVersion)) {
      return;
    }
    await delay(1_000);
  }

  console.warn("[dibao] worker starting before core migration wait observed latest schema");
}

function coreMigrationVersionApplied(databasePath: string, version: string): boolean {
  if (!existsSync(databasePath)) {
    return false;
  }

  let db: ReturnType<typeof openDatabase> | null = null;
  try {
    db = openDatabase(databasePath, {
      loadSqliteVec: false,
      migrate: false
    });
    const table = db
      .prepare(
        `
          select 1 as ok
          from sqlite_master
          where type = 'table'
            and name = 'schema_migrations'
        `
      )
      .get() as { ok: number } | undefined;
    if (!table) {
      return false;
    }

    const row = db
      .prepare("select 1 as ok from schema_migrations where version = ?")
      .get(version) as { ok: number } | undefined;
    return !!row;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
