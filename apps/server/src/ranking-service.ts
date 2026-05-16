import {
  calculateBaselineRankScore,
  calculateRecommendationRankScore,
  clamp,
  cosineSimilarity,
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
};

export type RankExplanationResult = {
  articleId: string;
  status: ArticleRankExplanationSourceRow["rankingStatus"];
  reasons: RankExplanationReason[];
  generatedAt: number;
};

export type RecommendationRankingServiceOptions = {
  embeddings?: Pick<EmbeddingRepository, "findActiveProviderWithIndex">;
  profiles?: Pick<ProfileRepository, "listClusters">;
  rankings: RankingRepository;
  now?: () => number;
};

type ClusterVector = {
  cluster: InterestClusterRow;
  polarity: InterestClusterPolarity;
  vector: number[];
  weightNorm: number;
};

export class RecommendationRankingService implements ArticleRankingRecalculator {
  private readonly now: () => number;

  constructor(private readonly options: RecommendationRankingServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  getActiveRankContext(): string {
    return this.activeEmbeddingIndexId() ?? BASE_RANK_CONTEXT;
  }

  recalculateArticle(articleId: string): number {
    return this.recalculateArticles([articleId]);
  }

  recalculateArticles(articleIds: string[]): number {
    if (articleIds.length === 0) {
      return 0;
    }
    return this.writeScores(uniqueStrings(articleIds));
  }

  recalculateAll(): number {
    return this.writeScores();
  }

  explainArticle(articleId: string): RankExplanationResult | null {
    const source = this.options.rankings.findExplanationSource({
      articleId,
      rankContext: this.getActiveRankContext()
    });
    if (!source) {
      return null;
    }

    return {
      articleId,
      status: source.rankingStatus,
      reasons: rankReasonsFor(source),
      generatedAt: source.rank?.calculatedAt ?? this.now()
    };
  }

  private writeScores(articleIds?: string[]): number {
    const activeIndexId = this.activeEmbeddingIndexId();
    const candidates = this.options.rankings.listCandidates({
      articleIds,
      embeddingIndexId: activeIndexId
    });
    const now = this.now();
    const clusters = activeIndexId ? this.clusterVectorsFor(activeIndexId) : [];

    for (const candidate of candidates) {
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
        read: candidate.state.read,
        favorited: candidate.state.favorited,
        readLater: candidate.state.readLater,
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

      if (activeIndexId) {
        const matches = interestMatchesFor(candidate, clusters);
        const recommendationScore = calculateRecommendationRankScore({
          now,
          publishedAt: candidate.publishedAt,
          discoveredAt: candidate.discoveredAt,
          sourceWeight: candidate.sourceWeight,
          feedPositiveScore: candidate.feedPositiveScore,
          feedNegativeScore: candidate.feedNegativeScore,
          feedOpenRate: candidate.feedOpenRate,
          feedFavoriteRate: candidate.feedFavoriteRate,
          feedNotInterestedRate: candidate.feedNotInterestedRate,
          read: candidate.state.read,
          favorited: candidate.state.favorited,
          readLater: candidate.state.readLater,
          hidden: candidate.state.hidden,
          notInterested: candidate.state.notInterested,
          embeddingStatus:
            candidate.embeddingStatus === "embedding_pending"
              ? "pending"
              : candidate.embeddingStatus === "ready"
                ? "ready"
                : "none",
          positiveInterestMatch: matches.positiveInterestMatch,
          negativeInterestMatch: matches.negativeInterestMatch,
          negativeSimilarity: matches.negativeSimilarity
        });

        this.options.rankings.upsertScore({
          articleId: candidate.articleId,
          rankContext: activeIndexId,
          embeddingIndexId: activeIndexId,
          ...recommendationScore
        });
      }
    }

    return candidates.length;
  }

  private activeEmbeddingIndexId(): string | null {
    return this.options.embeddings?.findActiveProviderWithIndex()?.index.id ?? null;
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
  let positiveInterestMatch = 0;
  let negativeInterestMatch = 0;
  let negativeSimilarity = 0;

  for (const cluster of clusters) {
    const similarity = cosineSimilarity(articleVector, cluster.vector);
    const weightedMatch = Math.max(0, similarity) * cluster.weightNorm;

    if (cluster.polarity === "positive") {
      positiveInterestMatch = Math.max(positiveInterestMatch, weightedMatch);
    } else {
      negativeInterestMatch = Math.max(negativeInterestMatch, weightedMatch);
      if (weightedMatch === negativeInterestMatch) {
        negativeSimilarity = Math.max(negativeSimilarity, similarity);
      }
    }
  }

  return {
    positiveInterestMatch,
    negativeInterestMatch,
    negativeSimilarity
  };
}

function rankReasonsFor(source: ArticleRankExplanationSourceRow): RankExplanationReason[] {
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

  if (rank.interestScore > MIN_REASON_SCORE) {
    candidates.push({
      type: "interest",
      label: "Interest match",
      impact: "positive",
      magnitude: rank.interestScore,
      priority: 1
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
      label: "Read state lowers priority",
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
  if (source.rankingStatus === "learning") {
    return "Profile is still learning";
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

  return labels.length > 0 ? labels.join(", ") : "Article state increased the score";
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}
