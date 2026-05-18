import {
  calculateBaselineRankScore,
  clamp,
  cosineSimilarity,
  freshnessScore,
  profileAlgorithmDefaults
} from "@dibao/ranking";
import {
  BASE_RANK_CONTEXT,
  fromVectorBlob,
  type ArticleRankExplanationSourceRow,
  type ArticleRankingCandidateRow,
  type EmbeddingRepository,
  type InterestClusterPolarity,
  type InterestClusterRow,
  type ProfileRepository,
  type RankingRepository
} from "@dibao/db";

export interface ArticleRankingRecalculator {
  recalculateArticle(articleId: string): number;
  recalculateArticles(articleIds: string[]): number;
  recalculateAll(): number;
  recalculateChunk?(input: {
    cursor?: string | null;
    limit: number;
  }): { processed: number; nextCursor: string | null };
}

export type RankExplanationReasonType =
  | "interest"
  | "source"
  | "freshness"
  | "state"
  | "fallback"
  | "negative"
  | "penalty";

export type RankExplanationReason = {
  type: RankExplanationReasonType;
  label: string;
  impact: "positive" | "negative" | "neutral";
  cluster?: RankExplanationClusterMatch;
};

export type RankExplanationClusterMatch = {
  id: string;
  polarity: InterestClusterPolarity;
  label: string | null;
  displayIndex: number;
  weight: number;
  sampleCount: number;
  similarity: number;
  lastMatchedAt: number | null;
  updatedAt: number;
};

export type RankExplanationResult = {
  articleId: string;
  status: ArticleRankExplanationSourceRow["rankingStatus"];
  reasons: RankExplanationReason[];
  generatedAt: number;
  components?: Record<string, unknown>;
};

export type RankingSettingsSnapshot = {
  cocoonLevel: number;
  localLearningEnabled: boolean;
  localLearningShadowMode: boolean;
  explorationEnabled: boolean;
  evaluationEnabled: boolean;
};

export type RecommendationRankingServiceOptions = {
  embeddings?: Pick<EmbeddingRepository, "findActiveProviderWithIndex">;
  profiles?: Pick<ProfileRepository, "listClusters">;
  rankings: RankingRepository;
  getRankingSettings?: () => RankingSettingsSnapshot;
  now?: () => number;
};

type ClusterVector = {
  cluster: InterestClusterRow;
  polarity: InterestClusterPolarity;
  vector: number[];
  weightNorm: number;
};

type V2Score = {
  score: number;
  baseScore: number;
  ftrlScore: number;
  semanticScore: number;
  bm25Score: number;
  sourceScore: number;
  freshnessScore: number;
  stateScore: number;
  diversityScore: number;
  penaltyScore: number;
  negativePenalty: number;
  duplicatePenalty: number;
  diversityPenalty: number;
  explorationBonus: number;
  pendingEmbeddingScore: number;
  exposurePenalty: number;
  preRerankScore: number;
};

const RECOMMENDATION_ALGORITHM_VERSION = "rec_v2";
const RECOMMENDATION_FEATURE_SCHEMA_VERSION = 2;
const MMR_WINDOW_LIMIT = 500;

export class RecommendationRankingService implements ArticleRankingRecalculator {
  private readonly now: () => number;

