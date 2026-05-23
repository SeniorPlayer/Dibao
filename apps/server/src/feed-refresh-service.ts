import { createHash } from "node:crypto";
import {
  FeedParseError,
  normalizeFeedUrl,
  parseFeedXml,
  type ParsedFeed,
  type ParsedFeedItem
} from "@dibao/rss";
import type {
  ArticleRow,
  ArticleRepository,
  DibaoDatabase,
  FeedRepository,
  FeedRow
} from "@dibao/db";
import type { FullContentExtractionService } from "./full-content-extraction-service.js";

export type FeedFetchResponse = {
  ok: boolean;
  status: number;
  statusText?: string;
  text(): Promise<string>;
};

export type FeedFetcher = (url: string) => Promise<FeedFetchResponse>;

export type FeedIngestionErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PROVIDER_ERROR";

export class FeedIngestionError extends Error {
  constructor(
    readonly code: FeedIngestionErrorCode,
    readonly statusCode: number,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "FeedIngestionError";
  }
}

export type FeedRefreshResult = {
  jobId: string;
  feed: FeedRow;
  articleIds: string[];
  effectiveContentChangedArticleIds: string[];
  articlesSeen: number;
  articlesCreated: number;
  articlesUpdated: number;
  fullContent: {
    attempted: number;
    succeeded: number;
    failed: number;
    skipped: number;
  };
};

export type FeedRefreshServiceOptions = {
  db: DibaoDatabase;
  feeds: FeedRepository;
  articles: ArticleRepository;
  fetcher?: FeedFetcher;
  fullContentExtractor?: Pick<FullContentExtractionService, "extract">;
  now?: () => number;
};

export class FeedRefreshService {
  private readonly fetcher: FeedFetcher;
  private readonly now: () => number;

  constructor(private readonly options: FeedRefreshServiceOptions) {
    this.fetcher = options.fetcher ?? defaultFeedFetcher;
    this.now = options.now ?? Date.now;
  }

  async addFeed(input: { feedUrl: string; folderId?: string | null }): Promise<FeedRefreshResult> {
    const feedUrl = normalizeHttpFeedUrl(input.feedUrl);
    const parsed = await this.fetchAndParse(feedUrl);

    return this.writeParsedFeed({
      feedId: feedIdForUrl(feedUrl),
      feedUrl,
      folderId: input.folderId ?? null,
      parsed
    });
  }

  async refreshFeed(feedId: string): Promise<FeedRefreshResult> {
    const existing = this.options.feeds.findById(feedId);
    if (!existing) {
      throw new FeedIngestionError("NOT_FOUND", 404, "Feed not found");
    }

    try {
      const parsed = await this.fetchAndParse(existing.feedUrl);
      return this.writeParsedFeed({
        feedId: existing.id,
        feedUrl: existing.feedUrl,
        folderId: existing.folderId,
        parsed
      });
    } catch (error) {
      if (error instanceof FeedIngestionError && error.code === "PROVIDER_ERROR") {
        this.options.feeds.recordFetchFailure(existing.id, error.message, this.now());
      }
      throw error;
    }
  }

  async fetchAndParse(feedUrl: string): Promise<ParsedFeed> {
    let response: FeedFetchResponse;
    try {
      response = await this.fetcher(feedUrl);
    } catch (error) {
      throw new FeedIngestionError("PROVIDER_ERROR", 502, "Feed fetch failed", {
        cause: errorMessage(error)
      });
    }

    if (!response.ok) {
      throw new FeedIngestionError("PROVIDER_ERROR", 502, "Feed fetch failed", {
        status: response.status,
        statusText: response.statusText ?? null
      });
    }

    const xml = await response.text();
    try {
      return parseFeedXml(xml, feedUrl);
    } catch (error) {
      throw new FeedIngestionError("PROVIDER_ERROR", 502, "Feed parse failed", {
        cause: error instanceof FeedParseError ? error.message : errorMessage(error)
      });
    }
  }

