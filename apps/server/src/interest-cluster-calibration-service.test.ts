import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  openDatabase,
  SqliteArticleRepository,
  SqliteEmbeddingRepository,
  SqliteFeedRepository,
  SqliteVecVectorStore,
  type DibaoDatabase
} from "@dibao/db";
import { InterestClusterCalibrationService } from "./interest-cluster-calibration-service.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("InterestClusterCalibrationService", () => {
  it("falls back to conservative thresholds when signal samples are sparse", () => {
    const db = createCalibrationDatabase();
    try {
      insertSignalArticle(db, {
        articleId: "article_sparse_positive",
        vector: [1, 0, 0, 0],
        eventType: "favorite"
      });

      const calibration = new InterestClusterCalibrationService({
        db,
        now: () => 5000
      }).getOrCreateCalibration("index_calibration");

      expect(calibration.confidence).toBe("low");
      expect(calibration.diagnostics.fallbackPositive).toBe(true);
      expect(calibration.thresholds.positive.mergeThreshold).toBe(0.82);
    } finally {
      db.close();
    }
  });

  it("stores per-index adaptive thresholds for dense embedding distributions", () => {
    const db = createCalibrationDatabase();
    try {
      const topics = [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1]
      ];
      for (let topicIndex = 0; topicIndex < topics.length; topicIndex += 1) {
        for (let itemIndex = 0; itemIndex < 4; itemIndex += 1) {
          const base = topics[topicIndex]!;
          const vector = base.map((value, index) =>
            index === topicIndex ? value : (itemIndex + 1) * 0.08
          );
          insertSignalArticle(db, {
            articleId: `article_positive_${topicIndex}_${itemIndex}`,
            vector,
            eventType: itemIndex % 2 === 0 ? "favorite" : "read_later"
          });
        }
      }
      for (let index = 0; index < 24; index += 1) {
        insertBackgroundArticle(db, {
          articleId: `article_background_${index}`,
          vector: [
            Math.sin(index + 1),
            Math.cos(index + 2),
            Math.sin(index + 3),
            Math.cos(index + 4)
          ]
        });
      }

      const service = new InterestClusterCalibrationService({ db, now: () => 6000 });
      const calibration = service.getOrCreateCalibration("index_calibration");
      const stored = service.getOrCreateCalibration("index_calibration");

      expect(calibration.diagnostics.fallbackPositive).toBe(false);
      expect(calibration.thresholds.positive.mergeThreshold).toBeLessThan(0.82);
      expect(calibration.thresholds.positive.mergeThreshold).toBeGreaterThanOrEqual(0.7);
      expect(calibration.thresholds.positive.attachThreshold).toBeLessThanOrEqual(
        calibration.thresholds.positive.mergeThreshold
      );
      expect(stored.updatedAt).toBe(calibration.updatedAt);
      expect(
        db.prepare("select count(*) as count from interest_cluster_calibrations").get()
      ).toEqual({ count: 1 });
    } finally {
      db.close();
    }
  });

  it("regenerates active calibration when provider, model, or dimension changes", () => {
    const db = createCalibrationDatabase();
    try {
      for (let index = 0; index < 16; index += 1) {
        insertSignalArticle(db, {
          articleId: `article_model_shift_${index}`,
          vector: [1, index * 0.01, 0, 0],
          eventType: index % 2 === 0 ? "favorite" : "read_later"
        });
      }

      let now = 6000;
      const service = new InterestClusterCalibrationService({ db, now: () => now });
      const initial = service.getOrCreateCalibration("index_calibration");

      db.prepare(
        `
          update embedding_providers
          set type = 'embedded_local', model = 'fixture-e5-like', dimension = 8
          where id = 'provider_calibration'
        `
      ).run();
      db.prepare(
        `
          update embedding_indexes
          set model = 'fixture-e5-like', dimension = 8
          where id = 'index_calibration'
        `
      ).run();
      now = 7000;

      const regenerated = service.getOrCreateCalibration("index_calibration");

      expect(regenerated.updatedAt).toBe(7000);
      expect(regenerated.providerType).toBe("embedded_local");
      expect(regenerated.providerModel).toBe("fixture-e5-like");
      expect(regenerated.embeddingDimension).toBe(8);
      expect(regenerated.updatedAt).toBeGreaterThan(initial.updatedAt);
      expect(
        db.prepare("select count(*) as count from interest_cluster_calibrations").get()
      ).toEqual({ count: 1 });
    } finally {
      db.close();
    }
  });
});

function createCalibrationDatabase(): DibaoDatabase {
  const db = openDatabase(tempDatabasePath(), { migrate: true });
  const feeds = new SqliteFeedRepository(db);
  const embeddings = new SqliteEmbeddingRepository(db);
  feeds.upsert({
    id: "feed_calibration",
    title: "Calibration Feed",
    feedUrl: "https://example.com/calibration.xml",
    now: 1000
  });
  embeddings.upsertProvider({
    id: "provider_calibration",
    type: "openai_compatible",
    name: "Fixture Provider",
    baseUrl: "https://api.example.com/v1",
    model: "fixture-bge-like",
    dimension: 4,
    enabled: true,
    now: 1000
  });
  embeddings.createIndex({
    id: "index_calibration",
    providerId: "provider_calibration",
    model: "fixture-bge-like",
    dimension: 4,
    status: "active",
    now: 1000
  });
  return db;
}

function insertSignalArticle(
  db: DibaoDatabase,
  input: {
    articleId: string;
    vector: number[];
    eventType: "favorite" | "read_later" | "not_interested";
  }
): void {
  insertBackgroundArticle(db, input);
  db.prepare(
    `
      insert into behavior_events (
        id,
        article_id,
        event_type,
        event_weight,
        created_at
      )
      values (?, ?, ?, ?, 3000)
    `
  ).run(
    `event_${input.articleId}`,
    input.articleId,
    input.eventType,
    input.eventType === "not_interested" ? -6 : 6
  );
}

function insertBackgroundArticle(
  db: DibaoDatabase,
  input: {
    articleId: string;
    vector: number[];
  }
): void {
  const articles = new SqliteArticleRepository(db);
  const vectorStore = new SqliteVecVectorStore(db);
  articles.upsert({
    id: input.articleId,
    feedId: "feed_calibration",
    url: `https://example.com/${input.articleId}`,
    title: input.articleId,
    summary: input.articleId,
    discoveredAt: 2000,
    contentHash: `hash_${input.articleId}`,
    dedupeKey: input.articleId,
    now: 2000
  });
  vectorStore.upsertArticleVector({
    articleId: input.articleId,
    embeddingIndexId: "index_calibration",
    vector: input.vector,
    contentHash: `hash_${input.articleId}`,
    now: 2000
  });
}

function tempDatabasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "dibao-calibration-"));
  tempDirs.push(dir);
  return join(dir, "dibao.sqlite");
}