  constructor(private readonly options: RecommendationRankingServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  getActiveRankContext(): string {
    const settings = this.rankingSettings();
    const activeIndexId = this.activeEmbeddingIndexId();
    return activeIndexId
      ? rankContextFor({
          hasEmbedding: true,
          cocoonLevel: settings.cocoonLevel
        })
      : BASE_RANK_CONTEXT;
  }

  recalculateArticle(articleId: string): number {
    return this.recalculateArticles([articleId]);
  }

  recalculateArticles(articleIds: string[]): number {
    if (articleIds.length === 0) {
      return 0;
    }
    return this.writeScores(uniqueStrings(articleIds)).processed;
  }

  recalculateAll(): number {
    return this.writeScores().processed;
  }

  recalculateChunk(input: {
    cursor?: string | null;
    limit: number;
  }): { processed: number; nextCursor: string | null } {
    const result = this.writeScores(undefined, {
      afterArticleId: input.cursor ?? null,
      limit: input.limit
    });
    return {
      processed: result.processed,
      nextCursor: result.nextCursor
    };
  }

  explainArticle(articleId: string): RankExplanationResult | null {
    const rankContext = this.getActiveRankContext();
    const source = this.options.rankings.findExplanationSource({
      articleId,
      rankContext
    });
    if (!source) {
      return null;
    }

    const persisted = this.options.rankings.findExplanationPayload({
      articleId,
      rankContext
    });
    const clusterMatch = this.explanationClusterMatch(source);
    const persistedPayload = parseExplanationPayload(persisted?.payloadJson ?? null);

    return {
      articleId,
      status: source.rankingStatus,
      reasons: rankReasonsFor(source, clusterMatch, persistedPayload),
      components: persistedPayload?.components,
      generatedAt: source.rank?.calculatedAt ?? this.now()
    };
  }

  private explanationClusterMatch(
    source: ArticleRankExplanationSourceRow
  ): RankExplanationClusterMatch | null {
    const activeIndexId = this.activeEmbeddingIndexId();
    if (!activeIndexId || !source.vectorBlob || source.rankingStatus !== "ready") {
      return null;
    }

    const articleVector = fromVectorBlob(source.vectorBlob);
    let best:
      | {
          cluster: InterestClusterRow;
          similarity: number;
          displayIndex: number;
        }
      | null = null;

    const clusters = this.clusterVectorsFor(activeIndexId);
    for (let index = 0; index < clusters.length; index += 1) {
      const cluster = clusters[index];
      if (!cluster) {
        continue;
      }

      if (cluster.polarity !== "positive") {
        continue;
      }

      const similarity = cosineSimilarity(articleVector, cluster.vector);
      if (!best || similarity > best.similarity) {
        best = {
          cluster: cluster.cluster,
          similarity,
          displayIndex: index + 1
        };
      }
    }

    if (!best || best.similarity < profileAlgorithmDefaults.positiveInterestMatchThreshold) {
      return null;
    }

    return {
      id: best.cluster.id,
      polarity: best.cluster.polarity,
      label: null,
      displayIndex: best.displayIndex,
      weight: best.cluster.weight,
      sampleCount: best.cluster.sampleCount,
      similarity: best.similarity,
      lastMatchedAt: best.cluster.lastMatchedAt,
      updatedAt: best.cluster.updatedAt
    };
  }

  private writeScores(
    articleIds?: string[],
    page?: { afterArticleId?: string | null; limit?: number }
  ): { processed: number; nextCursor: string | null } {
    const activeIndexId = this.activeEmbeddingIndexId();
    const settings = this.rankingSettings();
    const activeRankContext = activeIndexId
      ? rankContextFor({
          hasEmbedding: true,
          cocoonLevel: settings.cocoonLevel
        })
      : BASE_RANK_CONTEXT;
    const candidates = this.options.rankings.listCandidates({
      articleIds,
      afterArticleId: page?.afterArticleId,
      limit: page?.limit,
      embeddingIndexId: activeIndexId
    });
    const now = this.now();
    const clusters = activeIndexId ? this.clusterVectorsFor(activeIndexId) : [];
    const duplicateStats = duplicateStatsFor(candidates);
    const rerankWindowId = `${activeRankContext}:${now}`;
    const scored: Array<{ candidate: ArticleRankingCandidateRow; score: V2Score }> = [];

    if (activeIndexId) {
      this.options.rankings.upsertRankContext({
        id: activeRankContext,
        algorithmVersion: RECOMMENDATION_ALGORITHM_VERSION,
        featureSchemaVersion: RECOMMENDATION_FEATURE_SCHEMA_VERSION,
        embeddingIndexId: activeIndexId,
        cocoonLevel: settings.cocoonLevel,
        metadataJson: JSON.stringify({
          localLearning: {
            enabled: settings.localLearningEnabled,
            shadowMode: settings.localLearningShadowMode
          },
          exploration: {
            enabled: settings.explorationEnabled
          }
        }),
        now
      });
    }

    for (const candidate of candidates) {
      const isRead = candidate.state.read || candidate.state.interactionStatus === "read";
      const baseScore = calculateBaselineRankScore({
        now,
        publishedAt: candidate.publishedAt,
        discoveredAt: candidate.discoveredAt,
        sourceWeight: candidate.sourceWeight,
        feedPositiveScore: candidate.feedPositiveScore,
        feedNegativeScore: candidate.feedNegativeScore,
        feedOpenRate: candidate.feedOpenRate,
        feedFavoriteRate: candidate.feedFavoriteRate,
        feedNotInterestedRate: candidate.feedNotInterestedRate,
        read: isRead,
        favorited: candidate.state.favorited,
        liked: candidate.state.liked,
        readLater: candidate.state.readLater,
        opened: candidate.state.interactionStatus === "opened",
        ignored: candidate.state.interactionStatus === "ignored",
        hidden: candidate.state.hidden,
        notInterested: candidate.state.notInterested,
        readingProgress: candidate.state.readingProgress,
        behaviorProjectionScore: candidate.behaviorProjectionScore,
        behaviorEventCount: candidate.behaviorEventCount
      });

      this.options.rankings.upsertBaseScore({
        articleId: candidate.articleId,
        ...baseScore
      });

      if (!activeIndexId) {
        continue;
      }

      const score = calculateV2Score({
        candidate,
        now,
        clusters,
        settings,
        baseScore: baseScore.score,
        duplicateCount: duplicateStats.get(candidate.articleId) ?? 1
      });
      scored.push({ candidate, score });
    }

    const reranked = rerankCanonicalWindow(scored, settings, MMR_WINDOW_LIMIT);
    for (const item of reranked) {
      this.options.rankings.upsertScore({
        articleId: item.candidate.articleId,
        rankContext: activeRankContext,
        embeddingIndexId: activeIndexId,
        score: item.score.score,
        baseScore: item.score.baseScore,
        ftrlScore: item.score.ftrlScore,
        interestScore: item.score.semanticScore,
        semanticScore: item.score.semanticScore,
        bm25Score: item.score.bm25Score,
        sourceScore: item.score.sourceScore,
        freshnessScore: item.score.freshnessScore,
        stateScore: item.score.stateScore,
        diversityScore: item.score.diversityScore,
        penaltyScore: item.score.penaltyScore,
        negativePenalty: item.score.negativePenalty,
        duplicatePenalty: item.score.duplicatePenalty,
        diversityPenalty: item.score.diversityPenalty,
        explorationBonus: item.score.explorationBonus,
        pendingEmbeddingScore: item.score.pendingEmbeddingScore,
        exposurePenalty: item.score.exposurePenalty,
        preRerankScore: item.score.preRerankScore,
        rerankScore: item.score.score,
        rerankPosition: item.position,
        rerankWindowId,
        algorithmVersion: RECOMMENDATION_ALGORITHM_VERSION,
        featureSchemaVersion: RECOMMENDATION_FEATURE_SCHEMA_VERSION,
        cocoonLevel: settings.cocoonLevel,
        calculatedAt: now
      });
      this.options.rankings.upsertExplanation({
        articleId: item.candidate.articleId,
        rankContext: activeRankContext,
        embeddingIndexId: activeIndexId,
        payloadJson: JSON.stringify(explanationPayloadFor(item.candidate, item.score, settings)),
        createdAt: now
      });
    }

    return {
      processed: candidates.length,
      nextCursor:
        page?.limit !== undefined && candidates.length >= page.limit
          ? candidates[candidates.length - 1]?.articleId ?? null
          : null
    };
  }

  private activeEmbeddingIndexId(): string | null {
    return this.options.embeddings?.findActiveProviderWithIndex()?.index.id ?? null;
  }

  private rankingSettings(): RankingSettingsSnapshot {
    return (
      this.options.getRankingSettings?.() ?? {
        cocoonLevel: 5,
        localLearningEnabled: false,
        localLearningShadowMode: true,
        explorationEnabled: true,
        evaluationEnabled: false
      }
    );
  }

  private clusterVectorsFor(embeddingIndexId: string): ClusterVector[] {
    if (!this.options.profiles) {
      return [];
    }

    return this.options.profiles.listClusters({ embeddingIndexId }).map((cluster) => ({
      cluster,
      polarity: cluster.polarity,
      vector: fromVectorBlob(cluster.centroidVectorBlob),
      weightNorm: clamp(
        Math.log1p(cluster.weight) / Math.log1p(profileAlgorithmDefaults.maxClusterWeight),
        0,
        1
      )
    }));
  }
}

export class BaselineRankingService extends RecommendationRankingService {
  constructor(options: Omit<RecommendationRankingServiceOptions, "embeddings" | "profiles">) {
    super(options);
  }
}

const MIN_REASON_SCORE = 0.001;
const MAX_REASONS = 5;

function interestMatchesFor(
  candidate: ArticleRankingCandidateRow,
  clusters: ClusterVector[]
): {
  positiveInterestMatch: number;
  negativeInterestMatch: number;
  negativeSimilarity: number;
} {
  if (!candidate.vectorBlob || clusters.length === 0) {
    return {
      positiveInterestMatch: 0,
      negativeInterestMatch: 0,
      negativeSimilarity: 0
    };
  }

  const articleVector = fromVectorBlob(candidate.vectorBlob);
  const positive: Array<{ value: number; similarity: number }> = [];
  const negative: Array<{ value: number; similarity: number }> = [];

  for (const cluster of clusters) {
    const similarity = cosineSimilarity(articleVector, cluster.vector);
    const weightedMatch = Math.max(0, similarity) * cluster.weightNorm;

    if (cluster.polarity === "positive") {
      if (similarity >= profileAlgorithmDefaults.positiveInterestMatchThreshold) {
        positive.push({ value: weightedMatch, similarity });
      }
    } else {
      negative.push({ value: weightedMatch, similarity });
    }
  }

  const positiveInterestMatch = topKWeightedAverage(positive, 4);
  const negativeInterestMatch = topKWeightedAverage(negative, 3);
  const negativeSimilarity = Math.max(0, ...negative.map((item) => item.similarity));

  return {
    positiveInterestMatch,
    negativeInterestMatch,
    negativeSimilarity
  };
}

function topKWeightedAverage(matches: Array<{ value: number }>, k: number): number {
  const top = matches
    .filter((match) => Number.isFinite(match.value) && match.value > 0)
    .sort((left, right) => right.value - left.value)
    .slice(0, k);
  if (top.length === 0) {
    return 0;
  }
  const weightedSum = top.reduce((sum, match, index) => sum + match.value / (index + 1), 0);
  const divisor = top.reduce((sum, _match, index) => sum + 1 / (index + 1), 0);
  return divisor > 0 ? weightedSum / divisor : 0;
}

function rankContextFor(input: { hasEmbedding: boolean; cocoonLevel: number }): string {
  return `${RECOMMENDATION_ALGORITHM_VERSION}:${input.hasEmbedding ? "embedding" : "base"}:cocoon_${input.cocoonLevel}:schema_${RECOMMENDATION_FEATURE_SCHEMA_VERSION}`;
}

function cocoonParameters(level: number) {
  const c = clamp((level - 1) / 9, 0, 1);
  return {
    personalizationStrength: lerp(0.65, 1.25, c),
    diversityStrength: lerp(1.25, 0.55, c),
    mmrLambda: lerp(0.55, 0.88, c),
    explorationRatio: lerp(0.08, 0.005, c),
    sourceCap: Math.round(lerp(3, 12, c)),
    pendingEmbeddingFloor: lerp(0.12, 0.03, c),
    freshnessWeight: lerp(1.15, 0.75, c),
    negativeSemanticStrength: lerp(0.75, 1.15, c),
    recentIntentStrength: lerp(0.75, 1.2, c),
    keywordProfileStrength: lerp(0.75, 1.15, c)
  };
}

function calculateV2Score(input: {
  candidate: ArticleRankingCandidateRow;
  now: number;
  clusters: ClusterVector[];
  settings: RankingSettingsSnapshot;
  baseScore: number;
  duplicateCount: number;
}): V2Score {
  const params = cocoonParameters(input.settings.cocoonLevel);
  const candidate = input.candidate;
  const ageHours = Math.max(
    0,
    (input.now - (candidate.publishedAt ?? candidate.discoveredAt)) / 3_600_000
  );
  const matches = interestMatchesFor(candidate, input.clusters);
  const semanticScore = clamp(
    matches.positiveInterestMatch * 0.48 * params.personalizationStrength,
    0,
    0.62
  );
  const negativePenalty =
    matches.negativeSimilarity >= profileAlgorithmDefaults.negativePenaltyThreshold
      ? -clamp(
          matches.negativeInterestMatch * 0.42 * params.negativeSemanticStrength,
          0,
          0.5
        )
      : 0;
  const bm25Score = lexicalPreferenceScore(candidate) * 0.12 * params.keywordProfileStrength;
  const freshness = freshnessScore(ageHours, 0.18, profileAlgorithmDefaults.freshnessHalfLifeHours) *
    params.freshnessWeight;
  const pendingEmbeddingScore =
    candidate.embeddingStatus === "embedding_pending" && ageHours <= 72
      ? Math.max(0, params.pendingEmbeddingFloor - freshness)
      : 0;
  const sourceScore = normalizedSourceScore(candidate);
  const stateScore = stateScoreForV2(candidate);
  const duplicatePenalty = input.duplicateCount > 1 && !candidate.state.favorited && !candidate.state.readLater
    ? -Math.min(0.16, (input.duplicateCount - 1) * 0.04)
    : 0;
  const exposurePenalty = candidate.state.interactionStatus === "ignored" ? -0.04 : 0;
  const explorationBonus = explorationBonusFor(candidate, input.settings, ageHours);
  const preRerankScore =
    semanticScore +
    bm25Score +
    freshness +
    pendingEmbeddingScore +
    sourceScore +
    stateScore +
    negativePenalty +
    duplicatePenalty +
    exposurePenalty +
    explorationBonus;
  const ftrlScore = 0;
  const score = clamp(
    input.settings.localLearningEnabled && !input.settings.localLearningShadowMode
      ? preRerankScore * 0.9 + ftrlScore * 0.1
      : preRerankScore,
    0,
    1
  );

  return {
    score: roundScore(score),
    baseScore: roundScore(input.baseScore),
    ftrlScore,
    semanticScore: roundScore(semanticScore),
    bm25Score: roundScore(bm25Score),
    sourceScore: roundScore(sourceScore),
    freshnessScore: roundScore(freshness),
    stateScore: roundScore(stateScore),
    diversityScore: 0,
    penaltyScore: roundScore(negativePenalty + duplicatePenalty + exposurePenalty),
    negativePenalty: roundScore(negativePenalty),
    duplicatePenalty: roundScore(duplicatePenalty),
    diversityPenalty: 0,
    explorationBonus: roundScore(explorationBonus),
    pendingEmbeddingScore: roundScore(pendingEmbeddingScore),
    exposurePenalty: roundScore(exposurePenalty),
    preRerankScore: roundScore(preRerankScore)
  };
}

function normalizedSourceScore(candidate: ArticleRankingCandidateRow): number {
  const clearSignalScore = Math.tanh(
    (candidate.feedPositiveScore - candidate.feedNegativeScore) / 16
  );
  const rateScore = clamp(candidate.feedFavoriteRate - candidate.feedNotInterestedRate, -1, 1);
  const manual = clamp(candidate.sourceWeight, -1, 1) * 0.08;
  const learned = clearSignalScore * 0.045 + rateScore * 0.025;
  const openOnly = clamp(candidate.feedOpenRate, 0, 1) * 0.004;
  return clamp(manual + learned + openOnly, -0.14, 0.14);
}

function stateScoreForV2(candidate: ArticleRankingCandidateRow): number {
  const read = candidate.state.read || candidate.state.interactionStatus === "read";
  return (
    (!read ? 0.04 : -0.06) +
    (candidate.state.readLater ? 0.08 : 0) +
    (candidate.state.favorited ? 0.14 : 0) +
    (candidate.state.liked ? 0.08 : 0) +
    (candidate.state.interactionStatus === "opened" && !read ? 0.012 : 0) +
    clamp(candidate.state.readingProgress, 0, 1) * 0.08
  );
}

function lexicalPreferenceScore(candidate: ArticleRankingCandidateRow): number {
  const title = tokenize(candidate.title);
  const summary = tokenize(candidate.summary ?? "");
  const content = tokenize((candidate.contentText ?? "").slice(0, 2000));
  const titleScore = Math.min(1, title.length / 8) * 0.55;
  const summaryScore = Math.min(1, summary.length / 28) * 0.3;
  const contentScore = Math.min(1, content.length / 100) * 0.15;
  return clamp(titleScore + summaryScore + contentScore, 0, 1);
}

function tokenize(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .map((term) => term.trim())
        .filter((term) => term.length >= 2)
        .slice(0, 64)
    )
  );
}

