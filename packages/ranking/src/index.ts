export const profileAlgorithmDefaults = {
  maxPositiveClusters: 48,
  maxNegativeClusters: 32,
  minClusterWeight: 0.8,
  maxClusterWeight: 100,
  positiveMergeThreshold: 0.82,
  positiveCreateThreshold: 0.62,
  positiveInterestMatchThreshold: 0.78,
  negativeMergeThreshold: 0.84,
  negativeCreateThreshold: 0.65,
  negativePenaltyThreshold: 0.62,
  dailyDecayRate: 0.985,
  inactiveDecayRate: 0.96,
  negativeDailyDecayRate: 0.99,
  negativeInactiveDecayRate: 0.98,
  inactiveAfterDays: 21,
  deleteWeightBelow: 0.5,
  deleteSingleSampleInactiveDays: 30,
  negativeDeleteWeightBelow: 0.5,
  negativeDeleteSingleSampleInactiveDays: 60,
  clusterCompactionSimilarityThreshold: 0.92,
  readCompleteProgressThreshold: 0.9,
  readCompleteActiveProgressThreshold: 0.75,
  readCompleteActiveDurationMs: 90_000,
  estimatedReadingUnitsPerMinute: 500,
  minEstimatedReadTimeMs: 30_000,
  maxEstimatedReadTimeMs: 900_000,
  quickBounceDurationMs: 8_000,
  quickBounceProgressThreshold: 0.1,
  freshnessHalfLifeHours: 36
} as const;

export const BASE_RANK_CONTEXT = "base";

export const baselineRankingDefaults = {
  freshnessMaxScore: 0.35,
  sourceWeightMaxScore: 0.18,
  feedStatMaxScore: 0.1,
  favoriteScore: 0.5,
  likedScore: 0.1,
  readLaterScore: 0.24,
  readProgressMaxScore: 0.22,
  openedScore: 0.02,
  ignoredPenalty: -0.08,
  readPenalty: -0.06,
  behaviorProjectionMinScore: -0.12,
  behaviorProjectionMaxScore: 0.16,
  hiddenPenalty: -3,
  notInterestedPenalty: -4,
  scoreMin: -10,
  scoreMax: 10
} as const;

export type BaselineRankInput = {
  now: number;
  publishedAt: number | null;
  discoveredAt: number;
  sourceWeight: number;
  feedPositiveScore: number;
  feedNegativeScore: number;
  feedOpenRate: number;
  feedFavoriteRate: number;
  feedNotInterestedRate: number;
  read: boolean;
  favorited: boolean;
  liked: boolean;
  readLater: boolean;
  opened?: boolean;
  ignored?: boolean;
  hidden: boolean;
  notInterested: boolean;
  readingProgress: number;
  behaviorProjectionScore: number;
  behaviorEventCount: number;
};

export type BaselineRankScore = {
  score: number;
  interestScore: number;
  sourceScore: number;
  freshnessScore: number;
  stateScore: number;
  diversityScore: number;
  penaltyScore: number;
  calculatedAt: number;
};

export const recommendationRankingDefaults = {
  interestScoreMax: 0.55,
  sourceScoreMax: 0.18,
  sourceWeightMaxScore: 0.08,
  feedStatMaxScore: 0.08,
  feedRateMaxScore: 0.02,
  freshnessScoreMax: 0.18,
  unreadScore: 0.06,
  readLaterScore: 0.08,
  favoriteScore: 0.04,
  likedScore: 0.1,
  openedScore: 0.015,
  ignoredPenalty: -0.04,
  readPenalty: -0.08,
  negativeInterestPenaltyMax: 0.45,
  scoreMin: 0,
  scoreMax: 1
} as const;

export type RecommendationRankInput = {
  now: number;
  publishedAt: number | null;
  discoveredAt: number;
  sourceWeight: number;
  feedPositiveScore: number;
  feedNegativeScore: number;
  feedOpenRate: number;
  feedFavoriteRate: number;
  feedNotInterestedRate: number;
  read: boolean;
  favorited: boolean;
  liked: boolean;
  readLater: boolean;
  opened?: boolean;
  ignored?: boolean;
  hidden: boolean;
  notInterested: boolean;
  embeddingStatus?: "ready" | "pending" | "none";
  positiveInterestMatch: number;
  negativeInterestMatch: number;
  negativeSimilarity: number;
};

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function freshnessScore(
  ageHours: number,
  maxScore = 0.18,
  halfLifeHours = profileAlgorithmDefaults.freshnessHalfLifeHours
) {
  return Math.exp(-ageHours / halfLifeHours) * maxScore;
}

export function calculateBaselineRankScore(input: BaselineRankInput): BaselineRankScore {
  const ageHours = Math.max(
    0,
    (input.now - (input.publishedAt ?? input.discoveredAt)) / 3_600_000
  );
  const freshness = freshnessScore(
    ageHours,
    baselineRankingDefaults.freshnessMaxScore,
    profileAlgorithmDefaults.freshnessHalfLifeHours
  );
  const source = calculateSourceScore(input);
  const state = calculateStateScore(input);
  const interest = calculateBehaviorInterestScore(input);
  const penalty = calculatePenaltyScore(input);
  const score = freshness + source + state + interest + penalty;

  return {
    score: roundScore(
      clamp(score, baselineRankingDefaults.scoreMin, baselineRankingDefaults.scoreMax)
    ),
    interestScore: roundScore(interest),
    sourceScore: roundScore(source),
    freshnessScore: roundScore(freshness),
    stateScore: roundScore(state),
    diversityScore: 0,
    penaltyScore: roundScore(penalty),
    calculatedAt: input.now
  };
}

