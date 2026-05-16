import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  openDatabase,
  SqliteArticleRepository,
  SqliteEmbeddingRepository,
  SqliteFeedFolderRepository,
  SqliteJobRepository,
  SqliteFeedRepository,
  SqliteProfileRepository,
  SqliteRankingRepository,
  SqliteVecVectorStore,
  toVectorBlob,
  type DibaoDatabase
} from "@dibao/db";
import { parseOpml } from "@dibao/rss";
import { buildServer as buildRealServer } from "./app.js";
import type { FeedFetcher } from "./feed-refresh-service.js";
import { JobRunner } from "./job-runner.js";
import {
  RankingRecalculateJobService,
  RANKING_RECALCULATE_JOB_TYPE
} from "./ranking-job-service.js";
import { RecommendationRankingService } from "./ranking-service.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function buildServer(options: Parameters<typeof buildRealServer>[0] = {}) {
  return buildRealServer({
    authRequired: false,
    ...options
  });
}

describe("server API vertical slice", () => {
  it("reports database, FTS, and vector-store health", async () => {
    const db = createFixtureDatabase();
    const app = buildServer({ db, logger: false });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/system/health"
      });

      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toEqual({
        data: {
          ok: true,
          database: "ok",
          fts: "ok",
          vectorStore: "ok",
          version: "0.1.0"
        }
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("serves configured web static files and falls back to index for SPA routes", async () => {
    const db = createEmptyDatabase();
    const webDistDir = createTempDir();
    mkdirSync(join(webDistDir, "assets"), { recursive: true });
    writeFileSync(
      join(webDistDir, "index.html"),
      "<!doctype html><html><body><div id=\"root\">Dibao shell</div></body></html>"
    );
    writeFileSync(join(webDistDir, "assets", "app.js"), "console.log('dibao');");
    const app = buildServer({ db, logger: false, webDistDir });

    try {
      const root = await app.inject({
        method: "GET",
        url: "/"
      });
      const asset = await app.inject({
        method: "GET",
        url: "/assets/app.js"
      });
      const spaRoute = await app.inject({
        method: "GET",
        url: "/reader/latest"
      });
      const head = await app.inject({
        method: "HEAD",
        url: "/reader/latest"
      });

      expect(root.statusCode, root.body).toBe(200);
      expect(root.headers["content-type"]).toContain("text/html");
      expect(root.body).toContain("Dibao shell");
      expect(asset.statusCode, asset.body).toBe(200);
      expect(asset.headers["content-type"]).toContain("text/javascript");
      expect(asset.body).toContain("dibao");
      expect(spaRoute.statusCode, spaRoute.body).toBe(200);
      expect(spaRoute.body).toContain("Dibao shell");
      expect(head.statusCode, head.body).toBe(200);
      expect(head.body).toBe("");
    } finally {
      await app.close();
      db.close();
    }
  });

  it("serves web static files before login while keeping API routes protected", async () => {
    const db = createEmptyDatabase();
    const webDistDir = createTempDir();
    writeFileSync(
      join(webDistDir, "index.html"),
      "<!doctype html><html><body><div id=\"root\">Dibao public shell</div></body></html>"
    );
    const app = buildRealServer({ db, logger: false, webDistDir, cookieSecure: false });

    try {
      const root = await app.inject({
        method: "GET",
        url: "/"
      });
      const protectedApi = await app.inject({
        method: "GET",
        url: "/api/feeds"
      });

      expect(root.statusCode, root.body).toBe(200);
      expect(root.body).toContain("Dibao public shell");
      expect(protectedApi.statusCode, protectedApi.body).toBe(401);
      expect(protectedApi.json()).toMatchObject({
        error: {
          code: "UNAUTHORIZED"
        }
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("does not serve the SPA fallback for API paths", async () => {
    const db = createEmptyDatabase();
    const webDistDir = createTempDir();
    writeFileSync(
      join(webDistDir, "index.html"),
      "<!doctype html><html><body>should not serve for api</body></html>"
    );
    const app = buildServer({ db, logger: false, webDistDir });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/missing-route"
      });

      expect(response.statusCode, response.body).toBe(404);
      expect(response.headers["content-type"]).toContain("application/json");
      expect(response.json()).toMatchObject({
        error: {
          code: "NOT_FOUND"
        }
      });
      expect(response.body).not.toContain("should not serve for api");
    } finally {
      await app.close();
      db.close();
    }
  });

  it("reports anonymous auth session status before setup", async () => {
    const db = createEmptyDatabase();
    db.prepare(
      "insert into app_settings (key, value_json, updated_at) values (?, ?, ?)"
    ).run("setup.completed", "true", 1000);
    const app = buildRealServer({ db, logger: false, cookieSecure: false });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/auth/session"
      });

      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toEqual({
        data: {
          setupCompleted: false,
          authenticated: false
        }
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("sets up the single user with a hashed password and secure session cookie", async () => {
    const db = createEmptyDatabase();
    const app = buildRealServer({
      db,
      logger: false,
      now: () => 1000,
      cookieSecure: true
    });

    try {
      const invalid = await postJson(app, "/api/auth/setup", {
        password: "short"
      });
      expect(invalid.statusCode, invalid.body).toBe(400);
      expect(invalid.json()).toMatchObject({
        error: {
          code: "VALIDATION_ERROR"
        }
      });

      const setup = await postJson(app, "/api/auth/setup", {
        password: "correct horse battery"
      });
      expect(setup.statusCode, setup.body).toBe(200);
      expect(setup.json()).toEqual({
        data: {
          ok: true
        }
      });
      expectSessionCookieAttributes(setup.headers["set-cookie"], true);

      const credential = db
        .prepare(
          `
            select
              password_hash as passwordHash,
              password_algo as passwordAlgo
            from auth_credentials
          `
        )
        .get() as { passwordHash: string; passwordAlgo: string };
      expect(credential.passwordAlgo).toBe("scrypt:v1");
      expect(credential.passwordHash).toMatch(/^scrypt:v1:16384:8:1:32:64:/);
      expect(credential.passwordHash).not.toContain("correct horse battery");
      expect(
        db.prepare("select value_json as valueJson from app_settings where key = ?").get(
          "setup.completed"
        )
      ).toEqual({ valueJson: "true" });

      const session = await app.inject({
        method: "GET",
        url: "/api/auth/session",
        headers: {
          cookie: cookieHeaderFromSetCookie(setup.headers["set-cookie"])
        }
      });
      expect(session.statusCode, session.body).toBe(200);
      expect(session.json()).toEqual({
        data: {
          setupCompleted: true,
          authenticated: true
        }
      });

      const repeated = await postJson(app, "/api/auth/setup", {
        password: "another password"
      });
      expect(repeated.statusCode, repeated.body).toBe(409);
      expect(repeated.json()).toMatchObject({
        error: {
          code: "CONFLICT"
        }
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("logs in, protects APIs, and logs out idempotently", async () => {
    const db = createEmptyDatabase();
    const app = buildRealServer({ db, logger: false, cookieSecure: false });

    try {
      const health = await app.inject({
        method: "GET",
        url: "/api/system/health"
      });
      expect(health.statusCode, health.body).toBe(200);

      const protectedResponse = await app.inject({
        method: "GET",
        url: "/api/feeds"
      });
      expect(protectedResponse.statusCode, protectedResponse.body).toBe(401);
      expect(protectedResponse.json()).toMatchObject({
        error: {
          code: "UNAUTHORIZED"
        }
      });

      const setup = await postJson(app, "/api/auth/setup", {
        password: "correct horse battery"
      });
      const setupCookie = cookieHeaderFromSetCookie(setup.headers["set-cookie"]);

      const wrongLogin = await postJson(app, "/api/auth/login", {
        password: "wrong password"
      });
      expect(wrongLogin.statusCode, wrongLogin.body).toBe(401);
      expect(wrongLogin.json()).toMatchObject({
        error: {
          code: "UNAUTHORIZED"
        }
      });

      const logout = await app.inject({
        method: "POST",
        url: "/api/auth/logout",
        headers: {
          cookie: setupCookie
        }
      });
      expect(logout.statusCode, logout.body).toBe(200);
      expect(logout.json()).toEqual({
        data: {
          ok: true
        }
      });
      expectClearSessionCookie(logout.headers["set-cookie"]);

      const invalidLogout = await app.inject({
        method: "POST",
        url: "/api/auth/logout"
      });
      expect(invalidLogout.statusCode, invalidLogout.body).toBe(200);
      expect(invalidLogout.json()).toEqual({
        data: {
          ok: true
        }
      });

      const login = await postJson(app, "/api/auth/login", {
        password: "correct horse battery"
      });
      expect(login.statusCode, login.body).toBe(200);
      expectSessionCookieAttributes(login.headers["set-cookie"], false);

      const feeds = await app.inject({
        method: "GET",
        url: "/api/feeds",
        headers: {
          cookie: cookieHeaderFromSetCookie(login.headers["set-cookie"])
        }
      });
      expect(feeds.statusCode, feeds.body).toBe(200);
      expect(feeds.json()).toEqual({
        data: []
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("rejects expired sessions", async () => {
    const db = createEmptyDatabase();
    let now = 1000;
    const app = buildRealServer({
      db,
      logger: false,
      cookieSecure: false,
      now: () => now
    });

    try {
      const setup = await postJson(app, "/api/auth/setup", {
        password: "correct horse battery"
      });
      const cookie = cookieHeaderFromSetCookie(setup.headers["set-cookie"]);
      now += 31 * 24 * 60 * 60 * 1000;

      const feeds = await app.inject({
        method: "GET",
        url: "/api/feeds",
        headers: {
          cookie
        }
      });
      expect(feeds.statusCode, feeds.body).toBe(401);

      const session = await app.inject({
        method: "GET",
        url: "/api/auth/session",
        headers: {
          cookie
        }
      });
      expect(session.json()).toEqual({
        data: {
          setupCompleted: true,
          authenticated: false
        }
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("protects setup status and reports no feeds after login", async () => {
    const db = createEmptyDatabase();
    const app = buildRealServer({ db, logger: false, cookieSecure: false });

    try {
      const anonymous = await app.inject({
        method: "GET",
        url: "/api/setup/status"
      });
      expect(anonymous.statusCode, anonymous.body).toBe(401);
      expect(anonymous.json()).toMatchObject({
        error: {
          code: "UNAUTHORIZED"
        }
      });

      const setup = await postJson(app, "/api/auth/setup", {
        password: "correct horse battery"
      });
      const status = await app.inject({
        method: "GET",
        url: "/api/setup/status",
        headers: {
          cookie: cookieHeaderFromSetCookie(setup.headers["set-cookie"])
        }
      });

      expect(status.statusCode, status.body).toBe(200);
      expect(status.json()).toEqual({
        data: {
          setupCompleted: true,
          hasFeeds: false,
          hasEmbeddingProvider: false,
          firstRefreshStatus: "idle"
        }
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("protects recommendation diagnostics and jobs APIs", async () => {
    const db = createEmptyDatabase();
    const app = buildRealServer({ db, logger: false, cookieSecure: false });

    try {
      const jobs = await app.inject({
        method: "GET",
        url: "/api/jobs"
      });
      const status = await app.inject({
        method: "GET",
        url: "/api/recommendation/status"
      });

      expect(jobs.statusCode, jobs.body).toBe(401);
      expect(jobs.json()).toMatchObject({
        error: {
          code: "UNAUTHORIZED"
        }
      });
      expect(status.statusCode, status.body).toBe(401);
      expect(status.json()).toMatchObject({
        error: {
          code: "UNAUTHORIZED"
        }
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("reports setup status with existing undeleted feeds", async () => {
    const db = createEmptyDatabase();
    const feedRepository = new SqliteFeedRepository(db);
    feedRepository.upsert({
      id: "feed_fixture",
      title: "Fixture Feed",
      feedUrl: "https://example.com/feed.xml",
      now: 1000
    });
    const app = buildRealServer({ db, logger: false, cookieSecure: false });

    try {
      const setup = await postJson(app, "/api/auth/setup", {
        password: "correct horse battery"
      });
      const status = await app.inject({
        method: "GET",
        url: "/api/setup/status",
        headers: {
          cookie: cookieHeaderFromSetCookie(setup.headers["set-cookie"])
        }
      });

      expect(status.statusCode, status.body).toBe(200);
      expect(status.json()).toEqual({
        data: {
          setupCompleted: true,
          hasFeeds: true,
          hasEmbeddingProvider: false,
          firstRefreshStatus: "idle"
        }
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("lists jobs with filters and redacted payload summaries", async () => {
    const db = createEmptyDatabase();
    const jobs = new SqliteJobRepository(db);
    jobs.enqueue({
      id: "job_feed_refresh",
      type: "feed_refresh",
      payloadJson: JSON.stringify({ feedId: "feed_secret_shape" }),
      now: 1000
    });
    jobs.enqueue({
      id: "job_embedding",
      type: "embedding_generate",
      payloadJson: JSON.stringify({
        embeddingIndexId: "index_fixture",
        articleIds: ["article_a", "article_b"]
      }),
      now: 2000
    });
    const app = buildServer({ db, logger: false });

    try {
      const embedding = await app.inject({
        method: "GET",
        url: "/api/jobs?status=queued&type=embedding_generate&limit=1"
      });
      expect(embedding.statusCode, embedding.body).toBe(200);
      expect(embedding.json()).toEqual({
        data: [
          {
            id: "job_embedding",
            type: "embedding_generate",
            status: "queued",
            error: null,
            attempts: 0,
            maxAttempts: 3,
            runAfter: "1970-01-01T00:00:02.000Z",
            startedAt: null,
            finishedAt: null,
            createdAt: "1970-01-01T00:00:02.000Z",
            updatedAt: "1970-01-01T00:00:02.000Z",
            payloadSummary: {
              embeddingIndexId: "index_fixture",
              articleCount: 2
            }
          }
        ]
      });
      expect(embedding.body).not.toContain("payloadJson");
      expect(embedding.body).not.toContain("article_a");
      expect(embedding.body).not.toContain("article_b");

      const feedRefresh = await app.inject({
        method: "GET",
        url: "/api/jobs?type=feed_refresh"
      });
      expect(feedRefresh.statusCode, feedRefresh.body).toBe(200);
      expect(feedRefresh.json().data[0]).toMatchObject({
        id: "job_feed_refresh",
        payloadSummary: null
      });
      expect(feedRefresh.body).not.toContain("feed_secret_shape");

      const invalid = await app.inject({
        method: "GET",
        url: "/api/jobs?status=waiting"
      });
      expect(invalid.statusCode, invalid.body).toBe(400);
      expect(invalid.json()).toMatchObject({
        error: {
          code: "VALIDATION_ERROR",
          details: {
            field: "status"
          }
        }
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("reports baseline recommendation status without an active provider and index", async () => {
    const db = createEmptyDatabase();
    const app = buildServer({ db, logger: false });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/recommendation/status"
      });

      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toEqual({
        data: {
          mode: "baseline",
          activeProvider: null,
          activeIndex: null,
          activeRankContext: "base",
          coverage: {
            candidateCount: 0,
            eligibleArticleCount: 0,
            missingEmbeddingCount: 0,
            staleEmbeddingCount: 0,
            embeddingCount: 0,
            coverageRatio: 0,
            pendingJobs: 0,
            failedJobs: 0,
            lastFailedAt: null,
            lastError: null
          },
          behaviorCounts: {},
          clusters: {
            positive: 0,
            negative: 0
          },
          rankedArticles: {
            base: 0,
            active: 0
          },
          lastProfileUpdate: null,
          lastRankingUpdate: null,
          warnings: [
            {
              code: "NO_PROVIDER",
              message:
                "No active embedding provider and index are configured; recommendations are using baseline ranking."
            }
          ]
        }
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("creates, tests, and lists OpenAI-compatible embedding providers", async () => {
    const db = createEmptyDatabase();
    const embeddingCalls: Array<{ url: string; authorization: string | null; inputCount: number }> =
      [];
    const app = buildServer({
      db,
      logger: false,
      now: () => 1000,
      embeddingFetcher: embeddingFetcherFixture(embeddingCalls, 3)
    });

    try {
      const created = await postJson(app, "/api/embedding/providers", {
        type: "openai_compatible",
        name: "OpenAI Compatible",
        baseUrl: "https://api.example.com/v1/",
        model: "fixture-embedding",
        dimension: 3,
        apiKey: "secret",
        enabled: true,
        qualityTier: "recommended"
      });
      expect(created.statusCode, created.body).toBe(200);
      const providerId = (created.json() as { data: { id: string } }).data.id;
      expect(providerId).toMatch(/^provider_/);

      const providers = await app.inject({
        method: "GET",
        url: "/api/embedding/providers"
      });
      expect(providers.statusCode, providers.body).toBe(200);
      expect(providers.json()).toMatchObject({
        data: [
          {
            id: providerId,
            type: "openai_compatible",
            name: "OpenAI Compatible",
            baseUrl: "https://api.example.com/v1",
            model: "fixture-embedding",
            dimension: 3,
            enabled: true,
            qualityTier: "recommended",
            hasApiKey: true
          }
        ]
      });
      expect(providers.body).not.toContain("secret");

      const indexes = await app.inject({
        method: "GET",
        url: "/api/embedding/indexes"
      });
      expect(indexes.statusCode, indexes.body).toBe(200);
      expect(indexes.json()).toMatchObject({
        data: [
          {
            providerId,
            model: "fixture-embedding",
            dimension: 3,
            distanceMetric: "cosine",
            status: "active",
            embeddingCount: 0
          }
        ]
      });

      const status = await app.inject({
        method: "GET",
        url: "/api/setup/status"
      });
      expect(status.json()).toMatchObject({
        data: {
          hasEmbeddingProvider: true
        }
      });

      const test = await app.inject({
        method: "POST",
        url: `/api/embedding/providers/${providerId}/test`
      });
      expect(test.statusCode, test.body).toBe(200);
      expect(test.json()).toMatchObject({
        data: {
          status: "success",
          dimension: 3,
          latencyMs: expect.any(Number)
        }
      });
      expect(embeddingCalls).toEqual([
        {
          url: "https://api.example.com/v1/embeddings",
          authorization: "Bearer secret",
          inputCount: 1
        }
      ]);
    } finally {
      await app.close();
      db.close();
    }
  });

  it("creates, tests, and lists Ollama embedding providers", async () => {
    const db = createEmptyDatabase();
    const embeddingCalls: Array<{ url: string; authorization: string | null; inputCount: number; model: string }> =
      [];
    const app = buildServer({
      db,
      logger: false,
      now: () => 1000,
      embeddingFetcher: ollamaEmbeddingFetcherFixture(embeddingCalls, 3)
    });

    try {
      const created = await postJson(app, "/api/embedding/providers", {
        type: "ollama",
        name: "Ollama",
        baseUrl: "http://127.0.0.1:11434/",
        model: "nomic-embed-text",
        dimension: 3,
        enabled: true,
        qualityTier: "basic"
      });
      expect(created.statusCode, created.body).toBe(200);
      const providerId = (created.json() as { data: { id: string } }).data.id;

      const providers = await app.inject({
        method: "GET",
        url: "/api/embedding/providers"
      });
      expect(providers.statusCode, providers.body).toBe(200);
      expect(providers.json()).toMatchObject({
        data: [
          {
            id: providerId,
            type: "ollama",
            name: "Ollama",
            baseUrl: "http://127.0.0.1:11434",
            model: "nomic-embed-text",
            dimension: 3,
            enabled: true,
            qualityTier: "basic",
            hasApiKey: false
          }
        ]
      });

      const test = await app.inject({
        method: "POST",
        url: `/api/embedding/providers/${providerId}/test`
      });
      expect(test.statusCode, test.body).toBe(200);
      expect(test.json()).toMatchObject({
        data: {
          status: "success",
          dimension: 3,
          latencyMs: expect.any(Number)
        }
      });
      expect(embeddingCalls).toEqual([
        {
          url: "http://127.0.0.1:11434/api/embed",
          authorization: null,
          inputCount: 1,
          model: "nomic-embed-text"
        }
      ]);
    } finally {
      await app.close();
      db.close();
    }
  });

  it("rejects unsupported embedding providers and invalid provider base URLs", async () => {
    const db = createEmptyDatabase();
    const app = buildServer({ db, logger: false });

    try {
      const unsupported = await postJson(app, "/api/embedding/providers", {
        type: "custom_http",
        name: "Custom HTTP",
        model: "custom-embedding",
        dimension: 3,
        enabled: true
      });
      expect(unsupported.statusCode, unsupported.body).toBe(400);
      expect(unsupported.json()).toMatchObject({
        error: {
          code: "VALIDATION_ERROR"
        }
      });

      const invalidBaseUrl = await postJson(app, "/api/embedding/providers", {
        type: "openai_compatible",
        name: "Bad Endpoint",
        baseUrl: "https://api.example.com/v1/embeddings",
        model: "fixture-embedding",
        dimension: 3,
        enabled: true
      });
      expect(invalidBaseUrl.statusCode, invalidBaseUrl.body).toBe(400);
      expect(invalidBaseUrl.json()).toMatchObject({
        error: {
          code: "VALIDATION_ERROR",
          details: {
            field: "baseUrl"
          }
        }
      });

      const invalidOllamaBaseUrl = await postJson(app, "/api/embedding/providers", {
        type: "ollama",
        name: "Bad Ollama Endpoint",
        baseUrl: "http://127.0.0.1:11434/api/embed",
        model: "nomic-embed-text",
        dimension: 768,
        enabled: true
      });
      expect(invalidOllamaBaseUrl.statusCode, invalidOllamaBaseUrl.body).toBe(400);
      expect(invalidOllamaBaseUrl.json()).toMatchObject({
        error: {
          code: "VALIDATION_ERROR",
          details: {
            field: "baseUrl"
          }
        }
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("records provider test failures without storing errors on indexes", async () => {
    const db = createEmptyDatabase();
    const embeddingCalls: Array<{ url: string; authorization: string | null; inputCount: number }> =
      [];
    const app = buildServer({
      db,
      logger: false,
      embeddingFetcher: embeddingFetcherFixture(embeddingCalls, 2)
    });

    try {
      const created = await postJson(app, "/api/embedding/providers", {
        type: "openai_compatible",
        name: "OpenAI Compatible",
        baseUrl: "https://api.example.com/v1",
        model: "fixture-embedding",
        dimension: 3,
        enabled: true
      });
      const providerId = (created.json() as { data: { id: string } }).data.id;

      const failed = await app.inject({
        method: "POST",
        url: `/api/embedding/providers/${providerId}/test`
      });
      expect(failed.statusCode, failed.body).toBe(502);
      expect(failed.json()).toMatchObject({
        error: {
          code: "PROVIDER_ERROR"
        }
      });

      const providers = await app.inject({
        method: "GET",
        url: "/api/embedding/providers"
      });
      expect(providers.json()).toMatchObject({
        data: [
          {
            id: providerId,
            lastTestStatus: "failed",
            lastTestError: expect.stringContaining("dimension 2")
          }
        ]
      });

      const indexes = await app.inject({
        method: "GET",
        url: "/api/embedding/indexes"
      });
      expect(indexes.body).not.toContain("lastTestError");
      expect(indexes.body).not.toContain("error");
    } finally {
      await app.close();
      db.close();
    }
  });

  it("prevents deleting embedding providers that already have indexes", async () => {
    const db = createEmptyDatabase();
    const app = buildServer({ db, logger: false, now: () => 1000 });

    try {
      const enabled = await postJson(app, "/api/embedding/providers", {
        type: "openai_compatible",
        name: "Enabled Provider",
        baseUrl: "https://api.example.com/v1",
        model: "fixture-embedding",
        dimension: 3,
        enabled: true
      });
      const enabledProviderId = (enabled.json() as { data: { id: string } }).data.id;

      const conflict = await app.inject({
        method: "DELETE",
        url: `/api/embedding/providers/${enabledProviderId}`
      });
      expect(conflict.statusCode, conflict.body).toBe(409);
      expect(conflict.json()).toMatchObject({
        error: {
          code: "CONFLICT"
        }
      });

      const disabled = await postJson(app, "/api/embedding/providers", {
        type: "openai_compatible",
        name: "Disabled Provider",
        baseUrl: "https://api.example.com/v1",
        model: "fixture-embedding",
        dimension: 3,
        enabled: false
      });
      const disabledProviderId = (disabled.json() as { data: { id: string } }).data.id;

      const deleted = await app.inject({
        method: "DELETE",
        url: `/api/embedding/providers/${disabledProviderId}`
      });
      expect(deleted.statusCode, deleted.body).toBe(200);
      expect(deleted.json()).toEqual({
        data: {
          ok: true
        }
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("enables embedding providers transactionally by disabling the previous active provider", async () => {
    const db = createEmptyDatabase();
    const app = buildServer({ db, logger: false, now: () => 1000 });

    try {
      const first = await postJson(app, "/api/embedding/providers", {
        type: "openai_compatible",
        name: "First Provider",
        baseUrl: "https://api.first.example/v1",
        model: "fixture-embedding",
        dimension: 3,
        enabled: true
      });
      const firstProviderId = (first.json() as { data: { id: string } }).data.id;

      const second = await postJson(app, "/api/embedding/providers", {
        type: "openai_compatible",
        name: "Second Provider",
        baseUrl: "https://api.second.example/v1",
        model: "fixture-embedding",
        dimension: 3,
        enabled: true
      });
      const secondProviderId = (second.json() as { data: { id: string } }).data.id;

      const providers = await app.inject({
        method: "GET",
        url: "/api/embedding/providers"
      });
      expect(providers.statusCode, providers.body).toBe(200);
      expect(providers.json()).toMatchObject({
        data: [
          {
            id: secondProviderId,
            enabled: true
          },
          {
            id: firstProviderId,
            enabled: false
          }
        ]
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("creates a new active index on model or dimension change without polluting the old index", async () => {
    const db = createFixtureDatabase();
    const app = buildServer({ db, logger: false, now: () => 1000 });

    try {
      const created = await postJson(app, "/api/embedding/providers", {
        type: "openai_compatible",
        name: "Migration Provider",
        baseUrl: "https://api.example.com/v1",
        model: "fixture-embedding-v1",
        dimension: 3,
        enabled: true
      });
      const providerId = (created.json() as { data: { id: string } }).data.id;
      const firstIndexes = await app.inject({
        method: "GET",
        url: "/api/embedding/indexes"
      });
      const oldIndex = (firstIndexes.json() as { data: Array<{ id: string }> }).data[0];

      new SqliteVecVectorStore(db).upsertArticleVector({
        articleId: "article_recommended",
        embeddingIndexId: oldIndex.id,
        vector: [1, 0, 0],
        contentHash: "article_recommended:2000",
        now: 1100
      });

      const updated = await injectJson(app, "PATCH", `/api/embedding/providers/${providerId}`, {
        model: "fixture-embedding-v2",
        dimension: 4,
        enabled: true
      });
      expect(updated.statusCode, updated.body).toBe(200);

      const indexes = await app.inject({
        method: "GET",
        url: "/api/embedding/indexes"
      });
      expect(indexes.statusCode, indexes.body).toBe(200);
      const data = (indexes.json() as { data: Array<{ id: string; status: string; model: string; dimension: number; embeddingCount: number; coverageRatio: number }> }).data;
      const active = data.find((index) => index.status === "active");
      const retired = data.find((index) => index.id === oldIndex.id);

      expect(active).toMatchObject({
        model: "fixture-embedding-v2",
        dimension: 4,
        embeddingCount: 0,
        coverageRatio: 0
      });
      expect(active?.id).not.toBe(oldIndex.id);
      expect(retired).toMatchObject({
        id: oldIndex.id,
        status: "retired",
        model: "fixture-embedding-v1",
        dimension: 3,
        embeddingCount: 1
      });

      const recommended = await app.inject({
        method: "GET",
        url: "/api/recommendation/status"
      });
      expect(recommended.json()).toMatchObject({
        data: {
          activeIndex: {
            id: active?.id
          },
          activeRankContext: active?.id
        }
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("uses provider-specific embedding backfill batch sizes", async () => {
    const db = createEmptyDatabase();
    const feeds = new SqliteFeedRepository(db);
    const articles = new SqliteArticleRepository(db);
    feeds.upsert({
      id: "feed_batch",
      title: "Batch Feed",
      feedUrl: "https://example.com/batch.xml",
      now: 1000
    });
    for (let index = 0; index < 9; index += 1) {
      articles.upsert({
        id: `article_batch_${index}`,
        feedId: "feed_batch",
        url: `https://example.com/batch/${index}`,
        canonicalUrl: `https://example.com/batch/${index}`,
        title: `Batch article ${index}`,
        summary: "Batch sizing fixture",
        publishedAt: 1000 + index,
        discoveredAt: 1000 + index,
        dedupeKey: `article_batch_${index}`,
        now: 1000 + index
      });
    }
    const app = buildServer({ db, logger: false, now: () => 2000 });

    try {
      await postJson(app, "/api/embedding/providers", {
        type: "ollama",
        name: "Ollama Batch",
        baseUrl: "http://127.0.0.1:11434",
        model: "bge-m3",
        dimension: 1024,
        enabled: true
      });
      const indexes = await app.inject({
        method: "GET",
        url: "/api/embedding/indexes"
      });
      const indexId = (indexes.json() as { data: Array<{ id: string }> }).data[0].id;
      const backfill = await app.inject({
        method: "POST",
        url: `/api/embedding/indexes/${indexId}/backfill`
      });
      expect(backfill.statusCode, backfill.body).toBe(200);

      const payloads = db
        .prepare(
          `
            select payload_json as payloadJson
            from jobs
            where type = 'embedding_generate'
            order by id
          `
        )
        .all() as Array<{ payloadJson: string }>;
      const lengths = payloads.map(
        (row) => (JSON.parse(row.payloadJson) as { articleIds: string[] }).articleIds.length
      );
      expect(lengths.sort((left, right) => right - left)).toEqual([4, 4, 1]);
    } finally {
      await app.close();
      db.close();
    }
  });

  it("queues embedding jobs for newly refreshed articles without calling the provider inline", async () => {
    const db = createEmptyDatabase();
    const embeddingCalls: Array<{ url: string; authorization: string | null; inputCount: number }> =
      [];
    const app = buildServer({
      db,
      logger: false,
      feedFetcher: fixtureFetcher({ "https://example.com/feed.xml": fixtureRss }),
      embeddingFetcher: embeddingFetcherFixture(embeddingCalls, 3)
    });

    try {
      await postJson(app, "/api/embedding/providers", {
        type: "openai_compatible",
        name: "OpenAI Compatible",
        baseUrl: "https://api.example.com/v1",
        model: "fixture-embedding",
        dimension: 3,
        enabled: true
      });

      const feed = await postJson(app, "/api/feeds", {
        feedUrl: "https://example.com/feed.xml"
      });
      expect(feed.statusCode, feed.body).toBe(200);

      const queued = db
        .prepare(
          `
            select payload_json as payloadJson
            from jobs
            where type = 'embedding_generate'
              and status = 'queued'
          `
        )
        .all() as Array<{ payloadJson: string }>;
      expect(queued).toHaveLength(1);
      const payload = JSON.parse(queued[0].payloadJson) as {
        embeddingIndexId: string;
        articleIds: string[];
      };
      expect(payload.embeddingIndexId).toMatch(/^index_/);
      expect(payload.articleIds).toHaveLength(2);
      expect(payload.articleIds.length).toBeLessThanOrEqual(16);
      expect(embeddingCalls).toEqual([]);
    } finally {
      await app.close();
      db.close();
    }
  });

  it("reports embedding coverage on index and recommendation diagnostics", async () => {
    const db = createFixtureDatabase();
    const { index } = createActiveEmbeddingDiagnosticsFixture(db, {
      providerTestStatus: "success"
    });
    const jobs = new SqliteJobRepository(db);
    jobs.enqueue({
      id: "job_embedding_pending",
      type: "embedding_generate",
      payloadJson: JSON.stringify({
        embeddingIndexId: index.id,
        articleIds: ["article_recent"]
      }),
      now: 6000
    });
    new SqliteVecVectorStore(db).upsertArticleVector({
      articleId: "article_recommended",
      embeddingIndexId: index.id,
      vector: [1, 0, 0],
      contentHash: "article_recommended:2000",
      now: 6100
    });
    db.prepare(
      `
        insert into article_states (
          article_id,
          hidden_at,
          reading_progress,
          updated_at
        )
        values (?, ?, ?, ?)
        on conflict(article_id) do update set
          hidden_at = excluded.hidden_at,
          updated_at = excluded.updated_at
      `
    ).run("article_recommended", 6200, 0, 6200);
    const app = buildServer({ db, logger: false });

    try {
      const indexes = await app.inject({
        method: "GET",
        url: "/api/embedding/indexes"
      });
      expect(indexes.statusCode, indexes.body).toBe(200);
      expect(indexes.json().data[0]).toMatchObject({
        id: index.id,
        candidateCount: 2,
        eligibleArticleCount: 2,
        missingEmbeddingCount: 1,
        staleEmbeddingCount: 0,
        embeddingCount: 1,
        coverageRatio: 0.5,
        pendingJobs: 1,
        failedJobs: 0,
        lastFailedAt: null,
        lastError: null
      });

      const status = await app.inject({
        method: "GET",
        url: "/api/recommendation/status"
      });
      expect(status.statusCode, status.body).toBe(200);
      expect(status.json()).toMatchObject({
        data: {
          mode: "embedding",
          activeProvider: {
            id: "provider_diagnostics",
            type: "openai_compatible",
            name: "Diagnostics Provider",
            model: "fixture-embedding",
            dimension: 3,
            lastTestStatus: "success",
            lastTestAt: "1970-01-01T00:00:05.000Z"
          },
          activeIndex: {
            id: index.id,
            status: "active",
            model: "fixture-embedding",
            dimension: 3
          },
          activeRankContext: index.id,
          coverage: {
            candidateCount: 2,
            eligibleArticleCount: 2,
            missingEmbeddingCount: 1,
            staleEmbeddingCount: 0,
            embeddingCount: 1,
            coverageRatio: 0.5,
            pendingJobs: 1,
            failedJobs: 0,
            lastFailedAt: null,
            lastError: null
          },
          warnings: expect.arrayContaining([
            {
              code: "EMBEDDING_PENDING",
              message: "Embedding generation is still running or incomplete for the active index."
            }
          ])
        }
      });
      expect(status.body).not.toContain("apiKey");
      expect(status.body).not.toContain("apiKeyEncrypted");
      expect(status.body).not.toContain("hasApiKey");
      expect(status.body).not.toContain("vectorBlob");
      expect(status.body).not.toContain("tableName");
    } finally {
      await app.close();
      db.close();
    }
  });

  it("backfills only active index missing or stale embeddings and deduplicates open jobs", async () => {
    const db = createFixtureDatabase();
    const { index } = createActiveEmbeddingDiagnosticsFixture(db, {
      providerTestStatus: "success"
    });
    const vectorStore = new SqliteVecVectorStore(db);
    vectorStore.upsertArticleVector({
      articleId: "article_recommended",
      embeddingIndexId: index.id,
      vector: [1, 0, 0],
      contentHash: "stale-hash",
      now: 6100
    });
    const app = buildServer({ db, logger: false, now: () => 7000 });

    try {
      const first = await app.inject({
        method: "POST",
        url: `/api/embedding/indexes/${index.id}/backfill`
      });
      expect(first.statusCode, first.body).toBe(200);
      expect(first.json()).toMatchObject({
        data: {
          candidateCount: 2,
          enqueuedArticleCount: 2,
          dedupedArticleCount: 0
        }
      });
      expect(first.json().data.jobIds).toHaveLength(1);

      const second = await app.inject({
        method: "POST",
        url: `/api/embedding/indexes/${index.id}/backfill`
      });
      expect(second.statusCode, second.body).toBe(200);
      expect(second.json()).toMatchObject({
        data: {
          candidateCount: 2,
          enqueuedArticleCount: 0,
          dedupedArticleCount: 2,
          jobIds: []
        }
      });

      const indexes = await app.inject({
        method: "GET",
        url: "/api/embedding/indexes"
      });
      expect(indexes.json().data[0]).toMatchObject({
        id: index.id,
        candidateCount: 2,
        eligibleArticleCount: 2,
        missingEmbeddingCount: 1,
        staleEmbeddingCount: 1,
        pendingJobs: 1
      });

      new SqliteEmbeddingRepository(db).markIndexStatus(index.id, "retired", 7100);
      const retired = await app.inject({
        method: "POST",
        url: `/api/embedding/indexes/${index.id}/backfill`
      });
      expect(retired.statusCode, retired.body).toBe(409);
      expect(retired.json()).toMatchObject({
        error: {
          code: "CONFLICT"
        }
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("reports degraded recommendation diagnostics for failed embedding jobs while recommendations remain usable", async () => {
    const db = createFixtureDatabase();
    const { index } = createActiveEmbeddingDiagnosticsFixture(db, {
      providerTestStatus: "success"
    });
    const jobs = new SqliteJobRepository(db);
    const failedJob = jobs.enqueue({
      id: "job_embedding_failed",
      type: "embedding_generate",
      payloadJson: JSON.stringify({
        embeddingIndexId: index.id,
        articleIds: ["article_recent", "article_recommended"]
      }),
      now: 7000
    });
    jobs.markFailed(failedJob.id, "Provider request failed", 7100);
    const profiles = new SqliteProfileRepository(db);
    profiles.upsertCluster({
      id: "cluster_positive",
      embeddingIndexId: index.id,
      polarity: "positive",
      centroidVectorBlob: toVectorBlob([1, 0, 0]),
      weight: 1,
      sampleCount: 1,
      now: 7200
    });
    profiles.upsertCluster({
      id: "cluster_negative",
      embeddingIndexId: index.id,
      polarity: "negative",
      centroidVectorBlob: toVectorBlob([0, 1, 0]),
      weight: 1,
      sampleCount: 1,
      now: 7300
    });
    const app = buildServer({ db, logger: false });

    try {
      const status = await app.inject({
        method: "GET",
        url: "/api/recommendation/status"
      });
      expect(status.statusCode, status.body).toBe(200);
      expect(status.json()).toMatchObject({
        data: {
          mode: "degraded",
          coverage: {
            candidateCount: 2,
            eligibleArticleCount: 2,
            missingEmbeddingCount: 2,
            staleEmbeddingCount: 0,
            embeddingCount: 0,
            coverageRatio: 0,
            pendingJobs: 0,
            failedJobs: 1,
            lastFailedAt: "1970-01-01T00:00:07.100Z",
            lastError: "Provider request failed"
          },
          clusters: {
            positive: 1,
            negative: 1
          },
          warnings: expect.arrayContaining([
            {
              code: "EMBEDDING_JOB_FAILED",
              message: "Embedding generation has failed jobs for the active index."
            }
          ])
        }
      });

      const recommended = await app.inject({
        method: "GET",
        url: "/api/articles?view=recommended"
      });
      expect(recommended.statusCode, recommended.body).toBe(200);
      expect(recommended.json().data.map((article: { id: string }) => article.id)).toEqual([
        "article_recommended",
        "article_recent"
      ]);
    } finally {
      await app.close();
      db.close();
    }
  });

  it("reports degraded recommendation diagnostics when the active provider test failed", async () => {
    const db = createFixtureDatabase();
    createActiveEmbeddingDiagnosticsFixture(db, {
      providerTestStatus: "failed"
    });
    const app = buildServer({ db, logger: false });

    try {
      const status = await app.inject({
        method: "GET",
        url: "/api/recommendation/status"
      });

      expect(status.statusCode, status.body).toBe(200);
      expect(status.json()).toMatchObject({
        data: {
          mode: "degraded",
          activeProvider: {
            lastTestStatus: "failed"
          },
          warnings: expect.arrayContaining([
            {
              code: "PROVIDER_TEST_FAILED",
              message: "The active embedding provider's latest connection test failed."
            }
          ])
        }
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("protects, reads, and strictly updates app settings", async () => {
    const db = createEmptyDatabase();
    const app = buildRealServer({
      db,
      logger: false,
      cookieSecure: false,
      now: () => 5000
    });

    try {
      const anonymous = await app.inject({
        method: "GET",
        url: "/api/settings"
      });
      expect(anonymous.statusCode, anonymous.body).toBe(401);
      expect(anonymous.json()).toMatchObject({
        error: {
          code: "UNAUTHORIZED"
        }
      });

      const setup = await postJson(app, "/api/auth/setup", {
        password: "correct horse battery"
      });
      const cookie = cookieHeaderFromSetCookie(setup.headers["set-cookie"]);
      db.prepare(
        `
          insert into app_settings (key, value_json, updated_at)
          values (?, ?, ?)
          on conflict(key) do update set value_json = excluded.value_json
        `
      ).run("retention.articleDays", JSON.stringify("invalid"), 5000);

      const defaults = await app.inject({
        method: "GET",
        url: "/api/settings",
        headers: {
          cookie
        }
      });
      expect(defaults.statusCode, defaults.body).toBe(200);
      expect(defaults.json()).toEqual({
        data: {
          ui: {
            locale: "zh-CN"
          },
          reader: {
            fontSize: 18,
            lineHeight: 1.75,
            paragraphGap: 1.1,
            readerWidth: 720,
            theme: "paper"
          },
          retention: {
            retentionDays: 60,
            keepFavorites: true,
            keepReadLater: true
          },
          ranking: {
            preferFreshness: 0.5,
            preferSource: 0.5,
            preferDiversity: 0.5
          }
        }
      });

      const updated = await injectJsonWithCookie(app, "PATCH", "/api/settings", cookie, {
        ui: {
          locale: "en-US"
        },
        reader: {
          fontSize: 20,
          lineHeight: 1.8
        },
        retention: {
          retentionDays: 45
        }
      });
      expect(updated.statusCode, updated.body).toBe(200);
      expect(updated.json()).toMatchObject({
        data: {
          ok: true,
          settings: {
            ui: {
              locale: "en-US"
            },
            reader: {
              fontSize: 20,
              lineHeight: 1.8,
              paragraphGap: 1.1,
              readerWidth: 720
            },
            retention: {
              retentionDays: 45
            }
          }
        }
      });
      expect(
        db.prepare("select value_json as valueJson from app_settings where key = ?").get(
          "retention.articleDays"
        )
      ).toEqual({
        valueJson: "45"
      });

      const partial = await injectJsonWithCookie(app, "PATCH", "/api/settings", cookie, {
        reader: {
          paragraphGap: 1.3
        }
      });
      expect(partial.statusCode, partial.body).toBe(200);
      expect(partial.json()).toMatchObject({
        data: {
          settings: {
            reader: {
              fontSize: 20,
              lineHeight: 1.8,
              paragraphGap: 1.3,
              readerWidth: 720
            },
            retention: {
              retentionDays: 45
            }
          }
        }
      });

      for (const payload of [
        {
          reader: {
            theme: "paper"
          }
        },
        {
          ui: {
            locale: "fr-FR"
          }
        },
        {
          retention: {
            retentionDays: 0
          }
        },
        {
          retention: {
            retentionDays: "30"
          }
        },
        {
          ranking: {
            preferFreshness: 0.9
          }
        }
      ]) {
        const invalid = await injectJsonWithCookie(app, "PATCH", "/api/settings", cookie, payload);
        expect(invalid.statusCode, invalid.body).toBe(400);
        expect(invalid.json()).toMatchObject({
          error: {
            code: "VALIDATION_ERROR"
          }
        });
      }
    } finally {
      await app.close();
      db.close();
    }
  });

  it("lists feeds from the migrated database with API timestamps", async () => {
    const db = createFixtureDatabase();
    const app = buildServer({ db, logger: false });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/feeds?enabled=true"
      });

      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toEqual({
        data: [
          {
            id: "feed_design",
            folderId: null,
            title: "Design Notes",
            siteUrl: "https://example.com",
            feedUrl: "https://example.com/feed.xml",
            description: null,
            enabled: true,
            sourceWeight: 0,
            lastFetchedAt: null,
            lastSuccessAt: null,
            lastError: null,
            createdAt: "1970-01-01T00:00:01.000Z",
            updatedAt: "1970-01-01T00:00:01.000Z"
          }
        ]
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("lists feed folders with contract fields", async () => {
    const db = createEmptyDatabase();
    const folders = new SqliteFeedFolderRepository(db);
    folders.upsert({
      id: "folder_design",
      title: "Design",
      sortOrder: 2,
      now: 1000
    });
    folders.upsert({
      id: "folder_news",
      title: "News",
      sortOrder: 1,
      now: 1000
    });
    const app = buildServer({ db, logger: false });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/feed-folders"
      });

      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toEqual({
        data: [
          {
            id: "folder_news",
            title: "News",
            sortOrder: 1
          },
          {
            id: "folder_design",
            title: "Design",
            sortOrder: 2
          }
        ]
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("creates, renames, and deletes feed folders without deleting feeds", async () => {
    const db = createEmptyDatabase();
    const feedRepository = new SqliteFeedRepository(db);
    const app = buildServer({ db, logger: false, now: () => 7000 });

    try {
      const invalid = await postJson(app, "/api/feed-folders", {
        title: "   "
      });
      expect(invalid.statusCode, invalid.body).toBe(400);
      expect(invalid.json()).toMatchObject({
        error: {
          code: "VALIDATION_ERROR"
        }
      });

      const created = await postJson(app, "/api/feed-folders", {
        title: "Design"
      });
      expect(created.statusCode, created.body).toBe(200);
      expect(created.json()).toMatchObject({
        data: {
          id: expect.stringMatching(/^folder_/),
          title: "Design",
          sortOrder: 0
        }
      });

      const folderId = created.json().data.id as string;
      const renamed = await injectJson(app, "PATCH", `/api/feed-folders/${folderId}`, {
        title: "Design Systems"
      });
      expect(renamed.statusCode, renamed.body).toBe(200);
      expect(renamed.json()).toMatchObject({
        data: {
          id: folderId,
          title: "Design Systems"
        }
      });

      feedRepository.upsert({
        id: "feed_folder_delete",
        folderId,
        title: "Folder Delete Feed",
        feedUrl: "https://example.com/folder-delete.xml",
        now: 7100
      });

      const deleted = await app.inject({
        method: "DELETE",
        url: `/api/feed-folders/${folderId}`
      });
      expect(deleted.statusCode, deleted.body).toBe(200);
      expect(deleted.json()).toEqual({
        data: {
          ok: true
        }
      });
      expect(feedRepository.findById("feed_folder_delete")).toMatchObject({
        folderId: null
      });
      const foldersAfterDelete = await app.inject({
        method: "GET",
        url: "/api/feed-folders"
      });
      expect(
        foldersAfterDelete.json().data.map((folder: { id: string }) => folder.id)
      ).not.toContain(folderId);
    } finally {
      await app.close();
      db.close();
    }
  });

  it("returns not found for missing feed folders", async () => {
    const db = createEmptyDatabase();
    const app = buildServer({ db, logger: false });

    try {
      const update = await injectJson(app, "PATCH", "/api/feed-folders/missing", {
        title: "Missing"
      });
      const remove = await app.inject({
        method: "DELETE",
        url: "/api/feed-folders/missing"
      });

      expect(update.statusCode, update.body).toBe(404);
      expect(update.json()).toMatchObject({
        error: {
          code: "NOT_FOUND"
        }
      });
      expect(remove.statusCode, remove.body).toBe(404);
      expect(remove.json()).toMatchObject({
        error: {
          code: "NOT_FOUND"
        }
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("updates feed management fields and validates folder and source weight", async () => {
    const db = createEmptyDatabase();
    const folders = new SqliteFeedFolderRepository(db);
    const feeds = new SqliteFeedRepository(db);
    const folder = folders.upsert({
      id: "folder_design",
      title: "Design",
      now: 1000
    });
    feeds.upsert({
      id: "feed_manage",
      title: "Original Feed",
      feedUrl: "https://example.com/manage.xml",
      now: 1000
    });
    const app = buildServer({ db, logger: false, now: () => 8000 });

    try {
      const updated = await injectJson(app, "PATCH", "/api/feeds/feed_manage", {
        title: "Managed Feed",
        folderId: folder.id,
        enabled: false,
        sourceWeight: 0.2
      });
      expect(updated.statusCode, updated.body).toBe(200);
      expect(updated.json()).toMatchObject({
        data: {
          id: "feed_manage",
          title: "Managed Feed",
          folderId: "folder_design",
          enabled: false,
          sourceWeight: 0.2,
          updatedAt: "1970-01-01T00:00:08.000Z"
        }
      });

      const missingFolder = await injectJson(app, "PATCH", "/api/feeds/feed_manage", {
        folderId: "folder_missing"
      });
      expect(missingFolder.statusCode, missingFolder.body).toBe(404);
      expect(missingFolder.json()).toMatchObject({
        error: {
          code: "NOT_FOUND"
        }
      });

      const invalidWeight = await injectJson(app, "PATCH", "/api/feeds/feed_manage", {
        sourceWeight: 1.5
      });
      expect(invalidWeight.statusCode, invalidWeight.body).toBe(400);
      expect(invalidWeight.json()).toMatchObject({
        error: {
          code: "VALIDATION_ERROR",
          details: {
            field: "sourceWeight",
            min: -1,
            max: 1
          }
        }
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("validates folderId when creating feeds", async () => {
    const db = createEmptyDatabase();
    const app = buildServer({ db, logger: false });

    try {
      const response = await postJson(app, "/api/feeds", {
        feedUrl: "https://example.com/feed.xml",
        folderId: "folder_missing"
      });

      expect(response.statusCode, response.body).toBe(404);
      expect(response.json()).toMatchObject({
        error: {
          code: "NOT_FOUND",
          message: "Folder not found"
        }
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("soft deletes feeds and removes their articles from API lists", async () => {
    const db = createFixtureDatabase();
    const app = buildServer({ db, logger: false, now: () => 9000 });

    try {
      const deleted = await app.inject({
        method: "DELETE",
        url: "/api/feeds/feed_design"
      });
      expect(deleted.statusCode, deleted.body).toBe(200);
      expect(deleted.json()).toEqual({
        data: {
          ok: true
        }
      });

      const feeds = await app.inject({
        method: "GET",
        url: "/api/feeds"
      });
      expect(feeds.statusCode, feeds.body).toBe(200);
      expect(feeds.json().data.map((feed: { id: string }) => feed.id)).not.toContain(
        "feed_design"
      );

      const articles = await app.inject({
        method: "GET",
        url: "/api/articles?view=latest"
      });
      expect(articles.statusCode, articles.body).toBe(200);
      expect(articles.json().data).toEqual([]);
      expect(
        db.prepare("select deleted_at as deletedAt from feeds where id = ?").get("feed_design")
      ).toEqual({
        deletedAt: 9000
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("returns not found for missing feed management targets", async () => {
    const db = createEmptyDatabase();
    const app = buildServer({ db, logger: false });

    try {
      const update = await injectJson(app, "PATCH", "/api/feeds/missing", {
        title: "Missing"
      });
      const remove = await app.inject({
        method: "DELETE",
        url: "/api/feeds/missing"
      });

      expect(update.statusCode, update.body).toBe(404);
      expect(update.json()).toMatchObject({
        error: {
          code: "NOT_FOUND"
        }
      });
      expect(remove.statusCode, remove.body).toBe(404);
      expect(remove.json()).toMatchObject({
        error: {
          code: "NOT_FOUND"
        }
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("adds a feed and imports feed articles synchronously", async () => {
    const db = createEmptyDatabase();
    const app = buildServer({
      db,
      logger: false,
      now: () => Date.parse("2026-05-14T08:00:00.000Z"),
      feedFetcher: fixtureFetcher({ "https://example.com/feed.xml": fixtureRss })
    });

    try {
      const response = await postJson(app, "/api/feeds", {
        feedUrl: "https://example.com/feed.xml"
      });
      const body = response.json();

      expect(response.statusCode).toBe(200);
      expect(body).toMatchObject({
        data: {
          feed: {
            title: "Example Feed",
            feedUrl: "https://example.com/feed.xml",
            lastFetchedAt: "2026-05-14T08:00:00.000Z",
            lastSuccessAt: "2026-05-14T08:00:00.000Z",
            lastError: null
          },
          refreshJobId: expect.any(String)
        }
      });

      const articles = await app.inject({
        method: "GET",
        url: `/api/articles?feedId=${body.data.feed.id}`
      });
      const articleBody = articles.json();

      expect(articles.statusCode).toBe(200);
      expect(articleBody.data.map((article: { title: string }) => article.title)).toEqual([
        "Second fixture article",
        "First fixture article"
      ]);
      expect(
        articleBody.data.every(
          (article: { rank?: { score: number; calculatedAt: string } }) =>
            typeof article.rank?.score === "number" &&
            article.rank.calculatedAt === "2026-05-14T08:00:00.000Z"
        )
      ).toBe(true);

      const detail = await app.inject({
        method: "GET",
        url: `/api/articles/${articleBody.data[1].id}`
      });

      expect(detail.statusCode).toBe(200);
      expect(detail.json()).toMatchObject({
        data: {
          title: "First fixture article",
          contentHtml: "<p>Full first article</p>",
          contentText: "Full first article",
          extractionStatus: "feed_only"
        }
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("refreshes an existing feed and writes articles", async () => {
    const db = createEmptyDatabase();
    const feeds = new SqliteFeedRepository(db);
    feeds.upsert({
      id: "feed_fixture",
      title: "Pending Feed",
      feedUrl: "https://example.com/feed.xml",
      now: 1000
    });
    const app = buildServer({
      db,
      logger: false,
      now: () => Date.parse("2026-05-14T08:00:00.000Z"),
      feedFetcher: fixtureFetcher({ "https://example.com/feed.xml": fixtureRss })
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/feeds/feed_fixture/refresh"
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        data: {
          jobId: expect.any(String)
        }
      });

      const articles = await app.inject({
        method: "GET",
        url: "/api/articles?feedId=feed_fixture"
      });

      expect(articles.json().data).toHaveLength(2);
    } finally {
      await app.close();
      db.close();
    }
  });

  it("queues refresh-all jobs for enabled feeds and deduplicates open jobs", async () => {
    const db = createEmptyDatabase();
    const feeds = new SqliteFeedRepository(db);
    feeds.upsert({
      id: "feed_enabled",
      title: "Enabled Feed",
      feedUrl: "https://example.com/enabled.xml",
      enabled: true,
      now: 1000
    });
    feeds.upsert({
      id: "feed_disabled",
      title: "Disabled Feed",
      feedUrl: "https://example.com/disabled.xml",
      enabled: false,
      now: 1000
    });
    const app = buildServer({ db, logger: false, now: () => 2000 });

    try {
      const first = await app.inject({
        method: "POST",
        url: "/api/feeds/refresh"
      });
      const second = await app.inject({
        method: "POST",
        url: "/api/feeds/refresh"
      });

      expect(first.statusCode, first.body).toBe(200);
      expect(second.statusCode, second.body).toBe(200);
      expect(first.json().data.jobIds).toHaveLength(1);
      expect(second.json().data.jobIds).toEqual(first.json().data.jobIds);
      expect(new SqliteJobRepository(db).listOpenByType("feed_refresh")).toHaveLength(1);
    } finally {
      await app.close();
      db.close();
    }
  });

  it("does not duplicate articles when the same feed is refreshed repeatedly", async () => {
    const db = createEmptyDatabase();
    const feeds = new SqliteFeedRepository(db);
    feeds.upsert({
      id: "feed_fixture",
      title: "Pending Feed",
      feedUrl: "https://example.com/feed.xml",
      now: 1000
    });
    const app = buildServer({
      db,
      logger: false,
      now: () => Date.parse("2026-05-14T08:00:00.000Z"),
      feedFetcher: fixtureFetcher({ "https://example.com/feed.xml": fixtureRss })
    });

    try {
      await app.inject({ method: "POST", url: "/api/feeds/feed_fixture/refresh" });
      await app.inject({ method: "POST", url: "/api/feeds/feed_fixture/refresh" });

      const articles = await app.inject({
        method: "GET",
        url: "/api/articles?feedId=feed_fixture"
      });

      expect(articles.statusCode).toBe(200);
      expect(articles.json().data).toHaveLength(2);
    } finally {
      await app.close();
      db.close();
    }
  });

  it("imports OPML folders and feeds without refreshing articles", async () => {
    const db = createEmptyDatabase();
    const app = buildServer({ db, logger: false, now: () => 6000 });

    try {
      const response = await postMultipartOpml(app, fixtureOpml);

      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toEqual({
        data: {
          foldersCreated: 2,
          feedsCreated: 2,
          feedsSkipped: 1,
          errors: []
        }
      });
      expect(listFolderTitles(db)).toEqual(["Tech", "AI"]);
      expect(listFeedFolderAssignments(db)).toEqual([
        {
          title: "Design Feed",
          feedUrl: "https://example.com/design.xml",
          folderTitle: "Tech"
        },
        {
          title: "ML Feed",
          feedUrl: "https://example.com/ml.xml",
          folderTitle: "AI"
        }
      ]);
      expect(db.prepare("select count(*) as count from articles").get()).toEqual({ count: 0 });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("skips duplicate OPML feed URLs on repeated imports", async () => {
    const db = createEmptyDatabase();
    const app = buildServer({ db, logger: false, now: () => 6100 });

    try {
      const first = await app.inject({
        method: "POST",
        url: "/api/opml/import",
        headers: {
          "content-type": "application/xml"
        },
        payload: singleFeedOpml
      });
      const second = await app.inject({
        method: "POST",
        url: "/api/opml/import",
        headers: {
          "content-type": "application/xml"
        },
        payload: singleFeedOpml
      });

      expect(first.statusCode, first.body).toBe(200);
      expect(first.json()).toMatchObject({
        data: {
          foldersCreated: 1,
          feedsCreated: 1,
          feedsSkipped: 0
        }
      });
      expect(second.statusCode, second.body).toBe(200);
      expect(second.json()).toMatchObject({
        data: {
          foldersCreated: 0,
          feedsCreated: 0,
          feedsSkipped: 1
        }
      });
      expect(listFeedFolderAssignments(db)).toHaveLength(1);
    } finally {
      await app.close();
      db.close();
    }
  });

  it("returns contract-shaped error for invalid OPML import", async () => {
    const db = createEmptyDatabase();
    const app = buildServer({ db, logger: false });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/opml/import",
        headers: {
          "content-type": "application/xml"
        },
        payload: "<rss></rss>"
      });

      expect(response.statusCode, response.body).toBe(400);
      expect(response.json()).toMatchObject({
        error: {
          code: "VALIDATION_ERROR",
          message: "OPML parse failed"
        }
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("exports current folders and feeds as OPML", async () => {
    const db = createEmptyDatabase();
    const folders = new SqliteFeedFolderRepository(db);
    const feeds = new SqliteFeedRepository(db);
    const design = folders.upsert({
      id: "folder_design",
      title: "Design & Tech",
      sortOrder: 0,
      now: 1000
    });
    folders.upsert({
      id: "folder_empty",
      title: "Empty Folder",
      sortOrder: 1,
      now: 1000
    });
    feeds.upsert({
      id: "feed_design_export",
      folderId: design.id,
      title: "Design Feed",
      feedUrl: "https://example.com/design.xml",
      siteUrl: "https://example.com/design",
      now: 1000
    });
    feeds.upsert({
      id: "feed_loose_export",
      title: "Loose Feed",
      feedUrl: "https://example.com/loose.xml",
      now: 1000
    });
    const app = buildServer({ db, logger: false });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/opml/export"
      });

      expect(response.statusCode, response.body).toBe(200);
      expect(response.headers["content-type"]).toContain("application/xml");
      expect(response.body).toContain('<opml version="2.0">');
      expect(parseOpml(response.body)).toMatchObject({
        title: "Dibao Subscriptions",
        folders: ["Design & Tech", "Empty Folder"],
        feeds: [
          {
            title: "Design Feed",
            feedUrl: "https://example.com/design.xml",
            siteUrl: "https://example.com/design",
            folderTitle: "Design & Tech"
          },
          {
            title: "Loose Feed",
            feedUrl: "https://example.com/loose.xml",
            siteUrl: null,
            folderTitle: null
          }
        ]
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("keeps article identity stable when an item link changes but guid is stable", async () => {
    const db = createEmptyDatabase();
    const feeds = new SqliteFeedRepository(db);
    feeds.upsert({
      id: "feed_fixture",
      title: "Pending Feed",
      feedUrl: "https://example.com/feed.xml",
      now: 1000
    });
    const app = buildServer({
      db,
      logger: false,
      now: () => Date.parse("2026-05-14T08:00:00.000Z"),
      feedFetcher: sequenceFetcher("https://example.com/feed.xml", [
        fixtureRss,
        fixtureRssWithMovedFirstArticle
      ])
    });

    try {
      const firstRefresh = await app.inject({
        method: "POST",
        url: "/api/feeds/feed_fixture/refresh"
      });
      const secondRefresh = await app.inject({
        method: "POST",
        url: "/api/feeds/feed_fixture/refresh"
      });

      expect(firstRefresh.statusCode, firstRefresh.body).toBe(200);
      expect(secondRefresh.statusCode, secondRefresh.body).toBe(200);

      const articles = await app.inject({
        method: "GET",
        url: "/api/articles?feedId=feed_fixture"
      });
      const body = articles.json();
      const firstArticle = body.data.find(
        (article: { title: string }) => article.title === "First fixture article"
      );

      expect(articles.statusCode).toBe(200);
      expect(body.data).toHaveLength(2);
      expect(firstArticle).toMatchObject({
        url: "https://example.com/first-moved"
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("returns a contract-shaped error for invalid feedUrl", async () => {
    const db = createEmptyDatabase();
    const app = buildServer({ db, logger: false });

    try {
      const response = await postJson(app, "/api/feeds", {
        feedUrl: "not a url"
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: {
          code: "VALIDATION_ERROR",
          message: "feedUrl must be a valid URL"
        }
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("returns a contract-shaped error when feed parsing fails", async () => {
    const db = createEmptyDatabase();
    const app = buildServer({
      db,
      logger: false,
      feedFetcher: fixtureFetcher({ "https://example.com/feed.xml": "<html>no feed</html>" })
    });

    try {
      const response = await postJson(app, "/api/feeds", {
        feedUrl: "https://example.com/feed.xml"
      });

      expect(response.statusCode, response.body).toBe(502);
      expect(response.json()).toMatchObject({
        error: {
          code: "PROVIDER_ERROR",
          message: "Feed parse failed",
          details: {
            cause: expect.any(String)
          }
        }
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("lists and paginates article summaries", async () => {
    const db = createFixtureDatabase();
    const app = buildServer({ db, logger: false });

    try {
      const firstPage = await app.inject({
        method: "GET",
        url: "/api/articles?view=latest&limit=1"
      });
      const firstBody = firstPage.json();

      expect(firstPage.statusCode).toBe(200);
      expect(firstBody.data).toHaveLength(1);
      expect(firstBody.data[0]).toMatchObject({
        id: "article_recent",
        feedId: "feed_design",
        feedTitle: "Design Notes",
        title: "Dense reader interfaces",
        publishedAt: "1970-01-01T00:00:03.000Z",
        discoveredAt: "1970-01-01T00:00:03.000Z",
        state: {
          read: true,
          favorited: true,
          readLater: false,
          hidden: false,
          notInterested: false,
          readingProgress: 0.5
        }
      });
      expect(firstBody.page.nextCursor).toEqual(expect.any(String));

      const secondPage = await app.inject({
        method: "GET",
        url: `/api/articles?view=latest&limit=1&cursor=${firstBody.page.nextCursor}`
      });

      expect(secondPage.statusCode).toBe(200);
      expect(secondPage.json()).toMatchObject({
        data: [
          {
            id: "article_recommended",
            title: "Quiet ranking systems",
            state: {
              read: false,
              favorited: false,
              readLater: false,
              hidden: false,
              notInterested: false,
              readingProgress: 0
            }
          }
        ],
        page: {
          nextCursor: null
        }
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("orders recommended articles by stored rank scores", async () => {
    const db = createFixtureDatabase();
    const app = buildServer({ db, logger: false });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/articles?view=recommended"
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.map((article: { id: string }) => article.id)).toEqual([
        "article_recommended",
        "article_recent"
      ]);
    } finally {
      await app.close();
      db.close();
    }
  });

  it("returns baseline rank explanation reasons", async () => {
    const db = createFixtureDatabase();
    insertRank(db, "article_recommended", 1.2, 7000, {
      interestScore: 0.08,
      sourceScore: 0.12,
      freshnessScore: 0.2,
      stateScore: 0.5,
      penaltyScore: -0.25
    });
    const app = buildServer({ db, logger: false, now: () => 8000 });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/articles/article_recommended/explanation"
      });

      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toEqual({
        data: {
          articleId: "article_recommended",
          generatedAt: "1970-01-01T00:00:07.000Z",
          reasons: [
            {
              type: "state",
              label: "Article state increased the score",
              impact: "positive"
            },
            {
              type: "negative",
              label: "Negative interest match",
              impact: "negative"
            },
            {
              type: "freshness",
              label: "Recent article",
              impact: "positive"
            },
            {
              type: "source",
              label: "Design Notes",
              impact: "positive"
            },
            {
              type: "interest",
              label: "Interest match",
              impact: "positive"
            }
          ]
        }
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("returns fallback explanation when rank is missing", async () => {
    const db = createRankingFixtureDatabase();
    const app = buildServer({ db, logger: false, now: () => 9000 });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/articles/article_rank_neutral/explanation"
      });

      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toEqual({
        data: {
          articleId: "article_rank_neutral",
          generatedAt: "1970-01-01T00:00:09.000Z",
          reasons: [
            {
              type: "fallback",
              label: "Ranking has not been calculated yet",
              impact: "neutral"
            }
          ]
        }
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("recalculates base rank after article actions and orders recommended by score", async () => {
    const db = createRankingFixtureDatabase();
    const app = buildServer({ db, logger: false, now: () => 10_000 });

    try {
      const progress = await postJson(app, "/api/articles/article_rank_progress/actions", {
        type: "read_progress",
        progress: 0.5
      });
      const readLater = await postJson(app, "/api/articles/article_rank_later/actions", {
        type: "read_later"
      });
      const favorite = await postJson(app, "/api/articles/article_rank_favorite/actions", {
        type: "favorite"
      });

      expect(progress.statusCode, progress.body).toBe(200);
      expect(readLater.statusCode, readLater.body).toBe(200);
      expect(favorite.statusCode, favorite.body).toBe(200);

      await drainRankingJobs(db, 10_000);

      expect(getRankScore(db, "article_rank_favorite")).toBeGreaterThan(
        getRankScore(db, "article_rank_later")
      );
      expect(getRankScore(db, "article_rank_later")).toBeGreaterThan(
        getRankScore(db, "article_rank_progress")
      );

      const recommended = await app.inject({
        method: "GET",
        url: "/api/articles?view=recommended"
      });

      expect(recommended.statusCode, recommended.body).toBe(200);
      expect(recommended.json().data.map((article: { id: string }) => article.id)).toEqual([
        "article_rank_favorite",
        "article_rank_later",
        "article_rank_progress",
        "article_rank_neutral"
      ]);

      const notInterested = await postJson(
        app,
        "/api/articles/article_rank_favorite/actions",
        {
          type: "not_interested"
        }
      );
      const hide = await postJson(app, "/api/articles/article_rank_later/actions", {
        type: "hide"
      });

      expect(notInterested.statusCode, notInterested.body).toBe(200);
      expect(hide.statusCode, hide.body).toBe(200);
      await drainRankingJobs(db, 10_000);

      const filtered = await app.inject({
        method: "GET",
        url: "/api/articles?view=recommended"
      });

      expect(filtered.statusCode, filtered.body).toBe(200);
      expect(filtered.json().data.map((article: { id: string }) => article.id)).toEqual([
        "article_rank_progress",
        "article_rank_neutral"
      ]);
    } finally {
      await app.close();
      db.close();
    }
  });

  it("returns article details with content and state", async () => {
    const db = createFixtureDatabase();
    const app = buildServer({ db, logger: false });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/articles/article_recent"
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        data: {
          id: "article_recent",
          contentHtml: "<p>Reader density without visual clutter.</p>",
          contentText: "Reader density without visual clutter.",
          extractionStatus: "success",
          extractionError: null,
          rank: {
            score: 0.4,
            calculatedAt: "1970-01-01T00:00:04.000Z"
          }
        }
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("records favorite and unfavorite article actions", async () => {
    const db = createFixtureDatabase();
    const app = buildServer({ db, logger: false, now: () => 5000 });

    try {
      const favorite = await postJson(app, "/api/articles/article_recommended/actions", {
        type: "favorite"
      });
      const unfavorite = await postJson(app, "/api/articles/article_recommended/actions", {
        type: "unfavorite"
      });

      expect(favorite.statusCode, favorite.body).toBe(200);
      expect(favorite.json().data.state).toMatchObject({
        favorited: true
      });
      expect(unfavorite.statusCode, unfavorite.body).toBe(200);
      expect(unfavorite.json().data.state).toMatchObject({
        favorited: false
      });
      expect(getArticleStateRow(db, "article_recommended")).toMatchObject({
        favoritedAt: null,
        updatedAt: 5000
      });
      expect(listBehaviorEventTypes(db, "article_recommended")).toEqual([
        "favorite",
        "unfavorite"
      ]);
    } finally {
      await app.close();
      db.close();
    }
  });

  it("records read later and remove read later article actions", async () => {
    const db = createFixtureDatabase();
    const app = buildServer({ db, logger: false, now: () => 5100 });

    try {
      const readLater = await postJson(app, "/api/articles/article_recommended/actions", {
        type: "read_later"
      });
      const removeReadLater = await postJson(app, "/api/articles/article_recommended/actions", {
        type: "remove_read_later"
      });

      expect(readLater.statusCode, readLater.body).toBe(200);
      expect(readLater.json().data.state).toMatchObject({
        readLater: true
      });
      expect(removeReadLater.statusCode, removeReadLater.body).toBe(200);
      expect(removeReadLater.json().data.state).toMatchObject({
        readLater: false
      });
      expect(getArticleStateRow(db, "article_recommended")).toMatchObject({
        readLaterAt: null,
        updatedAt: 5100
      });
      expect(listBehaviorEventTypes(db, "article_recommended")).toEqual([
        "read_later",
        "remove_read_later"
      ]);
    } finally {
      await app.close();
      db.close();
    }
  });

  it("records mark read and mark unread article actions", async () => {
    const db = createFixtureDatabase();
    const app = buildServer({ db, logger: false, now: () => 5200 });

    try {
      const markRead = await postJson(app, "/api/articles/article_recommended/actions", {
        type: "mark_read"
      });
      const markUnread = await postJson(app, "/api/articles/article_recommended/actions", {
        type: "mark_unread"
      });

      expect(markRead.statusCode, markRead.body).toBe(200);
      expect(markRead.json().data.state).toMatchObject({
        read: true,
        readingProgress: 1
      });
      expect(markUnread.statusCode, markUnread.body).toBe(200);
      expect(markUnread.json().data.state).toMatchObject({
        read: false,
        readingProgress: 0
      });
      expect(getArticleStateRow(db, "article_recommended")).toMatchObject({
        readAt: null,
        readingProgress: 0,
        updatedAt: 5200
      });
      expect(listBehaviorEventTypes(db, "article_recommended")).toEqual([
        "mark_read",
        "mark_unread"
      ]);
    } finally {
      await app.close();
      db.close();
    }
  });

  it("records scrolled-past impressions as ignored until the article is opened", async () => {
    const db = createFixtureDatabase();
    let now = 5400;
    const app = buildServer({ db, logger: false, now: () => now });

    try {
      const impression = await postJson(app, "/api/articles/article_recommended/actions", {
        type: "impression",
        metadata: {
          reason: "scrolled_past_unopened"
        }
      });
      now = 5500;
      const open = await postJson(app, "/api/articles/article_recommended/actions", {
        type: "open"
      });

      expect(impression.statusCode, impression.body).toBe(200);
      expect(impression.json().data.state).toMatchObject({
        interactionStatus: "ignored",
        ignoredAt: 5400,
        openedAt: null
      });
      expect(open.statusCode, open.body).toBe(200);
      expect(open.json().data.state).toMatchObject({
        interactionStatus: "opened",
        ignoredAt: null,
        openedAt: 5500
      });
      expect(listBehaviorEventTypes(db, "article_recommended")).toEqual([
        "impression",
        "open"
      ]);
    } finally {
      await app.close();
      db.close();
    }
  });

  it("records read progress article actions", async () => {
    const db = createFixtureDatabase();
    const app = buildServer({ db, logger: false, now: () => 5300 });

    try {
      const response = await postJson(app, "/api/articles/article_recommended/actions", {
        type: "read_progress",
        progress: 0.72,
        metadata: {
          durationMs: 42000
        }
      });

      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().data.state).toMatchObject({
        read: false,
        readingProgress: 0.72
      });
      expect(getArticleStateRow(db, "article_recommended")).toMatchObject({
        readingProgress: 0.72,
        updatedAt: 5300
      });
      expect(listBehaviorEvents(db, "article_recommended")).toEqual([
        {
          eventType: "read_progress",
          eventWeight: 0.1,
          metadataJson: JSON.stringify({ durationMs: 42000, progress: 0.72 })
        }
      ]);
    } finally {
      await app.close();
      db.close();
    }
  });

  it("accepts contract-shaped article action values", async () => {
    const db = createFixtureDatabase();
    const app = buildServer({ db, logger: false, now: () => 5350 });

    try {
      const favorite = await postJson(app, "/api/articles/article_recommended/actions", {
        type: "favorite",
        value: true
      });
      const unfavorite = await postJson(app, "/api/articles/article_recommended/actions", {
        type: "favorite",
        value: false
      });
      const readProgress = await postJson(app, "/api/articles/article_recommended/actions", {
        type: "read_progress",
        value: 0.5
      });

      expect(favorite.statusCode, favorite.body).toBe(200);
      expect(favorite.json().data.state).toMatchObject({
        favorited: true
      });
      expect(unfavorite.statusCode, unfavorite.body).toBe(200);
      expect(unfavorite.json().data.state).toMatchObject({
        favorited: false
      });
      expect(readProgress.statusCode, readProgress.body).toBe(200);
      expect(readProgress.json().data.state).toMatchObject({
        readingProgress: 0.5
      });
      expect(listBehaviorEventTypes(db, "article_recommended")).toEqual([
        "favorite",
        "unfavorite",
        "read_progress"
      ]);
    } finally {
      await app.close();
      db.close();
    }
  });

  it("does not lower reading progress when a stale progress event arrives", async () => {
    const db = createFixtureDatabase();
    const app = buildServer({ db, logger: false, now: () => 5360 });

    try {
      const highProgress = await postJson(app, "/api/articles/article_recommended/actions", {
        type: "read_progress",
        progress: 0.8
      });
      const staleProgress = await postJson(app, "/api/articles/article_recommended/actions", {
        type: "read_progress",
        progress: 0.2
      });

      expect(highProgress.statusCode, highProgress.body).toBe(200);
      expect(staleProgress.statusCode, staleProgress.body).toBe(200);
      expect(staleProgress.json().data.state).toMatchObject({
        readingProgress: 0.8
      });
      expect(getArticleStateRow(db, "article_recommended")).toMatchObject({
        readingProgress: 0.8
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("returns a contract-shaped error for invalid read progress", async () => {
    const db = createFixtureDatabase();
    const app = buildServer({ db, logger: false });

    try {
      const response = await postJson(app, "/api/articles/article_recommended/actions", {
        type: "read_progress",
        progress: 1.25
      });

      expect(response.statusCode, response.body).toBe(400);
      expect(response.json()).toEqual({
        error: {
          code: "VALIDATION_ERROR",
          message: "progress or value must be a number between 0 and 1",
          details: {
            fields: ["progress", "value"],
            min: 0,
            max: 1
          }
        }
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("records not interested article actions", async () => {
    const db = createFixtureDatabase();
    const app = buildServer({ db, logger: false, now: () => 5400 });

    try {
      const response = await postJson(app, "/api/articles/article_recommended/actions", {
        type: "not_interested"
      });

      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().data.state).toMatchObject({
        notInterested: true
      });
      expect(getArticleStateRow(db, "article_recommended")).toMatchObject({
        notInterestedAt: 5400,
        updatedAt: 5400
      });
      expect(listBehaviorEvents(db, "article_recommended")).toEqual([
        {
          eventType: "not_interested",
          eventWeight: -1,
          metadataJson: null
        }
      ]);

      const articles = await app.inject({
        method: "GET",
        url: "/api/articles?view=latest"
      });
      expect(articles.statusCode, articles.body).toBe(200);
      expect(
        articles.json().data.map((article: { id: string }) => article.id)
      ).not.toContain("article_recommended");
    } finally {
      await app.close();
      db.close();
    }
  });

  it("records open and hide article actions", async () => {
    const db = createFixtureDatabase();
    const app = buildServer({ db, logger: false, now: () => 5500 });

    try {
      const open = await postJson(app, "/api/articles/article_recommended/actions", {
        type: "open"
      });
      const hide = await postJson(app, "/api/articles/article_recommended/actions", {
        type: "hide"
      });

      expect(open.statusCode, open.body).toBe(200);
      expect(open.json().data.state).toMatchObject({
        hidden: false
      });
      expect(hide.statusCode, hide.body).toBe(200);
      expect(hide.json().data.state).toMatchObject({
        hidden: true
      });
      expect(getArticleStateRow(db, "article_recommended")).toMatchObject({
        hiddenAt: 5500,
        lastOpenedAt: 5500,
        updatedAt: 5500
      });
      expect(listBehaviorEventTypes(db, "article_recommended")).toEqual(["open", "hide"]);
    } finally {
      await app.close();
      db.close();
    }
  });

  it("returns a contract-shaped error when article action target is missing", async () => {
    const db = createFixtureDatabase();
    const app = buildServer({ db, logger: false });

    try {
      const response = await postJson(app, "/api/articles/missing/actions", {
        type: "favorite"
      });

      expect(response.statusCode, response.body).toBe(404);
      expect(response.json()).toEqual({
        error: {
          code: "NOT_FOUND",
          message: "Article not found"
        }
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("returns a contract-shaped error for invalid article actions", async () => {
    const db = createFixtureDatabase();
    const app = buildServer({ db, logger: false });

    try {
      const response = await postJson(app, "/api/articles/article_recommended/actions", {
        type: "archive"
      });

      expect(response.statusCode, response.body).toBe(400);
      expect(response.json()).toEqual({
        error: {
          code: "VALIDATION_ERROR",
          message:
            "type must be impression, open, mark_read, mark_unread, favorite, unfavorite, read_later, remove_read_later, hide, not_interested, or read_progress"
        }
      });
    } finally {
      await app.close();
      db.close();
    }
  });

  it("returns a contract-shaped error for missing articles", async () => {
    const db = createFixtureDatabase();
    const app = buildServer({ db, logger: false });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/articles/missing"
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        error: {
          code: "NOT_FOUND",
          message: "Article not found"
        }
      });
    } finally {
      await app.close();
      db.close();
    }
  });
});

function createEmptyDatabase(): DibaoDatabase {
  return openDatabase(tempDatabasePath(), { migrate: true });
}

function createFixtureDatabase(): DibaoDatabase {
  const db = createEmptyDatabase();
  const feeds = new SqliteFeedRepository(db);
  const articles = new SqliteArticleRepository(db);

  feeds.upsert({
    id: "feed_design",
    title: "Design Notes",
    feedUrl: "https://example.com/feed.xml",
    siteUrl: "https://example.com",
    now: 1000
  });
  feeds.upsert({
    id: "feed_disabled",
    title: "Disabled Feed",
    feedUrl: "https://example.com/disabled.xml",
    enabled: false,
    now: 1000
  });

  articles.upsert({
    id: "article_recommended",
    feedId: "feed_design",
    url: "https://example.com/recommended",
    canonicalUrl: "https://example.com/recommended",
    title: "Quiet ranking systems",
    summary: "Ranking without theatrics.",
    publishedAt: 2000,
    discoveredAt: 2000,
    dedupeKey: "recommended",
    now: 2000
  });
  articles.upsert({
    id: "article_recent",
    feedId: "feed_design",
    url: "https://example.com/recent",
    canonicalUrl: "https://example.com/recent",
    title: "Dense reader interfaces",
    summary: "A practical reader layout.",
    publishedAt: 3000,
    discoveredAt: 3000,
    dedupeKey: "recent",
    now: 3000
  });
  articles.upsertContent({
    articleId: "article_recent",
    contentHtml: "<p>Reader density without visual clutter.</p>",
    contentText: "Reader density without visual clutter.",
    extractionStatus: "success",
    extractedAt: 3000,
    now: 3000
  });

  db.prepare(
    `
      insert into article_states (
        article_id,
        read_at,
        favorited_at,
        read_later_at,
        hidden_at,
        not_interested_at,
        reading_progress,
        last_opened_at,
        updated_at
      )
      values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run("article_recent", 3500, 3500, null, null, null, 0.5, 3500, 3500);

  insertRank(db, "article_recommended", 0.9, 4000);
  insertRank(db, "article_recent", 0.4, 4000);

  return db;
}

function createRankingFixtureDatabase(): DibaoDatabase {
  const db = createEmptyDatabase();
  const feeds = new SqliteFeedRepository(db);
  const articles = new SqliteArticleRepository(db);

  feeds.upsert({
    id: "feed_ranking",
    title: "Ranking Feed",
    feedUrl: "https://example.com/ranking.xml",
    now: 1000
  });

  for (const id of [
    "article_rank_favorite",
    "article_rank_later",
    "article_rank_progress",
    "article_rank_neutral"
  ]) {
    articles.upsert({
      id,
      feedId: "feed_ranking",
      url: `https://example.com/${id}`,
      canonicalUrl: `https://example.com/${id}`,
      title: id,
      summary: "Ranking fixture article.",
      publishedAt: 1000,
      discoveredAt: 1000,
      dedupeKey: id,
      now: 1000
    });
  }

  return db;
}

function createActiveEmbeddingDiagnosticsFixture(
  db: DibaoDatabase,
  input: { providerTestStatus: "success" | "failed" }
) {
  const embeddings = new SqliteEmbeddingRepository(db);
  embeddings.upsertProvider({
    id: "provider_diagnostics",
    type: "openai_compatible",
    name: "Diagnostics Provider",
    baseUrl: "https://api.example.com/v1",
    model: "fixture-embedding",
    dimension: 3,
    apiKeyEncrypted: "plain:v1:secret",
    enabled: true,
    now: 5000
  });
  embeddings.recordProviderTestResult({
    id: "provider_diagnostics",
    status: input.providerTestStatus,
    error: input.providerTestStatus === "failed" ? "Provider request failed" : null,
    testedAt: 5000
  });
  const index = embeddings.createIndex({
    id: "index_diagnostics",
    providerId: "provider_diagnostics",
    model: "fixture-embedding",
    dimension: 3,
    status: "active",
    now: 5000
  });

  return {
    provider: embeddings.findProviderById("provider_diagnostics"),
    index
  };
}

function insertRank(
  db: DibaoDatabase,
  articleId: string,
  score: number,
  calculatedAt: number,
  components: {
    interestScore?: number;
    sourceScore?: number;
    freshnessScore?: number;
    stateScore?: number;
    diversityScore?: number;
    penaltyScore?: number;
  } = {}
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
      values (?, 'base', null, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(article_id, rank_context) do update set
        score = excluded.score,
        interest_score = excluded.interest_score,
        source_score = excluded.source_score,
        freshness_score = excluded.freshness_score,
        state_score = excluded.state_score,
        diversity_score = excluded.diversity_score,
        penalty_score = excluded.penalty_score,
        calculated_at = excluded.calculated_at
    `
  ).run(
    articleId,
    score,
    components.interestScore ?? 0,
    components.sourceScore ?? 0,
    components.freshnessScore ?? 0,
    components.stateScore ?? 0,
    components.diversityScore ?? 0,
    components.penaltyScore ?? 0,
    calculatedAt
  );
}

function getRankScore(db: DibaoDatabase, articleId: string): number {
  const row = db
    .prepare(
      `
        select score
        from article_rank_scores
        where article_id = ?
          and rank_context = 'base'
      `
    )
    .get(articleId) as { score: number } | undefined;

  if (!row) {
    throw new Error(`Missing rank score for ${articleId}`);
  }

  return row.score;
}

async function drainRankingJobs(db: DibaoDatabase, now: number): Promise<void> {
  const jobs = new SqliteJobRepository(db);
  const embeddings = new SqliteEmbeddingRepository(db);
  const profiles = new SqliteProfileRepository(db);
  const rankings = new SqliteRankingRepository(db);
  const ranking = new RecommendationRankingService({
    embeddings,
    profiles,
    rankings,
    now: () => now
  });
  const rankingJobs = new RankingRecalculateJobService({
    jobs,
    ranking,
    now: () => now
  });
  const runner = new JobRunner({
    jobs,
    handlers: {
      [RANKING_RECALCULATE_JOB_TYPE]: (job) => rankingJobs.handleRankingRecalculateJob(job)
    },
    now: () => now
  });

  await runner.drainDue();
}

function tempDatabasePath(): string {
  const dir = createTempDir();
  return join(dir, "dibao.sqlite");
}

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "dibao-server-"));
  tempDirs.push(dir);
  return dir;
}

function fixtureFetcher(fixtures: Record<string, string>): FeedFetcher {
  return async (url) => ({
    ok: fixtures[url] !== undefined,
    status: fixtures[url] === undefined ? 404 : 200,
    statusText: fixtures[url] === undefined ? "Not Found" : "OK",
    async text() {
      return fixtures[url] ?? "";
    }
  });
}

function embeddingFetcherFixture(
  calls: Array<{ url: string; authorization: string | null; inputCount: number }>,
  dimension: number
): typeof fetch {
  return async (input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { input?: unknown };
    const values = Array.isArray(body.input) ? body.input : [body.input];
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      authorization: headers.get("authorization"),
      inputCount: values.length
    });

    return new Response(
      JSON.stringify({
        data: values.map((_, index) => ({
          index,
          embedding: Array.from({ length: dimension }, (_value, vectorIndex) => vectorIndex + 1)
        }))
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      }
    );
  };
}

function ollamaEmbeddingFetcherFixture(
  calls: Array<{ url: string; authorization: string | null; inputCount: number; model: string }>,
  dimension: number
): typeof fetch {
  return async (input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { input?: unknown; model?: unknown };
    const values = Array.isArray(body.input) ? body.input : [body.input];
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      authorization: headers.get("authorization"),
      inputCount: values.length,
      model: typeof body.model === "string" ? body.model : ""
    });

    return new Response(
      JSON.stringify({
        model: body.model,
        embeddings: values.map(() =>
          Array.from({ length: dimension }, (_value, vectorIndex) => vectorIndex + 1)
        )
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      }
    );
  };
}

function sequenceFetcher(url: string, responses: string[]): FeedFetcher {
  let requestCount = 0;

  return async (requestedUrl) => {
    const xml =
      requestedUrl === url
        ? responses[Math.min(requestCount, responses.length - 1)]
        : undefined;
    requestCount += 1;

    return {
      ok: xml !== undefined,
      status: xml === undefined ? 404 : 200,
      statusText: xml === undefined ? "Not Found" : "OK",
      async text() {
        return xml ?? "";
      }
    };
  };
}

async function postJson(app: ReturnType<typeof buildServer>, url: string, payload: unknown) {
  return injectJson(app, "POST", url, payload);
}

async function injectJson(
  app: ReturnType<typeof buildServer>,
  method: "PATCH" | "POST",
  url: string,
  payload: unknown
) {
  return app.inject({
    method,
    url,
    headers: {
      "content-type": "application/json"
    },
    payload: JSON.stringify(payload)
  });
}

async function injectJsonWithCookie(
  app: ReturnType<typeof buildServer>,
  method: "PATCH" | "POST",
  url: string,
  cookie: string,
  payload: unknown
) {
  return app.inject({
    method,
    url,
    headers: {
      "content-type": "application/json",
      cookie
    },
    payload: JSON.stringify(payload)
  });
}

function cookieHeaderFromSetCookie(value: string | string[] | undefined): string {
  const cookie = Array.isArray(value) ? value[0] : value;
  if (!cookie) {
    throw new Error("Expected set-cookie header");
  }

  return cookie.split(";")[0];
}

function expectSessionCookieAttributes(
  value: string | string[] | undefined,
  secure: boolean
): void {
  const cookie = Array.isArray(value) ? value[0] : value;
  expect(cookie).toBeDefined();
  expect(cookie).toContain("dibao_session=");
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=Lax");
  expect(cookie).toContain("Path=/");
  expect(cookie).toContain("Max-Age=2592000");
  expect(cookie).toMatch(/Expires=[^;]+GMT/);
  if (secure) {
    expect(cookie).toContain("Secure");
  } else {
    expect(cookie).not.toContain("Secure");
  }
}

function expectClearSessionCookie(value: string | string[] | undefined): void {
  const cookie = Array.isArray(value) ? value[0] : value;
  expect(cookie).toBeDefined();
  expect(cookie).toContain("dibao_session=");
  expect(cookie).toContain("Max-Age=0");
  expect(cookie).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=Lax");
  expect(cookie).toContain("Path=/");
}

async function postMultipartOpml(app: ReturnType<typeof buildServer>, xml: string) {
  const boundary = `dibao-${Date.now()}`;
  const payload = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="subscriptions.opml"',
    "Content-Type: text/xml",
    "",
    xml,
    `--${boundary}--`,
    ""
  ].join("\r\n");

  return app.inject({
    method: "POST",
    url: "/api/opml/import",
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`
    },
    payload
  });
}

function getArticleStateRow(db: DibaoDatabase, articleId: string) {
  return db
    .prepare(
      `
        select
          read_at as readAt,
          favorited_at as favoritedAt,
          read_later_at as readLaterAt,
          hidden_at as hiddenAt,
          not_interested_at as notInterestedAt,
          reading_progress as readingProgress,
          last_opened_at as lastOpenedAt,
          updated_at as updatedAt
        from article_states
        where article_id = ?
      `
    )
    .get(articleId);
}

function listBehaviorEventTypes(db: DibaoDatabase, articleId: string): string[] {
  return listBehaviorEvents(db, articleId).map((event) => event.eventType);
}

function listBehaviorEvents(db: DibaoDatabase, articleId: string) {
  return db
    .prepare(
      `
        select
          event_type as eventType,
          event_weight as eventWeight,
          metadata_json as metadataJson
        from behavior_events
        where article_id = ?
        order by rowid
      `
    )
    .all(articleId) as Array<{
    eventType: string;
    eventWeight: number;
    metadataJson: string | null;
    }>;
}

function listFolderTitles(db: DibaoDatabase): string[] {
  return db
    .prepare(
      `
        select title
        from feed_folders
        where deleted_at is null
        order by sort_order, title collate nocase
      `
    )
    .all()
    .map((row) => (row as { title: string }).title);
}

function listFeedFolderAssignments(db: DibaoDatabase) {
  return db
    .prepare(
      `
        select
          feeds.title,
          feeds.feed_url as feedUrl,
          feed_folders.title as folderTitle
        from feeds
        left join feed_folders on feed_folders.id = feeds.folder_id
        where feeds.deleted_at is null
        order by feeds.title collate nocase
      `
    )
    .all() as Array<{
    title: string;
    feedUrl: string;
    folderTitle: string | null;
  }>;
}

const fixtureOpml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Fixture Subscriptions</title></head>
  <body>
    <outline text="Tech">
      <outline type="rss" text="Design Feed" xmlUrl="https://example.com/design.xml" htmlUrl="https://example.com/design" />
      <outline text="AI">
        <outline type="rss" title="ML Feed" xmlUrl="https://example.com/ml.xml" htmlUrl="https://example.com/ml" />
        <outline type="rss" title="ML Duplicate" xmlUrl="https://example.com/ml.xml" />
      </outline>
    </outline>
  </body>
</opml>`;

const singleFeedOpml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <body>
    <outline text="News">
      <outline type="rss" text="News Feed" xmlUrl="https://example.com/news.xml" />
    </outline>
  </body>
</opml>`;

const fixtureRss = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Example Feed</title>
    <link>https://example.com/</link>
    <description>Fixture feed</description>
    <item>
      <title>First fixture article</title>
      <link>https://example.com/first</link>
      <guid>fixture-first</guid>
      <author>Ada</author>
      <pubDate>Thu, 14 May 2026 07:00:00 GMT</pubDate>
      <description>First summary</description>
      <content:encoded><![CDATA[<p>Full first article</p>]]></content:encoded>
    </item>
    <item>
      <title>Second fixture article</title>
      <link>https://example.com/second</link>
      <guid>fixture-second</guid>
      <pubDate>Thu, 14 May 2026 07:30:00 GMT</pubDate>
      <description>Second summary</description>
    </item>
  </channel>
</rss>`;

const fixtureRssWithMovedFirstArticle = fixtureRss.replace(
  "https://example.com/first",
  "https://example.com/first-moved"
);