function explorationBonusFor(
  candidate: ArticleRankingCandidateRow,
  settings: RankingSettingsSnapshot,
  ageHours: number
): number {
  if (!settings.explorationEnabled || candidate.state.hidden || candidate.state.notInterested) {
    return 0;
  }
  const params = cocoonParameters(settings.cocoonLevel);
  const pending = candidate.embeddingStatus === "embedding_pending" ? params.explorationRatio : 0;
  const lowExposure = candidate.behaviorEventCount === 0 && ageHours <= 48 ? params.explorationRatio / 2 : 0;
  return clamp(pending + lowExposure, 0, 0.08);
}

function duplicateStatsFor(candidates: ArticleRankingCandidateRow[]): Map<string, number> {
  const keys = new Map<string, number>();
  for (const candidate of candidates) {
    const key = duplicateKeyFor(candidate);
    keys.set(key, (keys.get(key) ?? 0) + 1);
  }

  const result = new Map<string, number>();
  for (const candidate of candidates) {
    result.set(candidate.articleId, keys.get(duplicateKeyFor(candidate)) ?? 1);
  }
  return result;
}

function duplicateKeyFor(candidate: ArticleRankingCandidateRow): string {
  return (
    candidate.dedupeKey ||
    candidate.contentHash ||
    normalizeUrl(candidate.canonicalUrl ?? candidate.url) ||
    normalizeTitle(candidate.title)
  );
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url.trim().toLowerCase();
  }
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function rerankCanonicalWindow(
  items: Array<{ candidate: ArticleRankingCandidateRow; score: V2Score }>,
  settings: RankingSettingsSnapshot,
  limit: number
): Array<{ candidate: ArticleRankingCandidateRow; score: V2Score; position: number }> {
  const params = cocoonParameters(settings.cocoonLevel);
  const remaining = items
    .slice()
    .sort((left, right) => right.score.score - left.score.score || right.candidate.discoveredAt - left.candidate.discoveredAt)
    .slice(0, limit);
  const selected: Array<{ candidate: ArticleRankingCandidateRow; score: V2Score; position: number }> = [];
  const sourceCounts = new Map<string, number>();
  const duplicateGroups = new Set<string>();

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const item = remaining[index]!;
      const sourceCount = sourceCounts.get(item.candidate.feedId) ?? 0;
      const sourcePenalty =
        sourceCount >= params.sourceCap ? 0.12 * params.diversityStrength : sourceCount * 0.01;
      const duplicateKey = duplicateKeyFor(item.candidate);
      const duplicatePenalty = duplicateGroups.has(duplicateKey) && !item.candidate.state.favorited && !item.candidate.state.readLater
        ? 0.18 * params.diversityStrength
        : 0;
      const mmrScore =
        params.mmrLambda * item.score.score -
        (1 - params.mmrLambda) * (sourcePenalty + duplicatePenalty);
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIndex = index;
      }
    }

    const [next] = remaining.splice(bestIndex, 1);
    if (!next) {
      break;
    }
    const diversityPenalty = Math.min(0, bestScore - next.score.score);
    next.score = {
      ...next.score,
      diversityPenalty: roundScore(diversityPenalty),
      diversityScore: roundScore(diversityPenalty),
      score: roundScore(clamp(next.score.score + diversityPenalty, 0, 1))
    };
    sourceCounts.set(next.candidate.feedId, (sourceCounts.get(next.candidate.feedId) ?? 0) + 1);
    duplicateGroups.add(duplicateKeyFor(next.candidate));
    selected.push({
      ...next,
      position: selected.length + 1
    });
  }

  return selected;
}

