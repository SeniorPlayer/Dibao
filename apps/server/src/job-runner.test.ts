import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  openDatabase,
  SqliteArticleRepository,
  SqliteAppSettingsRepository,
  SqliteEmbeddingRepository,
  SqliteFeedRepository,
  SqliteJobRepository,
  SqliteProfileRepository,
  SqliteRankingRepository,
  SqliteVecVectorStore,
  type DibaoDatabase,
  type JobRow
} from "@dibao/db";
import {
  ArticleRetentionService,
  DEFAULT_ARTICLE_RETENTION_DAYS,
  RETENTION_ARTICLE_DAYS_SETTING_KEY
} from "./article-retention-service.js";
import {
  EmbeddingJobService,
  EMBEDDING_GENERATE_JOB_TYPE
} from "./embedding-job-service.js";
import { EmbeddingProviderService } from "./embedding-provider-service.js";
import { EmbeddingProviderError, type EmbeddingProviderAdapter } from "./embedding/types.js";
import {
  DEFAULT_FEED_REFRESH_INTERVAL_MS,
  FeedRefreshCoordinator,
  FeedRefreshJobService,
  FeedRefreshScheduler
} from "./feed-refresh-job-service.js";
import { FeedRefreshService, type FeedFetcher } from "./feed-refresh-service.js";
import { JobRunner } from "./job-runner.js";
import {
  ProfileDecayJobService,
  PROFILE_DECAY_JOB_TYPE
} from "./profile-decay-job-service.js";
import { ProfileService } from "./profile-service.js";
import {
  RankingRecalculateJobService,
  RANKING_RECALCULATE_JOB_TYPE
} from "./ranking-job-service.js";
import { RecommendationRankingService } from "./ranking-service.js";
import {
  RetentionCleanupJobService,
  RetentionCleanupScheduler
} from "./retention-cleanup-job-service.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("job runner foundation", () => {
  it("continues running queued jobs after one job fails", async () => {
    const db = createEmptyDatabase();
    const jobs = new SqliteJobRepository(db);
    const calls: string[] = [];

    try {
      jobs.enqueue({
        id: "job_fail",
        type: "feed_refresh",
        payloadJson: JSON.stringify({ feedId: "feed_fail" }),
        maxAttempts: 1,
        runAfter: 1000,
        now: 1000
      });
      jobs.enqueue({
        id: "job_success",
        type: "feed_refresh",
        payloadJson: JSON.stringify({ feedId: "feed_success" }),
        maxAttempts: 1,
        runAfter: 1000,
        now: 1000
      });

      const runner = new JobRunner({
        jobs,
        handlers: {
          feed_refresh: (job) => {
            calls.push(job.id);
            if (job.id === "job_fail") {
              throw new Error("fixture failure");
            }
          }
        },
        now: () => 2000,
        retryDelayMs: 1000
      });

      await expect(runner.drainDue()).resolves.toBe(2);
      expect(calls).toEqual(["job_fail", "job_success"]);
      expect(jobs.findById("job_fail")).toMatchObject({
        status: "failed",
        attempts: 1,
        error: "fixture failure"
      });
      expect(jobs.findById("job_success")).toMatchObject({
        status: "succeeded",
        attempts: 1,
        error: null
      });
    } finally {
      db.close();
    }
  });

  it("fails invalid feed refresh payloads without crashing the runner", async () => {
    const db = createEmptyDatabase();
    const jobs = new SqliteJobRepository(db);
    const feeds = new SqliteFeedRepository(db);
    let refreshCalled = false;

    try {
      jobs.enqueue({
        id: "job_invalid_payload",
        type: "feed_refresh",
        payloadJson: JSON.stringify({ feedId: 42 }),
        maxAttempts: 3,
        runAfter: 1000,
        now: 1000
      });
      const refreshJobs = new FeedRefreshJobService({
        feeds,
        jobs,
        refresher: {
          async refreshFeed() {
            refreshCalled = true;
            throw new Error("should not refresh invalid payload");
          }
        },
        now: () => 2000
      });
      const runner = new JobRunner({
        jobs,
        handlers: {
          feed_refresh: (job) => refreshJobs.handleFeedRefreshJob(job)
        },
        now: () => 2000
      });

      await expect(runner.runDueOnce()).resolves.toMatchObject({
        id: "job_invalid_payload"
      });
      expect(refreshCalled).toBe(false);
      expect(jobs.findById("job_invalid_payload")).toMatchObject({
        status: "failed",
        attempts: 1,
        error: "Invalid feed_refresh job payload"
      });
    } finally {
      db.close();
    }
  });

  it("resolves retention days using setting, env, then default with invalid fallback", () => {
    const db = createEmptyDatabase();

    try {
      const settings = new SqliteAppSettingsRepository(db);
      const retention = new ArticleRetentionService({
        settings,
        articles: new SqliteArticleRepository(db),
        vectorStore: new SqliteVecVectorStore(db),
        env: {
          DIBAO_ARTICLE_RETENTION_DAYS: "45"
        }
      });

      expect(retention.getRetentionDays()).toBe(45);

      settings.setJson(RETENTION_ARTICLE_DAYS_SETTING_KEY, 30, 1000);
      expect(retention.getRetentionDays()).toBe(30);

      settings.setJson(RETENTION_ARTICLE_DAYS_SETTING_KEY, 0, 1000);
      expect(retention.getRetentionDays()).toBe(0);

      settings.setJson(RETENTION_ARTICLE_DAYS_SETTING_KEY, "invalid", 1000);
      expect(retention.getRetentionDays()).toBe(DEFAULT_ARTICLE_RETENTION_DAYS);

      settings.delete(RETENTION_ARTICLE_DAYS_SETTING_KEY);
      const invalidEnv = new ArticleRetentionService({
        settings,
        articles: new SqliteArticleRepository(db),
        vectorStore: new SqliteVecVectorStore(db),
        env: {
          DIBAO_ARTICLE_RETENTION_DAYS: "-1"
        }
      });
      expect(invalidEnv.getRetentionDays()).toBe(DEFAULT_ARTICLE_RETENTION_DAYS);
    } finally {
      db.close();
    }
  });

  it("skips article retention cleanup when retention days is zero", () => {
    const db = createEmptyDatabase();

    try {
      const settings = new SqliteAppSettingsRepository(db);
      const feeds = new SqliteFeedRepository(db);
      const articles = new SqliteArticleRepository(db);
      const vectorStore = new SqliteVecVectorStore(db);
      const now = Date.parse("2026-05-15T00:00:00.000Z");
      settings.setJson(RETENTION_ARTICLE_DAYS_SETTING_KEY, 0, now);
      feeds.upsert({
        id: "feed_retention_zero",
        title: "Retention Zero Feed",
        feedUrl: "https://example.com/retention-zero.xml",
        now
      });
      const article = articles.upsert({
        id: "article_retention_zero",
        feedId: "feed_retention_zero",
        url: "https://example.com/retention-zero",
        canonicalUrl: "https://example.com/retention-zero",
        title: "Kept forever",
        summary: "Retention zero should not clean this article.",
        publishedAt: now - 400 * 24 * 60 * 60 * 1000,
        discoveredAt: now - 400 * 24 * 60 * 60 * 1000,
        dedupeKey: "article_retention_zero",
        now
      });

      const retention = new ArticleRetentionService({
        settings,
        articles,
        vectorStore,
        now: () => now,
        env: {}
      });

      expect(retention.runCleanup()).toMatchObject({
        retentionDays: 0,
        cutoff: 0,
        candidateArticles: 0,
        articlesSoftDeleted: 0
      });
      expect(articles.findById(article.id)).toMatchObject({
        id: article.id,
        deletedAt: null
      });
    } finally {
      db.close();
    }
  });

  it("fails invalid retention cleanup payloads without retrying", async () => {
    const db = createEmptyDatabase();
    const jobs = new SqliteJobRepository(db);
    let cleanupRuns = 0;

    try {
      jobs.enqueue({
        id: "job_invalid_retention",
        type: "retention_cleanup",
        payloadJson: JSON.stringify({ articleId: "not-accepted" }),
        maxAttempts: 3,
        runAfter: 1000,
        now: 1000
      });
      const cleanupJobs = new RetentionCleanupJobService({
        jobs,
        retention: {
          runCleanup() {
            cleanupRuns += 1;
            return undefined as never;
          }
        },
        now: () => 2000
      });
      const runner = new JobRunner({
        jobs,
        handlers: {
          retention_cleanup: (job) => cleanupJobs.handleRetentionCleanupJob(job)
        },
        now: () => 2000
      });

      await expect(runner.runDueOnce()).resolves.toMatchObject({
        id: "job_invalid_retention"
      });
      expect(cleanupRuns).toBe(0);
      expect(jobs.findById("job_invalid_retention")).toMatchObject({
        status: "failed",
        attempts: 1,
        error: "Invalid retention_cleanup job payload"
      });
    } finally {
      db.close();
    }
  });

  it("retention cleanup prevents deleted articles from being restored by feed refresh", async () => {
    const db = createEmptyDatabase();
    const feeds = new SqliteFeedRepository(db);
    const articles = new SqliteArticleRepository(db);
    const settings = new SqliteAppSettingsRepository(db);
    const vectorStore = new SqliteVecVectorStore(db);
    const embeddings = new SqliteEmbeddingRepository(db);
    const rankings = new SqliteRankingRepository(db);
    const recalculatedArticleIds: string[] = [];
    const now = Date.parse("2026-05-15T00:00:00.000Z");

    try {
      feeds.upsert({
        id: "feed_retention",
        title: "Retention Feed",
        feedUrl: "https://example.com/retention.xml",
        now
      });
      const refreshService = new FeedRefreshService({
        db,
        feeds,
        articles,
        fetcher: fixtureFetcher({
          "https://example.com/retention.xml": retentionFixtureRss
        }),
        ranking: {
          recalculateArticle(articleId: string) {
            recalculatedArticleIds.push(articleId);
            return 1;
          },
          recalculateArticles(articleIds: string[]) {
            recalculatedArticleIds.push(...articleIds);
            return articleIds.length;
          },
          recalculateAll() {
            return 0;
          }
        },
        now: () => now
      });

      await refreshService.refreshFeed("feed_retention");
      const article = articles.list({ feedId: "feed_retention" }).items[0];
      expect(article).toMatchObject({
        title: "Retention deleted article"
      });
      expect(recalculatedArticleIds).toEqual([article.id]);

      rankings.upsertBaseScore({
        articleId: article.id,
        score: 0.5,
        interestScore: 0,
        sourceScore: 0,
        freshnessScore: 0,
        stateScore: 0,
        diversityScore: 0,
        penaltyScore: 0,
        calculatedAt: now
      });
      embeddings.upsertProvider({
        id: "provider_retention",
        type: "embedded_local",
        name: "Retention Fixture",
        model: "fixture-4d",
        dimension: 4,
        enabled: true,
        now
      });
      embeddings.createIndex({
        id: "index_retention",
        providerId: "provider_retention",
        model: "fixture-4d",
        dimension: 4,
        now
      });
      vectorStore.upsertArticleVector({
        articleId: article.id,
        embeddingIndexId: "index_retention",
        vector: [0.9, 0.1, 0.05, 0.02],
        contentHash: "hash_retention",
        now
      });

      const retention = new ArticleRetentionService({
        settings,
        articles,
        vectorStore,
        now: () => now,
        env: {}
      });
      expect(retention.runCleanup()).toMatchObject({
        candidateArticles: 1,
        articlesSoftDeleted: 1,
        contentsDeleted: 1,
        rankScoresDeleted: 1,
        vectorsDeleted: 1
      });
      expect(articles.findDetailById(article.id)).toBeNull();
      expect(countRows(db, "article_contents", article.id)).toBe(0);
      expect(countRows(db, "article_embeddings", article.id)).toBe(0);
      expect(countRows(db, "article_rank_scores", article.id)).toBe(0);

      recalculatedArticleIds.length = 0;
      await refreshService.refreshFeed("feed_retention");

      expect(articles.findById(article.id)).toMatchObject({
        status: "deleted",
        deletedAt: now
      });
      expect(articles.findDetailById(article.id)).toBeNull();
      expect(articles.list({ feedId: "feed_retention" }).items).toHaveLength(0);
      expect(countRows(db, "article_contents", article.id)).toBe(0);
      expect(countRows(db, "article_embeddings", article.id)).toBe(0);
      expect(countRows(db, "article_rank_scores", article.id)).toBe(0);
      expect(recalculatedArticleIds).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("refreshes enabled feeds through jobs and isolates feed failures", async () => {
    const db = createEmptyDatabase();
    const feeds = new SqliteFeedRepository(db);
    const articles = new SqliteArticleRepository(db);
    const jobs = new SqliteJobRepository(db);
    let jobSequence = 0;

    try {
      feeds.upsert({
        id: "feed_success",
        title: "Alpha Success Feed",
        feedUrl: "https://example.com/success.xml",
        enabled: true,
        now: 1000
      });
      feeds.upsert({
        id: "feed_failure",
        title: "Zulu Failure Feed",
        feedUrl: "https://example.com/failure.xml",
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
      feeds.upsert({
        id: "feed_not_due",
        title: "Not Due Feed",
        feedUrl: "https://example.com/not-due.xml",
        enabled: true,
        now: 1000
      });
      feeds.recordFetchSuccess("feed_not_due", 1500);

      const refreshService = new FeedRefreshService({
        db,
        feeds,
        articles,
        fetcher: fixtureFetcher({
          "https://example.com/success.xml": fixtureRss
        }),
        now: () => 3000
      });
      const refreshJobs = new FeedRefreshJobService({
        feeds,
        jobs,
        refresher: new FeedRefreshCoordinator({ refreshService }),
        jobIdFactory: () => `job_${++jobSequence}`,
        maxAttempts: 1,
        now: () => 2000
      });
      const runner = new JobRunner({
        jobs,
        handlers: {
          feed_refresh: (job) => refreshJobs.handleFeedRefreshJob(job)
        },
        now: () => 3000,
        retryDelayMs: 1000
      });

      const firstBatch = refreshJobs.enqueueAllEnabledFeeds();
      const secondBatch = refreshJobs.enqueueAllEnabledFeeds();
      expect(firstBatch.map((job) => job.id)).toEqual(["job_1", "job_2"]);
      expect(secondBatch.map((job) => job.id)).toEqual(["job_1", "job_2"]);
      expect(jobs.listOpenByType("feed_refresh")).toHaveLength(2);

      await expect(runner.drainDue()).resolves.toBe(2);
      expect(articles.list({ feedId: "feed_success" })).toMatchObject({
        items: [
          expect.objectContaining({
            title: "Job runner article"
          })
        ]
      });
      expect(feeds.findById("feed_success")).toMatchObject({
        lastFetchedAt: 3000,
        lastSuccessAt: 3000,
        lastError: null
      });
      expect(feeds.findById("feed_failure")).toMatchObject({
        lastFetchedAt: 3000,
        lastSuccessAt: null,
        lastError: "Feed fetch failed"
      });
      expect(feeds.findById("feed_disabled")).toMatchObject({
        lastFetchedAt: null,
        lastSuccessAt: null,
        lastError: null
      });
      expect(feeds.findById("feed_not_due")).toMatchObject({
        lastFetchedAt: 1500,
        lastSuccessAt: 1500,
        lastError: null
      });
      expect(jobs.findById("job_1")).toMatchObject({
        status: "succeeded"
      });
      expect(jobs.findById("job_2")).toMatchObject({
        status: "failed",
        error: "Feed fetch failed"
      });
    } finally {
      db.close();
    }
  });

  it("fails invalid embedding payloads without retrying", async () => {
    const fixture = createEmbeddingPipelineFixture();
    const { db, jobs, embeddingJobs } = fixture;
    let adapterCalls = 0;

    try {
      jobs.enqueue({
        id: "job_invalid_embedding",
        type: EMBEDDING_GENERATE_JOB_TYPE,
        payloadJson: JSON.stringify({ embeddingIndexId: "index_openai", articleIds: [] }),
        maxAttempts: 3,
        runAfter: 1000,
        now: 1000
      });
      fixture.adapter.embedBatch = async () => {
        adapterCalls += 1;
        return [];
      };
      const runner = new JobRunner({
        jobs,
        handlers: {
          embedding_generate: (job) => embeddingJobs.handleEmbeddingGenerateJob(job)
        },
        now: () => 2000
      });

      await expect(runner.runDueOnce()).resolves.toMatchObject({
        id: "job_invalid_embedding"
      });
      expect(adapterCalls).toBe(0);
      expect(jobs.findById("job_invalid_embedding")).toMatchObject({
        status: "failed",
        attempts: 1,
        error: "Invalid embedding_generate job payload"
      });
    } finally {
      db.close();
    }
  });

  it("filters retention-deleted embedding payload articles before provider calls", async () => {
    const fixture = createEmbeddingPipelineFixture();
    const { db, articles, jobs, embeddingJobs } = fixture;

    try {
      const disabledFeeds = new SqliteFeedRepository(db);
      disabledFeeds.upsert({
        id: "feed_embedding_disabled",
        title: "Disabled Embedding Feed",
        feedUrl: "https://example.com/disabled-embedding.xml",
        enabled: false,
        now: 1000
      });
      insertEmbeddingArticleFixture(db, articles, "article_active", "Active embedding article");
      insertEmbeddingArticleFixture(db, articles, "article_deleted", "Deleted embedding article");
      insertEmbeddingArticleFixture(
        db,
        articles,
        "article_disabled_feed",
        "Disabled feed embedding article",
        "feed_embedding_disabled"
      );
      db.prepare("update articles set status = 'deleted', deleted_at = ? where id = ?").run(
        1500,
        "article_deleted"
      );
      jobs.enqueue({
        id: "job_embedding_batch",
        type: EMBEDDING_GENERATE_JOB_TYPE,
        payloadJson: JSON.stringify({
          embeddingIndexId: "index_openai",
          articleIds: ["article_active", "article_deleted", "article_disabled_feed"]
        }),
        maxAttempts: 1,
        runAfter: 1000,
        now: 1000
      });
      const seenIds: string[] = [];
      fixture.adapter.embedBatch = async ({ items }) => {
        seenIds.push(...items.map((input) => input.id));
        return items.map((input) => ({
          id: input.id,
          vector: [0.1, 0.2, 0.3]
        }));
      };
      const runner = new JobRunner({
        jobs,
        handlers: {
          embedding_generate: (job) => embeddingJobs.handleEmbeddingGenerateJob(job)
        },
        now: () => 2000
      });

      await expect(runner.runDueOnce()).resolves.toMatchObject({
        id: "job_embedding_batch"
      });
      expect(seenIds).toEqual(["article_active"]);
      expect(countRows(db, "article_embeddings", "article_active")).toBe(1);
      expect(countRows(db, "article_embeddings", "article_deleted")).toBe(0);
      expect(countRows(db, "article_embeddings", "article_disabled_feed")).toBe(0);
      expect(countRows(db, "article_vector_rows", "article_active")).toBe(1);
      expect(countRows(db, "article_vector_rows", "article_deleted")).toBe(0);
      expect(countRows(db, "article_vector_rows", "article_disabled_feed")).toBe(0);
      expect(jobs.findById("job_embedding_batch")).toMatchObject({
        status: "succeeded"
      });
    } finally {
      db.close();
    }
  });

  it("strips HTML from embedding provider input text", async () => {
    const fixture = createEmbeddingPipelineFixture();
    const { db, articles, jobs, embeddingJobs } = fixture;

    try {
      insertEmbeddingArticleFixture(db, articles, "article_html_embedding", "HTML embedding article");
      db.prepare("update articles set title = ?, summary = ? where id = ?").run(
        "Plain <em>title</em>",
        "<p>Summary &amp; <strong>context</strong><script>discard()</script></p>",
        "article_html_embedding"
      );
      articles.upsertContent({
        articleId: "article_html_embedding",
        contentHtml: "<article><p>Body <b>HTML</b></p></article>",
        contentText: "Body <b>HTML</b> &nbsp; text<style>.hidden{}</style>",
        extractionStatus: "success",
        extractedAt: 1000,
        now: 1000
      });
      jobs.enqueue({
        id: "job_embedding_html",
        type: EMBEDDING_GENERATE_JOB_TYPE,
        payloadJson: JSON.stringify({
          embeddingIndexId: "index_openai",
          articleIds: ["article_html_embedding"]
        }),
        maxAttempts: 1,
        runAfter: 1000,
        now: 1000
      });
      const seenTexts: string[] = [];
      fixture.adapter.embedBatch = async ({ items }) => {
        seenTexts.push(...items.map((input) => input.text));
        return items.map((input) => ({
          id: input.id,
          vector: [0.1, 0.2, 0.3]
        }));
      };
      const runner = new JobRunner({
        jobs,
        handlers: {
          embedding_generate: (job) => embeddingJobs.handleEmbeddingGenerateJob(job)
        },
        now: () => 2000
      });

      await expect(runner.runDueOnce()).resolves.toMatchObject({
        id: "job_embedding_html"
      });
      expect(seenTexts).toEqual([
        "Plain title\n\nSummary & context\n\nBody HTML text"
      ]);
      expect(seenTexts[0]).not.toMatch(/<[^>]+>|discard|hidden/u);
    } finally {
      db.close();
    }
  });

  it("does not let old succeeded embedding jobs block future enqueue", () => {
    const fixture = createEmbeddingPipelineFixture();
    const { db, articles, jobs, embeddingJobs } = fixture;

    try {
      insertEmbeddingArticleFixture(db, articles, "article_requeue", "Requeue embedding article");
      const firstBatch = embeddingJobs.enqueueArticlesForActiveIndex(["article_requeue"]);
      expect(firstBatch).toHaveLength(1);
      jobs.markSucceeded(firstBatch[0].id, 2000);

      const secondBatch = embeddingJobs.enqueueArticlesForActiveIndex(["article_requeue"]);
      expect(secondBatch).toHaveLength(1);
      expect(secondBatch[0].id).not.toBe(firstBatch[0].id);
    } finally {
      db.close();
    }
  });

  it("continues active index backfill until remaining embedding candidates are covered", async () => {
    const fixture = createEmbeddingPipelineFixture();
    const { db, articles, embeddingJobs, jobs } = fixture;

    try {
      for (let index = 0; index < 1005; index += 1) {
        insertEmbeddingArticleFixture(
          db,
          articles,
          `article_backfill_${String(index).padStart(4, "0")}`,
          `Backfill article ${index}`
        );
      }

      const initialJobs = embeddingJobs.enqueueBackfillForActiveIndex();
      expect(initialJobs).toHaveLength(63);

      const runner = new JobRunner({
        jobs,
        handlers: {
          [EMBEDDING_GENERATE_JOB_TYPE]: (job) => embeddingJobs.handleEmbeddingGenerateJob(job)
        },
        now: () => 2000
      });

      await runner.runDueOnce();

      expect(
        (
          db
            .prepare("select count(*) as count from jobs where type = ? and status = 'queued'")
            .get(EMBEDDING_GENERATE_JOB_TYPE) as { count: number }
        ).count
      ).toBe(62);

      await runner.drainDue();

      expect(
        (
          db
            .prepare("select count(*) as count from article_embeddings where embedding_index_id = ?")
            .get("index_openai") as { count: number }
        ).count
      ).toBe(1005);
      expect(
        (
          db
            .prepare(
              "select count(*) as count from jobs where type = ? and status in ('queued', 'running')"
            )
            .get(EMBEDDING_GENERATE_JOB_TYPE) as { count: number }
        ).count
      ).toBe(0);
    } finally {
      db.close();
    }
  });

  it("retries retryable provider failures and permanently fails malformed provider responses", async () => {
    const retryable = createEmbeddingPipelineFixture();

    try {
      insertEmbeddingArticleFixture(
        retryable.db,
        retryable.articles,
        "article_retryable_provider",
        "Retryable provider article"
      );
      const [retryableJob] = retryable.embeddingJobs.enqueueArticlesForActiveIndex([
        "article_retryable_provider"
      ]);
      retryable.adapter.embedBatch = async () => {
        throw new EmbeddingProviderError("Provider request failed", true, {
          status: 429,
          authorization: "Bearer should-not-leak"
        });
      };
      const retryRunner = new JobRunner({
        jobs: retryable.jobs,
        handlers: {
          embedding_generate: (job) => retryable.embeddingJobs.handleEmbeddingGenerateJob(job)
        },
        now: () => 2000,
        retryDelayMs: 5000
      });

      await expect(retryRunner.runDueOnce()).resolves.toMatchObject({
        id: retryableJob.id
      });
      expect(retryable.jobs.findById(retryableJob.id)).toMatchObject({
        status: "queued",
        attempts: 1,
        error: "Provider request failed",
        runAfter: 7000
      });
    } finally {
      retryable.db.close();
    }

    const permanent = createEmbeddingPipelineFixture();
    try {
      insertEmbeddingArticleFixture(
        permanent.db,
        permanent.articles,
        "article_permanent_provider",
        "Permanent provider article"
      );
      const [permanentJob] = permanent.embeddingJobs.enqueueArticlesForActiveIndex([
        "article_permanent_provider"
      ]);
      permanent.adapter.embedBatch = async () => {
        throw new EmbeddingProviderError("Provider response must include data array", false, {
          apiKey: "should-not-leak"
        });
      };
      const permanentRunner = new JobRunner({
        jobs: permanent.jobs,
        handlers: {
          embedding_generate: (job) => permanent.embeddingJobs.handleEmbeddingGenerateJob(job)
        },
        now: () => 2000,
        retryDelayMs: 5000
      });

      await expect(permanentRunner.runDueOnce()).resolves.toMatchObject({
        id: permanentJob.id
      });
      expect(permanent.jobs.findById(permanentJob.id)).toMatchObject({
        status: "failed",
        attempts: 1,
        error: "Provider response must include data array"
      });
    } finally {
      permanent.db.close();
    }
  });

  it("scheduler tick enqueues refresh jobs and wakes the runner without using a real interval", async () => {
    let drained = false;
    const scheduler = new FeedRefreshScheduler({
      refreshJobs: {
        enqueueDueFeeds: () => [minimalJob("job_1")]
      },
      runner: {
        async drainDue() {
          drained = true;
          return 0;
        }
      },
      intervalMs: 60_000
    });

    await expect(scheduler.tick()).resolves.toEqual(["job_1"]);
    expect(drained).toBe(true);
  });

  it("feed refresh scheduler scans due feeds at startup and defaults to ten minutes", async () => {
    expect(DEFAULT_FEED_REFRESH_INTERVAL_MS).toBe(10 * 60 * 1000);

    let enqueued = 0;
    let drained = 0;
    const scheduler = new FeedRefreshScheduler({
      refreshJobs: {
        enqueueDueFeeds: () => {
          enqueued += 1;
          return [minimalJob("job_startup")];
        }
      },
      runner: {
        async drainDue() {
          drained += 1;
          return 0;
        }
      },
      intervalMs: 60_000
    });

    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    scheduler.stop();

    expect(enqueued).toBe(1);
    expect(drained).toBe(1);
  });

  it("feed refresh jobs enqueue only feeds due for refresh", () => {
    const db = createEmptyDatabase();
    const feeds = new SqliteFeedRepository(db);
    const jobs = new SqliteJobRepository(db);

    try {
      feeds.upsert({
        id: "feed_due",
        title: "Due Feed",
        feedUrl: "https://example.com/due.xml",
        now: 1000
      });
      feeds.upsert({
        id: "feed_fresh",
        title: "Fresh Feed",
        feedUrl: "https://example.com/fresh.xml",
        now: 1000
      });
      feeds.recordFetchSuccess("feed_due", 1_000);
      feeds.recordFetchSuccess("feed_fresh", 3_500_000);

      const refreshJobs = new FeedRefreshJobService({
        feeds,
        jobs,
        refresher: {
          async refreshFeed() {
            throw new Error("not used");
          }
        },
        jobIdFactory: () => "job_due",
        now: () => 3_700_000
      });

      expect(refreshJobs.enqueueAllEnabledFeeds().map((job) => job.payloadJson)).toEqual([
        JSON.stringify({ feedId: "feed_due" })
      ]);
    } finally {
      db.close();
    }
  });

  it("retention scheduler enqueues one cleanup job and wakes the runner", async () => {
    const db = createEmptyDatabase();
    const jobs = new SqliteJobRepository(db);
    let drained = false;

    try {
      const cleanupJobs = new RetentionCleanupJobService({
        jobs,
        retention: {
          runCleanup() {
            return undefined as never;
          }
        },
        jobIdFactory: () => "job_retention_cleanup",
        now: () => 1000
      });
      const scheduler = new RetentionCleanupScheduler({
        cleanupJobs,
        runner: {
          async drainDue() {
            drained = true;
            return 0;
          }
        },
        intervalMs: 60_000
      });

      await expect(scheduler.tick()).resolves.toBe("job_retention_cleanup");
      await expect(scheduler.tick()).resolves.toBe("job_retention_cleanup");
      expect(drained).toBe(true);
      expect(jobs.listOpenByType("retention_cleanup")).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("fails invalid ranking and profile decay payloads without retrying", async () => {
    const db = createEmptyDatabase();
    try {
      const jobs = new SqliteJobRepository(db);
      const settings = new SqliteAppSettingsRepository(db);
      const embeddings = new SqliteEmbeddingRepository(db);
      const profiles = new SqliteProfileRepository(db);
      const rankings = new SqliteRankingRepository(db);
      const ranking = new RecommendationRankingService({
        embeddings,
        profiles,
        rankings,
        now: () => 1000
      });
      const rankingJobs = new RankingRecalculateJobService({
        jobs,
        ranking,
        now: () => 1000
      });
      const profile = new ProfileService({
        embeddings,
        profiles,
        now: () => 1000
      });
      const profileDecayJobs = new ProfileDecayJobService({
        jobs,
        profile,
        rankingJobs,
        settings,
        now: () => 1000
      });

      jobs.enqueue({
        id: "job_invalid_rank",
        type: RANKING_RECALCULATE_JOB_TYPE,
        payloadJson: JSON.stringify({ articleIds: [] }),
        maxAttempts: 3,
        runAfter: 1000,
        now: 1000
      });
      jobs.enqueue({
        id: "job_invalid_profile_decay",
        type: PROFILE_DECAY_JOB_TYPE,
        payloadJson: JSON.stringify({ force: true }),
        maxAttempts: 3,
        runAfter: 1000,
        now: 1000
      });

      const runner = new JobRunner({
        jobs,
        handlers: {
          [RANKING_RECALCULATE_JOB_TYPE]: (job) =>
            rankingJobs.handleRankingRecalculateJob(job),
          [PROFILE_DECAY_JOB_TYPE]: (job) => profileDecayJobs.handleProfileDecayJob(job)
        },
        now: () => 1000
      });

      await expect(runner.drainDue()).resolves.toBe(2);
      expect(jobs.findById("job_invalid_rank")).toMatchObject({
        status: "failed",
        attempts: 1,
        error: "Invalid ranking_recalculate job payload"
      });
      expect(jobs.findById("job_invalid_profile_decay")).toMatchObject({
        status: "failed",
        attempts: 1,
        error: "Invalid profile_decay job payload"
      });
    } finally {
      db.close();
    }
  });

  it("runs full ranking recalculation as resumable chunks", async () => {
    const db = createEmptyDatabase();
    try {
      const jobs = new SqliteJobRepository(db);
      const calls: Array<{ cursor: string | null; limit: number }> = [];
      const rankingJobs = new RankingRecalculateJobService({
        jobs,
        ranking: {
          recalculateArticle() {
            return 1;
          },
          recalculateArticles(articleIds: string[]) {
            return articleIds.length;
          },
          recalculateAll() {
            return 0;
          },
          recalculateChunk(input: { cursor?: string | null; limit: number }) {
            calls.push({
              cursor: input.cursor ?? null,
              limit: input.limit
            });
            return {
              processed: input.cursor === "cursor_2" ? 100 : 500,
              nextCursor:
                input.cursor === null || input.cursor === undefined
                  ? "cursor_1"
                  : input.cursor === "cursor_1"
                    ? "cursor_2"
                    : null
            };
          }
        },
        jobIdFactory: () => `job_rank_${calls.length}_${randomFixtureId()}`,
        now: () => 1000
      });
      rankingJobs.enqueueAll();
      const runner = new JobRunner({
        jobs,
        handlers: {
          [RANKING_RECALCULATE_JOB_TYPE]: (job) =>
            rankingJobs.handleRankingRecalculateJob(job)
        },
        now: () => 1000
      });

      await expect(runner.drainDue()).resolves.toBe(3);
      expect(calls).toEqual([
        { cursor: null, limit: 500 },
        { cursor: "cursor_1", limit: 500 },
        { cursor: "cursor_2", limit: 500 }
      ]);
      expect(jobs.countByTypeAndStatus(RANKING_RECALCULATE_JOB_TYPE, "succeeded")).toBe(3);
    } finally {
      db.close();
    }
  });
});

function createEmptyDatabase(): DibaoDatabase {
  return openDatabase(tempDatabasePath(), { migrate: true });
}

function createEmbeddingPipelineFixture() {
  const db = createEmptyDatabase();
  const feeds = new SqliteFeedRepository(db);
  const articles = new SqliteArticleRepository(db);
  const embeddings = new SqliteEmbeddingRepository(db);
  const jobs = new SqliteJobRepository(db);
  const vectorStore = new SqliteVecVectorStore(db);
  const adapter = embeddingAdapterFixture();

  feeds.upsert({
    id: "feed_embedding",
    title: "Embedding Feed",
    feedUrl: "https://example.com/embedding.xml",
    enabled: true,
    now: 1000
  });
  embeddings.upsertProvider({
    id: "provider_openai",
    type: "openai_compatible",
    name: "OpenAI Compatible",
    baseUrl: "https://api.example.com/v1",
    model: "fixture-embedding",
    dimension: 3,
    enabled: true,
    qualityTier: "recommended",
    now: 1000
  });
  embeddings.createIndex({
    id: "index_openai",
    providerId: "provider_openai",
    model: "fixture-embedding",
    dimension: 3,
    now: 1000
  });

  const providerService = new EmbeddingProviderService({
    embeddings,
    vectorStore,
    adapters: {
      openai_compatible: adapter
    },
    now: () => 1000
  });
  const embeddingJobs = new EmbeddingJobService({
    articles,
    embeddings,
    jobs,
    providerService,
    vectorStore,
    jobIdFactory: () => `job_embedding_${randomFixtureId()}`,
    now: () => 1000
  });

  return {
    db,
    articles,
    adapter,
    embeddingJobs,
    jobs
  };
}

function insertEmbeddingArticleFixture(
  db: DibaoDatabase,
  articles: SqliteArticleRepository,
  articleId: string,
  title: string,
  feedId = "feed_embedding"
): void {
  articles.upsert({
    id: articleId,
    feedId,
    url: `https://example.com/${articleId}`,
    canonicalUrl: `https://example.com/${articleId}`,
    title,
    summary: `${title} summary`,
    publishedAt: 1000,
    discoveredAt: 1000,
    dedupeKey: articleId,
    now: 1000
  });
  articles.upsertContent({
    articleId,
    contentHtml: null,
    contentText: `${title} full text`,
    extractionStatus: "success",
    extractedAt: 1000,
    now: 1000
  });
  db.prepare("update articles set content_hash = ? where id = ?").run(
    `hash_${articleId}`,
    articleId
  );
}

function embeddingAdapterFixture(): EmbeddingProviderAdapter {
  return {
    async embedBatch({ items }) {
      return items.map((input) => ({
        id: input.id,
        vector: [0.1, 0.2, 0.3]
      }));
    },
    async test() {
      return {
        status: "success",
        dimension: 3,
        latencyMs: 1
      };
    }
  };
}

let fixtureId = 0;

function randomFixtureId(): string {
  fixtureId += 1;
  return String(fixtureId);
}

function tempDatabasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "dibao-server-jobs-"));
  tempDirs.push(dir);
  return join(dir, "dibao.sqlite");
}

function fixtureFetcher(fixtures: Record<string, string>): FeedFetcher {
  return async (url) => ({
    ok: fixtures[url] !== undefined,
    status: fixtures[url] === undefined ? 502 : 200,
    statusText: fixtures[url] === undefined ? "Bad Gateway" : "OK",
    async text() {
      return fixtures[url] ?? "";
    }
  });
}

function minimalJob(id: string): JobRow {
  return {
    id,
    type: "feed_refresh",
    status: "queued",
    payloadJson: JSON.stringify({ feedId: "feed_fixture" }),
    error: null,
    attempts: 0,
    maxAttempts: 3,
    runAfter: 1000,
    startedAt: null,
    finishedAt: null,
    createdAt: 1000,
    updatedAt: 1000
  };
}

function countRows(db: DibaoDatabase, table: string, articleId: string): number {
  return (
    db
      .prepare(`select count(*) as count from ${table} where article_id = ?`)
      .get(articleId) as { count: number }
  ).count;
}

const fixtureRss = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Job Runner Feed</title>
    <link>https://example.com</link>
    <description>Fixture feed</description>
    <item>
      <title>Job runner article</title>
      <link>https://example.com/job-runner</link>
      <guid>job-runner</guid>
      <pubDate>Thu, 14 May 2026 08:00:00 GMT</pubDate>
      <description>Queued refresh content.</description>
    </item>
  </channel>
</rss>`;

const retentionFixtureRss = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Retention Feed</title>
    <link>https://example.com</link>
    <description>Retention fixture feed</description>
    <item>
      <title>Retention deleted article</title>
      <link>https://example.com/retention-deleted</link>
      <guid>retention-deleted</guid>
      <pubDate>Thu, 01 Jan 2026 08:00:00 GMT</pubDate>
      <description>cleanuprestoreguard</description>
      <content:encoded><![CDATA[<p>cleanuprestoreguard full text</p>]]></content:encoded>
    </item>
  </channel>
</rss>`;
