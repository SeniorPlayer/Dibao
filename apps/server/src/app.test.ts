import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  openDatabase,
  SqliteArticleRepository,
  SqliteFeedRepository,
  type DibaoDatabase
} from "@dibao/db";
import { buildServer } from "./app.js";
import type { FeedFetcher } from "./feed-refresh-service.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

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
          version: "0.0.0"
        }
      });
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
            "type must be open, mark_read, mark_unread, favorite, unfavorite, read_later, remove_read_later, hide, not_interested, or read_progress"
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

function insertRank(db: DibaoDatabase, articleId: string, score: number, calculatedAt: number): void {
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

function tempDatabasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "dibao-server-"));
  tempDirs.push(dir);
  return join(dir, "dibao.sqlite");
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
  return app.inject({
    method: "POST",
    url,
    headers: {
      "content-type": "application/json"
    },
    payload: JSON.stringify(payload)
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