export function calculateRecommendationRankScore(
  input: RecommendationRankInput
): BaselineRankScore {
  const ageHours = Math.max(
    0,
    (input.now - (input.publishedAt ?? input.discoveredAt)) / 3_600_000
  );
  const freshness = freshnessScore(
    ageHours,
    recommendationRankingDefaults.freshnessScoreMax,
    profileAlgorithmDefaults.freshnessHalfLifeHours
  );
  const freshnessWithFloor =
    input.embeddingStatus === "pending" && ageHours <= 72
      ? Math.max(freshness, 0.035)
      : freshness;
  const source = calculateRecommendationSourceScore(input);
  const state = calculateRecommendationStateScore(input);
  const interest =
    Math.max(0, input.positiveInterestMatch) *
    recommendationRankingDefaults.interestScoreMax;
  const penalty = calculateRecommendationPenaltyScore(input);
  const score = freshnessWithFloor + source + state + interest + penalty;

  return {
    score: roundScore(
      clamp(
        score,
        recommendationRankingDefaults.scoreMin,
        recommendationRankingDefaults.scoreMax
      )
    ),
    interestScore: roundScore(interest),
    sourceScore: roundScore(source),
    freshnessScore: roundScore(freshnessWithFloor),
    stateScore: roundScore(state),
    diversityScore: 0,
    penaltyScore: roundScore(penalty),
    calculatedAt: input.now
  };
}

function calculateSourceScore(input: BaselineRankInput): number {
  const explicitSourceWeight =
    clamp(input.sourceWeight, -1, 1) * baselineRankingDefaults.sourceWeightMaxScore;
  const feedScore =
    clamp(input.feedPositiveScore - input.feedNegativeScore, -5, 5) *
    (baselineRankingDefaults.feedStatMaxScore / 5);
  const feedRateScore =
    clamp(input.feedFavoriteRate - input.feedNotInterestedRate, -1, 1) * 0.04 +
    clamp(input.feedOpenRate, 0, 1) * 0.003;

  return explicitSourceWeight + feedScore + feedRateScore;
}

function calculateStateScore(input: BaselineRankInput): number {
  return (
    (input.favorited ? baselineRankingDefaults.favoriteScore : 0) +
    (input.liked ? baselineRankingDefaults.likedScore : 0) +
    (input.readLater ? baselineRankingDefaults.readLaterScore : 0) +
    (input.opened && !input.read && input.readingProgress <= 0
      ? baselineRankingDefaults.openedScore
      : 0) +
    (input.ignored ? baselineRankingDefaults.ignoredPenalty : 0) +
    clamp(input.readingProgress, 0, 1) * baselineRankingDefaults.readProgressMaxScore +
    (input.read ? baselineRankingDefaults.readPenalty : 0)
  );
}

function calculateBehaviorInterestScore(input: BaselineRankInput): number {
  return clamp(
    input.behaviorProjectionScore,
    baselineRankingDefaults.behaviorProjectionMinScore,
    baselineRankingDefaults.behaviorProjectionMaxScore
  );
}

function calculatePenaltyScore(input: BaselineRankInput): number {
  return (
    (input.hidden ? baselineRankingDefaults.hiddenPenalty : 0) +
    (input.notInterested ? baselineRankingDefaults.notInterestedPenalty : 0)
  );
}

function calculateRecommendationSourceScore(input: RecommendationRankInput): number {
  const explicitSourceWeight =
    clamp(input.sourceWeight, -1, 1) * recommendationRankingDefaults.sourceWeightMaxScore;
  const feedScore =
    Math.tanh((input.feedPositiveScore - input.feedNegativeScore) / 20) *
    recommendationRankingDefaults.feedStatMaxScore;
  const feedRateScore =
    clamp(input.feedFavoriteRate - input.feedNotInterestedRate, -1, 1) *
      recommendationRankingDefaults.feedRateMaxScore +
    clamp(input.feedOpenRate, 0, 1) * 0.002;

  return clamp(
    explicitSourceWeight + feedScore + feedRateScore,
    -recommendationRankingDefaults.sourceScoreMax,
    recommendationRankingDefaults.sourceScoreMax
  );
}

function calculateRecommendationStateScore(input: RecommendationRankInput): number {
  return (
    (!input.read ? recommendationRankingDefaults.unreadScore : 0) +
    (input.readLater ? recommendationRankingDefaults.readLaterScore : 0) +
    (input.favorited ? recommendationRankingDefaults.favoriteScore : 0) +
    (input.liked ? recommendationRankingDefaults.likedScore : 0) +
    (input.opened && !input.read ? recommendationRankingDefaults.openedScore : 0) +
    (input.ignored ? recommendationRankingDefaults.ignoredPenalty : 0) +
    (input.read ? recommendationRankingDefaults.readPenalty : 0)
  );
}

function calculateRecommendationPenaltyScore(input: RecommendationRankInput): number {
  const statePenalty =
    (input.hidden ? baselineRankingDefaults.hiddenPenalty : 0) +
    (input.notInterested ? baselineRankingDefaults.notInterestedPenalty : 0);
  const negativeInterestPenalty =
    input.negativeSimilarity >= profileAlgorithmDefaults.negativePenaltyThreshold
      ? -Math.max(0, input.negativeInterestMatch) *
        recommendationRankingDefaults.negativeInterestPenaltyMax
      : 0;

  return statePenalty + negativeInterestPenalty;
}

function roundScore(value: number): number {
  return Number(value.toFixed(6));
}

export {
  assertSameDimension,
  cosineSimilarity,
  mergeCentroid,
  normalizeVector,
  VectorDimensionMismatchError
} from "./vector.js";
