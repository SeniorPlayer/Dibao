import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  fromVectorBlob,
  openDatabase,
  SqliteArticleRepository,
  SqliteEmbeddingRepository,
  SqliteFeedRepository,
  SqliteJobRepository,
  SqliteVecVectorStore,
  type DibaoDatabase
} from "@dibao/db";
import { RecommendationMaintenanceService } from "./recommendation-maintenance-service.js";
import {
  TOPIC_SNAPSHOT_REBUILD_JOB_TYPE,
  TOPIC_SNAPSHOT_RUNNER_UNAVAILABLE,
  TopicSnapshotService,
  TopicSnapshotServiceError,
  type TopicSnapshotRunnerInput,
  type TopicSnapshotRunnerOutput
} from "./topic-snapshot-service.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("TopicSnapshotService", () => {
  it("imports fixture output, writes topics and centroids, and never enqueues embeddings or ranking", async () => {
    const db = createTopicFixtureDatabase();
    let runnerInput: TopicSnapshotRunnerInput | null = null;
    try {
      const service = new TopicSnapshotService({
        db,
        runner: (input) => {
          runnerInput = input;
          return fixtureRunnerOutput();
        },
        runnerTokenizer: "ja",
        now: () => 10_000,
        runIdFactory: () => "run_fixture"
      });

      const result = await service.rebuildActiveIndexSnapshot({
        maxArticles: 10,
        minArticles: 2,
        minTopicSize: 2,
        scopeDays: 60
      });

      expect(result).toMatchObject({
        runId: "run_fixture",
        embeddingIndexId: "index_topic",
        status: "succeeded",
        articleCount: 2,
        topicCount: 1,
        skippedMissingEmbeddingCount: 1,
        skippedStaleEmbeddingCount: 1,
        error: null
      });
      expect(runnerInput).toMatchObject({
        tokenizer: "ja",
        embeddingIndexId: "index_topic",
        maxArticles: 20,
        scopeDays: 60,
        minTopicSize: 2
      });
      expect(db.prepare("select count(*) as count from corpus_topics").get()).toEqual({
        count: 1
      });
      expect(db.prepare("select count(*) as count from corpus_topic_articles").get()).toEqual({
        count: 2
      });
      const topic = db
        .prepare(
          "select centroid_vector_blob as centroidVectorBlob from corpus_topics where run_id = ?"
        )
        .get("run_fixture") as { centroidVectorBlob: Buffer };
      expect(fromVectorBlob(topic.centroidVectorBlob).map((value) => Number(value.toFixed(3)))).toEqual([
        0.707,
        0.707,
        0
      ]);
      expect(
        db
          .prepare(
            "select count(*) as count from jobs where type in ('embedding_generate', 'ranking_recalculate')"
          )
          .get()
      ).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });

  it("records runner-unavailable failures without blocking service startup", async () => {
    const db = createTopicFixtureDatabase();
    try {
      const service = new TopicSnapshotService({
        db,
        runnerCommand: null,
        now: () => 10_000,
        runIdFactory: () => "run_unavailable"
      });

      expect(service.isRunnerConfigured()).toBe(false);
      await expect(
        service.rebuildActiveIndexSnapshot({
          maxArticles: 10,
          minArticles: 2
        })
      ).rejects.toMatchObject({
        code: TOPIC_SNAPSHOT_RUNNER_UNAVAILABLE
      });
      expect(
        db
          .prepare(
            "select status, error from corpus_topic_runs where id = 'run_unavailable'"
          )
          .get()
      ).toEqual({
        status: "failed",
        error: TOPIC_SNAPSHOT_RUNNER_UNAVAILABLE
      });
      expect(
        db.prepare("select count(*) as count from jobs where type = 'embedding_generate'").get()
      ).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });

  it("fails low-coverage rebuilds without calling the runner or enqueueing embedding backfill", async () => {
    const db = createTopicFixtureDatabase({ omitCurrentEmbeddings: true });
    let runnerCalled = false;
    try {
      const service = new TopicSnapshotService({
        db,
        runner: () => {
          runnerCalled = true;
          return fixtureRunnerOutput();
        },
        now: () => 10_000,
        runIdFactory: () => "run_low_coverage"
      });

      const result = await service.rebuildActiveIndexSnapshot({
        maxArticles: 10,
        minArticles: 2
      });

      expect(result).toMatchObject({
        status: "failed",
        articleCount: 0,
        topicCount: 0
      });
      expect(result.error).toContain("INSUFFICIENT_CURRENT_EMBEDDINGS");
      expect(runnerCalled).toBe(false);
      expect(
        db.prepare("select count(*) as count from jobs where type = 'embedding_generate'").get()
      ).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });

  it("queues cluster label rebuild after a successful topic snapshot job but not ranking or embeddings", async () => {
    const db = createTopicFixtureDatabase();
    const jobs = new SqliteJobRepository(db);
    try {
      const maintenance = new RecommendationMaintenanceService({
        db,
        jobs,
        rankingJobs: {
          enqueueAll() {
            throw new Error("topic snapshot must not enqueue ranking_recalculate");
          }
        },
        topicSnapshots: {
          async handleTopicSnapshotRebuildJob() {
            return {
              runId: "run_job",
              embeddingIndexId: "index_topic",
              status: "succeeded",
              articleCount: 20,
              topicCount: 1,
              skippedMissingEmbeddingCount: 0,
              skippedStaleEmbeddingCount: 0,
              error: null
            };
          }
        },
        now: () => 10_000,
        jobIdFactory: () => "job_label_rebuild"
      });
      const job = jobs.enqueue({
        id: "job_topic_snapshot",
        type: TOPIC_SNAPSHOT_REBUILD_JOB_TYPE,
        payloadJson: JSON.stringify({
          maxArticles: 10,
          scopeDays: 60,
          minTopicSize: 2
        }),
        maxAttempts: 1,
        runAfter: 10_000,
        now: 10_000
      });

      await maintenance.handleJob(job);

      expect(
        db
          .prepare(
            "select count(*) as count from jobs where type = 'interest_cluster_label_rebuild'"
          )
          .get()
      ).toEqual({ count: 1 });
      expect(
        db
          .prepare(
            "select count(*) as count from jobs where type in ('embedding_generate', 'ranking_recalculate')"
          )
          .get()
      ).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });
});

function createTopicFixtureDatabase(
  options: { omitCurrentEmbeddings?: boolean } = {}
): DibaoDatabase {
  const db = openDatabase(tempDatabasePath(), { migrate: true });
  const feeds = new SqliteFeedRepository(db);
  const articles = new SqliteArticleRepository(db);
  const embeddings = new SqliteEmbeddingRepository(db);
  const vectorStore = new SqliteVecVectorStore(db);

  feeds.upsert({
    id: "feed_topic",
    title: "Topic Feed",
    feedUrl: "https://example.com/topic.xml",
    now: 1000
  });
  embeddings.upsertProvider({
    id: "provider_topic",
    type: "openai_compatible",
    name: "Fixture Provider",
    baseUrl: "https://api.example.com/v1",
    model: "fixture",
    dimension: 3,
    enabled: true,
    now: 1000
  });
  embeddings.createIndex({
    id: "index_topic",
    providerId: "provider_topic",
    model: "fixture",
    dimension: 3,
    status: "active",
    now: 1000
  });

  const articleInputs = [
    ["article_a", "AI agents and local models", "hash_a", [1, 0, 0]],
    ["article_b", "SQLite vector search notes", "hash_b", [0, 1, 0]],
    ["article_missing", "Missing embedding topic", "hash_missing", null],
    ["article_stale", "Stale embedding topic", "hash_stale_current", [0, 0, 1]]
  ] as const;

  for (const [articleId, title, contentHash, vector] of articleInputs) {
    articles.upsert({
      id: articleId,
      feedId: "feed_topic",
      url: `https://example.com/${articleId}`,
      title,
      summary: "Topic snapshot fixture article.",
      publishedAt: 9000,
      discoveredAt: 9000,
      contentHash,
      dedupeKey: articleId,
      now: 9000
    });
    if (vector && !options.omitCurrentEmbeddings) {
      vectorStore.upsertArticleVector({
        articleId,
        embeddingIndexId: "index_topic",
        vector,
        contentHash: articleId === "article_stale" ? "hash_stale_old" : contentHash,
        now: 9000
      });
    }
  }

  return db;
}

function fixtureRunnerOutput(): TopicSnapshotRunnerOutput {
  return {
    algorithm: "fixture",
    algorithmVersion: "fixture:v1",
    embeddingIndexId: "index_topic",
    params: {
      maxArticles: 10,
      scopeDays: 60,
      minTopicSize: 2
    },
    articleCount: 4,
    topics: [
      {
        topicKey: "0",
        label: "AI / SQLite",
        topTerms: [
          { term: "AI", weight: 1.3 },
          { term: "SQLite", weight: 1.1 }
        ],
        representativeArticles: [
          {
            articleId: "article_a",
            title: "AI agents and local models",
            feedTitle: "Topic Feed",
            score: 0.91
          }
        ],
        assignments: [
          { articleId: "article_a", assignmentScore: 0.91, isRepresentative: true },
          { articleId: "article_b", assignmentScore: 0.84 },
          { articleId: "article_missing", assignmentScore: 0.75 },
          { articleId: "article_stale", assignmentScore: 0.71 }
        ],
        confidence: 0.77
      }
    ],
    skipped: {
      missingEmbeddingCount: 1,
      staleEmbeddingCount: 1
    }
  };
}

function tempDatabasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "dibao-topic-snapshot-"));
  tempDirs.push(dir);
  return join(dir, "dibao.sqlite");
}