function explanationPayloadFor(
  candidate: ArticleRankingCandidateRow,
  score: V2Score,
  settings: RankingSettingsSnapshot
): Record<string, unknown> {
  return {
    algorithmVersion: RECOMMENDATION_ALGORITHM_VERSION,
    featureSchemaVersion: RECOMMENDATION_FEATURE_SCHEMA_VERSION,
    cocoonLevel: settings.cocoonLevel,
    components: {
      final: score.score,
      preRerank: score.preRerankScore,
      semantic: score.semanticScore,
      bm25: score.bm25Score,
      source: score.sourceScore,
      freshness: score.freshnessScore,
      state: score.stateScore,
      negativePenalty: score.negativePenalty,
      duplicatePenalty: score.duplicatePenalty,
      diversityPenalty: score.diversityPenalty,
      pendingEmbedding: score.pendingEmbeddingScore,
      exploration: score.explorationBonus,
      exposurePenalty: score.exposurePenalty,
      ftrl: score.ftrlScore
    },
    evidence: {
      feedId: candidate.feedId,
      embeddingStatus: candidate.embeddingStatus,
      dedupeKey: candidate.dedupeKey,
      contentHash: candidate.contentHash,
      titleTerms: tokenize(candidate.title).slice(0, 8)
    },
    flags: {
      localLearningEnabled: settings.localLearningEnabled,
      localLearningShadowMode: settings.localLearningShadowMode,
      explorationEnabled: settings.explorationEnabled,
      evaluationEnabled: settings.evaluationEnabled
    }
  };
}

