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
  nextRefreshAt: number | null;
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
  | "profile_event_process"
  | "ranking_recalculate"
  | "profile_decay"
  | "retention_cleanup"
  | "vector_index_rebuild"
  | "article_fingerprint_backfill"
  | "duplicate_group_rebuild"
  | "keyword_profile_rebuild"
  | "recent_intent_rebuild"
  | "ftrl_train"
  | "ranking_eval_run"
  | "recommendation_backfill"
  | "interest_cluster_label_rebuild"
  | "interest_cluster_merge_diagnostics"
  | "interest_cluster_auto_merge";

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
  feedUrl?: string;
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

export type ArticleFavoriteSort =
  | "favorited_desc"
  | "favorited_asc"
  | "published_desc"
  | "published_asc";

export type ArticleReadLaterSort =
  | "ranked"
  | "read_later_desc"
  | "read_later_asc"
  | "published_desc"
  | "published_asc";

export type ArticleListSort = ArticleFavoriteSort | ArticleReadLaterSort;

export type ArticleReadStatus = "unread" | "read" | "all";

export type ArticleInteractionStatus = "unseen" | "ignored" | "opened" | "reading" | "read";

export type ArticleListInput = {
  view?: ArticleListView;
  feedId?: string;
  folderId?: string;
  status?: ArticleReadStatus;
  unreadOnly?: boolean;
  todayStartAt?: number;
  todayEndAt?: number;
  limit?: number;
  offset?: number;
  rankContext?: string;
  sort?: ArticleListSort;
};

export type ArticleStateSnapshot = {
  read: boolean;
  favorited: boolean;
  liked: boolean;
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
  | "like"
  | "unlike"
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
  title: string;
  summary: string | null;
  contentText: string | null;
  dedupeKey: string;
  contentHash: string | null;
  canonicalUrl: string | null;
  url: string;
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
  baseScore?: number | null;
  ftrlScore?: number | null;
  interestScore: number;
  semanticScore?: number | null;
  bm25Score?: number | null;
  sourceScore: number;
  freshnessScore: number;
  stateScore: number;
  diversityScore: number;
  penaltyScore: number;
  negativePenalty?: number | null;
  duplicatePenalty?: number | null;
  diversityPenalty?: number | null;
  explorationBonus?: number | null;
  pendingEmbeddingScore?: number | null;
  exposurePenalty?: number | null;
  preRerankScore?: number | null;
  rerankScore?: number | null;
  rerankPosition?: number | null;
  rerankWindowId?: string | null;
  algorithmVersion?: string | null;
  featureSchemaVersion?: number | null;
  cocoonLevel?: number | null;
  calculatedAt: number;
};

export type ArticleRankScoreComponentsRow = {
  score: number;
  baseScore: number | null;
  ftrlScore: number | null;
  interestScore: number;
  semanticScore: number | null;
  bm25Score: number | null;
  sourceScore: number;
  freshnessScore: number;
  stateScore: number;
  diversityScore: number;
  penaltyScore: number;
  negativePenalty: number | null;
  duplicatePenalty: number | null;
  diversityPenalty: number | null;
  explorationBonus: number | null;
  pendingEmbeddingScore: number | null;
  exposurePenalty: number | null;
  preRerankScore: number | null;
  rerankScore: number | null;
  rerankPosition: number | null;
  rerankWindowId: string | null;
  algorithmVersion: string | null;
  featureSchemaVersion: number | null;
  cocoonLevel: number | null;
  calculatedAt: number;
};

