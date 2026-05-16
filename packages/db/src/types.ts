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

export type JobType =
  | "feed_refresh"
  | "content_extract"
  | "embedding_generate"
  | "ranking_recalculate"
  | "profile_decay"
  | "retention_cleanup"
  | "vector_index_rebuild";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type JobRow = {
  id: string;
  type: JobType;
  status: JobStatus;
  payloadJson: string | null;
  error: string | null;
  attempts: number;
  maxAttempts: number;
  runAfter: number;
  startedAt: number | null;
  finishedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type JobListInput = {
  status?: JobStatus;
  type?: JobType;
  limit?: number;
};

export type EnqueueJobInput = {
  id: string;
  type: JobType;
  payloadJson?: string | null;
  maxAttempts?: number;
  runAfter?: number;
  now?: number;
};

export type ArticleRetentionCandidateRow = {
  articleId: string;
  retainedAt: number;
};

export type ArticleRetentionCleanupResult = {
  articlesSoftDeleted: number;
  contentsDeleted: number;
  ftsRowsDeleted: number;
  rankScoresDeleted: number;
  rankExplanationsDeleted: number;
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

export type ArticleInteractionStatus = "unseen" | "ignored" | "opened" | "reading" | "read";

export type ArticleListInput = {
  view?: ArticleListView;
  feedId?: string;
  folderId?: string;
  status?: ArticleReadStatus;
  limit?: number;
  offset?: number;
  rankContext?: string;
};

export type ArticleStateSnapshot = {
  read: boolean;
  favorited: boolean;
  readLater: boolean;
  hidden: boolean;
  notInterested: boolean;
  readingProgress: number;
  interactionStatus: ArticleInteractionStatus;
  openedAt: number | null;
  ignoredAt: number | null;
};

export type ArticleRankingEmbeddingStatus = "ready" | "embedding_pending" | "no_provider";

export type ArticleActionType =
  | "impression"
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

export type BehaviorEventType = ArticleActionType | "read_complete" | "quick_bounce";

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
  eventId: string;
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
  behaviorProjectionScore: number;
  behaviorEventCount: number;
  vectorBlob: Buffer | null;
  embeddingContentHash: string | null;
  embeddingStatus: ArticleRankingEmbeddingStatus;
};

export type UpsertArticleRankScoreInput = {
  articleId: string;
  rankContext?: string;
  embeddingIndexId?: string | null;
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
  rankingStatus: ArticleRankingEmbeddingStatus | "learning";
};

export type InterestClusterPolarity = "positive" | "negative";

export type InterestClusterRow = {
  id: string;
  embeddingIndexId: string;
  polarity: InterestClusterPolarity;
  label: string | null;
  centroidVectorBlob: Buffer;
  weight: number;
  sampleCount: number;
  lastMatchedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type UpsertInterestClusterInput = {
  id: string;
  embeddingIndexId: string;
  polarity: InterestClusterPolarity;
  label?: string | null;
  centroidVectorBlob: Buffer;
  weight: number;
  sampleCount: number;
  lastMatchedAt?: number | null;
  now?: number;
};

export type UpdateInterestClusterInput = {
  id: string;
  centroidVectorBlob?: Buffer;
  weight?: number;
  sampleCount?: number;
  lastMatchedAt?: number | null;
  now?: number;
};

export type ProfileBehaviorEventRow = {
  id: string;
  articleId: string;
  feedId: string;
  eventType: BehaviorEventType;
  metadataJson: string | null;
  createdAt: number;
  articleUpdatedAt: number;
  readingProgress: number;
  contentHash: string;
  title: string;
  summary: string | null;
  contentText: string | null;
  embeddingIndexId: string | null;
  embeddingContentHash: string | null;
  vectorBlob: Buffer | null;
};

export type FeedBehaviorEventRow = {
  eventType: BehaviorEventType;
  metadataJson: string | null;
  readingProgress: number;
  title: string;
  summary: string | null;
  contentText: string | null;
};

export type FeedStatsInput = {
  feedId: string;
  positiveScore: number;
  negativeScore: number;
  openRate: number;
  favoriteRate: number;
  notInterestedRate: number;
  now?: number;
};

export type BehaviorEventCountRow = {
  eventType: BehaviorEventType;
  count: number;
};

export type ClusterCountRow = {
  positive: number;
  negative: number;
};

export type RankedArticleCountsRow = {
  base: number;
  active: number;
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

export type EmbeddingProviderRow = {
  id: string;
  type: "embedded_local" | "ollama" | "openai_compatible" | "custom_http";
  name: string;
  baseUrl: string | null;
  model: string;
  dimension: number;
  apiKeyEncrypted: string | null;
  enabled: boolean;
  qualityTier: "basic" | "recommended" | "best_quality";
  lastTestStatus: "success" | "failed" | null;
  lastTestError: string | null;
  lastTestAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type UpdateEmbeddingProviderInput = Partial<
  Pick<
    EmbeddingProviderInput,
    "type" | "name" | "baseUrl" | "model" | "dimension" | "apiKeyEncrypted" | "enabled" | "qualityTier"
  >
> & {
  id: string;
  now?: number;
};

export type EmbeddingProviderTestResultInput = {
  id: string;
  status: "success" | "failed";
  error?: string | null;
  testedAt: number;
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
  createdAt?: number;
  updatedAt?: number;
};

export type EmbeddingIndexListRow = EmbeddingIndexRow & {
  candidateCount: number;
  eligibleArticleCount: number;
  missingEmbeddingCount: number;
  staleEmbeddingCount: number;
  embeddingCount: number;
  coverageRatio: number;
  pendingJobs: number;
  failedJobs: number;
  lastFailedAt: number | null;
  lastError: string | null;
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

export type ArticleEmbeddingCandidateRow = {
  articleId: string;
  title: string;
  summary: string | null;
  contentText: string | null;
  contentHash: string;
};
