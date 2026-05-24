import type {
  AppSettingsRepository,
  ArticleRepository,
  ArticleRetentionCleanupResult
} from "@dibao/db";
import type { VectorStore } from "@dibao/db";

export const RETENTION_ARTICLE_DAYS_SETTING_KEY = "retention.articleDays";
export const RETENTION_SETTINGS_KEY = "retention.settings";
export const DEFAULT_ARTICLE_RETENTION_DAYS = 0;
export const MIN_ARTICLE_RETENTION_DAYS = 0;
export const MAX_ARTICLE_RETENTION_DAYS = 3650;
export const DAY_IN_MS = 24 * 60 * 60 * 1000;
const RETENTION_CLEANUP_BATCH_SIZE = 100;

export type ArticleRetentionSummary = ArticleRetentionCleanupResult & {
  retentionDays: number;
  cutoff: number;
  candidateArticles: number;
  vectorsDeleted: number;
  hasMoreCandidates: boolean;
};

export type ArticleRetentionServiceOptions = {
  settings: AppSettingsRepository;
  articles: Pick<ArticleRepository, "cleanupForRetention" | "listRetentionCandidates">;
  vectorStore: Pick<VectorStore, "deleteArticleVectors">;
  now?: () => number;
  env?: Record<string, string | undefined>;
};

export class ArticleRetentionService {
  private readonly now: () => number;
  private readonly env: Record<string, string | undefined>;

  constructor(private readonly options: ArticleRetentionServiceOptions) {
    this.now = options.now ?? Date.now;
    this.env = options.env ?? process.env;
  }

  getRetentionDays(): number {
    const setting = this.options.settings.getJson<unknown>(RETENTION_ARTICLE_DAYS_SETTING_KEY);
    if (setting !== null) {
      return parseRetentionDays(setting) ?? DEFAULT_ARTICLE_RETENTION_DAYS;
    }

    const envValue = this.env.DIBAO_ARTICLE_RETENTION_DAYS;
    if (envValue !== undefined) {
      return parseRetentionDays(envValue) ?? DEFAULT_ARTICLE_RETENTION_DAYS;
    }

    return DEFAULT_ARTICLE_RETENTION_DAYS;
  }

  getRetentionPolicy(): { keepFavorites: boolean; keepReadLater: boolean } {
    const stored = this.options.settings.getJson<unknown>(RETENTION_SETTINGS_KEY);
    const input =
      typeof stored === "object" && stored !== null && !Array.isArray(stored)
        ? (stored as Record<string, unknown>)
        : {};

    return {
      keepFavorites:
        typeof input.keepFavorites === "boolean" ? input.keepFavorites : true,
      keepReadLater:
        typeof input.keepReadLater === "boolean" ? input.keepReadLater : true
    };
  }

  runCleanup(options: { maxBatches?: number } = {}): ArticleRetentionSummary {
    const now = this.now();
    const retentionDays = this.getRetentionDays();
    const retentionPolicy = this.getRetentionPolicy();
    const cutoff = retentionDays === 0 ? 0 : now - retentionDays * DAY_IN_MS;
    const maxBatches = options.maxBatches ?? Number.POSITIVE_INFINITY;
    let batches = 0;
    let vectorsDeleted = 0;
    let candidateArticles = 0;
    let hasMoreCandidates = false;
    let cleanup: ArticleRetentionCleanupResult = {
      articlesSoftDeleted: 0,
      contentsDeleted: 0,
      ftsRowsDeleted: 0,
      rankScoresDeleted: 0,
      rankExplanationsDeleted: 0
    };

    if (retentionDays === 0) {
      return {
        retentionDays,
        cutoff,
        candidateArticles,
        vectorsDeleted,
        hasMoreCandidates,
        ...cleanup
      };
    }

    while (batches < maxBatches) {
      const candidates = this.options.articles.listRetentionCandidates({
        cutoff,
        keepFavorites: retentionPolicy.keepFavorites,
        keepReadLater: retentionPolicy.keepReadLater,
        limit: RETENTION_CLEANUP_BATCH_SIZE
      });
      if (candidates.length === 0) {
        break;
      }
      batches += 1;

      const articleIds = candidates.map((candidate) => candidate.articleId);
      candidateArticles += articleIds.length;

      for (const articleId of articleIds) {
        vectorsDeleted += this.options.vectorStore.deleteArticleVectors(articleId);
      }

      cleanup = addCleanupResults(
        cleanup,
        this.options.articles.cleanupForRetention(articleIds, now)
      );
    }

    if (batches >= maxBatches) {
      hasMoreCandidates =
        this.options.articles.listRetentionCandidates({
          cutoff,
          keepFavorites: retentionPolicy.keepFavorites,
          keepReadLater: retentionPolicy.keepReadLater,
          limit: 1
        }).length > 0;
    }

    return {
      retentionDays,
      cutoff,
      candidateArticles,
      vectorsDeleted,
      hasMoreCandidates,
      ...cleanup
    };
  }
}

export function parseRetentionDays(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;

  if (
    !Number.isInteger(parsed) ||
    parsed < MIN_ARTICLE_RETENTION_DAYS ||
    parsed > MAX_ARTICLE_RETENTION_DAYS
  ) {
    return null;
  }

  return parsed;
}

function addCleanupResults(
  left: ArticleRetentionCleanupResult,
  right: ArticleRetentionCleanupResult
): ArticleRetentionCleanupResult {
  return {
    articlesSoftDeleted: left.articlesSoftDeleted + right.articlesSoftDeleted,
    contentsDeleted: left.contentsDeleted + right.contentsDeleted,
    ftsRowsDeleted: left.ftsRowsDeleted + right.ftsRowsDeleted,
    rankScoresDeleted: left.rankScoresDeleted + right.rankScoresDeleted,
    rankExplanationsDeleted: left.rankExplanationsDeleted + right.rankExplanationsDeleted
  };
}
