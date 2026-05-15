import type Database from "better-sqlite3";

export type DibaoDatabase = Database.Database;

export type Migration = {
  version: string;
  name: string;
  sql: string;
  checksum?: string;
};

export type AppliedMigration = {
  version: string;
  name: string;
  appliedAt: number;
  checksum: string | null;
};

export type FeedRow = {
  id: string;
  folderId: string | null;
  title: string;
  siteUrl: string | null;
  feedUrl: string;
  description: string | null;
  enabled: boolean;
  sourceWeight: number;
  lastFetchedAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
};

export type FeedFolderRow = {
  id: string;
  title: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
};

export type FeedListInput = {
  folderId?: string | null;
  enabled?: boolean;
};

export type UpsertFeedInput = {
  id: string;
  folderId?: string | null;
  title: string;
  siteUrl?: string | null;
  feedUrl: string;
  description?: string | null;
  enabled?: boolean;
  sourceWeight?: number;
  now?: number;
};

export type UpdateFeedInput = {
  id: string;
  title?: string;
  folderId?: string | null;
  enabled?: boolean;
  sourceWeight?: number;
  now?: number;
};

export type UpsertFeedFolderInput = {
  id: string;
  title: string;
  sortOrder?: number;
  now?: number;
};

export type UpdateFeedFolderInput = {
  id: string;
  title?: string;
  sortOrder?: number;
  now?: number;
};

export type AuthCredentialRow = {
  id: string;
  passwordHash: string;
  passwordAlgo: string;
  createdAt: number;
  updatedAt: number;
};

export type CreateAuthCredentialInput = {
  id: string;
  passwordHash: string;
  passwordAlgo: string;
  now?: number;
};

export type SessionRow = {
  id: string;
  sessionHash: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number | null;
  userAgent: string | null;
  ipHash: string | null;
};

export type CreateSessionInput = {
  id: string;
  sessionHash: string;
  createdAt: number;
  expiresAt: number;
  userAgent?: string | null;
  ipHash?: string | null;
};

export type ArticleRow = {
  id: string;
  feedId: string;
  guid: string | null;
  url: string;
  canonicalUrl: string | null;
  title: string;
  author: string | null;
  summary: string | null;
  publishedAt: number | null;
  discoveredAt: number;
  contentHash: string | null;
  dedupeKey: string;
  status: "active" | "archived" | "deleted";
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

export type ArticleListView = "recommended" | "latest" | "favorites" | "read_later";

export type ArticleReadStatus = "unread" | "read" | "all";

export type ArticleListInput = {
  view?: ArticleListView;
  feedId?: string;
  folderId?: string;
  status?: ArticleReadStatus;
  limit?: number;
  offset?: number;
};

export type ArticleStateSnapshot = {
  read: boolean;
  favorited: boolean;
  readLater: boolean;
  hidden: boolean;
  notInterested: boolean;
  readingProgress: number;
};

export type ArticleActionType =
  | "open"
  | "mark_read"
  | "mark_unread"
  | "favorite"
  | "unfavorite"
  | "read_later"
  | "remove_read_later"
  | "hide"
  | "not_interested"
  | "read_progress";

export type RecordArticleActionInput = {
  articleId: string;
  type: ArticleActionType;
  progress?: number;
  metadata?: Record<string, unknown>;
  now?: number;
  eventId?: string;
};

export type RecordArticleActionResult = {
  state: ArticleStateSnapshot;
};

export type ArticleRankSnapshot = {
  score: number;
  calculatedAt: number;
};

export type ArticleRankingCandidateRow = {
  articleId: string;
  feedId: string;
  publishedAt: number | null;
  discoveredAt: number;
  sourceWeight: number;
  feedPositiveScore: number;
  feedNegativeScore: number;
  feedOpenRate: number;
  feedFavoriteRate: number;
  feedNotInterestedRate: number;
  state: ArticleStateSnapshot;
  behaviorEventWeightSum: number;
  behaviorEventCount: number;
};

export type UpsertArticleRankScoreInput = {
  articleId: string;
  rankContext?: string;
  score: number;
  interestScore: number;
  sourceScore: number;
  freshnessScore: number;
  stateScore: number;
  diversityScore: number;
  penaltyScore: number;
  calculatedAt: number;
};

export type ArticleRankScoreComponentsRow = {
  score: number;
  interestScore: number;
  sourceScore: number;
  freshnessScore: number;
  stateScore: number;
  diversityScore: number;
  penaltyScore: number;
  calculatedAt: number;
};

export type ArticleRankExplanationSourceRow = {
  articleId: string;
  feedTitle: string;
  publishedAt: number | null;
  discoveredAt: number;
  state: ArticleStateSnapshot;
  rank: ArticleRankScoreComponentsRow | null;
};

export type ArticleListItemRow = {
  id: string;
  feedId: string;
  feedTitle: string;
  title: string;
  url: string;
  author: string | null;
  summary: string | null;
  publishedAt: number | null;
  discoveredAt: number;
  state: ArticleStateSnapshot;
  rank: ArticleRankSnapshot | null;
};

export type ArticleDetailRow = ArticleListItemRow & {
  contentHtml: string | null;
  contentText: string | null;
  extractionStatus: "pending" | "feed_only" | "success" | "failed" | "skipped";
  extractionError: string | null;
};

export type ArticleListResult = {
  items: ArticleListItemRow[];
  nextOffset: number | null;
};

export type UpsertArticleInput = {
  id: string;
  feedId: string;
  guid?: string | null;
  url: string;
  canonicalUrl?: string | null;
  title: string;
  author?: string | null;
  summary?: string | null;
  publishedAt?: number | null;
  discoveredAt?: number;
  contentHash?: string | null;
  dedupeKey: string;
  status?: ArticleRow["status"];
  now?: number;
};

export type UpsertArticleContentInput = {
  articleId: string;
  contentHtml?: string | null;
  contentText?: string | null;
  extractionStatus?: "pending" | "feed_only" | "success" | "failed" | "skipped";
  extractionError?: string | null;
  extractedAt?: number | null;
  now?: number;
};

export type ArticleSearchResult = {
  articleId: string;
  title: string;
  summary: string | null;
  rank: number;
};

export type EmbeddingProviderInput = {
  id: string;
  type: "embedded_local" | "ollama" | "openai_compatible" | "custom_http";
  name: string;
  baseUrl?: string | null;
  model: string;
  dimension: number;
  apiKeyEncrypted?: string | null;
  enabled?: boolean;
  qualityTier?: "basic" | "recommended" | "best_quality";
  now?: number;
};

export type EmbeddingIndexInput = {
  id: string;
  providerId: string;
  model: string;
  dimension: number;
  distanceMetric?: "cosine";
  tableName: string;
  status?: "active" | "building" | "disabled" | "failed" | "retired";
  now?: number;
};

export type EmbeddingIndexRow = {
  id: string;
  providerId: string;
  model: string;
  dimension: number;
  distanceMetric: "cosine";
  tableName: string;
  status: "active" | "building" | "disabled" | "failed" | "retired";
};

export type ArticleVectorInput = {
  articleId: string;
  embeddingIndexId: string;
  vector: Buffer | readonly number[];
  contentHash: string;
  now?: number;
};

export type SimilarArticleQuery = {
  embeddingIndexId: string;
  vector: Buffer | readonly number[];
  limit?: number;
};

export type VectorSearchResult = {
  articleId: string;
  distance: number;
};
