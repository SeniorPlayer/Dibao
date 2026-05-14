import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SqliteArticleFtsIndex,
  SqliteArticleRepository,
  SqliteAppSettingsRepository,
  SqliteEmbeddingRepository,
  SqliteFeedRepository,
  SqliteVecVectorStore,
  checksumSql,
  float32VectorToBuffer,
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
});

function tempDatabasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "dibao-db-"));
  tempDirs.push(dir);
  return join(dir, "dibao.sqlite");
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
