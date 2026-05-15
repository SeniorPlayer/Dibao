import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  openDatabase,
  SqliteArticleActionRepository,
  SqliteArticleRepository,
  SqliteEmbeddingRepository,
  SqliteFeedRepository,
  SqliteJobRepository,
  SqliteProfileRepository,
  SqliteRankingRepository,
  SqliteVecVectorStore,
  type DibaoDatabase
} from "@dibao/db";
import { JobRunner } from "./job-runner.js";
import { ProfileService } from "./profile-service.js";
import {
  RankingRecalculateJobService,
  RANKING_RECALCULATE_JOB_TYPE
} from "./ranking-job-service.js";
import { RecommendationRankingService } from "./ranking-service.js";
import { buildServer as buildRealServer } from "./app.js";

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

describe("profile algorithm and recommendation ranking", () => {
  it("processes a single event idempotently and does not replay it for a new content hash", () => {
    const fixture = createProfileFixture();
    const { actions, articles, db, profile, profiles, vectorStore } = fixture;

    try {
      const result = actions.record({
        articleId: "article_liked",
        type: "favorite",
        now: 2000
      });
      expect(result?.eventId).toEqual(expect.any(String));

      profile.processEvent(result!.eventId);
      profile.processEvent(result!.eventId);

      expect(profiles.listClusters({ embeddingIndexId: "index_profile" })).toHaveLength(1);
      expect(profiles.listClusters({ embeddingIndexId: "index_profile" })[0]?.weight).toBe(6);

      articles.upsert({
        id: "article_liked",
        feedId: "feed_profile",
        url: "https://example.com/article_liked",
        canonicalUrl: "https://example.com/article_liked",
        title: "Liked article rewritten",
        summary: "A changed article body.",
        publishedAt: 1000,
        discoveredAt: 1000,
        contentHash: "hash_liked_v2",
        dedupeKey: "article_liked",
        now: 3000
      });
      vectorStore.upsertArticleVector({
        articleId: "article_liked",
        embeddingIndexId: "index_profile",
        vector: [0, 1, 0],
        contentHash: "hash_liked_v2",
        now: 3000
      });

      profile.processArticleEvents(["article_liked"]);

      expect(profiles.listClusters({ embeddingIndexId: "index_profile" })).toHaveLength(1);
      expect(profiles.listClusters({ embeddingIndexId: "index_profile" })[0]?.weight).toBe(6);

      const snapshot = JSON.parse(profiles.getTopicSnapshot("article_liked") ?? "{}") as {
        profileV0?: Record<string, Record<string, { processedEventIds?: string[] }>>;
      };
      expect(
        snapshot.profileV0?.index_profile?.hash_liked_v2?.processedEventIds
      ).toContain(result!.eventId);
    } finally {
      db.close();
    }
  });

  it("uses positive profile clusters to raise similar articles in ranking v1", () => {
    const fixture = createProfileFixture();
    const { actions, db, profile, ranking } = fixture;

    try {
      const result = actions.record({
        articleId: "article_liked",
        type: "favorite",
        now: 2000
      });
      profile.processEvent(result!.eventId);
      ranking.recalculateAll();

      const similarScore = activeScore(db, "article_similar");
      const otherScore = activeScore(db, "article_other");

      expect(similarScore).not.toBeNull();
      expect(otherScore).not.toBeNull();
      expect(similarScore!).toBeGreaterThan(otherScore!);
    } finally {
      db.close();
    }
  });

  it("queues ranking recalculation after article actions and applies it after draining jobs", async () => {
    const fixture = createProfileFixture();
    const { db, jobs } = fixture;
    const app = buildServer({ db, logger: false, now: () => 5000 });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/articles/article_liked/actions",
        payload: {
          type: "favorite"
        }
      });

      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().data.eventId).toBeUndefined();
      expect(jobs.countByTypeAndStatus(RANKING_RECALCULATE_JOB_TYPE, "queued")).toBe(1);
      expect(activeScore(db, "article_similar")).toBeNull();

      await drainRankingJobs(db, 5000);

      expect(activeScore(db, "article_similar")).not.toBeNull();
      const recommended = await app.inject({
        method: "GET",
        url: "/api/articles?view=recommended"
      });

      expect(recommended.statusCode, recommended.body).toBe(200);
      const ids = recommended.json().data.map((article: { id: string }) => article.id);
      expect(ids.indexOf("article_similar")).toBeLessThan(ids.indexOf("article_other"));
    } finally {
      await app.close();
      db.close();
    }
  });
});

function createProfileFixture() {
  const db = openDatabase(tempDatabasePath(), { migrate: true });
  const feeds = new SqliteFeedRepository(db);
  const articles = new SqliteArticleRepository(db);
  const actions = new SqliteArticleActionRepository(db);
  const embeddings = new SqliteEmbeddingRepository(db);
  const jobs = new SqliteJobRepository(db);
  const profiles = new SqliteProfileRepository(db);
  const rankings = new SqliteRankingRepository(db);
  const vectorStore = new SqliteVecVectorStore(db);

  feeds.upsert({
    id: "feed_profile",
    title: "Profile Feed",
    feedUrl: "https://example.com/profile.xml",
    now: 1000
  });
  embeddings.upsertProvider({
    id: "provider_profile",
    type: "openai_compatible",
    name: "Provider",
    baseUrl: "https://api.example.com/v1",
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

  insertArticle(articles, "article_liked", "Liked profile topic", "hash_liked", 1000);
  insertArticle(articles, "article_similar", "Similar profile topic", "hash_similar", 1100);
  insertArticle(articles, "article_other", "Other profile topic", "hash_other", 1200);
  vectorStore.upsertArticleVector({
    articleId: "article_liked",
    embeddingIndexId: "index_profile",
    vector: [1, 0, 0],
    contentHash: "hash_liked",
    now: 1000
  });
  vectorStore.upsertArticleVector({
    articleId: "article_similar",
    embeddingIndexId: "index_profile",
    vector: [0.98, 0.02, 0],
    contentHash: "hash_similar",
    now: 1000
  });
  vectorStore.upsertArticleVector({
    articleId: "article_other",
    embeddingIndexId: "index_profile",
    vector: [0, 1, 0],
    contentHash: "hash_other",
    now: 1000
  });

  const profile = new ProfileService({
    embeddings,
    profiles,
    clusterIdFactory: () => "cluster_profile",
    now: () => 5000
  });
  const ranking = new RecommendationRankingService({
    embeddings,
    profiles,
    rankings,
    now: () => 5000
  });

  return {
    actions,
    articles,
    db,
    jobs,
    profile,
    profiles,
    ranking,
    vectorStore
  };
}

function insertArticle(
  articles: SqliteArticleRepository,
  articleId: string,
  title: string,
  contentHash: string,
  publishedAt: number
): void {
  articles.upsert({
    id: articleId,
    feedId: "feed_profile",
    url: `https://example.com/${articleId}`,
    canonicalUrl: `https://example.com/${articleId}`,
    title,
    summary: `${title} summary`,
    publishedAt,
    discoveredAt: publishedAt,
    contentHash,
    dedupeKey: articleId,
    now: publishedAt
  });
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

function activeScore(db: DibaoDatabase, articleId: string): number | null {
  const row = db
    .prepare(
      `
        select score
        from article_rank_scores
        where article_id = ?
          and rank_context = 'index_profile'
      `
    )
    .get(articleId) as { score: number } | undefined;

  return row?.score ?? null;
}

function tempDatabasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "dibao-profile-ranking-"));
  tempDirs.push(dir);
  return join(dir, "test.sqlite");
}