function parseExplanationPayload(payloadJson: string | null): { components?: Record<string, unknown> } | null {
  if (!payloadJson) {
    return null;
  }
  try {
    const parsed = JSON.parse(payloadJson) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as { components?: Record<string, unknown> })
      : null;
  } catch {
    return null;
  }
}

function lerp(left: number, right: number, t: number): number {
  return left + (right - left) * t;
}

function roundScore(value: number): number {
  return Number(value.toFixed(6));
}

function rankReasonsFor(
  source: ArticleRankExplanationSourceRow,
  clusterMatch: RankExplanationClusterMatch | null,
  persistedPayload?: { components?: Record<string, unknown> } | null
): RankExplanationReason[] {
  const rank = source.rank;
  if (!rank) {
    return [
      {
        type: "fallback",
        label: "Ranking has not been calculated yet",
        impact: "neutral"
      }
    ];
  }

  const candidates: Array<RankExplanationReason & { magnitude: number; priority: number }> = [];
  const components = persistedPayload?.components ?? {};
  const bm25Score = typeof components.bm25 === "number" ? components.bm25 : rank.bm25Score ?? 0;
  const pendingScore =
    typeof components.pendingEmbedding === "number"
      ? components.pendingEmbedding
      : rank.pendingEmbeddingScore ?? 0;
  const duplicatePenalty =
    typeof components.duplicatePenalty === "number"
      ? components.duplicatePenalty
      : rank.duplicatePenalty ?? 0;
  const diversityPenalty =
    typeof components.diversityPenalty === "number"
      ? components.diversityPenalty
      : rank.diversityPenalty ?? 0;

  if ((rank.semanticScore ?? rank.interestScore) > MIN_REASON_SCORE) {
    candidates.push({
      type: "interest",
      label: "Interest match",
      impact: "positive",
      ...(clusterMatch ? { cluster: clusterMatch } : {}),
      magnitude: rank.semanticScore ?? rank.interestScore,
      priority: 1
    });
  }

  if (bm25Score > MIN_REASON_SCORE) {
    candidates.push({
      type: "interest",
      label: "Keyword/BM25 match",
      impact: "positive",
      magnitude: bm25Score,
      priority: 2
    });
  }

  if (rank.sourceScore > MIN_REASON_SCORE) {
    candidates.push({
      type: "source",
      label: source.feedTitle,
      impact: "positive",
      magnitude: rank.sourceScore,
      priority: 2
    });
  } else if (rank.sourceScore < -MIN_REASON_SCORE) {
    candidates.push({
      type: "source",
      label: source.feedTitle,
      impact: "negative",
      magnitude: Math.abs(rank.sourceScore),
      priority: 2
    });
  }

  if (rank.freshnessScore > MIN_REASON_SCORE) {
    candidates.push({
      type: "freshness",
      label: "Recent article",
      impact: "positive",
      magnitude: rank.freshnessScore,
      priority: 3
    });
  }

  if (rank.stateScore > MIN_REASON_SCORE) {
    candidates.push({
      type: "state",
      label: positiveStateLabelFor(source),
      impact: "positive",
      magnitude: rank.stateScore,
      priority: 4
    });
  } else if (rank.stateScore < -MIN_REASON_SCORE) {
    candidates.push({
      type: "state",
      label: source.state.interactionStatus === "ignored"
        ? "Ignored in the list"
        : "Read state lowers priority",
      impact: "negative",
      magnitude: Math.abs(rank.stateScore),
      priority: 4
    });
  }

  if (rank.penaltyScore < -MIN_REASON_SCORE) {
    candidates.push({
      type: rank.penaltyScore <= -0.2 ? "negative" : "penalty",
      label: source.state.notInterested
        ? "Marked not interested"
        : source.state.hidden
          ? "Hidden article"
          : "Negative interest match",
      impact: "negative",
      magnitude: Math.abs(rank.penaltyScore),
      priority: 0
    });
  }

  if (pendingScore > MIN_REASON_SCORE) {
    candidates.push({
      type: "fallback",
      label: "Fresh article is waiting for embedding",
      impact: "neutral",
      magnitude: pendingScore,
      priority: 6
    });
  }

  if (duplicatePenalty < -MIN_REASON_SCORE || diversityPenalty < -MIN_REASON_SCORE) {
    candidates.push({
      type: "penalty",
      label: duplicatePenalty < -MIN_REASON_SCORE ? "Near-duplicate penalty" : "Diversity rerank penalty",
      impact: "negative",
      magnitude: Math.abs(duplicatePenalty + diversityPenalty),
      priority: 5
    });
  }

  const reasons = candidates
    .sort((left, right) => right.magnitude - left.magnitude || left.priority - right.priority)
    .slice(0, MAX_REASONS)
    .map(({ magnitude: _magnitude, priority: _priority, ...reason }) => reason);

  return reasons.length > 0
    ? reasons
    : [
        {
          type: "fallback",
          label: fallbackLabelFor(source),
          impact: "neutral"
        }
      ];
}

function fallbackLabelFor(source: ArticleRankExplanationSourceRow): string {
  if (source.rankingStatus === "no_provider") {
    return "Using baseline ranking because embedding is not configured";
  }
  if (source.rankingStatus === "embedding_pending") {
    return "Using baseline signals while embedding is pending";
  }
  if (source.rankingStatus === "rank_pending") {
    return "Ranking signals are still being prepared";
  }
  return "Ranking has not been calculated yet";
}

function positiveStateLabelFor(source: ArticleRankExplanationSourceRow): string {
  const labels: string[] = [];

  if (source.state.favorited) {
    labels.push("Favorited");
  }
  if (source.state.readLater) {
    labels.push("Saved for later");
  }
  if (source.state.readingProgress > 0) {
    labels.push("Reading progress");
  }
  if (source.state.interactionStatus === "opened") {
    labels.push("Opened article");
  }

  return labels.length > 0 ? labels.join(", ") : "Article state increased the score";
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}
