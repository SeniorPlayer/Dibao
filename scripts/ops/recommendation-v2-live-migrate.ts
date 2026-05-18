import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { openDatabase, runMigrations } from "@dibao/db";

const dbPath = process.env.DIBAO_DATABASE_PATH;

if (!dbPath) {
  fail("DIBAO_DATABASE_PATH is required.");
}

if (process.env.DIBAO_ALLOW_LIVE_MIGRATION !== "1") {
  fail("Refusing live migration without DIBAO_ALLOW_LIVE_MIGRATION=1.");
}

if (process.env.DIBAO_DB_BACKUP_CONFIRMED !== "1") {
  fail("Refusing live migration without DIBAO_DB_BACKUP_CONFIRMED=1.");
}

const resolvedDbPath = resolve(dbPath);
if (!existsSync(resolvedDbPath)) {
  fail(`Database does not exist: ${resolvedDbPath}`);
}

const backupPath = `${resolvedDbPath}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
mkdirSync(dirname(backupPath), { recursive: true });
copyFileSync(resolvedDbPath, backupPath);

const preSha = sha256File(backupPath);
const preSize = statSync(backupPath).size;
const db = openDatabase(resolvedDbPath, { loadSqliteVec: false });

try {
  const preCounts = tableCounts(db);
  const activeIndex = db
    .prepare("select id from embedding_indexes where status = 'active' order by updated_at desc limit 1")
    .get() as { id: string } | undefined;
  const appliedNow = runMigrations(db);
  const migrations = db
    .prepare("select version, name from schema_migrations order by version")
    .all() as Array<{ version: string; name: string }>;
  const postCounts = tableCounts(db);
  const hasRankContexts = hasTable(db, "rank_contexts");
  const legacyRankReadable = countTable(db, "article_rank_scores") >= 0;

  const report = {
    backup: {
      path: backupPath,
      size: preSize,
      sha256: preSha
    },
    app: {
      gitSha: process.env.DIBAO_GIT_SHA ?? null,
      version: process.env.npm_package_version ?? null
    },
    preMigration: {
      counts: preCounts,
      activeEmbeddingIndexId: activeIndex?.id ?? null
    },
    migrations,
    appliedNow,
    postMigration: {
      counts: postCounts,
      newTablesExist: hasRankContexts,
      legacyRankContextReadable: legacyRankReadable,
      embeddingCountUnchanged:
        preCounts.article_embeddings === postCounts.article_embeddings,
      articleCountUnchanged: preCounts.articles === postCounts.articles,
      feedCountUnchanged: preCounts.feeds === postCounts.feeds,
      behaviorEventCountUnchanged:
        preCounts.behavior_events === postCounts.behavior_events
    }
  };

  console.log(JSON.stringify(report, null, 2));
} finally {
  db.close();
}

function tableCounts(db: ReturnType<typeof openDatabase>) {
  return {
    feeds: countTable(db, "feeds"),
    articles: countTable(db, "articles"),
    behavior_events: countTable(db, "behavior_events"),
    article_states: countTable(db, "article_states"),
    article_embeddings: countTable(db, "article_embeddings"),
    interest_clusters: countTable(db, "interest_clusters"),
    feed_stats: countTable(db, "feed_stats"),
    article_rank_scores: countTable(db, "article_rank_scores")
  };
}

function countTable(db: ReturnType<typeof openDatabase>, table: string): number {
  if (!hasTable(db, table)) {
    return 0;
  }
  const row = db.prepare(`select count(*) as count from ${table}`).get() as { count: number };
  return row.count;
}

function hasTable(db: ReturnType<typeof openDatabase>, table: string): boolean {
  const row = db
    .prepare("select 1 as ok from sqlite_master where type in ('table', 'view') and name = ?")
    .get(table) as { ok: number } | undefined;
  return row !== undefined;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
