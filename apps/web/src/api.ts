export type ApiPage = {
  nextCursor: string | null;
};

export type Feed = {
  id: string;
  folderId: string | null;
  title: string;
  siteUrl: string | null;
  feedUrl: string;
  description: string | null;
  enabled: boolean;
  fullContentMode: FeedFullContentMode;
  sourceWeight: number;
  lastFetchedAt: string | null;
  lastSuccessAt: string | null;
  nextRefreshAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FeedFullContentMode = "feed_only" | "fetch_full_content";

export type FeedDiscoveryCandidateStatus = "valid" | "duplicate" | "invalid";

export type FeedDiscoveryCandidate = {
  feedUrl: string;
  title: string | null;
  siteUrl: string | null;
  description: string | null;
  format: "rss" | "atom" | "unknown";
  status: FeedDiscoveryCandidateStatus;
  existingFeedId: string | null;
  itemCount: number;
  recentItems: Array<{
    title: string;
    url: string | null;
    publishedAt: string | null;
  }>;
  error: string | null;
};

export type FeedDiscoveryResponse = {
  inputUrl: string;
  normalizedUrl: string;
  inputKind: "feed" | "html" | "unknown";
  candidates: FeedDiscoveryCandidate[];
  warnings: string[];
};

export type FeedHealthStatus =
  | "healthy"
  | "never_fetched"
  | "due"
  | "stale"
  | "failing"
  | "disabled";

export type FeedHealthSeverity = "ok" | "info" | "warning" | "error" | "disabled";

export type FeedDiagnosticItem = {
  feed: Pick<Feed, "id" | "title" | "feedUrl" | "siteUrl" | "enabled">;
  diagnostic: {
    feedId: string;
    status: FeedHealthStatus;
    severity: FeedHealthSeverity;
    code: string;
    message: string;
    lastFetchedAt: string | null;
    lastSuccessAt: string | null;
    nextRefreshAt: string | null;
    lastError: string | null;
  };
};

export type FeedDiagnosticsResponse = {
  summary: {
    total: number;
    enabled: number;
    healthy: number;
    warning: number;
    error: number;
    disabled: number;
    neverFetched: number;
  };
  items: FeedDiagnosticItem[];
};

export type FeedFolder = {
  id: string;
  title: string;
  sortOrder: number;
};

export type UpdateFeedInput = {
  title?: string;
  folderId?: string | null;
  feedUrl?: string;
  enabled?: boolean;
  fullContentMode?: FeedFullContentMode;
  sourceWeight?: number;
};

export type FullContentPreviewResponse = {
  feedId: string;
  articleUrl: string;
  status: "success" | "failed" | "skipped";
  title: string | null;
  excerpt: string | null;
  contentText: string | null;
  contentHtml: string | null;
  error: string | null;
};

export type FullContentBackfillResponse = {
  feedId: string;
  articlesSeen: number;
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  articleIds: string[];
  effectiveContentChangedArticleIds: string[];
  limited: boolean;
};

export type UpdateFeedFolderInput = {
  title?: string;
  sortOrder?: number;
};

export type ArticleInteractionStatus =
  | "unseen"
  | "seen"
  | "saved"
  | "ignored"
  | "opened"
  | "reading"
  | "read";

export type ArticleState = {
  read: boolean;
  favorited: boolean;
  liked: boolean;
  readLater: boolean;
  hidden: boolean;
  notInterested: boolean;
  readingProgress: number;
  interactionStatus?: ArticleInteractionStatus;
  openedAt?: number | null;
  ignoredAt?: number | null;
};

export type ArticleListItem = {
  id: string;
  feedId: string;
  feedTitle: string;
  title: string;
  url: string;
  author: string | null;
  summary: string | null;
  publishedAt: string | null;
  discoveredAt: string;
  state: ArticleState;
};

export type ArticleDetail = ArticleListItem & {
  contentHtml: string | null;
  contentText: string | null;
  extractionStatus: "pending" | "feed_only" | "success" | "failed" | "skipped";
  extractionError: string | null;
};

export type ArticleActionRequest =
  | {
      type: "impression" | "open" | "hide" | "not_interested";
      value?: true;
      metadata?: Record<string, unknown>;
    }
  | {
      type: "favorite" | "like" | "read_later" | "mark_read";
      value: boolean;
      metadata?: Record<string, unknown>;
    }
  | {
      type: "read_progress";
      progress: number;
      metadata?: Record<string, unknown>;
    };

export type ArticleActionResponse = {
  state: ArticleState;
};

export type RankExplanationReasonType =
  | "interest"
  | "source"
  | "freshness"
  | "state"
  | "fallback"
  | "negative"
  | "penalty"
  | "exploration";

export type RankExplanationReason = {
  type: RankExplanationReasonType;
  label: string;
  impact: "positive" | "negative" | "neutral";
  family?: {
    id: string;
    label: string;
    maturity: number;
    dominanceRatio: number;
    matchedFamilyCount: number;
  };
  recentIntent?: {
    polarity: "positive";
  };
  cluster?: RecommendationClusterItem & {
    similarity: number;
  };
  clusters?: Array<RecommendationClusterItem & {
    similarity: number;
  }>;
};

export type RankExplanation = {
  articleId: string;
  reasons: RankExplanationReason[];
  generatedAt: string;
};

export type ArticleView = "latest" | "recommended" | "favorites" | "read_later";
export type ArticleTimeWindow = "all" | "24h" | "7d" | "30d";
export type ArticleSearchState = "all" | "unread" | "read" | "favorites" | "read_later";
export type ArticleSearchSort = "relevance" | "recommended" | "latest";

export type FavoriteArticleSort =
  | "favorited_desc"
  | "favorited_asc"
  | "published_desc"
  | "published_asc";

export type ReadLaterArticleSort =
  | "ranked"
  | "read_later_desc"
  | "read_later_asc"
  | "published_desc"
  | "published_asc";

export type ArticleListSort = FavoriteArticleSort | ReadLaterArticleSort;

export type ArticleListResponse = {
  data: ArticleListItem[];
  page: ApiPage;
  meta: {
    unreadCount: number;
  };
};

export type ReaderCommandMarkScopeReadResponse = {
  ok: true;
  commandId: string;
  markedReadCount: number;
};

export type ReaderCommandMarkScopeReadPreviewResponse = {
  ok: true;
  markedReadCount: number;
};

export type ReaderCommandScope =
  | {
      type: "article_list";
      view: "latest" | "recommended";
      feedId?: string | null;
      folderId?: string | null;
      clearWindow?: ArticleTimeWindow;
      timeWindow?: ArticleTimeWindow;
    }
  | {
      type: "search";
      q: string;
      feedId?: string | null;
      folderId?: string | null;
      from?: string | null;
      to?: string | null;
      state?: ArticleSearchState;
    };

export type OpmlImportResponse = {
  foldersCreated: number;
  feedsCreated: number;
  feedsSkipped: number;
  errors: string[];
};

export type AuthSession = {
  setupCompleted: boolean;
  authenticated: boolean;
};

export type SetupStatus = {
  setupCompleted: boolean;
  hasFeeds: boolean;
  hasEmbeddingProvider: boolean;
  firstRefreshStatus: "idle" | "running" | "succeeded" | "failed";
  derivedDataUpgrade?: DerivedDataUpgradeStatus;
};

export type DerivedDataUpgradeStatus = {
  id: string;
  targetVersion: string;
  state: "not_required" | "pending" | "running" | "completed" | "failed";
  blocking: boolean;
  step:
    | "detecting"
    | "reset"
    | "replay"
    | "labels"
    | "families"
    | "ranking"
    | "completed"
    | "failed"
    | "skipped";
  activeIndexId: string | null;
  reason: string | null;
  progress: {
    current: number;
    total: number;
    chunksProcessed: number;
    percent: number;
  };
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  result: unknown | null;
};

export type SettingsLocale = "zh-CN" | "en-US" | "ja-JP";
export type DefaultHomeView = "recommended" | "latest";

export type ReaderSettings = {
  fontSize: number;
  lineHeight: number;
  paragraphGap: number;
  readerWidth: number;
  theme: "paper";
};

export type AppSettings = {
  ui: {
    locale: SettingsLocale;
    defaultHomeView: DefaultHomeView;
  };
  reader: ReaderSettings;
  behavior: {
    markScrolledArticlesIgnored: boolean;
    removeReadLaterOnReadComplete: boolean;
  };
  telemetry: {
    enabled: boolean;
  };
  retention: {
    retentionDays: number;
    keepFavorites: boolean;
    keepReadLater: boolean;
  };
  ranking: {
    preferFreshness: number;
    preferSource: number;
    preferDiversity: number;
    cocoonLevel: number;
    maxPositiveInterestClusters: number;
    maxNegativeInterestClusters: number;
    maxPositiveInterestFamilies: number;
    maxNegativeInterestFamilies: number;
    localLearningEnabled: boolean;
    localLearningShadowMode: boolean;
    explorationEnabled: boolean;
    evaluationEnabled: boolean;
  };
  recommendationMaintenance: RecommendationMaintenanceSettings;
};

export type LatestReleaseStatus = {
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string | null;
  releaseName: string | null;
  publishedAt: string | null;
  checkedAt: string | null;
  nextAutoCheckAt: string;
  updateAvailable: boolean;
  status: "unknown" | "current" | "update_available" | "error";
  error: string | null;
};

export type RecommendationMaintenanceSettings = {
  maintenanceEnabled: boolean;
  recentIntentAutoRebuildEnabled: boolean;
  keywordAutoRebuildEnabled: boolean;
  duplicateAutoRebuildEnabled: boolean;
  clusterLabelAutoRebuildEnabled: boolean;
  clusterMergeDiagnosticsEnabled: boolean;
  clusterAutoMergeEnabled: boolean;
  ftrlAutoTrainEnabled: boolean;
  ftrlAutoPromoteEnabled: boolean;
  evaluationAutoRunEnabled: boolean;
  evaluationAutoRunIntervalDays: number;
  embeddingHealthAutoBackfillEnabled: boolean;
};

export type UpdateSettingsInput = {
  ui?: {
    locale?: SettingsLocale;
    defaultHomeView?: DefaultHomeView;
  };
  reader?: Partial<
    Pick<ReaderSettings, "fontSize" | "lineHeight" | "paragraphGap" | "readerWidth">
  >;
  behavior?: {
    markScrolledArticlesIgnored?: boolean;
    removeReadLaterOnReadComplete?: boolean;
  };
  telemetry?: {
    enabled?: boolean;
  };
  retention?: {
    retentionDays?: number;
    keepFavorites?: boolean;
    keepReadLater?: boolean;
  };
  ranking?: {
    cocoonLevel?: number;
    maxPositiveInterestClusters?: number;
    maxNegativeInterestClusters?: number;
    maxPositiveInterestFamilies?: number;
    maxNegativeInterestFamilies?: number;
    localLearningEnabled?: boolean;
    localLearningShadowMode?: boolean;
    explorationEnabled?: boolean;
    evaluationEnabled?: boolean;
  };
  recommendationMaintenance?: Partial<RecommendationMaintenanceSettings>;
};

export type UpdateSettingsResponse = {
  ok: true;
  settings: AppSettings;
  rankingRecalculateQueued?: boolean;
  rankingRecalculateJobId?: string | null;
  retentionCleanupQueued?: boolean;
  retentionCleanupJobId?: string | null;
};

export type EmbeddingProviderType =
  | "embedded_local"
  | "ollama"
  | "openai_compatible"
  | "gemini"
  | "custom_http";

export type EmbeddingProviderQualityTier = "basic" | "recommended" | "best_quality";

export type EmbeddingProvider = {
  id: string;
  type: EmbeddingProviderType;
  name: string;
  baseUrl: string | null;
  model: string;
  dimension: number;
  textMaxChars: number;
  requestsPerMinute: number | null;
  requestsPerDay: number | null;
  enabled: boolean;
  qualityTier: EmbeddingProviderQualityTier;
  hasApiKey: boolean;
  lastTestStatus: "success" | "failed" | null;
  lastTestError: string | null;
  lastTestAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateEmbeddingProviderInput = {
  type: "openai_compatible" | "gemini" | "ollama";
  name: string;
  baseUrl: string;
  model: string;
  dimension: number;
  textMaxChars?: number;
  requestsPerMinute?: number | null;
  requestsPerDay?: number | null;
  apiKey?: string | null;
  enabled: boolean;
  qualityTier?: EmbeddingProviderQualityTier;
};

export type UpdateEmbeddingProviderInput = Partial<CreateEmbeddingProviderInput>;

export type CreateEmbeddingProviderResponse = {
  id: string;
};

export type TestEmbeddingProviderResponse = {
  status: "success";
  dimension: number;
  latencyMs: number;
};

export type EmbeddingIndex = {
  id: string;
  providerId: string;
  model: string;
  dimension: number;
  textMaxChars: number;
  distanceMetric: "cosine";
  status: "active" | "building" | "disabled" | "failed" | "retired";
  candidateCount?: number;
  coveredArticleCount?: number;
  embeddingCount: number;
  coverageRatio?: number;
  pendingJobs: number;
  failedJobs: number;
  lastFailedAt?: string | null;
  lastError?: string | null;
  usage: {
    windows: Record<
      "24h" | "7d" | "30d",
      {
        requestCount: number;
        itemCount: number;
        estimatedTokens: number;
      }
    >;
  };
  createdAt: string;
  updatedAt: string;
};

export type RecommendationMaintenanceTask =
  | "ranking_recalculate"
  | "fingerprint_backfill"
  | "duplicate_rebuild"
  | "keyword_rebuild"
  | "cluster_label_rebuild"
  | "cluster_merge_diagnostics"
  | "interest_family_rebuild"
  | "cluster_auto_merge"
  | "recent_intent_rebuild"
  | "evaluation"
  | "ftrl_train"
  | "ftrl_reset"
  | "ftrl_promote";

export type RecommendationMaintenanceTaskResponse =
  | {
      jobId: string;
      existing: boolean;
    }
  | {
      ok: true;
      modelVersionId?: string;
      sampleCount?: number;
      highQualitySampleCount?: number;
      blendAlpha?: number;
    };

export type ClusterLabelLexiconOverrides = {
  stopwordsAdd: string[];
  stopwordsRemove: string[];
  protectedTermsAdd: string[];
  protectedTermsRemove: string[];
  badTermPatternsAdd: string[];
  badTermPatternsRemove: string[];
};

export type ClusterLabelLexiconResponse = {
  defaultVersion: number;
  effective: {
    stopwords: string[];
    protectedTerms: string[];
    badTermPatterns: string[];
  };
  overrides: ClusterLabelLexiconOverrides;
  warnings: string[];
  rebuildJob?: {
    jobId: string;
    existing: boolean;
  };
};

export type RecommendationClusterMergeCandidate = {
  id: string;
  embeddingIndexId: string;
  leftClusterId: string;
  rightClusterId: string;
  leftLabel: string;
  rightLabel: string;
  polarity: "positive" | "negative";
  centroidSimilarity: number;
  labelJaccard: number;
  evidenceOverlap: number;
  representativeOverlap: number;
  sourceOverlap: number;
  mergeScore: number;
  recommendation: "auto_merge" | "review" | "ignore";
  status: "open" | "merged" | "ignored" | "dismissed";
  reasonJson: string | null;
  createdAt: number;
  updatedAt: number;
  decidedAt: number | null;
};

export type RecommendationClusterMergeCandidateList = {
  activeIndexId: string | null;
  candidates: RecommendationClusterMergeCandidate[];
};

export type RecommendationClusterMergeResult = {
  ok: true;
  candidateId: string;
  survivorClusterId: string;
  mergedAwayClusterId: string;
  labelRebuild: {
    jobId: string;
    existing: boolean;
  };
  rankingRecalculate: {
    jobId: string;
    existing: boolean;
  };
};

export type RecommendationClusterIgnoreResult = {
  ok: true;
  candidateId: string;
  status: "ignored";
};

export type RebuildEmbeddingIndexResponse = {
  jobId: string;
};

export type BackfillEmbeddingIndexResponse = {
  jobIds: string[];
  candidateCount: number;
  enqueuedArticleCount: number;
  dedupedArticleCount: number;
};

export type RecommendationMode = "baseline" | "personalized" | "embedding" | "degraded";

export type RecommendationFamilySummaryItem = {
  id: string;
  polarity: "positive" | "negative";
  displayLabel: string;
  weight: number;
  clusterCount: number;
  supportArticleCount: number;
  supportEventCount: number;
  sourceCount: number;
  strongSignalCount: number;
  topSourceShare: number;
  maturity: number;
  dominanceRatio: number;
  labelTerms: string[];
  representativeClusterIds: string[];
  diagnostics: {
    lowSupportClusterCount: number;
    singleArticleClusterCount: number;
    concentrationRisk: "low" | "medium" | "high";
  };
  updatedAt: number;
};

export type RecommendationFamilySummary = {
  positive: number;
  negative: number;
  topFamilies: RecommendationFamilySummaryItem[];
  dominantFamily: RecommendationFamilySummaryItem | null;
  concentrationRisk: "low" | "medium" | "high";
};

export type RecommendationStatus = {
  mode: RecommendationMode;
  activeProvider: {
    id: string;
    type: EmbeddingProviderType;
    name: string;
    model: string;
    dimension: number;
    lastTestStatus: "success" | "failed" | null;
    lastTestAt: string | null;
  } | null;
  activeIndex: {
    id: string;
    status: EmbeddingIndex["status"];
    model: string;
    dimension: number;
  } | null;
  activeRankContext: string;
  algorithm?: {
    version: string;
    featureSchemaVersion: number;
    cocoonLevel: number;
    localLearning: {
      enabled: boolean;
      shadowMode: boolean;
    };
    exploration: {
      enabled: boolean;
    };
    evaluation: {
      enabled: boolean;
    };
    cocoonParameters: Record<string, number>;
  };
  coverage: {
    candidateCount: number;
    eligibleArticleCount?: number;
    missingEmbeddingCount?: number;
    staleEmbeddingCount?: number;
    coveredArticleCount?: number;
    embeddingCount: number;
    coverageRatio: number;
    pendingJobs: number;
    failedJobs: number;
    lastFailedAt: string | null;
    lastError: string | null;
  };
  behaviorCounts: Record<string, number>;
  clusters: {
    positive: number;
    negative: number;
    families?: RecommendationFamilySummary;
    items?: RecommendationClusterItem[];
  };
  rankedArticles: {
    base: number;
    active: number;
  };
  lastProfileUpdate: string | null;
  lastRankingUpdate: string | null;
  warnings: Array<{
    code: string;
    message: string;
  }>;
};

export type RecommendationTransparency = RecommendationStatus & {
  transparency: {
    currentFormula: string;
    fallbackReason: string | null;
    rankingCore: {
      usesRemoteLlm: boolean;
      usesRemoteReranker: boolean;
      usesExternalSearchService: boolean;
      allowedRemoteDependency: string;
    };
    maintenance: {
      schemaMigration: string;
      backfillState: string;
      explanationAuthority: string;
      scoreAuthority: string;
      automaticMaintenanceEnabled?: boolean;
      settings?: RecommendationMaintenanceSettings | null;
      schedule?: Array<{
        taskKey: string;
        lastEnqueuedAt: string | null;
        lastCompletedAt: string | null;
        lastSkippedReason: string | null;
        lastJobId: string | null;
        updatedAt: string;
      }>;
    };
    moduleStatus: {
      bm25ProfileTerms: "not_active" | "empty" | "stale" | "active";
      recentIntent: "missing" | "stale" | "active";
      ftrl:
        | "disabled"
        | "shadow_no_samples"
        | "insufficient_samples"
        | "shadow_training"
        | "ready_to_promote"
        | "active_low_weight"
        | "active"
        | "auto_paused"
        | "retired"
        | "failed";
      exploration: "disabled" | "enabled_bonus_only" | "enabled_slots_active";
      evaluation: "unavailable" | "diagnostic_only" | "lightweight_replay_diagnostic" | "strict_replay";
      duplicate: "not_built" | "exact_scaffold" | "near_duplicate_active";
      interestFamilies: "not_built" | "active";
      evidence: "dynamic_fallback" | "reconstructed" | "live_evidence";
      stalePendingEmbeddingJobs: number;
      failedRankingJobs: number;
    };
    algorithmModules: Array<{
      id: string;
      name: string;
      status: "normal" | "warning" | "stopped" | "disabled";
      summary: string;
    }>;
    failureStates: Record<string, boolean>;
  };
};

export type RecommendationClusterItem = {
  id: string;
  polarity: "positive" | "negative";
  label: string | null;
  displayLabel?: string;
  labelSource?: "manual" | "keywords" | "representative_titles" | "feeds" | "fallback";
  autoLabel?: string | null;
  manualLabel?: string | null;
  confidence?: number;
  evidenceCount?: number;
  topTerms?: string[];
  representativeArticles?: Array<{
    articleId: string;
    title: string;
    feedTitle: string;
    eventType: string;
    confidence: number;
    similarity: number | null;
  }>;
  feedTitles?: string[];
  labelDiagnostics?: {
    collision: boolean;
    collisionGroupSize: number;
    lowConfidence: boolean;
  };
  mergeDiagnostics?: {
    candidateCount: number;
    topCandidate: {
      candidateId: string;
      otherClusterId: string;
      otherLabel: string;
      centroidSimilarity: number;
      labelJaccard: number;
      evidenceOverlap: number;
      mergeScore: number;
      recommendation: "auto_merge" | "review" | "ignore";
      status: "open" | "merged" | "ignored" | "dismissed";
    } | null;
  };
  family?: {
    id: string;
    polarity: "positive" | "negative";
    displayLabel: string;
    weight: number;
    clusterCount: number;
    supportArticleCount: number;
    supportEventCount: number;
    sourceCount: number;
    maturity: number;
    dominanceRatio: number;
    membershipConfidence: number;
    centroidSimilarity: number;
  } | null;
  lastGeneratedAt?: string | null;
  displayIndex?: number;
  weight: number;
  sampleCount: number;
  diagnostics?: {
    supportArticleCount: number;
    supportEventCount: number;
    sourceCount: number;
    strongSignalCount: number;
    strongSignalRatio: number;
    topSourceShare: number;
    averageSimilarity: number;
    maxSimilarity: number;
    overfitRisk: "low" | "medium" | "high";
    warnings: string[];
  };
  lastMatchedAt: string | null;
  updatedAt: string;
};

export type RecommendationClusterListResponse = {
  activeIndex: RecommendationStatus["activeIndex"];
  total: number;
  families?: RecommendationFamilySummary;
  items: RecommendationClusterItem[];
};

export type UpdateRecommendationClusterLabelResponse = {
  ok: true;
  clusterId: string;
  displayLabel: string;
  labelSource: RecommendationClusterItem["labelSource"];
};

export type AuthOkResponse = {
  ok: true;
};

export type DeleteResponse = {
  ok: true;
};

export type CreateFeedResponse = {
  feed: Feed;
  refreshJobId: string;
};

export type RefreshFeedResponse = {
  jobId: string;
};

export type RefreshAllFeedsResponse = {
  jobIds: string[];
};

export const defaultAppSettings: AppSettings = {
  ui: {
    locale: "zh-CN",
    defaultHomeView: "recommended"
  },
  reader: {
    fontSize: 18,
    lineHeight: 1.75,
    paragraphGap: 1.1,
    readerWidth: 720,
    theme: "paper"
  },
  behavior: {
    markScrolledArticlesIgnored: true,
    removeReadLaterOnReadComplete: false
  },
  telemetry: {
    enabled: true
  },
  retention: {
    retentionDays: 0,
    keepFavorites: true,
    keepReadLater: true
  },
  ranking: {
    preferFreshness: 0.5,
    preferSource: 0.5,
    preferDiversity: 0.5,
    cocoonLevel: 5,
    maxPositiveInterestClusters: 48,
    maxNegativeInterestClusters: 32,
    maxPositiveInterestFamilies: 16,
    maxNegativeInterestFamilies: 12,
    localLearningEnabled: true,
    localLearningShadowMode: false,
    explorationEnabled: true,
    evaluationEnabled: false
  },
  recommendationMaintenance: {
    maintenanceEnabled: true,
    recentIntentAutoRebuildEnabled: true,
    keywordAutoRebuildEnabled: true,
    duplicateAutoRebuildEnabled: true,
    clusterLabelAutoRebuildEnabled: true,
    clusterMergeDiagnosticsEnabled: true,
    clusterAutoMergeEnabled: false,
    ftrlAutoTrainEnabled: true,
    ftrlAutoPromoteEnabled: false,
    evaluationAutoRunEnabled: false,
    evaluationAutoRunIntervalDays: 7,
    embeddingHealthAutoBackfillEnabled: true
  }
};

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly hasUserMessage = true
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export type ApiErrorMessages = {
  requestFailed: string;
  httpError: (status: number) => string;
};

type ApiFetch = typeof fetch;

type ApiSuccess<T> = {
  data: T;
  page?: ApiPage;
  meta?: {
    unreadCount?: number;
  };
};

type ApiErrorPayload = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export function createDibaoApi(fetcher: ApiFetch = fetch) {
  async function request<T>(path: string, init: RequestInit = {}): Promise<ApiSuccess<T>> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");

    if (init.body && !isFormDataBody(init.body) && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const response = await fetcher(path, {
      ...init,
      credentials: init.credentials ?? "same-origin",
      headers
    });
    const payload = await readJson(response);

    if (!response.ok) {
      const apiError = isApiErrorPayload(payload) ? payload.error : null;
      throw new ApiRequestError(
        response.status,
        apiError?.code ?? "INTERNAL_ERROR",
        apiError?.message ?? "",
        apiError?.details,
        Boolean(apiError?.message)
      );
    }

    if (isApiErrorPayload(payload)) {
      throw new ApiRequestError(response.status, payload.error.code, payload.error.message);
    }

    return payload as ApiSuccess<T>;
  }

  async function requestText(path: string, init: RequestInit = {}): Promise<string> {
    const response = await fetcher(path, {
      ...init,
      credentials: init.credentials ?? "same-origin",
      headers: {
        accept: "application/xml, text/xml, */*",
        ...init.headers
      }
    });
    const text = await response.text();

    if (!response.ok) {
      const payload = parseJsonText(text);
      const apiError = isApiErrorPayload(payload) ? payload.error : null;
      throw new ApiRequestError(
        response.status,
        apiError?.code ?? "INTERNAL_ERROR",
        apiError?.message ?? "",
        apiError?.details,
        Boolean(apiError?.message)
      );
    }

    return text;
  }

  return {
    async getAuthSession(): Promise<AuthSession> {
      return (await request<AuthSession>("/api/auth/session")).data;
    },

    async setupAuth(
      username: string,
      password: string,
      telemetryEnabled?: boolean
    ): Promise<AuthOkResponse> {
      const body =
        telemetryEnabled === undefined
          ? { username, password }
          : { username, password, telemetryEnabled };

      return (
        await request<AuthOkResponse>("/api/auth/setup", {
          method: "POST",
          body: JSON.stringify(body)
        })
      ).data;
    },

    async login(username: string, password: string): Promise<AuthOkResponse> {
      return (
        await request<AuthOkResponse>("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ username, password })
        })
      ).data;
    },

    async logout(): Promise<AuthOkResponse> {
      return (
        await request<AuthOkResponse>("/api/auth/logout", {
          method: "POST"
        })
      ).data;
    },

    async changePassword(currentPassword: string, newPassword: string): Promise<AuthOkResponse> {
      return (
        await request<AuthOkResponse>("/api/auth/password", {
          method: "POST",
          body: JSON.stringify({ currentPassword, newPassword })
        })
      ).data;
    },

    async getSetupStatus(): Promise<SetupStatus> {
      return (await request<SetupStatus>("/api/setup/status")).data;
    },

    async getDerivedDataUpgradeStatus(): Promise<DerivedDataUpgradeStatus> {
      return (await request<DerivedDataUpgradeStatus>("/api/system/upgrade/status")).data;
    },

    async retryDerivedDataUpgrade(): Promise<DerivedDataUpgradeStatus> {
      return (
        await request<DerivedDataUpgradeStatus>("/api/system/upgrade/retry", {
          method: "POST"
        })
      ).data;
    },

    async getSettings(): Promise<AppSettings> {
      return (await request<AppSettings>("/api/settings")).data;
    },

    async getLatestRelease(): Promise<LatestReleaseStatus> {
      return (await request<LatestReleaseStatus>("/api/system/latest-release")).data;
    },

    async checkLatestRelease(): Promise<LatestReleaseStatus> {
      return (
        await request<LatestReleaseStatus>("/api/system/latest-release/check", {
          method: "POST"
        })
      ).data;
    },

    async updateSettings(input: UpdateSettingsInput): Promise<UpdateSettingsResponse> {
      return (
        await request<UpdateSettingsResponse>("/api/settings", {
          method: "PATCH",
          body: JSON.stringify(input)
        })
      ).data;
    },

    async listEmbeddingProviders(): Promise<EmbeddingProvider[]> {
      return (await request<EmbeddingProvider[]>("/api/embedding/providers")).data;
    },

    async createEmbeddingProvider(
      input: CreateEmbeddingProviderInput
    ): Promise<CreateEmbeddingProviderResponse> {
      return (
        await request<CreateEmbeddingProviderResponse>("/api/embedding/providers", {
          method: "POST",
          body: JSON.stringify(input)
        })
      ).data;
    },

    async updateEmbeddingProvider(
      providerId: string,
      input: UpdateEmbeddingProviderInput
    ): Promise<EmbeddingProvider> {
      return (
        await request<EmbeddingProvider>(
          `/api/embedding/providers/${encodeURIComponent(providerId)}`,
          {
            method: "PATCH",
            body: JSON.stringify(input)
          }
        )
      ).data;
    },

    async activateEmbeddingProvider(providerId: string): Promise<EmbeddingProvider> {
      return (
        await request<EmbeddingProvider>(
          `/api/embedding/providers/${encodeURIComponent(providerId)}/activate`,
          {
            method: "POST"
          }
        )
      ).data;
    },

    async deleteEmbeddingProvider(providerId: string): Promise<DeleteResponse> {
      return (
        await request<DeleteResponse>(
          `/api/embedding/providers/${encodeURIComponent(providerId)}`,
          {
            method: "DELETE"
          }
        )
      ).data;
    },

    async testEmbeddingProvider(providerId: string): Promise<TestEmbeddingProviderResponse> {
      return (
        await request<TestEmbeddingProviderResponse>(
          `/api/embedding/providers/${encodeURIComponent(providerId)}/test`,
          {
            method: "POST"
          }
        )
      ).data;
    },

    async listEmbeddingIndexes(): Promise<EmbeddingIndex[]> {
      return (await request<EmbeddingIndex[]>("/api/embedding/indexes")).data;
    },

    async getRecommendationStatus(
      input: { includeClusterItems?: boolean } = {}
    ): Promise<RecommendationStatus> {
      const params = new URLSearchParams();
      if (input.includeClusterItems === false) {
        params.set("includeClusterItems", "false");
      }
      const query = params.toString();
      return (
        await request<RecommendationStatus>(
          query ? `/api/recommendation/status?${query}` : "/api/recommendation/status"
        )
      ).data;
    },

    async getRecommendationTransparency(): Promise<RecommendationTransparency> {
      return (await request<RecommendationTransparency>("/api/recommendation/transparency")).data;
    },

    async listRecommendationClusters(
      limit: "all" | number = "all"
    ): Promise<RecommendationClusterListResponse> {
      const params = new URLSearchParams({
        limit: String(limit)
      });
      return (
        await request<RecommendationClusterListResponse>(
          `/api/recommendation/clusters?${params.toString()}`
        )
      ).data;
    },

    async updateRecommendationClusterLabel(
      clusterId: string,
      manualLabel: string | null
    ): Promise<UpdateRecommendationClusterLabelResponse> {
      return (
        await request<UpdateRecommendationClusterLabelResponse>(
          `/api/recommendation/clusters/${encodeURIComponent(clusterId)}/label`,
          {
            method: "PATCH",
            body: JSON.stringify({ manualLabel })
          }
        )
      ).data;
    },

    async getClusterLabelLexicon(): Promise<ClusterLabelLexiconResponse> {
      return (
        await request<ClusterLabelLexiconResponse>(
          "/api/recommendation/cluster-label-lexicon"
        )
      ).data;
    },

    async updateClusterLabelLexicon(
      input: Partial<ClusterLabelLexiconOverrides>
    ): Promise<ClusterLabelLexiconResponse> {
      return (
        await request<ClusterLabelLexiconResponse>(
          "/api/recommendation/cluster-label-lexicon",
          {
            method: "PATCH",
            body: JSON.stringify(input)
          }
        )
      ).data;
    },

    async rebuildRecommendationClusterMergeCandidates(): Promise<RecommendationMaintenanceTaskResponse> {
      return (
        await request<RecommendationMaintenanceTaskResponse>(
          "/api/recommendation/clusters/merge-candidates/rebuild",
          {
            method: "POST"
          }
        )
      ).data;
    },

    async listRecommendationClusterMergeCandidates(
      status: "open" | "merged" | "ignored" | "dismissed" | "all" = "all"
    ): Promise<RecommendationClusterMergeCandidateList> {
      const params = new URLSearchParams({
        status,
        limit: "50"
      });
      return (
        await request<RecommendationClusterMergeCandidateList>(
          `/api/recommendation/clusters/merge-candidates?${params.toString()}`
        )
      ).data;
    },

    async mergeRecommendationClusterCandidate(
      candidateId: string
    ): Promise<RecommendationClusterMergeResult> {
      return (
        await request<RecommendationClusterMergeResult>(
          `/api/recommendation/clusters/merge-candidates/${encodeURIComponent(candidateId)}/merge`,
          {
            method: "POST"
          }
        )
      ).data;
    },

    async ignoreRecommendationClusterCandidate(
      candidateId: string
    ): Promise<RecommendationClusterIgnoreResult> {
      return (
        await request<RecommendationClusterIgnoreResult>(
          `/api/recommendation/clusters/merge-candidates/${encodeURIComponent(candidateId)}/ignore`,
          {
            method: "POST"
          }
        )
      ).data;
    },

    async runRecommendationMaintenanceTask(
      task: RecommendationMaintenanceTask
    ): Promise<RecommendationMaintenanceTaskResponse> {
      return (
        await request<RecommendationMaintenanceTaskResponse>(
          `/api/recommendation/maintenance/${encodeURIComponent(task)}`,
          {
            method: "POST"
          }
        )
      ).data;
    },

    async rebuildEmbeddingIndex(indexId: string): Promise<RebuildEmbeddingIndexResponse> {
      return (
        await request<RebuildEmbeddingIndexResponse>(
          `/api/embedding/indexes/${encodeURIComponent(indexId)}/rebuild`,
          {
            method: "POST"
          }
        )
      ).data;
    },

    async backfillEmbeddingIndex(indexId: string): Promise<BackfillEmbeddingIndexResponse> {
      return (
        await request<BackfillEmbeddingIndexResponse>(
          `/api/embedding/indexes/${encodeURIComponent(indexId)}/backfill`,
          {
            method: "POST"
          }
        )
      ).data;
    },

    async listFeedFolders(): Promise<FeedFolder[]> {
      return (await request<FeedFolder[]>("/api/feed-folders")).data;
    },

    async listFeeds(): Promise<Feed[]> {
      return (await request<Feed[]>("/api/feeds")).data;
    },

    async discoverFeeds(url: string): Promise<FeedDiscoveryResponse> {
      return (
        await request<FeedDiscoveryResponse>("/api/feeds/discover", {
          method: "POST",
          body: JSON.stringify({ url })
        })
      ).data;
    },

    async getFeedDiagnostics(): Promise<FeedDiagnosticsResponse> {
      return (await request<FeedDiagnosticsResponse>("/api/feeds/diagnostics")).data;
    },

    async createFeed(feedUrl: string, folderId?: string | null): Promise<CreateFeedResponse> {
      return (
        await request<CreateFeedResponse>("/api/feeds", {
          method: "POST",
          body: JSON.stringify({
            feedUrl,
            ...(folderId !== undefined ? { folderId } : {})
          })
        })
      ).data;
    },

    async updateFeed(feedId: string, input: UpdateFeedInput): Promise<Feed> {
      return (
        await request<Feed>(`/api/feeds/${encodeURIComponent(feedId)}`, {
          method: "PATCH",
          body: JSON.stringify(input)
        })
      ).data;
    },

    async previewFeedFullContent(
      feedId: string,
      articleUrl?: string
    ): Promise<FullContentPreviewResponse> {
      return (
        await request<FullContentPreviewResponse>(
          `/api/feeds/${encodeURIComponent(feedId)}/full-content/preview`,
          {
            method: "POST",
            body: JSON.stringify(articleUrl ? { articleUrl } : {})
          }
        )
      ).data;
    },

    async backfillCurrentFeedFullContent(feedId: string): Promise<FullContentBackfillResponse> {
      return (
        await request<FullContentBackfillResponse>(
          `/api/feeds/${encodeURIComponent(feedId)}/full-content/backfill-current`,
          {
            method: "POST"
          }
        )
      ).data;
    },

    async deleteFeed(feedId: string): Promise<DeleteResponse> {
      return (
        await request<DeleteResponse>(`/api/feeds/${encodeURIComponent(feedId)}`, {
          method: "DELETE"
        })
      ).data;
    },

    async refreshFeed(feedId: string): Promise<RefreshFeedResponse> {
      return (
        await request<RefreshFeedResponse>(`/api/feeds/${encodeURIComponent(feedId)}/refresh`, {
          method: "POST"
        })
      ).data;
    },

    async refreshAllFeeds(): Promise<RefreshAllFeedsResponse> {
      return (
        await request<RefreshAllFeedsResponse>("/api/feeds/refresh", {
          method: "POST"
        })
      ).data;
    },

    async createFeedFolder(title: string): Promise<FeedFolder> {
      return (
        await request<FeedFolder>("/api/feed-folders", {
          method: "POST",
          body: JSON.stringify({ title })
        })
      ).data;
    },

    async updateFeedFolder(
      folderId: string,
      input: UpdateFeedFolderInput
    ): Promise<FeedFolder> {
      return (
        await request<FeedFolder>(`/api/feed-folders/${encodeURIComponent(folderId)}`, {
          method: "PATCH",
          body: JSON.stringify(input)
        })
      ).data;
    },

    async deleteFeedFolder(folderId: string): Promise<DeleteResponse> {
      return (
        await request<DeleteResponse>(`/api/feed-folders/${encodeURIComponent(folderId)}`, {
          method: "DELETE"
        })
      ).data;
    },

    async listArticles(
      input: {
        view?: ArticleView;
        feedId?: string | null;
        folderId?: string | null;
        limit?: number;
        cursor?: string | null;
        unreadOnly?: boolean;
        todayOnly?: boolean;
        timeWindow?: ArticleTimeWindow;
        sort?: ArticleListSort;
      } = {}
    ): Promise<ArticleListResponse> {
      const params = new URLSearchParams({
        view: input.view ?? "latest",
        limit: String(input.limit ?? 50)
      });

      if (input.feedId) {
        params.set("feedId", input.feedId);
      }
      if (input.folderId) {
        params.set("folderId", input.folderId);
      }
      if (input.cursor) {
        params.set("cursor", input.cursor);
      }
      const view = input.view ?? "latest";
      if (input.unreadOnly && (view === "latest" || view === "recommended")) {
        params.set("unreadOnly", "true");
      }
      if (view === "latest" || view === "recommended") {
        if (input.timeWindow && input.timeWindow !== "all") {
          params.set("timeWindow", input.timeWindow);
        } else if (input.todayOnly) {
          params.set("timeWindow", "24h");
        }
      }
      if (input.sort && (view === "favorites" || view === "read_later")) {
        params.set("sort", input.sort);
      }

      const response = await request<ArticleListItem[]>(`/api/articles?${params.toString()}`);

      return {
        data: response.data,
        page: response.page ?? { nextCursor: null },
        meta: {
          unreadCount: response.meta?.unreadCount ?? response.data.length
        }
      };
    },

    async searchArticles(input: {
      q: string;
      feedId?: string | null;
      folderId?: string | null;
      from?: string | null;
      to?: string | null;
      state?: ArticleSearchState;
      sort?: ArticleSearchSort;
      limit?: number;
      cursor?: string | null;
    }): Promise<ArticleListResponse> {
      const params = new URLSearchParams({
        q: input.q,
        limit: String(input.limit ?? 50)
      });

      if (input.feedId) {
        params.set("feedId", input.feedId);
      }
      if (input.folderId) {
        params.set("folderId", input.folderId);
      }
      if (input.from) {
        params.set("from", input.from);
      }
      if (input.to) {
        params.set("to", input.to);
      }
      if (input.state && input.state !== "all") {
        params.set("state", input.state);
      }
      if (input.sort) {
        params.set("sort", input.sort);
      }
      if (input.cursor) {
        params.set("cursor", input.cursor);
      }

      const response = await request<ArticleListItem[]>(`/api/search?${params.toString()}`);

      return {
        data: response.data,
        page: response.page ?? { nextCursor: null },
        meta: {
          unreadCount: response.meta?.unreadCount ?? response.data.length
        }
      };
    },

    async markScopeRead(
      scope: ReaderCommandScope
    ): Promise<ReaderCommandMarkScopeReadResponse> {
      return (
        await request<ReaderCommandMarkScopeReadResponse>(
          "/api/reader/commands/mark-scope-read",
          {
            method: "POST",
            body: JSON.stringify({ scope })
          }
        )
      ).data;
    },

    async previewMarkScopeRead(
      scope: ReaderCommandScope
    ): Promise<ReaderCommandMarkScopeReadPreviewResponse> {
      return (
        await request<ReaderCommandMarkScopeReadPreviewResponse>(
          "/api/reader/commands/mark-scope-read/preview",
          {
            method: "POST",
            body: JSON.stringify({ scope })
          }
        )
      ).data;
    },

    async getArticle(articleId: string): Promise<ArticleDetail> {
      return (await request<ArticleDetail>(`/api/articles/${encodeURIComponent(articleId)}`)).data;
    },

    async getArticleExplanation(articleId: string): Promise<RankExplanation> {
      return (
        await request<RankExplanation>(
          `/api/articles/${encodeURIComponent(articleId)}/explanation`
        )
      ).data;
    },

    async postArticleAction(
      articleId: string,
      input: ArticleActionRequest
    ): Promise<ArticleActionResponse> {
      return (
        await request<ArticleActionResponse>(
          `/api/articles/${encodeURIComponent(articleId)}/actions`,
          {
            method: "POST",
            body: JSON.stringify(input)
          }
        )
      ).data;
    },

    postArticleActionKeepalive(articleId: string, input: ArticleActionRequest): void {
      const headers = new Headers();
      headers.set("accept", "application/json");
      headers.set("content-type", "application/json");

      void fetcher(`/api/articles/${encodeURIComponent(articleId)}/actions`, {
        method: "POST",
        body: JSON.stringify(input),
        credentials: "same-origin",
        headers,
        keepalive: true
      });
    },

    async importOpml(file: File): Promise<OpmlImportResponse> {
      const formData = new FormData();
      formData.append("file", file);

      return (
        await request<OpmlImportResponse>("/api/opml/import", {
          method: "POST",
          body: formData
        })
      ).data;
    },

    async exportOpml(): Promise<string> {
      return requestText("/api/opml/export");
    }
  };
}

export const dibaoApi = createDibaoApi();

export function userMessageForError(error: unknown, messages: ApiErrorMessages): string {
  if (error instanceof ApiRequestError) {
    return error.hasUserMessage && error.message ? error.message : messages.httpError(error.status);
  }

  return messages.requestFailed;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return {};
  }

  return parseJsonText(text);
}

function parseJsonText(text: string): unknown {
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

function isApiErrorPayload(payload: unknown): payload is ApiErrorPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof (payload as ApiErrorPayload).error?.code === "string" &&
    typeof (payload as ApiErrorPayload).error?.message === "string"
  );
}

function isFormDataBody(body: BodyInit): boolean {
  return typeof FormData !== "undefined" && body instanceof FormData;
}
