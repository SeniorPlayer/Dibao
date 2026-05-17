import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  openDatabase,
  SqliteArticleActionRepository,
  SqliteArticleRepository,
  SqliteAppSettingsRepository,
  SqliteEmbeddingRepository,
  SqliteFeedRepository,
  SqliteJobRepository,
  SqliteProfileRepository,
  SqliteRankingRepository,
  SqliteVecVectorStore,
  toVectorBlob,
  type DibaoDatabase
} from "@dibao/db";
import { JobRunner } from "./job-runner.js";
import { ProfileDecayJobService } from "./profile-decay-job-service.js";
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
      expect(profiles.listClusters({ embeddingIndexId: "index_profile" })[0]).toMatchObject({
        label: "Liked profile topic",
        weight: 6
      });

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

  it("weights like above favorite in profile clusters and source stats", () => {
    const db = openDatabase(tempDatabasePath(), { migrate: true });
    const feeds = new SqliteFeedRepository(db);
    const articles = new SqliteArticleRepository(db);
    const actions = new SqliteArticleActionRepository(db);
    const embeddings = new SqliteEmbeddingRepository(db);
    const profiles = new SqliteProfileRepository(db);
    const vectorStore = new SqliteVecVectorStore(db);

    try {
      feeds.upsert({ id: "feed_like", title: "Like Feed", feedUrl: "https://example.com/like.xml", now: 1000 });
      feeds.upsert({ id: "feed_favorite", title: "Favorite Feed", feedUrl: "https://example.com/favorite.xml", now: 1000 });
      embeddings.upsertProvider({
        id: "provider_like",
        type: "openai_compatible",
        name: "Provider",
        baseUrl: "https://api.example.com/v1",
        model: "fixture",
        dimension: 3,
        enabled: true,
        now: 1000
      });
      embeddings.createIndex({
        id: "index_like",
        providerId: "provider_like",
        model: "fixture",
        dimension: 3,
        now: 1000
      });

      insertArticleForFeed(articles, "seed_like", "feed_like", "Seed like", "hash_like", 1000);
      insertArticleForFeed(articles, "seed_favorite", "feed_favorite", "Seed favorite", "hash_favorite", 1000);
      vectorStore.upsertArticleVector({
        articleId: "seed_like",
        embeddingIndexId: "index_like",
        vector: [1, 0, 0],
        contentHash: "hash_like",
        now: 1000
      });
      vectorStore.upsertArticleVector({
        articleId: "seed_favorite",
        embeddingIndexId: "index_like",
        vector: [0, 1, 0],
        contentHash: "hash_favorite",
        now: 1000
      });

      let clusterCount = 0;
      const profile = new ProfileService({
        embeddings,
        profiles,
        clusterIdFactory: () => {
          clusterCount += 1;
          return `cluster_like_${clusterCount}`;
        },
        now: () => 5000
      });

      const like = actions.record({ articleId: "seed_like", type: "like", now: 2000 });
      const favorite = actions.record({ articleId: "seed_favorite", type: "favorite", now: 2100 });
      profile.processEvent(like!.eventId);
      profile.processEvent(favorite!.eventId);

      const clusters = profiles.listClusters({ embeddingIndexId: "index_like", polarity: "positive" });
      expect(clusters.map((cluster) => cluster.weight)).toEqual([8, 6]);
      expect(clusters.map((cluster) => cluster.label)).toEqual(["Seed like", "Seed favorite"]);
      expect(feedStats(db, "feed_like").positiveScore).toBeGreaterThan(
        feedStats(db, "feed_favorite").positiveScore
      );
    } finally {
      db.close();
    }
  });

  it("treats unlike as a weak correction without creating a negative interest cluster", () => {
    const fixture = createProfileFixture();
    const { actions, db, profile, profiles } = fixture;

    try {
      const unlike = actions.record({
        articleId: "article_liked",
        type: "unlike",
        now: 2000
      });
      profile.processEvent(unlike!.eventId);

      expect(profiles.listClusters({ embeddingIndexId: "index_profile", polarity: "negative" })).toHaveLength(0);
      expect(feedStats(db, "feed_profile").negativeScore).toBeGreaterThan(0);
      expect(feedStats(db, "feed_profile").negativeScore).toBeLessThan(0.1);
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

  it("REC-031 keeps cold start and pending embedding recommendations populated", () => {
    const db = openDatabase(tempDatabasePath(), { migrate: true });
    const feeds = new SqliteFeedRepository(db);
    const articles = new SqliteArticleRepository(db);
    const rankings = new SqliteRankingRepository(db);

    try {
      feeds.upsert({
        id: "feed_cold",
        title: "Cold Feed",
        feedUrl: "https://example.com/cold.xml",
        now: 1000
      });
      insertArticleForFeed(articles, "article_cold_recent", "feed_cold", "Cold recent", "hash_cold_recent", 9000);
      insertArticleForFeed(articles, "article_cold_old", "feed_cold", "Cold old", "hash_cold_old", 1000);

      const coldRanking = new RecommendationRankingService({
        rankings,
        now: () => 10_000
      });
      coldRanking.recalculateAll();

      const coldStart = articles.list({
        view: "recommended",
        rankContext: coldRanking.getActiveRankContext()
      }).items.map((article) => article.id);
      expect(coldStart.slice(0, 2)).toEqual(["article_cold_recent", "article_cold_old"]);

      const embeddings = new SqliteEmbeddingRepository(db);
      embeddings.upsertProvider({
        id: "provider_pending",
        type: "openai_compatible",
        name: "Provider",
        baseUrl: "https://api.example.com/v1",
        model: "fixture",
        dimension: 3,
        enabled: true,
        now: 10_000
      });
      embeddings.createIndex({
        id: "index_pending",
        providerId: "provider_pending",
        model: "fixture",
        dimension: 3,
        now: 10_000
      });

      const pendingRanking = new RecommendationRankingService({
        embeddings,
        profiles: new SqliteProfileRepository(db),
        rankings,
        now: () => 10_000
      });
      pendingRanking.recalculateAll();

      const pending = articles.list({
        view: "recommended",
        rankContext: pendingRanking.getActiveRankContext()
      }).items.map((article) => article.id);
      expect(pending).toContain("article_cold_recent");
      expect(pendingRanking.explainArticle("article_cold_recent")).toMatchObject({
        status: "embedding_pending"
      });
    } finally {
      db.close();
    }
  });

  it("REC-031 boosts favorite, read later, and derived read complete topics above open-only topics", () => {
    const fixture = createEvaluationFixture();
    const { actions, db, profile, ranking } = fixture;

    try {
      ranking.recalculateAll();
      const before = recommendedIds(db);
      expect(before).toContain("candidate_favorite");
      expect(before).toContain("candidate_open");

      for (const articleId of ["seed_open_1", "seed_open_2", "seed_open_3", "seed_open_4"]) {
        const result = actions.record({ articleId, type: "open", now: 2_000 });
        profile.processEvent(result!.eventId);
      }
      const favorite = actions.record({ articleId: "seed_favorite", type: "favorite", now: 2_100 });
      const readLater = actions.record({ articleId: "seed_later", type: "read_later", now: 2_200 });
      const readComplete = actions.record({
        articleId: "seed_complete",
        type: "read_progress",
        progress: 0.75,
        metadata: { activeDurationMs: 20_000 },
        now: 2_300
      });
      profile.processEvent(favorite!.eventId);
      profile.processEvent(readLater!.eventId);
      profile.processEvent(readComplete!.eventId);
      ranking.recalculateAll();

      const after = recommendedIds(db);
      expect(after.indexOf("candidate_favorite")).toBeLessThan(after.indexOf("candidate_open"));
      expect(after.indexOf("candidate_later")).toBeLessThan(after.indexOf("candidate_open"));
      expect(after.indexOf("candidate_complete")).toBeLessThan(after.indexOf("candidate_open"));
    } finally {
      db.close();
    }
  });

  it("REC-031 applies not interested as a strong similar-content negative signal", () => {
    const fixture = createEvaluationFixture();
    const { actions, db, profile, ranking } = fixture;

    try {
      ranking.recalculateAll();
      const before = recommendedIds(db);
      const beforeScore = activeScoreForContext(db, "candidate_negative", "index_eval");
      expect(before).toContain("candidate_negative");

      const result = actions.record({
        articleId: "seed_negative",
        type: "not_interested",
        now: 2_000
      });
      profile.processEvent(result!.eventId);
      ranking.recalculateAll();

      const after = recommendedIds(db);
      expect(after).not.toContain("seed_negative");
      expect(activeScoreForContext(db, "candidate_negative", "index_eval")).toBeLessThan(
        beforeScore ?? Number.POSITIVE_INFINITY
      );
      expect(after.indexOf("candidate_negative")).toBeGreaterThan(after.indexOf("candidate_other"));
    } finally {
      db.close();
    }
  });

  it("REC-031 guards source stats against open overfit but learns after clear signals", () => {
    const db = openDatabase(tempDatabasePath(), { migrate: true });
    const feeds = new SqliteFeedRepository(db);
    const articles = new SqliteArticleRepository(db);
    const actions = new SqliteArticleActionRepository(db);
    const profiles = new SqliteProfileRepository(db);
    const rankings = new SqliteRankingRepository(db);
    const profile = new ProfileService({
      embeddings: new SqliteEmbeddingRepository(db),
      profiles,
      now: () => 20_000
    });
    const ranking = new RecommendationRankingService({
      rankings,
      now: () => 20_000
    });

    try {
      feeds.upsert({ id: "feed_open", title: "Open Feed", feedUrl: "https://example.com/open.xml", now: 1000 });
      feeds.upsert({ id: "feed_clear", title: "Clear Feed", feedUrl: "https://example.com/clear.xml", now: 1000 });
      feeds.upsert({ id: "feed_plain", title: "Plain Feed", feedUrl: "https://example.com/plain.xml", now: 1000 });
      insertArticleForFeed(articles, "candidate_open_source", "feed_open", "Open source candidate", "hash_open_source", 5_000);
      insertArticleForFeed(articles, "candidate_clear_source", "feed_clear", "Clear source candidate", "hash_clear_source", 5_000);
      insertArticleForFeed(articles, "candidate_plain_source", "feed_plain", "Plain source candidate", "hash_plain_source", 5_000);

      for (let index = 0; index < 20; index += 1) {
        const articleId = `seed_open_source_${index}`;
        insertArticleForFeed(articles, articleId, "feed_open", `Open seed ${index}`, `hash_open_${index}`, 1_000 + index);
        const result = actions.record({ articleId, type: "open", now: 6_000 + index });
        profile.processEvent(result!.eventId);
      }
      ranking.recalculateAll();
      const openOnly = recommendedIds(db, "base");
      expect(openOnly.indexOf("candidate_open_source")).toBeGreaterThan(
        openOnly.indexOf("candidate_plain_source") - 2
      );

      for (let index = 0; index < 10; index += 1) {
        const articleId = `seed_clear_source_${index}`;
        insertArticleForFeed(articles, articleId, "feed_clear", `Clear seed ${index}`, `hash_clear_${index}`, 2_000 + index);
        const result = actions.record({ articleId, type: "read_later", now: 7_000 + index });
        profile.processEvent(result!.eventId);
      }
      ranking.recalculateAll();
      const clearSignals = recommendedIds(db, "base");
      expect(clearSignals.indexOf("candidate_clear_source")).toBeLessThan(
        clearSignals.indexOf("candidate_plain_source")
      );
    } finally {
      db.close();
    }
  });

  it("keeps profile decay stable within a day and more conservative for negative clusters", () => {
    const db = openDatabase(tempDatabasePath(), { migrate: true });
    const embeddings = new SqliteEmbeddingRepository(db);
    const jobs = new SqliteJobRepository(db);
    const profiles = new SqliteProfileRepository(db);
    const settings = new SqliteAppSettingsRepository(db);
    const rankings = new SqliteRankingRepository(db);
    const profile = new ProfileService({
      embeddings,
      profiles,
      now: () => 3 * 86_400_000
    });
    const rankingJobs = new RankingRecalculateJobService({
      jobs,
      ranking: new RecommendationRankingService({ rankings, now: () => 3 * 86_400_000 }),
      now: () => 3 * 86_400_000
    });
    const decayJobs = new ProfileDecayJobService({
      jobs,
      profile,
      rankingJobs,
      settings,
      now: () => 3 * 86_400_000
    });

    try {
      embeddings.upsertProvider({
        id: "provider_decay",
        type: "openai_compatible",
        name: "Provider",
        baseUrl: "https://api.example.com/v1",
        model: "fixture",
        dimension: 3,
        enabled: true,
        now: 0
      });
      embeddings.createIndex({
        id: "index_decay",
        providerId: "provider_decay",
        model: "fixture",
        dimension: 3,
        now: 0
      });
      profiles.upsertCluster({
        id: "cluster_decay_positive",
        embeddingIndexId: "index_decay",
        polarity: "positive",
        centroidVectorBlob: toVectorBlob([1, 0, 0]),
        weight: 10,
        sampleCount: 3,
        lastMatchedAt: 86_400_000,
        now: 86_400_000
      });
      profiles.upsertCluster({
        id: "cluster_decay_negative",
        embeddingIndexId: "index_decay",
        polarity: "negative",
        centroidVectorBlob: toVectorBlob([0, 1, 0]),
        weight: 10,
        sampleCount: 3,
        lastMatchedAt: 86_400_000,
        now: 86_400_000
      });

      settings.setJson("profile.decayLastRunAt", 3 * 86_400_000 - 3_600_000, 3 * 86_400_000);
      decayJobs.handleProfileDecayJob({
        id: "job_decay_same_day",
        type: "profile_decay",
        status: "running",
        payloadJson: null,
        error: null,
        attempts: 1,
        maxAttempts: 1,
        runAfter: 0,
        startedAt: null,
        finishedAt: null,
        createdAt: 0,
        updatedAt: 0
      });
      expect(profiles.listClusters({ embeddingIndexId: "index_decay", polarity: "positive" })[0]?.weight).toBe(10);

      settings.setJson("profile.decayLastRunAt", 86_400_000, 3 * 86_400_000);
      decayJobs.handleProfileDecayJob({
        id: "job_decay_two_days",
        type: "profile_decay",
        status: "running",
        payloadJson: null,
        error: null,
        attempts: 1,
        maxAttempts: 1,
        runAfter: 0,
        startedAt: null,
        finishedAt: null,
        createdAt: 0,
        updatedAt: 0
      });

      const positive = profiles.listClusters({ embeddingIndexId: "index_decay", polarity: "positive" })[0]!;
      const negative = profiles.listClusters({ embeddingIndexId: "index_decay", polarity: "negative" })[0]!;
      expect(positive.weight).toBeLessThan(10);
      expect(negative.weight).toBeLessThan(10);
      expect(negative.weight).toBeGreaterThan(positive.weight);
    } finally {
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

function createEvaluationFixture() {
  const db = openDatabase(tempDatabasePath(), { migrate: true });
  const feeds = new SqliteFeedRepository(db);
  const articles = new SqliteArticleRepository(db);
  const actions = new SqliteArticleActionRepository(db);
  const embeddings = new SqliteEmbeddingRepository(db);
  const profiles = new SqliteProfileRepository(db);
  const rankings = new SqliteRankingRepository(db);
  const vectorStore = new SqliteVecVectorStore(db);

  feeds.upsert({
    id: "feed_eval",
    title: "Evaluation Feed",
    feedUrl: "https://example.com/eval.xml",
    now: 1000
  });
  embeddings.upsertProvider({
    id: "provider_eval",
    type: "openai_compatible",
    name: "Provider",
    baseUrl: "https://api.example.com/v1",
    model: "fixture",
    dimension: 3,
    enabled: true,
    now: 1000
  });
  embeddings.createIndex({
    id: "index_eval",
    providerId: "provider_eval",
    model: "fixture",
    dimension: 3,
    now: 1000
  });

  const vectors: Record<string, [number, number, number]> = {
    seed_favorite: [1, 0, 0],
    candidate_favorite: [0.98, 0.02, 0],
    seed_later: [0, 1, 0],
    candidate_later: [0.02, 0.98, 0],
    seed_complete: [0, 0, 1],
    candidate_complete: [0, 0.02, 0.98],
    seed_negative: [0.7, 0.7, 0],
    candidate_negative: [0.68, 0.72, 0],
    candidate_other: [0.35, 0.2, 0.9],
    seed_open_1: [0.2, -0.9, 0.1],
    seed_open_2: [0.21, -0.9, 0.1],
    seed_open_3: [0.19, -0.91, 0.1],
    seed_open_4: [0.2, -0.89, 0.11],
    candidate_open: [0.2, -0.9, 0.1]
  };

  for (const [articleId, vector] of Object.entries(vectors)) {
    const publishedAt = articleId === "candidate_open" ? 500 : articleId.startsWith("candidate_") ? 3_000 : 1_000;
    insertArticleForFeed(
      articles,
      articleId,
      "feed_eval",
      articleId.replaceAll("_", " "),
      `hash_${articleId}`,
      publishedAt
    );
    vectorStore.upsertArticleVector({
      articleId,
      embeddingIndexId: "index_eval",
      vector,
      contentHash: `hash_${articleId}`,
      now: 1000
    });
  }

  let clusterCount = 0;
  const profile = new ProfileService({
    embeddings,
    profiles,
    clusterIdFactory: () => {
      clusterCount += 1;
      return `cluster_eval_${clusterCount}`;
    },
    now: () => 5_000
  });
  const ranking = new RecommendationRankingService({
    embeddings,
    profiles,
    rankings,
    now: () => 5_000
  });

  return {
    actions,
    articles,
    db,
    profile,
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

function insertArticleForFeed(
  articles: SqliteArticleRepository,
  articleId: string,
  feedId: string,
  title: string,
  contentHash: string,
  publishedAt: number
): void {
  articles.upsert({
    id: articleId,
    feedId,
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

function recommendedIds(
  db: DibaoDatabase,
  rankContext = "index_eval",
  limit = 100
): string[] {
  return new SqliteArticleRepository(db)
    .list({ view: "recommended", rankContext, limit })
    .items.map((article) => article.id);
}

function activeScoreForContext(
  db: DibaoDatabase,
  articleId: string,
  rankContext: string
): number | null {
  const row = db
    .prepare(
      `
        select score
        from article_rank_scores
        where article_id = ?
          and rank_context = ?
      `
    )
    .get(articleId, rankContext) as { score: number } | undefined;

  return row?.score ?? null;
}

function feedStats(db: DibaoDatabase, feedId: string): {
  positiveScore: number;
  negativeScore: number;
} {
  const row = db
    .prepare(
      `
        select
          positive_score as positiveScore,
          negative_score as negativeScore
        from feed_stats
        where feed_id = ?
      `
    )
    .get(feedId) as { positiveScore: number; negativeScore: number } | undefined;

  return row ?? { positiveScore: 0, negativeScore: 0 };
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
