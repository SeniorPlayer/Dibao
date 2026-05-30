import { describe, expect, it } from "vitest";
import {
  calculateBaselineRankScore,
  calculateRecommendationRankScore,
  clamp,
  cosineSimilarity,
  freshnessScore,
  mergeCentroid,
  profileAlgorithmDefaults,
  type RecommendationRankInput,
  type BaselineRankInput
} from "./index.js";

describe("ranking package", () => {
  it("exports conservative Profile Algorithm defaults", () => {
    expect(profileAlgorithmDefaults.maxPositiveClusters).toBe(48);
    expect(profileAlgorithmDefaults.maxNegativeClusters).toBe(32);
    expect(profileAlgorithmDefaults.negativeMergeThreshold).toBeGreaterThan(
      profileAlgorithmDefaults.positiveMergeThreshold
    );
    expect(profileAlgorithmDefaults.positiveMergeThreshold).toBeGreaterThan(
      profileAlgorithmDefaults.positiveCreateThreshold
    );
    expect(profileAlgorithmDefaults.positiveInterestMatchThreshold).toBeGreaterThan(
      profileAlgorithmDefaults.positiveCreateThreshold
    );
    expect(profileAlgorithmDefaults.clusterCompactionSimilarityThreshold).toBeGreaterThan(
      profileAlgorithmDefaults.positiveMergeThreshold
    );
  });

  it("clamps values", () => {
    expect(clamp(2, 0, 1)).toBe(1);
    expect(clamp(-1, 0, 1)).toBe(0);
  });

  it("decays freshness as articles age", () => {
    expect(freshnessScore(0)).toBeGreaterThan(freshnessScore(72));
  });

  it("raises baseline rank for positive article state", () => {
    const base = baselineInput();
    const baseScore = calculateBaselineRankScore(base).score;

    expect(calculateBaselineRankScore({ ...base, favorited: true }).score).toBeGreaterThan(
      baseScore
    );
    expect(calculateBaselineRankScore({ ...base, liked: true }).score).toBeGreaterThan(
      baseScore
    );
    expect(calculateBaselineRankScore({ ...base, readLater: true }).score).toBeGreaterThan(
      baseScore
    );
    expect(
      calculateBaselineRankScore({ ...base, readingProgress: 0.75 }).score
    ).toBeGreaterThan(baseScore);
  });

  it("keeps open behavior projection weaker than saved states", () => {
    const base = baselineInput();
    const baseScore = calculateBaselineRankScore(base).score;
    const openScore = calculateBaselineRankScore({
      ...base,
      behaviorProjectionScore: 0.025,
      behaviorEventCount: 5
    }).score;
    const readLaterScore = calculateBaselineRankScore({ ...base, readLater: true }).score;

    expect(openScore).toBeGreaterThan(baseScore);
    expect(openScore).toBeLessThan(readLaterScore);
  });

  it("keeps like projection above favorite projection", () => {
    const base = baselineInput();
    const likeScore = calculateBaselineRankScore({
      ...base,
      behaviorProjectionScore: 0.16
    }).interestScore;
    const favoriteScore = calculateBaselineRankScore({
      ...base,
      behaviorProjectionScore: 0.12
    }).interestScore;

    expect(likeScore).toBeGreaterThan(favoriteScore);
  });

  it("penalizes hidden and not interested articles", () => {
    const base = baselineInput();
    const baseScore = calculateBaselineRankScore(base).score;

    expect(calculateBaselineRankScore({ ...base, hidden: true }).score).toBeLessThan(
      baseScore
    );
    expect(calculateBaselineRankScore({ ...base, notInterested: true }).score).toBeLessThan(
      baseScore
    );
  });

  it("keeps positive interest score non-negative for opposite vectors", () => {
    const input = recommendationInput();
    const score = calculateRecommendationRankScore({
      ...input,
      positiveInterestMatch: -0.8
    });

    expect(score.interestScore).toBe(0);
  });

  it("applies negative similarity through penalty score", () => {
    const input = recommendationInput();
    const score = calculateRecommendationRankScore({
      ...input,
      negativeInterestMatch: 0.9,
      negativeSimilarity: profileAlgorithmDefaults.negativePenaltyThreshold
    });

    expect(score.penaltyScore).toBeLessThan(0);
  });

  it("gives pending embedding articles a small freshness floor", () => {
    const input = recommendationInput();
    const pending = calculateRecommendationRankScore({
      ...input,
      publishedAt: input.now - 70 * 3_600_000,
      discoveredAt: input.now - 70 * 3_600_000,
      embeddingStatus: "pending"
    });
    const ready = calculateRecommendationRankScore({
      ...input,
      publishedAt: input.now - 70 * 3_600_000,
      discoveredAt: input.now - 70 * 3_600_000,
      embeddingStatus: "ready"
    });

    expect(pending.freshnessScore).toBeGreaterThanOrEqual(0.035);
    expect(pending.freshnessScore).toBeGreaterThan(ready.freshnessScore);
  });

  it("centralizes vector similarity and centroid merge helpers", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(-1);
    expect(mergeCentroid([1, 0], [0, 1], 0.5)).toHaveLength(2);
  });
});

function baselineInput(): BaselineRankInput {
  return {
    now: 10_000,
    publishedAt: 5_000,
    discoveredAt: 5_000,
    sourceWeight: 0,
    feedPositiveScore: 0,
    feedNegativeScore: 0,
    feedOpenRate: 0,
    feedFavoriteRate: 0,
    feedNotInterestedRate: 0,
    read: false,
    favorited: false,
    liked: false,
    readLater: false,
    hidden: false,
    notInterested: false,
    readingProgress: 0,
    behaviorProjectionScore: 0,
    behaviorEventCount: 0
  };
}

function recommendationInput(): RecommendationRankInput {
  return {
    now: 10_000,
    publishedAt: 5_000,
    discoveredAt: 5_000,
    sourceWeight: 0,
    feedPositiveScore: 0,
    feedNegativeScore: 0,
    feedOpenRate: 0,
    feedFavoriteRate: 0,
    feedNotInterestedRate: 0,
    read: false,
    favorited: false,
    liked: false,
    readLater: false,
    hidden: false,
    notInterested: false,
    positiveInterestMatch: 0,
    negativeInterestMatch: 0,
    negativeSimilarity: 0
  };
}