  async writeParsedFeed(input: {
    feedId: string;
    feedUrl: string;
    folderId: string | null;
    parsed: ParsedFeed;
  }): Promise<FeedRefreshResult> {
    const fetchedAt = this.now();
    const fullContent = {
      attempted: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0
    };
    const finalChangedIds = new Set<string>();

    const result = await this.options.db.transaction(() => {
      const existingFeed = this.options.feeds.findById(input.feedId);
      const feed = this.options.feeds.upsert({
        id: input.feedId,
        folderId: input.folderId,
        title: input.parsed.title,
        siteUrl: input.parsed.siteUrl,
        feedUrl: input.feedUrl,
        description: input.parsed.description,
        enabled: true,
        fullContentMode: existingFeed?.fullContentMode ?? "feed_only",
        now: fetchedAt
      });

      let articlesCreated = 0;
      let articlesUpdated = 0;
      const articleIds: string[] = [];
      const records: Array<{
        article: ArticleRow;
        existingContentHash: string | null;
        item: ParsedFeedItem;
        feedContentHash: string;
      }> = [];

      for (const item of input.parsed.items) {
        const feedContentHash = effectiveContentHash({
          title: item.title,
          summary: item.summary,
          contentHtml: item.contentHtml,
          contentText: item.contentText,
          source: "feed"
        });
        const articleInput = articleInputForFeedItem(feed, item, fetchedAt, feedContentHash);
        const existing = this.options.articles.findById(articleInput.id);
        const existingContentHash = existing?.contentHash ?? null;
        const article = this.options.articles.upsert(articleInput);
        if (isRetentionDeletedArticle(article)) {
          continue;
        }

        articleIds.push(article.id);
        this.options.articles.upsertContent({
          articleId: article.id,
          contentHtml: item.contentHtml,
          contentText: item.contentText,
          extractionStatus: "feed_only",
          extractedAt: fetchedAt,
          contentHash: feedContentHash,
          now: fetchedAt
        });
        records.push({ article, existingContentHash, item, feedContentHash });

        if (existing) {
          articlesUpdated += 1;
        } else {
          articlesCreated += 1;
        }
      }

      this.options.feeds.recordFetchSuccess(feed.id, fetchedAt);
      const updatedFeed = this.options.feeds.findById(feed.id);
      if (!updatedFeed) {
        throw new Error(`Failed to load refreshed feed: ${feed.id}`);
      }

      return {
        jobId: syncJobId(feed.id, fetchedAt),
        feed: updatedFeed,
        articleIds,
        records,
        articlesSeen: input.parsed.items.length,
        articlesCreated,
        articlesUpdated
      };
    })();

    for (const record of result.records) {
      let finalContentHash = record.feedContentHash;
      if (
        result.feed.fullContentMode === "fetch_full_content" &&
        this.options.fullContentExtractor
      ) {
        fullContent.attempted += 1;
        try {
          const extracted = await this.options.fullContentExtractor.extract(record.item.url);
          if (extracted.status === "success") {
            fullContent.succeeded += 1;
            finalContentHash = effectiveContentHash({
              title: record.item.title,
              summary: record.item.summary,
              contentHtml: extracted.contentHtml,
              contentText: extracted.contentText,
              source: "full_content"
            });
            this.options.articles.upsertContent({
              articleId: record.article.id,
              contentHtml: extracted.contentHtml,
              contentText: extracted.contentText,
              extractionStatus: "success",
              extractionError: null,
              extractedAt: fetchedAt,
              contentHash: finalContentHash,
              now: fetchedAt
            });
          } else {
            if (extracted.status === "failed") {
              fullContent.failed += 1;
            } else {
              fullContent.skipped += 1;
            }
            this.options.articles.upsertContent({
              articleId: record.article.id,
              contentHtml: record.item.contentHtml,
              contentText: record.item.contentText,
              extractionStatus: extracted.status,
              extractionError: extracted.error,
              extractedAt: fetchedAt,
              contentHash: record.feedContentHash,
              now: fetchedAt
            });
          }
        } catch (error) {
          fullContent.failed += 1;
          this.options.articles.upsertContent({
            articleId: record.article.id,
            contentHtml: record.item.contentHtml,
            contentText: record.item.contentText,
            extractionStatus: "failed",
            extractionError: errorMessage(error),
            extractedAt: fetchedAt,
            contentHash: record.feedContentHash,
            now: fetchedAt
          });
        }
      }
      if (record.existingContentHash !== finalContentHash) {
        finalChangedIds.add(record.article.id);
      }
    }

    this.options.feeds.recordFetchSuccess(result.feed.id, fetchedAt);
    const updatedFeed = this.options.feeds.findById(result.feed.id);
    if (!updatedFeed) {
      throw new Error(`Failed to load refreshed feed: ${result.feed.id}`);
    }

    const effectiveContentChangedArticleIds = [...finalChangedIds];

    return {
      jobId: result.jobId,
      feed: updatedFeed,
      articleIds: result.articleIds,
      effectiveContentChangedArticleIds,
      articlesSeen: result.articlesSeen,
      articlesCreated: result.articlesCreated,
      articlesUpdated: result.articlesUpdated,
      fullContent
    };
  }
}

