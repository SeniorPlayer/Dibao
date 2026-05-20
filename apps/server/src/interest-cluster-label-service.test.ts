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
  SqliteProfileRepository,
  toVectorBlob,
  type DibaoDatabase
} from "@dibao/db";
import { InterestClusterLabelService } from "./interest-cluster-label-service.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("InterestClusterLabelService", () => {
  it("generates local keyword labels from evidence articles and profile terms", () => {
    const db = createLabelFixtureDatabase();
    try {
      insertClusterWithEvidence(db, {
        clusterId: "cluster_ai",
        articleTitle: "AI Agent CLI for local model workflows",
        summary: "OpenAI and Gemini agents can run from a command line interface.",
        feedTitle: "AI Engineering Notes",
        polarity: "positive",
        profileTerm: "AI Agent"
      });
      const service = new InterestClusterLabelService({ db, now: () => 10_000 });

      expect(service.rebuildActiveIndexLabels()).toEqual({
        embeddingIndexId: "index_labels",
        clusterCount: 1
      });

      const label = service.displayLabelForCluster({
        id: "cluster_ai",
        label: null,
        polarity: "positive",
        displayIndex: 1
      });
      expect(["keywords", "representative_titles"]).toContain(label.labelSource);
      expect(label.displayLabel).toMatch(/AI|Agent|CLI/i);
      expect(label.topTerms.join(" ")).toMatch(/AI|Agent|CLI/i);
    } finally {
      db.close();
    }
  });

  it("generates labels for negative clusters", () => {
    const db = createLabelFixtureDatabase();
    try {
      insertClusterWithEvidence(db, {
        clusterId: "cluster_negative",
        articleTitle: "广告追踪脚本和弹窗营销复盘",
        summary: "用户明确隐藏广告和营销追踪内容。",
        feedTitle: "Marketing Feed",
        polarity: "negative",
        profileTerm: "广告追踪"
      });
      const service = new InterestClusterLabelService({ db, now: () => 10_000 });

      service.rebuildActiveIndexLabels();
      const label = service.displayLabelForCluster({
        id: "cluster_negative",
        label: null,
        polarity: "negative",
        displayIndex: 1
      });

      expect(["keywords", "representative_titles"]).toContain(label.labelSource);
      expect(label.displayLabel).toContain("广告");
    } finally {
      db.close();
    }
  });

  it("falls back to a numbered label when no evidence exists", () => {
    const db = createLabelFixtureDatabase();
    try {
      new SqliteProfileRepository(db).upsertCluster({
        id: "cluster_empty",
        embeddingIndexId: "index_labels",
        polarity: "positive",
        centroidVectorBlob: toVectorBlob([1, 0, 0]),
        weight: 2,
        sampleCount: 1,
        now: 6000
      });
      const service = new InterestClusterLabelService({ db, now: () => 10_000 });

      service.rebuildActiveIndexLabels();

      expect(
        service.displayLabelForCluster({
          id: "cluster_empty",
          label: null,
          polarity: "positive",
          displayIndex: 1
        })
      ).toMatchObject({
        displayLabel: "兴趣簇 #1",
        labelSource: "fallback",
        confidence: 0
      });
    } finally {
      db.close();
    }
  });

  it("prioritizes manual labels and restores automatic labels after clearing", () => {
    const db = createLabelFixtureDatabase();
    try {
      insertClusterWithEvidence(db, {
        clusterId: "cluster_manual",
        articleTitle: "AI Agent CLI for local model workflows",
        summary: "Agent tooling for command line workflows.",
        feedTitle: "AI Engineering Notes",
        polarity: "positive",
        profileTerm: "AI Agent"
      });
      const service = new InterestClusterLabelService({ db, now: () => 10_000 });
      service.rebuildActiveIndexLabels();

      const manual = service.setManualLabel("cluster_manual", "AI 编程代理");
      expect(manual).toMatchObject({
        displayLabel: "AI 编程代理",
        labelSource: "manual",
        manualLabel: "AI 编程代理"
      });

      const cleared = service.setManualLabel("cluster_manual", null);
      expect(cleared.labelSource).toBe("keywords");
      expect(cleared.manualLabel).toBeNull();
      expect(cleared.displayLabel).toMatch(/AI|Agent|CLI/i);
    } finally {
      db.close();
    }
  });

  it("does not mutate rank scores or enqueue embedding/ranking work during rebuild", () => {
    const db = createLabelFixtureDatabase();
    try {
      insertClusterWithEvidence(db, {
        clusterId: "cluster_safe",
        articleTitle: "AI Agent CLI for local model workflows",
        summary: "Agent tooling for command line workflows.",
        feedTitle: "AI Engineering Notes",
        polarity: "positive",
        profileTerm: "AI Agent"
      });
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
          values ('article_ai', 'base', null, 0.42, 0, 0, 0, 0, 0, 0, 7000)
        `
      ).run();
      const beforeScore = db
        .prepare("select score from article_rank_scores where article_id = 'article_ai'")
        .get();
      const service = new InterestClusterLabelService({ db, now: () => 10_000 });

      service.rebuildActiveIndexLabels();

      expect(
        db.prepare("select score from article_rank_scores where article_id = 'article_ai'").get()
      ).toEqual(beforeScore);
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

  it("loads default lexicon and applies app_settings overrides", () => {
    const db = createLabelFixtureDatabase();
    try {
      const settings = new SqliteAppSettingsRepository(db);
      const service = new InterestClusterLabelService({ db, settings, now: () => 10_000 });

      expect(service.getClusterLabelLexicon().effective.stopwords).toContain("article");
      service.updateClusterLabelLexicon({
        stopwordsAdd: ["workflow"],
        stopwordsRemove: ["article"],
        protectedTermsAdd: ["邸报"]
      });

      const lexicon = service.getClusterLabelLexicon();
      expect(lexicon.effective.stopwords).toContain("workflow");
      expect(lexicon.effective.stopwords).not.toContain("article");
      expect(lexicon.effective.protectedTerms).toContain("邸报");
    } finally {
      db.close();
    }
  });

  it("rejects invalid lexicon regex overrides without crashing", () => {
    const db = createLabelFixtureDatabase();
    try {
      const settings = new SqliteAppSettingsRepository(db);
      const service = new InterestClusterLabelService({ db, settings, now: () => 10_000 });

      expect(() =>
        service.updateClusterLabelLexicon({
          badTermPatternsAdd: ["["]
        })
      ).toThrow(/invalid regular expression/i);
    } finally {
      db.close();
    }
  });

  it("filters URL, HTML, metadata, and generic noise while preserving protected AI terms", () => {
    const db = createLabelFixtureDatabase();
    try {
      insertClusterWithEvidence(db, {
        clusterId: "cluster_noise",
        articleId: "article_noise",
        articleTitle: "AI Agent workflow beyond article affiliation strong https COM",
        summary: "<strong>AI</strong> href src utm_source https://huxiu.com example.ai",
        feedTitle: "COM HTML Feed",
        polarity: "positive",
        profileTerm: "strong affiliation article"
      });
      const service = new InterestClusterLabelService({ db, now: () => 10_000 });

      service.rebuildActiveIndexLabels();
      const label = service.displayLabelForCluster({
        id: "cluster_noise",
        label: null,
        polarity: "positive",
        displayIndex: 1
      });
      const terms = label.topTerms.map((term) => term.toLowerCase());

      expect(terms).toContain("ai");
      expect(terms).not.toEqual(
        expect.arrayContaining([
          "article",
          "affiliation",
          "strong",
          "https",
          "com",
          "href",
          "src",
          "utm_source",
          "huxiu.com",
          "example.ai"
        ])
      );
    } finally {
      db.close();
    }
  });

  it("lets cluster-local evidence outrank global profile terms and disambiguates collisions", () => {
    const db = createLabelFixtureDatabase();
    try {
      insertClusterWithEvidence(db, {
        clusterId: "cluster_cli",
        articleId: "article_cli",
        articleTitle: "AI Agent CLI 本地工作流",
        summary: "命令行代理工具",
        feedTitle: "AI Engineering Notes",
        polarity: "positive",
        profileTerm: "AI article affiliation"
      });
      insertClusterWithEvidence(db, {
        clusterId: "cluster_product",
        articleId: "article_product",
        articleTitle: "AI Agent 产品路线图",
        summary: "产品策略和功能设计",
        feedTitle: "AI Product Notes",
        polarity: "positive",
        profileTerm: "AI article affiliation"
      });
      const service = new InterestClusterLabelService({ db, now: () => 10_000 });

      service.rebuildActiveIndexLabels();
      const cli = service.displayLabelForCluster({
        id: "cluster_cli",
        label: null,
        polarity: "positive",
        displayIndex: 1
      });
      const product = service.displayLabelForCluster({
        id: "cluster_product",
        label: null,
        polarity: "positive",
        displayIndex: 2
      });

      expect(cli.displayLabel).not.toBe(product.displayLabel);
      expect(`${cli.displayLabel} ${product.displayLabel}`).not.toMatch(/affiliation|article/i);
    } finally {
      db.close();
    }
  });

  it("dedupes obvious Chinese substring chains", () => {
    const db = createLabelFixtureDatabase();
    try {
      insertClusterWithEvidence(db, {
        clusterId: "cluster_cn",
        articleId: "article_cn",
        articleTitle: "两市成交 人民币中间价 市场观察",
        summary: "两市 两市成 两市成交 人民币中间价",
        feedTitle: "市场快讯",
        polarity: "positive",
        profileTerm: "两市"
      });
      const service = new InterestClusterLabelService({ db, now: () => 10_000 });

      service.rebuildActiveIndexLabels();
      const label = service.displayLabelForCluster({
        id: "cluster_cn",
        label: null,
        polarity: "positive",
        displayIndex: 1
      });
      const chain = ["两市", "两市成", "两市成交"].filter((term) =>
        label.topTerms.includes(term)
      );

      expect(label.topTerms).toContain("两市成交");
      expect(chain.length).toBeLessThanOrEqual(1);
    } finally {
      db.close();
    }
  });
});

function createLabelFixtureDatabase(): DibaoDatabase {
  const db = openDatabase(tempDatabasePath(), { migrate: true });
  const feeds = new SqliteFeedRepository(db);
  const embeddings = new SqliteEmbeddingRepository(db);

  feeds.upsert({
    id: "feed_labels",
    title: "AI Engineering Notes",
    feedUrl: "https://example.com/labels.xml",
    now: 1000
  });
  embeddings.upsertProvider({
    id: "provider_labels",
    type: "openai_compatible",
    name: "Fixture Provider",
    baseUrl: "https://api.example.com/v1",
    model: "fixture",
    dimension: 3,
    enabled: true,
    now: 1000
  });
  embeddings.createIndex({
    id: "index_labels",
    providerId: "provider_labels",
    model: "fixture",
    dimension: 3,
    status: "active",
    now: 1000
  });

  return db;
}

function insertClusterWithEvidence(
  db: DibaoDatabase,
  input: {
    clusterId: string;
    articleId?: string;
    articleTitle: string;
    summary: string;
    feedTitle: string;
    polarity: "positive" | "negative";
    profileTerm: string;
  }
): void {
  const feeds = new SqliteFeedRepository(db);
  const articles = new SqliteArticleRepository(db);
  const profiles = new SqliteProfileRepository(db);
  feeds.upsert({
    id: `feed_${input.clusterId}`,
    title: input.feedTitle,
    feedUrl: `https://example.com/${input.clusterId}.xml`,
    now: 2000
  });
  articles.upsert({
    id: input.articleId ?? "article_ai",
    feedId: `feed_${input.clusterId}`,
    url: `https://example.com/${input.clusterId}`,
    title: input.articleTitle,
    summary: input.summary,
    discoveredAt: 3000,
    dedupeKey: input.articleId ?? input.clusterId,
    now: 3000
  });
  profiles.upsertCluster({
    id: input.clusterId,
    embeddingIndexId: "index_labels",
    polarity: input.polarity,
    centroidVectorBlob: toVectorBlob([1, 0, 0]),
    weight: 5,
    sampleCount: 2,
    now: 5000
  });
  db.prepare(
    `
      insert into behavior_events (
        id,
        article_id,
        event_type,
        event_weight,
        created_at
      )
      values (?, ?, ?, ?, 4000)
    `
  ).run(
    `event_${input.clusterId}`,
    input.articleId ?? "article_ai",
    input.polarity === "positive" ? "favorite" : "not_interested",
    input.polarity === "positive" ? 4 : -4
  );
  profiles.insertClusterEvidence({
    id: `evidence_${input.clusterId}`,
    clusterId: input.clusterId,
    articleId: input.articleId ?? "article_ai",
    behaviorEventId: `event_${input.clusterId}`,
    evidenceSource: "live_event",
    confidence: 0.9,
    similarity: 0.96,
    weightDelta: input.polarity === "positive" ? 4 : -4,
    createdAt: 4500
  });
  db.prepare(
    `
      insert into profile_terms (
        term,
        polarity,
        scope,
        weight,
        evidence_count,
        last_event_at,
        updated_at
      )
      values (?, ?, 'long', 2.5, 2, 4500, 4500)
      on conflict(term, polarity, scope) do update set
        weight = excluded.weight,
        evidence_count = profile_terms.evidence_count + excluded.evidence_count,
        updated_at = excluded.updated_at
    `
  ).run(input.profileTerm, input.polarity);
}

function tempDatabasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "dibao-cluster-labels-"));
  tempDirs.push(dir);
  return join(dir, "dibao.sqlite");
}
