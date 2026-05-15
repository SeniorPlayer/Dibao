import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SqliteArticleFtsIndex,
  SqliteArticleActionRepository,
  SqliteArticleRepository,
  SqliteAppSettingsRepository,
  SqliteAuthCredentialRepository,
  SqliteEmbeddingRepository,
  SqliteFeedRepository,
  SqliteJobRepository,
  SqliteProfileRepository,
  SqliteRankingRepository,
  SqliteSessionRepository,
  SqliteVecVectorStore,
  checksumSql,
  float32VectorToBuffer,
  fromVectorBlob,
  getAppliedMigrations,
  getSqliteVecVersion,
  openDatabase,
  runMigrations,
  vectorToJson
} from "./index.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("db package", () => {
  it("loads sqlite-vec and exposes vec_version", () => {
    const db = openDatabase();
    try {
      const result = getSqliteVecVersion(db);
      expect(result.version).toMatch(/^v\d+\./);
    } finally {
      db.close();
    }
  });

  it("serializes vectors for blob and sqlite-vec json inputs", () => {
    expect(float32VectorToBuffer([1, 0, 0, 0])).toBeInstanceOf(Buffer);
    expect(vectorToJson([1, 0, 0, 0])).toBe("[1,0,0,0]");
  });

  it("runs migrations once and records checksums", () => {
    const db = openDatabase(":memory:", { loadSqliteVec: false });
    try {
      const migrations = [
        {
          version: "001",
          name: "test",
          sql: "create table example (id text primary key);"
        }
      ];

      expect(runMigrations(db, migrations, () => 1000)).toHaveLength(1);
      expect(runMigrations(db, migrations, () => 2000)).toHaveLength(0);
      expect(getAppliedMigrations(db)).toEqual([
        {
          version: "001",
          name: "test",
          appliedAt: 1000,
          checksum: checksumSql(migrations[0].sql)
        }
      ]);
    } finally {
      db.close();
    }
  });

  it("rejects changed migrations after they have been applied", () => {
    const db = openDatabase(":memory:", { loadSqliteVec: false });
    try {
      runMigrations(db, [
        {
          version: "001",
          name: "test",
          sql: "create table example (id text primary key);"
        }
      ]);

      expect(() =>
        runMigrations(db, [
          {
            version: "001",
            name: "test",
            sql: "create table example_changed (id text primary key);"
          }
        ])
      ).toThrow("Migration 001 has changed");
    } finally {
      db.close();
    }
  });

  it("applies the default schema to an empty database idempotently", () => {
    const db = openDatabase(tempDatabasePath(), { migrate: true });
    try {
      expect(runMigrations(db)).toHaveLength(0);

      expect(getSqliteVecVersion(db).version).toMatch(/^v\d+\./);
      expect(
        db.prepare("select sqlite_compileoption_used('ENABLE_FTS5') as enabled").get()
      ).toEqual({ enabled: 1 });

      for (const name of [
        "schema_migrations",
        "app_settings",
        "auth_credentials",
        "sessions",
        "feed_folders",
        "feeds",
        "articles",
        "article_contents",
        "article_states",
        "behavior_events",
        "embedding_providers",
        "embedding_indexes",
        "article_embeddings",
        "article_vector_rows",
        "interest_clusters",
        "feed_stats",
        "article_rank_scores",
        "article_rank_explanations",
        "jobs"
      ]) {
        expect(hasTableOrView(db, name), name).toBe(true);
      }

      expect(hasFtsTable(db, "article_fts")).toBe(true);
    } finally {
      db.close();
    }
  });

  it("claims jobs with attempts and moves failures through retry boundaries", () => {
    const db = openDatabase(tempDatabasePath(), { migrate: true });
    try {
      const jobs = new SqliteJobRepository(db);
      const job = jobs.enqueue({
        id: "job_feed_refresh",
        type: "feed_refresh",
        payloadJson: JSON.stringify({ feedId: "feed_1" }),
        maxAttempts: 2,
        runAfter: 1000,
        now: 900
      });

      expect(job.status).toBe("queued");
      expect(job.attempts).toBe(0);
      expect(jobs.claimNextDue(999)).toBeNull();

      const firstClaim = jobs.claimNextDue(1000);
      expect(firstClaim).toMatchObject({
        id: "job_feed_refresh",
        status: "running",
        attempts: 1,
        startedAt: 1000
      });

      const retry = jobs.markFailedOrRetry("job_feed_refresh", "temporary", 1100, 5000);
      expect(retry).toMatchObject({
        status: "queued",
        attempts: 1,
        error: "temporary",
        runAfter: 6100,
        startedAt: null,
        finishedAt: null
      });
      expect(jobs.claimNextDue(6099)).toBeNull();

      expect(jobs.claimNextDue(6100)).toMatchObject({
        attempts: 2,
        status: "running"
      });
      const failed = jobs.markFailedOrRetry("job_feed_refresh", "permanent", 6200, 5000);
      expect(failed).toMatchObject({
        status: "failed",
        attempts: 2,
        error: "permanent",
        finishedAt: 6200
      });
    } finally {
      db.close();
    }
  });

  it("resets stale running jobs on runner startup", () => {
    const db = openDatabase(tempDatabasePath(), { migrate: true });
    try {
      const jobs = new SqliteJobRepository(db);
      jobs.enqueue({
        id: "job_retryable",
        type: "feed_refresh",
        payloadJson: JSON.stringify({ feedId: "feed_1" }),
        maxAttempts: 2,
        runAfter: 1000,
        now: 1000
      });
      jobs.enqueue({
        id: "job_exhausted",
        type: "feed_refresh",
        payloadJson: JSON.stringify({ feedId: "feed_2" }),
        maxAttempts: 1,
        runAfter: 1000,
        now: 1000
      });

      jobs.claimNextDue(1100);
      jobs.claimNextDue(1200);

      expect(jobs.resetStaleRunning(2000)).toBe(2);
      expect(jobs.findById("job_retryable")).toMatchObject({
        status: "queued",
        attempts: 1,
        runAfter: 2000,
        startedAt: null,
        finishedAt: null
      });
      expect(jobs.findById("job_exhausted")).toMatchObject({
        status: "failed",
        attempts: 1,
        finishedAt: 2000
      });
    } finally {
      db.close();
    }
  });

  it("cleans retention candidates without losing behavior state or saved articles", () => {
    const db = openDatabase(tempDatabasePath(), { migrate: true });
    try {
      const feeds = new SqliteFeedRepository(db);
      const articles = new SqliteArticleRepository(db);
      const actions = new SqliteArticleActionRepository(db);
      const embeddings = new SqliteEmbeddingRepository(db);
      const vectorStore = new SqliteVecVectorStore(db);
      const fts = new SqliteArticleFtsIndex(db);
      const now = Date.parse("2026-05-15T00:00:00.000Z");
      const cutoff = now - 60 * 24 * 60 * 60 * 1000;

      feeds.upsert({
        id: "feed_retention",
        title: "Retention Feed",
        feedUrl: "https://example.com/retention.xml",
        now
      });
      for (const article of [
        {
          id: "article_old_published",
          publishedAt: cutoff - 1000,
          discoveredAt: cutoff + 1000,
          title: "Old published cleanupvanish"
        },
        {
          id: "article_old_discovered",
          publishedAt: null,
          discoveredAt: cutoff - 2000,
          title: "Old discovered cleanupvanish"
        },
        {
          id: "article_favorite_old",
          publishedAt: cutoff - 3000,
          discoveredAt: cutoff - 3000,
          title: "Old favorite protected"
        },
        {
          id: "article_read_later_old",
          publishedAt: cutoff - 4000,
          discoveredAt: cutoff - 4000,
          title: "Old later protected"
        },
        {
          id: "article_recent",
          publishedAt: cutoff + 1000,
          discoveredAt: cutoff + 1000,
          title: "Recent active"
        }
      ]) {
        articles.upsert({
          id: article.id,
          feedId: "feed_retention",
          url: `https://example.com/${article.id}`,
          canonicalUrl: `https://example.com/${article.id}`,
          title: article.title,
          summary: "Retention fixture.",
          publishedAt: article.publishedAt,
          discoveredAt: article.discoveredAt,
          dedupeKey: article.id,
          now: article.discoveredAt
        });
        articles.upsertContent({
          articleId: article.id,
          contentText: `${article.title} body`,
          extractionStatus: "success",
          extractedAt: article.discoveredAt,
          now: article.discoveredAt
        });
      }

      expect(
        actions.record({
          articleId: "article_old_published",
          type: "open",
          eventId: "event_old_open",
          now
        })
      ).not.toBeNull();
      expect(
        actions.record({
          articleId: "article_favorite_old",
          type: "favorite",
          eventId: "event_favorite",
          now
        })
      ).not.toBeNull();
      expect(
        actions.record({
          articleId: "article_read_later_old",
          type: "read_later",
          eventId: "event_later",
          now
        })
      ).not.toBeNull();

      insertRank(db, "article_old_published", 0.5, now);
      embeddings.upsertProvider({
        id: "provider_retention",
        type: "embedded_local",
        name: "Retention Fixture",
        model: "fixture-4d",
        dimension: 4,
        enabled: true,
        now
      });
      for (const index of ["index_retention_one", "index_retention_two"]) {
        embeddings.createIndex({
          id: index,
          providerId: "provider_retention",
          model: "fixture-4d",
          dimension: 4,
          now
        });
        vectorStore.upsertArticleVector({
          articleId: "article_old_published",
          embeddingIndexId: index,
          vector: [0.9, 0.1, 0.05, 0.02],
          contentHash: `hash_${index}`,
          now
        });
      }

      const candidates = articles.listRetentionCandidates({ cutoff, limit: 10 });
      expect(candidates.map((candidate) => candidate.articleId)).toEqual([
        "article_old_discovered",
        "article_old_published"
      ]);

      const vectorRowsDeleted = candidates.reduce(
        (count, candidate) => count + vectorStore.deleteArticleVectors(candidate.articleId),
        0
      );
      const cleanup = articles.cleanupForRetention(
        candidates.map((candidate) => candidate.articleId),
        now
      );

      expect(vectorRowsDeleted).toBe(2);
      expect(cleanup).toMatchObject({
        articlesSoftDeleted: 2,
        contentsDeleted: 2,
        ftsRowsDeleted: 2,
        rankScoresDeleted: 1
      });
      expect(articles.findById("article_old_published")).toMatchObject({
        status: "deleted",
        deletedAt: now
      });
      expect(articles.list({ feedId: "feed_retention" }).items.map((article) => article.id)).toEqual([
        "article_recent",
        "article_favorite_old",
        "article_read_later_old"
      ]);
      expect(articles.findDetailById("article_old_published")).toBeNull();
      expect(fts.search("cleanupvanish", 10)).toHaveLength(0);
      expect(
        db.prepare("select count(*) as count from article_contents where article_id = ?").get(
          "article_old_published"
        )
      ).toEqual({ count: 0 });
      expect(
        db.prepare("select count(*) as count from article_embeddings where article_id = ?").get(
          "article_old_published"
        )
      ).toEqual({ count: 0 });
      expect(
        db.prepare("select count(*) as count from article_vector_rows where article_id = ?").get(
          "article_old_published"
        )
      ).toEqual({ count: 0 });
      expect(
        db.prepare("select count(*) as count from behavior_events where article_id = ?").get(
          "article_old_published"
        )
      ).toEqual({ count: 1 });
      expect(
        db.prepare("select count(*) as count from article_states where article_id = ?").get(
          "article_old_published"
        )
      ).toEqual({ count: 1 });

      const upserted = articles.upsert({
        id: "article_old_published",
        feedId: "feed_retention",
        url: "https://example.com/article_old_published",
        canonicalUrl: "https://example.com/article_old_published",
        title: "Old published returned",
        summary: "Returned by feed.",
        publishedAt: now,
        discoveredAt: now,
        dedupeKey: "article_old_published",
        status: "active",
        now: now + 1000
      });
      expect(upserted).toMatchObject({
        status: "deleted",
        deletedAt: now
      });
    } finally {
      db.close();
    }
  });

  it("initializes schema, repositories, FTS5, and sqlite-vec vector rebuild flow", () => {
    const db = openDatabase(tempDatabasePath(), { migrate: true });
    try {
      const settings = new SqliteAppSettingsRepository(db);
      settings.setJson("setup.completed", false, 1000);
      expect(settings.getJson("setup.completed")).toBe(false);

      const feeds = new SqliteFeedRepository(db);
      feeds.upsert({
        id: "feed_1",
        title: "Dibao Lab",
        feedUrl: "https://example.com/feed.xml",
        siteUrl: "https://example.com",
        now: 1000
      });

      const articles = new SqliteArticleRepository(db);
      articles.upsert({
        id: "article_ai_local",
        feedId: "feed_1",
        url: "https://example.com/local-embedding",
        canonicalUrl: "https://example.com/local-embedding",
        title: "Local embedding for personal RSS ranking",
        summary: "Using local vectors for a private recommender.",
        dedupeKey: "local-embedding",
        now: 1000
      });
      articles.upsertContent({
        articleId: "article_ai_local",
        contentText: "RSS personalization with local embeddings and transparent ranking.",
        extractionStatus: "success",
        extractedAt: 1000,
        now: 1000
      });

      articles.upsert({
        id: "article_design",
        feedId: "feed_1",
        url: "https://example.com/design",
        canonicalUrl: "https://example.com/design",
        title: "Japanese editorial layout systems",
        summary: "Typography and quiet interface density.",
        dedupeKey: "design",
        now: 1000
      });
      articles.upsertContent({
        articleId: "article_design",
        contentText: "Editorial design, spacing, type and reading rhythm.",
        extractionStatus: "success",
        extractedAt: 1000,
        now: 1000
      });

      const fts = new SqliteArticleFtsIndex(db);
      expect(fts.search("embedding", 5)[0]?.articleId).toBe("article_ai_local");

      const embeddings = new SqliteEmbeddingRepository(db);
      embeddings.upsertProvider({
        id: "provider_fixture",
        type: "embedded_local",
        name: "Fixture",
        model: "deterministic-fixture-4d",
        dimension: 4,
        enabled: true,
        now: 1000
      });
      embeddings.createIndex({
        id: "index_fixture",
        providerId: "provider_fixture",
        model: "deterministic-fixture-4d",
        dimension: 4,
        now: 1000
      });

      const vectorStore = new SqliteVecVectorStore(db);
      vectorStore.upsertArticleVector({
        articleId: "article_ai_local",
        embeddingIndexId: "index_fixture",
        vector: [0.96, 0.12, 0.05, 0.02],
        contentHash: "hash_article_ai_local",
        now: 1000
      });
      vectorStore.upsertArticleVector({
        articleId: "article_design",
        embeddingIndexId: "index_fixture",
        vector: [0.05, 0.08, 0.92, 0.2],
        contentHash: "hash_article_design",
        now: 1000
      });

      const initial = vectorStore.searchSimilarArticles({
        embeddingIndexId: "index_fixture",
        vector: [0.94, 0.14, 0.04, 0.03],
        limit: 2
      });
      expect(initial[0]?.articleId).toBe("article_ai_local");

      db.exec(`
        delete from vec_articles_index_fixture;
        delete from article_vector_rows;
      `);
      expect(
        vectorStore.searchSimilarArticles({
          embeddingIndexId: "index_fixture",
          vector: [0.94, 0.14, 0.04, 0.03],
          limit: 2
        })
      ).toHaveLength(0);

      vectorStore.rebuildIndex("index_fixture");
      const rebuilt = vectorStore.searchSimilarArticles({
        embeddingIndexId: "index_fixture",
        vector: [0.94, 0.14, 0.04, 0.03],
        limit: 2
      });
      expect(rebuilt[0]?.articleId).toBe("article_ai_local");
    } finally {
      db.close();
    }
  });

  it("reads ranking candidates and writes base rank scores", () => {
    const db = openDatabase(tempDatabasePath(), { migrate: true });
    try {
      const feeds = new SqliteFeedRepository(db);
      feeds.upsert({
        id: "feed_rank",
        title: "Ranking Feed",
        feedUrl: "https://example.com/ranking.xml",
        sourceWeight: 0.5,
        now: 1000
      });

      const articles = new SqliteArticleRepository(db);
      articles.upsert({
        id: "article_rank",
        feedId: "feed_rank",
        url: "https://example.com/rank",
        title: "Rank candidate",
        publishedAt: 1000,
        discoveredAt: 1000,
        dedupeKey: "rank",
        now: 1000
      });

      const actions = new SqliteArticleActionRepository(db);
      actions.record({
        articleId: "article_rank",
        type: "favorite",
        now: 2000
      });

      const rankings = new SqliteRankingRepository(db);
      const candidate = rankings.listBaseCandidates({ articleIds: ["article_rank"] })[0];

      expect(candidate).toMatchObject({
        articleId: "article_rank",
        feedId: "feed_rank",
        sourceWeight: 0.5,
        state: {
          favorited: true
        },
        behaviorEventWeightSum: 1,
        behaviorEventCount: 1
      });

      rankings.upsertBaseScore({
        articleId: "article_rank",
        score: 0.75,
        interestScore: 0.1,
        sourceScore: 0.2,
        freshnessScore: 0.3,
        stateScore: 0.15,
        diversityScore: 0,
        penaltyScore: 0,
        calculatedAt: 3000
      });

      expect(articles.list({ view: "recommended" }).items[0]?.rank).toEqual({
        score: 0.75,
        calculatedAt: 3000
      });
    } finally {
      db.close();
    }
  });

  it("reads active ranking candidates, profile snapshots, and active rank fallback", () => {
    const db = openDatabase(tempDatabasePath(), { migrate: true });
    try {
      const feeds = new SqliteFeedRepository(db);
      const articles = new SqliteArticleRepository(db);
      const embeddings = new SqliteEmbeddingRepository(db);
      const vectorStore = new SqliteVecVectorStore(db);
      const rankings = new SqliteRankingRepository(db);
      const profiles = new SqliteProfileRepository(db);

      feeds.upsert({
        id: "feed_profile",
        title: "Profile Feed",
        feedUrl: "https://example.com/profile.xml",
        now: 1000
      });
      articles.upsert({
        id: "article_profile",
        feedId: "feed_profile",
        url: "https://example.com/profile",
        title: "Profile candidate",
        publishedAt: 1000,
        discoveredAt: 1000,
        contentHash: "hash_profile",
        dedupeKey: "profile",
        now: 1000
      });
      embeddings.upsertProvider({
        id: "provider_profile",
        type: "openai_compatible",
        name: "Provider",
        model: "fixture",
        dimension: 3,
        enabled: true,
        now: 1000
      });
      embeddings.createIndex({
        id: "index_profile",
        providerId: "provider_profile",
        model: "fixture",
        dimension: 3,
        now: 1000
      });
      vectorStore.upsertArticleVector({
        articleId: "article_profile",
        embeddingIndexId: "index_profile",
        vector: [1, 0, 0],
        contentHash: "hash_profile",
        now: 1000
      });

      const candidate = rankings.listCandidates({
        embeddingIndexId: "index_profile",
        articleIds: ["article_profile"]
      })[0];
      expect(candidate?.embeddingContentHash).toBe("hash_profile");
      expect(candidate?.vectorBlob ? fromVectorBlob(candidate.vectorBlob) : null).toEqual([
        1, 0, 0
      ]);

      profiles.upsertTopicSnapshot({
        articleId: "article_profile",
        feedId: "feed_profile",
        topicSnapshotJson: JSON.stringify({
          profileV0: {
            index_profile: {
              hash_profile: {
                processedEventIds: ["event_1"]
              }
            }
          }
        }),
        now: 2000
      });
      expect(profiles.getTopicSnapshot("article_profile")).toContain("event_1");

      rankings.upsertBaseScore({
        articleId: "article_profile",
        score: 0.42,
        interestScore: 0,
        sourceScore: 0,
        freshnessScore: 0.42,
        stateScore: 0,
        diversityScore: 0,
        penaltyScore: 0,
        calculatedAt: 2000
      });
      expect(
        articles.list({ view: "recommended", rankContext: "index_profile" }).items[0]?.rank
      ).toEqual({
        score: 0.42,
        calculatedAt: 2000
      });
    } finally {
      db.close();
    }
  });

  it("stores auth credentials and hashed sessions", () => {
    const db = openDatabase(tempDatabasePath(), { migrate: true });
    try {
      const credentials = new SqliteAuthCredentialRepository(db);
      const sessions = new SqliteSessionRepository(db);

      expect(credentials.hasCredential()).toBe(false);
      credentials.createCredential({
        id: "single_user",
        passwordHash: "scrypt:v1:hash",
        passwordAlgo: "scrypt:v1",
        now: 1000
      });
      expect(credentials.hasCredential()).toBe(true);
      expect(credentials.findCredential()).toMatchObject({
        id: "single_user",
        passwordHash: "scrypt:v1:hash",
        passwordAlgo: "scrypt:v1",
        createdAt: 1000,
        updatedAt: 1000
      });

      sessions.createSession({
        id: "session_1",
        sessionHash: "hash_1",
        createdAt: 2000,
        expiresAt: 3000,
        userAgent: "vitest",
        ipHash: "ip_hash"
      });
      expect(sessions.findByHash("hash_1")).toMatchObject({
        id: "session_1",
        sessionHash: "hash_1",
        lastSeenAt: 2000
      });

      sessions.touchSession("session_1", 2500);
      expect(sessions.findByHash("hash_1")).toMatchObject({
        lastSeenAt: 2500
      });

      sessions.deleteExpired(3000);
      expect(sessions.findByHash("hash_1")).toBeNull();
    } finally {
      db.close();
    }
  });
});

function tempDatabasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "dibao-db-"));
  tempDirs.push(dir);
  return join(dir, "dibao.sqlite");
}

function insertRank(
  db: ReturnType<typeof openDatabase>,
  articleId: string,
  score: number,
  calculatedAt: number
): void {
  db.prepare(
    `
      insert into article_rank_scores (
        article_id,
        rank_context,
        embedding_index_id,
        score,
        interest_score,
        source_score,
        freshness_score,
        state_score,
        diversity_score,
        penalty_score,
        calculated_at
      )
      values (?, 'base', null, ?, 0, 0, 0, 0, 0, 0, ?)
    `
  ).run(articleId, score, calculatedAt);
}

function hasTableOrView(db: ReturnType<typeof openDatabase>, name: string): boolean {
  return Boolean(
    db
      .prepare(
        `
          select 1
          from sqlite_schema
          where name = ?
            and type in ('table', 'view')
        `
      )
      .get(name)
  );
}

function hasFtsTable(db: ReturnType<typeof openDatabase>, name: string): boolean {
  return Boolean(
    db
      .prepare(
        `
          select 1
          from sqlite_schema
          where name = ?
            and type = 'table'
            and sql like '%using fts5%'
        `
      )
      .get(name)
  );
}