const defaultFeedFetcher: FeedFetcher = async (url) =>
  fetch(url, {
    headers: {
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8"
    }
  });

function normalizeHttpFeedUrl(input: string): string {
  let feedUrl: string;
  try {
    feedUrl = normalizeFeedUrl(input);
  } catch {
    throw new FeedIngestionError("VALIDATION_ERROR", 400, "feedUrl must be a valid URL");
  }

  const protocol = new URL(feedUrl).protocol;
  if (protocol !== "http:" && protocol !== "https:") {
    throw new FeedIngestionError("VALIDATION_ERROR", 400, "feedUrl must use http or https");
  }

  return feedUrl;
}

export function articleInputForFeedItem(
  feed: FeedRow,
  item: ParsedFeedItem,
  now: number,
  contentHash = effectiveContentHash({
    title: item.title,
    summary: item.summary,
    contentHtml: item.contentHtml,
    contentText: item.contentText,
    source: "feed"
  })
) {
  const canonicalUrl = canonicalizeArticleUrl(item.url);
  const guid = cleanOptional(item.guid);
  const dedupeKey = articleDedupeKey({ canonicalUrl, guid, item });

  return {
    id: articleIdForDedupeKey(feed.id, dedupeKey),
    feedId: feed.id,
    guid,
    url: item.url,
    canonicalUrl,
    title: item.title,
    author: cleanOptional(item.author),
    summary: cleanOptional(item.summary),
    publishedAt: item.publishedAt,
    discoveredAt: now,
    contentHash,
    dedupeKey,
    status: "active" as const,
    now
  };
}

function articleDedupeKey(input: {
  canonicalUrl: string | null;
  guid: string | null;
  item: ParsedFeedItem;
}): string {
  // MVP dedupe is intentionally stable and inspectable: GUID, then URL, then title/date.
  if (input.guid) {
    return `guid:${input.guid}`;
  }

  if (input.canonicalUrl) {
    return `url:${input.canonicalUrl}`;
  }

  return `fallback:${input.item.title}|${input.item.publishedAt ?? ""}`;
}

function canonicalizeArticleUrl(value: string): string | null {
  try {
    const url = new URL(value);
    url.hash = "";
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return null;
  }
}

function cleanOptional(value: string | null): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function isRetentionDeletedArticle(article: ArticleRow): boolean {
  return article.status === "deleted" || article.deletedAt !== null;
}

export function feedIdForUrl(feedUrl: string): string {
  return hashId("feed", feedUrl);
}

export function articleIdForDedupeKey(feedId: string, dedupeKey: string): string {
  return hashId("article", `${feedId}|${dedupeKey}`);
}

function syncJobId(feedId: string, fetchedAt: number): string {
  return `sync_${hashText(`${feedId}|${fetchedAt}`)}`;
}

export function effectiveContentHash(input: {
  title: string;
  summary?: string | null;
  contentText?: string | null;
  contentHtml?: string | null;
  source: "feed" | "full_content";
}): string {
  return hashText(
    [
      `source:${input.source}`,
      input.title,
      input.summary ?? "",
      input.contentHtml ?? "",
      input.contentText ?? ""
    ].join("\n")
  );
}

function hashId(prefix: string, value: string): string {
  return `${prefix}_${hashText(value).slice(0, 20)}`;
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