export type ArticleRankExplanationSourceRow = {
  articleId: string;
  feedTitle: string;
  publishedAt: number | null;
  discoveredAt: number;
  state: ArticleStateSnapshot;
  vectorBlob: Buffer | null;
  rank: ArticleRankScoreComponentsRow | null;
  rankingStatus: ArticleRankingEmbeddingStatus | "rank_pending";
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

export type InterestClusterEvidenceRow = {
  id?: string;
  clusterId?: string;
  articleId: string;
  feedId: string;
  feedTitle: string;
  behaviorEventId?: string | null;
  evidenceSource?: "live_event" | "reconstructed";
  confidence?: number;
  similarity?: number | null;
  weightDelta?: number;
  eventType: BehaviorEventType;
  metadataJson: string | null;
  readingProgress: number;
  title: string;
  vectorBlob: Buffer;
  createdAt: number;
};

export type InterestClusterLabelSource =
  | "manual"
  | "keywords"
  | "representative_titles"
  | "feeds"
  | "fallback";

export type InterestClusterLabelRow = {
  clusterId: string;
  autoLabel: string | null;
  manualLabel: string | null;
  labelSource: InterestClusterLabelSource;
  labelTermsJson: string | null;
  representativeArticlesJson: string | null;
  feedTitlesJson: string | null;
  labelDiagnosticsJson: string | null;
  confidence: number;
  generatedAt: number | null;
  updatedAt: number;
};

export type InterestClusterMergeRecommendation = "auto_merge" | "review" | "ignore";

export type InterestClusterMergeCandidateStatus =
  | "open"
  | "merged"
  | "ignored"
  | "dismissed";

export type InterestClusterMergeCandidateRow = {
  id: string;
  embeddingIndexId: string;
  leftClusterId: string;
  rightClusterId: string;
  polarity: InterestClusterPolarity;
  centroidSimilarity: number;
  labelJaccard: number;
  evidenceOverlap: number;
  representativeOverlap: number;
  sourceOverlap: number;
  mergeScore: number;
  recommendation: InterestClusterMergeRecommendation;
  status: InterestClusterMergeCandidateStatus;
  reasonJson: string | null;
  createdAt: number;
  updatedAt: number;
  decidedAt: number | null;
};

export type EmbeddingUsageWindow = {
  requestCount: number;
  itemCount: number;
  estimatedTokens: number;
};

export type EmbeddingIndexUsage = {
  windows: {
    "24h": EmbeddingUsageWindow;
    "7d": EmbeddingUsageWindow;
    "30d": EmbeddingUsageWindow;
  };
};

export type RankContextRow = {
  id: string;
  algorithmVersion: string;
  featureSchemaVersion: number;
  embeddingIndexId: string | null;
  cocoonLevel: number;
  status: "active" | "retired" | "failed";
  metadataJson: string | null;
  createdAt: number;
  updatedAt: number;
};

export type UpsertRankContextInput = {
  id: string;
  algorithmVersion: string;
  featureSchemaVersion: number;
  embeddingIndexId?: string | null;
  cocoonLevel: number;
  status?: RankContextRow["status"];
  metadataJson?: string | null;
  now?: number;
};

export type UpsertArticleRankExplanationInput = {
  articleId: string;
  rankContext: string;
  embeddingIndexId?: string | null;
  payloadJson: string;
  createdAt: number;
};

export type ArticleRankExplanationPayloadRow = {
  articleId: string;
  rankContext: string;
  embeddingIndexId: string | null;
  payloadJson: string;
  createdAt: number;
};

export type RecommendationMaintenanceStateRow = {
  taskKey: string;
  status: "idle" | "running" | "succeeded" | "failed";
  cursor: string | null;
  processedCount: number;
  error: string | null;
  startedAt: number | null;
  updatedAt: number;
  finishedAt: number | null;
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
  label?: string | null;
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
  clearPositive?: number;
  clearNegative?: number;
  clearSignalCount?: number;
  smoothedPositiveRate?: number;
  sourceConfidence?: number;
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
  unreadCount: number;
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
  coveredArticleCount: number;
  embeddingCount: number;
  coverageRatio: number;
  pendingJobs: number;
  failedJobs: number;
  lastFailedAt: number | null;
  lastError: string | null;
  usage: EmbeddingIndexUsage;
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
