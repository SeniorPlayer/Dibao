import { randomBytes } from "node:crypto";
import {
  fromVectorBlob,
  toVectorBlob,
  type EmbeddingRepository,
  type InterestClusterEvidenceRow,
  type InterestClusterPolarity,
  type InterestClusterRow,
  type ProfileBehaviorEventRow,
  type ProfileRepository
} from "@dibao/db";
import {
  clamp,
  cosineSimilarity,
  mergeCentroid,
  normalizeVector,
  profileAlgorithmDefaults
} from "@dibao/ranking";
import type {
  InterestClusterCalibration,
  InterestClusterPolarityThresholds
} from "./interest-cluster-calibration-service.js";

type ProfileEventPolarity = InterestClusterPolarity | "stats_only";

type ProfileEventImpact = {
  polarity: ProfileEventPolarity;
  profileWeight: number;
  forceCreate?: boolean;
};

export type ProfileUpdateResult = {
  articleIds: string[];
  feedStatsChanged: boolean;
  profileChanged: boolean;
};

export type ProfileDecayResult = {
  clustersUpdated: number;
  clustersDeleted: number;
};

export type ProfileDecayInput = {
  elapsedDays?: number;
};

export type ProfileServiceOptions = {
  embeddings: Pick<EmbeddingRepository, "findActiveProviderWithIndex">;
  profiles: ProfileRepository;
  now?: () => number;
  clusterIdFactory?: () => string;
  getClusterLimits?: () => {
    maxPositiveInterestClusters: number;
    maxNegativeInterestClusters: number;
  };
  getClusterCalibration?: (embeddingIndexId: string) => InterestClusterCalibration;
};

type ProfileSnapshot = {
  profileV0?: Record<string, Record<string, ProfileContentSnapshot>>;
};

type ProfileContentSnapshot = {
  processedEventIds?: string[];
  readProgressTier?: ReadProgressTier;
};

type ReadProgressTier =
  | "read_progress_25"
  | "read_progress_50"
  | "read_progress_75"
  | "read_complete";

const READ_PROGRESS_TIER_ORDER: Record<ReadProgressTier, number> = {
  read_progress_25: 1,
  read_progress_50: 2,
  read_progress_75: 3,
  read_complete: 4
};

const PROFILE_EVENT_WEIGHTS = {
  impression: 0,
  open: 0,
  read_progress_25: 1.2,
  read_progress_50: 2,
  read_progress_75: 3,
  read_complete: 4,
  like: 8,
  favorite: 6,
  read_later: 3,
  mark_read: 1,
  quick_bounce: 0,
  hide: -3.5,
  not_interested: -6,
  unlike: -1,
  unfavorite: -1.5,
  remove_read_later: -1,
  mark_unread: -0.5
} as const;

type SourceEventKey =
  | "impression"
  | "open"
  | "read_complete"
  | "like"
  | "unlike"
  | "favorite"
  | "read_later"
  | "quick_bounce"
  | "hide"
  | "not_interested";

type SourceEventWeight = { positive: number; negative: number; clear?: boolean };

const SOURCE_EVENT_WEIGHTS: Record<SourceEventKey, SourceEventWeight> = {
  impression: { positive: 0, negative: 0.05, clear: false },
  open: { positive: 0.02, negative: 0, clear: false },
  read_complete: { positive: 1, negative: 0 },
  like: { positive: 3, negative: 0 },
  unlike: { positive: 0, negative: 0.4 },
  favorite: { positive: 2, negative: 0 },
  read_later: { positive: 1, negative: 0 },
  quick_bounce: { positive: 0, negative: 0.2 },
  hide: { positive: 0, negative: 1.5 },
  not_interested: { positive: 0, negative: 2.5 }
};

const FEED_STATS_CLEAR_SIGNAL_TARGET = 10;
const FEED_STATS_OPEN_ONLY_CONFIDENCE = 0.1;
const NEW_CLUSTER_PROTECTION_MS = 24 * 60 * 60 * 1000;

export class ProfileService {
  private readonly now: () => number;
  private readonly clusterIdFactory: () => string;
  private deferredClusterTrimDepth = 0;

  constructor(private readonly options: ProfileServiceOptions) {
    this.now = options.now ?? Date.now;
    this.clusterIdFactory = options.clusterIdFactory ?? randomClusterId;
  }

  processEvent(eventId: string): ProfileUpdateResult {
    const active = this.options.embeddings.findActiveProviderWithIndex();
    const event = this.options.profiles.findEventForIndex(eventId, active?.index.id ?? null);
    if (!event) {
      return emptyResult();
    }

    this.recalculateFeedStats(event.feedId);
    const profileChanged = active ? this.processProfileEvent(event) : false;

    return {
      articleIds: [event.articleId],
      feedStatsChanged: true,
      profileChanged
    };
  }

  processArticleEvents(articleIds: string[]): ProfileUpdateResult {
    const active = this.options.embeddings.findActiveProviderWithIndex();
    if (!active || articleIds.length === 0) {
      return emptyResult();
    }

    const events = this.options.profiles.listEventsForArticles({
      articleIds: uniqueStrings(articleIds),
      embeddingIndexId: active.index.id
    });
    let profileChanged = false;
    const feedIds = new Set<string>();

    for (const event of events) {
      feedIds.add(event.feedId);
      profileChanged = this.processProfileEvent(event) || profileChanged;
    }

    for (const feedId of feedIds) {
      this.recalculateFeedStats(feedId);
    }

    return {
      articleIds: uniqueStrings(events.map((event) => event.articleId)),
      feedStatsChanged: feedIds.size > 0,
      profileChanged
    };
  }

  beginDeferredClusterTrim(): () => void {
    this.deferredClusterTrimDepth += 1;
    return () => {
      this.deferredClusterTrimDepth = Math.max(0, this.deferredClusterTrimDepth - 1);
    };
  }

  finalizeClusterMaintenance(embeddingIndexId: string): number {
    return (
      this.compactAndTrimClusters(embeddingIndexId, "positive", { protectNewClusters: false }) +
      this.compactAndTrimClusters(embeddingIndexId, "negative", { protectNewClusters: false })
    );
  }

  decayClusters(input: ProfileDecayInput = {}): ProfileDecayResult {
    const now = this.now();
    let clustersUpdated = 0;
    let clustersDeleted = 0;
    const elapsedDays = Math.max(0, Math.floor(input.elapsedDays ?? 1));

    if (elapsedDays === 0) {
      return { clustersUpdated: 0, clustersDeleted: 0 };
    }

    for (const cluster of this.options.profiles.listClusters()) {
      const lastMatchedAt = cluster.lastMatchedAt ?? cluster.createdAt;
      const inactiveDays = Math.max(0, Math.floor((now - lastMatchedAt) / 86_400_000));
      const rate = decayRateFor(cluster.polarity, inactiveDays);
      const weight = cluster.weight * Math.pow(rate, elapsedDays);
      const deleteWeightBelow =
        cluster.polarity === "negative"
          ? profileAlgorithmDefaults.negativeDeleteWeightBelow
          : profileAlgorithmDefaults.deleteWeightBelow;
      const deleteSingleSampleInactiveDays =
        cluster.polarity === "negative"
          ? profileAlgorithmDefaults.negativeDeleteSingleSampleInactiveDays
          : profileAlgorithmDefaults.deleteSingleSampleInactiveDays;

      if (
        weight < deleteWeightBelow ||
        (cluster.sampleCount <= 1 &&
          inactiveDays > deleteSingleSampleInactiveDays)
      ) {
        if (this.options.profiles.deleteCluster(cluster.id)) {
          clustersDeleted += 1;
        }
        continue;
      }

      this.options.profiles.updateCluster({
        id: cluster.id,
        weight,
        now
      });
      clustersUpdated += 1;
    }

    const compacted = this.compactAllClusters();
    clustersDeleted += compacted.deleted;

    return { clustersUpdated, clustersDeleted };
  }

  private processProfileEvent(event: ProfileBehaviorEventRow): boolean {
    if (!event.embeddingIndexId || !event.embeddingContentHash || !event.vectorBlob) {
      return false;
    }

    if (event.embeddingContentHash !== event.contentHash) {
      return false;
    }

    const snapshot = parseSnapshot(this.options.profiles.getTopicSnapshot(event.articleId));
    if (snapshotHasProcessedEvent(snapshot, event.embeddingIndexId, event.id)) {
      return false;
    }

    const bucket = snapshotBucket(snapshot, event.embeddingIndexId, event.embeddingContentHash);

    if (bucket.processedEventIds?.includes(event.id)) {
      return false;
    }

    const impact = impactForEvent(event, bucket);

    bucket.processedEventIds = [...(bucket.processedEventIds ?? []), event.id];
    if (event.eventType === "read_progress") {
      const tier = readProgressTierFor(event);
      if (tier && isHigherTier(tier, bucket.readProgressTier)) {
        bucket.readProgressTier = tier;
      }
    }

    this.options.profiles.upsertTopicSnapshot({
      articleId: event.articleId,
      feedId: event.feedId,
      topicSnapshotJson: JSON.stringify(snapshot),
      now: this.now()
    });

    if (impact.polarity === "stats_only" || impact.profileWeight === 0) {
      return false;
    }

    this.applyClusterImpact(
      event,
      impact.polarity,
      Math.abs(impact.profileWeight),
      impact.forceCreate ?? false
    );
    return true;
  }

  private applyClusterImpact(
    event: ProfileBehaviorEventRow,
    polarity: InterestClusterPolarity,
    eventWeight: number,
    forceCreate: boolean
  ): void {
    if (!event.embeddingIndexId || !event.vectorBlob) {
      return;
    }

    const vector = fromVectorBlob(event.vectorBlob);
    const clusters = this.options.profiles.listClusters({
      embeddingIndexId: event.embeddingIndexId,
      polarity
    });
    const best = bestClusterMatch(vector, clusters);
    const thresholds = this.thresholdsFor(event.embeddingIndexId, polarity);
    const now = this.now();

    if (!best) {
      if (!forceCreate) {
        return;
      }
      const cluster = this.createCluster(
        event.embeddingIndexId,
        polarity,
        vector,
        newClusterWeightFor(eventWeight, polarity),
        now
      );
      this.recordClusterEvidence(event, cluster.id, "live_event", 1, eventWeight, now);
      this.compactAndTrimClusters(event.embeddingIndexId, polarity);
      return;
    }

    if (
      best.similarity >= thresholds.attachThreshold &&
      this.canMergeIntoCluster({
        vector,
        best,
        thresholds
      })
    ) {
      const learningRate = clamp(eventWeight / 20, 0.03, 0.18);
      const merged = mergeCentroid(best.centroid, vector, learningRate);
      this.options.profiles.updateCluster({
        id: best.cluster.id,
        centroidVectorBlob: toVectorBlob(merged),
        weight: clamp(
          best.cluster.weight + eventWeight,
          profileAlgorithmDefaults.minClusterWeight,
          profileAlgorithmDefaults.maxClusterWeight
        ),
        sampleCount: best.cluster.sampleCount + 1,
        lastMatchedAt: now,
        now
      });
      this.recordClusterEvidence(
        event,
        best.cluster.id,
        "live_event",
        best.similarity,
        eventWeight,
        now
      );
      this.compactAndTrimClusters(event.embeddingIndexId, polarity);
      return;
    }

    if (forceCreate) {
      const cluster = this.createCluster(
        event.embeddingIndexId,
        polarity,
        vector,
        newClusterWeightFor(eventWeight, polarity),
        now
      );
      this.recordClusterEvidence(event, cluster.id, "live_event", 1, eventWeight, now);
      this.compactAndTrimClusters(event.embeddingIndexId, polarity);
    }
  }

  private createCluster(
    embeddingIndexId: string,
    polarity: InterestClusterPolarity,
    vector: number[],
    eventWeight: number,
    now: number
  ): InterestClusterRow {
    return this.options.profiles.upsertCluster({
      id: this.clusterIdFactory(),
      embeddingIndexId,
      polarity,
      centroidVectorBlob: toVectorBlob(vector),
      weight: clamp(eventWeight, profileAlgorithmDefaults.minClusterWeight, 8),
      sampleCount: 1,
      lastMatchedAt: now,
      now
    });
  }

  private recordClusterEvidence(
    event: ProfileBehaviorEventRow,
    clusterId: string,
    evidenceSource: "live_event" | "reconstructed",
    similarity: number,
    weightDelta: number,
    now: number
  ): void {
    this.options.profiles.insertClusterEvidence({
      id: `evidence_${event.id}_${clusterId}_${evidenceSource}`,
      clusterId,
      articleId: event.articleId,
      behaviorEventId: event.id,
      evidenceSource,
      confidence: evidenceSource === "live_event" ? 1 : clamp(similarity, 0, 1),
      similarity,
      weightDelta,
      createdAt: now
    });
    this.options.profiles.trimClusterEvidence({ clusterId, limit: 50 });
  }

  private compactAllClusters(): { deleted: number } {
    let deleted = 0;
    const seen = new Set<string>();
    for (const cluster of this.options.profiles.listClusters()) {
      const key = `${cluster.embeddingIndexId}:${cluster.polarity}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      deleted += this.compactAndTrimClusters(cluster.embeddingIndexId, cluster.polarity);
    }
    return { deleted };
  }

  private compactAndTrimClusters(
    embeddingIndexId: string,
    polarity: InterestClusterPolarity,
    options: { protectNewClusters?: boolean } = {}
  ): number {
    const deletedByMerge = this.mergeSimilarClusters(embeddingIndexId, polarity);
    if (this.deferredClusterTrimDepth > 0) {
      return deletedByMerge;
    }
    return deletedByMerge + this.trimClusters(embeddingIndexId, polarity, options);
  }

  private mergeSimilarClusters(
    embeddingIndexId: string,
    polarity: InterestClusterPolarity
  ): number {
    let deleted = 0;
    let merged = true;
    const thresholds = this.thresholdsFor(embeddingIndexId, polarity);

    while (merged) {
      merged = false;
      const clusters = this.options.profiles.listClusters({ embeddingIndexId, polarity });
      for (let leftIndex = 0; leftIndex < clusters.length; leftIndex += 1) {
        const left = clusters[leftIndex];
        if (!left) {
          continue;
        }
        const leftVector = fromVectorBlob(left.centroidVectorBlob);
        for (let rightIndex = leftIndex + 1; rightIndex < clusters.length; rightIndex += 1) {
          const right = clusters[rightIndex];
          if (!right) {
            continue;
          }
          const rightVector = fromVectorBlob(right.centroidVectorBlob);
          const similarity = cosineSimilarity(leftVector, rightVector);
          if (similarity < thresholds.compactThreshold) {
            continue;
          }
          if (
            !this.canMergeClusterPair({
              left,
              right,
              leftVector,
              rightVector,
              similarity,
              thresholds
            })
          ) {
            continue;
          }

          const survivor = left.weight >= right.weight ? left : right;
          const mergedAway = survivor.id === left.id ? right : left;
          const survivorVector = survivor.id === left.id ? leftVector : rightVector;
          const mergedAwayVector = survivor.id === left.id ? rightVector : leftVector;
          const totalWeight = Math.max(survivor.weight + mergedAway.weight, 1);
          const centroid = normalizeVector(
            survivorVector.map(
              (value, index) =>
                (value * survivor.weight + (mergedAwayVector[index] ?? 0) * mergedAway.weight) /
                totalWeight
            )
          );
          const now = this.now();

          this.options.profiles.updateCluster({
            id: survivor.id,
            centroidVectorBlob: toVectorBlob(centroid),
            weight: clamp(
              survivor.weight + mergedAway.weight,
              profileAlgorithmDefaults.minClusterWeight,
              profileAlgorithmDefaults.maxClusterWeight
            ),
            sampleCount: survivor.sampleCount + mergedAway.sampleCount,
            lastMatchedAt: Math.max(survivor.lastMatchedAt ?? 0, mergedAway.lastMatchedAt ?? 0) || null,
            now
          });
          this.options.profiles.moveClusterEvidence({
            fromClusterId: mergedAway.id,
            toClusterId: survivor.id
          });
          this.options.profiles.trimClusterEvidence({ clusterId: survivor.id, limit: 50 });
          if (this.options.profiles.deleteCluster(mergedAway.id)) {
            deleted += 1;
          }
          merged = true;
          break;
        }
        if (merged) {
          break;
        }
      }
    }

    return deleted;
  }

  private trimClusters(
    embeddingIndexId: string,
    polarity: InterestClusterPolarity,
    options: { protectNewClusters?: boolean } = {}
  ): number {
    const limits = this.clusterLimits();
    const max = polarity === "positive" ? limits.positive : limits.negative;
    const clusters = this.options.profiles.listClusters({ embeddingIndexId, polarity });
    let deleted = 0;

    if (clusters.length <= max) {
      return deleted;
    }

    const now = this.now();
    const deleteWeightBelow =
      polarity === "negative"
        ? profileAlgorithmDefaults.negativeDeleteWeightBelow
        : profileAlgorithmDefaults.minClusterWeight;
    const staleDays = polarity === "negative" ? 60 : 30;
    const staleLowWeight = clusters.filter((cluster) => {
      const inactiveDays = Math.floor((now - (cluster.lastMatchedAt ?? cluster.createdAt)) / 86_400_000);
      return cluster.weight < deleteWeightBelow && inactiveDays > staleDays;
    });

    for (const cluster of staleLowWeight) {
      if (clusters.length - deleted <= max) {
        return deleted;
      }
      if (this.options.profiles.deleteCluster(cluster.id)) {
        deleted += 1;
      }
    }

    const remaining = this.options.profiles.listClusters({ embeddingIndexId, polarity });
    const protectNewClusters = options.protectNewClusters ?? true;
    const deletionCandidates = protectNewClusters
      ? [
          ...remaining.filter((cluster) => !this.isProtectedNewCluster(cluster, now)).reverse(),
          ...remaining.filter((cluster) => this.isProtectedNewCluster(cluster, now)).reverse()
        ]
      : remaining.slice().reverse();
    let deletedFromRemaining = 0;

    for (const cluster of deletionCandidates) {
      if (remaining.length - deletedFromRemaining <= max) {
        break;
      }
      if (this.options.profiles.deleteCluster(cluster.id)) {
        deleted += 1;
        deletedFromRemaining += 1;
      }
    }

    return deleted;
  }

  private clusterLimits(): { positive: number; negative: number } {
    const configured = this.options.getClusterLimits?.();
    return {
      positive:
        configured?.maxPositiveInterestClusters ?? profileAlgorithmDefaults.maxPositiveClusters,
      negative:
        configured?.maxNegativeInterestClusters ?? profileAlgorithmDefaults.maxNegativeClusters
    };
  }

  private isProtectedNewCluster(cluster: InterestClusterRow, now: number): boolean {
    return now - cluster.createdAt <= NEW_CLUSTER_PROTECTION_MS && cluster.sampleCount <= 1;
  }

  private thresholdsFor(
    embeddingIndexId: string,
    polarity: InterestClusterPolarity
  ): InterestClusterPolarityThresholds {
    const calibration = this.options.getClusterCalibration?.(embeddingIndexId);
    if (calibration) {
      return calibration.thresholds[polarity];
    }
    const mergeThreshold =
      polarity === "positive"
        ? profileAlgorithmDefaults.positiveMergeThreshold
        : profileAlgorithmDefaults.negativeMergeThreshold;
    return {
      mergeThreshold,
      attachThreshold: mergeThreshold,
      pairwiseGuardThreshold: mergeThreshold,
      compactThreshold: profileAlgorithmDefaults.clusterCompactionSimilarityThreshold,
      maxClusterSamples: polarity === "positive" ? 8 : 6,
      familyCentroidThreshold: polarity === "positive" ? 0.8 : 0.84,
      familyLabelAssistedThreshold: polarity === "positive" ? 0.76 : 0.8,
      familySharedLabelThreshold: polarity === "positive" ? 0.74 : 0.78
    };
  }

  private canMergeIntoCluster(input: {
    vector: number[];
    best: NonNullable<ReturnType<typeof bestClusterMatch>>;
    thresholds: InterestClusterPolarityThresholds;
  }): boolean {
    const cluster = input.best.cluster;
    if (cluster.sampleCount >= input.thresholds.maxClusterSamples) {
      return false;
    }

    if (input.best.similarity >= input.thresholds.mergeThreshold && cluster.sampleCount <= 1) {
      return true;
    }

    const evidence = this.options.profiles.listClusterEvidenceForCluster({
      clusterId: cluster.id,
      limit: 12
    });
    const similarities = evidenceVectorSimilarities(input.vector, evidence);
    if (similarities.length === 0) {
      return input.best.similarity >= input.thresholds.mergeThreshold;
    }

    const nearest = similarities[0] ?? Number.NEGATIVE_INFINITY;
    const top3 = similarities.slice(0, 3);
    const averageTop3 =
      top3.length > 0 ? top3.reduce((sum, value) => sum + value, 0) / top3.length : 0;
    const pairwiseFloor =
      cluster.sampleCount >= 6
        ? input.thresholds.pairwiseGuardThreshold - 0.015
        : input.thresholds.pairwiseGuardThreshold - 0.035;

    return (
      nearest >= input.thresholds.pairwiseGuardThreshold &&
      averageTop3 >= pairwiseFloor &&
      input.best.similarity >= input.thresholds.mergeThreshold - 0.02
    );
  }

  private canMergeClusterPair(input: {
    left: InterestClusterRow;
    right: InterestClusterRow;
    leftVector: number[];
    rightVector: number[];
    similarity: number;
    thresholds: InterestClusterPolarityThresholds;
  }): boolean {
    if (input.left.sampleCount + input.right.sampleCount > input.thresholds.maxClusterSamples) {
      return false;
    }
    if (
      input.left.sampleCount <= 1 &&
      input.right.sampleCount <= 1 &&
      input.similarity >= input.thresholds.compactThreshold
    ) {
      return true;
    }

    const leftEvidence = this.options.profiles.listClusterEvidenceForCluster({
      clusterId: input.left.id,
      limit: 10
    });
    const rightEvidence = this.options.profiles.listClusterEvidenceForCluster({
      clusterId: input.right.id,
      limit: 10
    });
    const similarities = crossEvidenceSimilarities({
      leftVector: input.leftVector,
      rightVector: input.rightVector,
      leftEvidence,
      rightEvidence
    });
    if (similarities.length === 0) {
      return input.similarity >= input.thresholds.mergeThreshold;
    }

    const nearest = similarities[0] ?? Number.NEGATIVE_INFINITY;
    const top3 = similarities.slice(0, 3);
    const averageTop3 =
      top3.length > 0 ? top3.reduce((sum, value) => sum + value, 0) / top3.length : 0;
    return (
      nearest >= input.thresholds.pairwiseGuardThreshold &&
      averageTop3 >= input.thresholds.pairwiseGuardThreshold - 0.03 &&
      input.similarity >= input.thresholds.compactThreshold
    );
  }

  private recalculateFeedStats(feedId: string): void {
    const events = this.options.profiles.listFeedBehaviorEvents(feedId);
    let positiveScore = 0;
    let negativeScore = 0;
    let openCount = 0;
    let favoriteCount = 0;
    let notInterestedCount = 0;
    let clearSignalCount = 0;
    let clearPositive = 0;
    let clearNegative = 0;

    for (const event of events) {
      const key = sourceEventKeyFor(event);
      if (!key) {
        continue;
      }
      const weights = SOURCE_EVENT_WEIGHTS[key];
      positiveScore += weights.positive;
      negativeScore += weights.negative;
      if (weights.clear !== false && key !== "open") {
        clearSignalCount += 1;
        if (weights.positive > weights.negative) {
          clearPositive += 1;
        } else if (weights.negative > 0) {
          clearNegative += 1;
        }
      }
      if (key === "open") {
        openCount += 1;
      } else if (key === "favorite") {
        favoriteCount += 1;
      } else if (key === "not_interested") {
        notInterestedCount += 1;
      }
    }

    const confidence = clamp(clearSignalCount / FEED_STATS_CLEAR_SIGNAL_TARGET, 0, 1);
    const openScale = clearSignalCount === 0 ? FEED_STATS_OPEN_ONLY_CONFIDENCE : confidence;
    const denominator = Math.max(events.length, 1);
    const globalPositiveRate = 0.5;
    const smoothingAlpha = 8;
    const smoothedPositiveRate =
      (clearPositive + smoothingAlpha * globalPositiveRate) /
      Math.max(clearPositive + clearNegative + smoothingAlpha, 1);
    this.options.profiles.upsertFeedStats({
      feedId,
      positiveScore: positiveScore * (clearSignalCount === 0 ? openScale : confidence),
      negativeScore: negativeScore * confidence,
      openRate: (openCount / denominator) * openScale,
      favoriteRate: (favoriteCount / denominator) * confidence,
      notInterestedRate: (notInterestedCount / denominator) * confidence,
      clearPositive,
      clearNegative,
      clearSignalCount,
      smoothedPositiveRate,
      sourceConfidence: confidence,
      now: this.now()
    });
  }
}

function impactForEvent(
  event: ProfileBehaviorEventRow,
  bucket: ProfileContentSnapshot
): ProfileEventImpact {
  switch (event.eventType) {
    case "favorite":
      return { polarity: "positive", profileWeight: PROFILE_EVENT_WEIGHTS.favorite, forceCreate: true };
    case "like":
      return { polarity: "positive", profileWeight: PROFILE_EVENT_WEIGHTS.like, forceCreate: true };
    case "unlike":
      return { polarity: "negative", profileWeight: PROFILE_EVENT_WEIGHTS.unlike, forceCreate: false };
    case "read_later":
      return { polarity: "positive", profileWeight: PROFILE_EVENT_WEIGHTS.read_later, forceCreate: true };
    case "hide":
      return { polarity: "negative", profileWeight: PROFILE_EVENT_WEIGHTS.hide, forceCreate: true };
    case "not_interested":
      return { polarity: "negative", profileWeight: PROFILE_EVENT_WEIGHTS.not_interested, forceCreate: true };
    case "read_complete":
      return { polarity: "positive", profileWeight: PROFILE_EVENT_WEIGHTS.read_complete, forceCreate: true };
    case "read_progress": {
      const tier = readProgressTierFor(event);
      if (!tier || tier === "read_progress_25" || !isHigherTier(tier, bucket.readProgressTier)) {
        return { polarity: "stats_only", profileWeight: 0 };
      }

      const previousWeight = bucket.readProgressTier
        ? profileWeightForReadProgressTier(bucket.readProgressTier)
        : 0;
      const nextWeight = profileWeightForReadProgressTier(tier);
      return {
        polarity: "positive",
        profileWeight: Math.max(0, nextWeight - previousWeight),
        forceCreate: tier === "read_progress_75"
      };
    }
    default:
      return { polarity: "stats_only", profileWeight: 0 };
  }
}

function newClusterWeightFor(eventWeight: number, polarity: InterestClusterPolarity): number {
  const multiplier = polarity === "positive" ? 0.7 : 0.85;
  return eventWeight * multiplier;
}

function sourceEventKeyFor(
  event: Pick<
    ProfileBehaviorEventRow,
    | "eventType"
    | "eventWeight"
    | "metadataJson"
    | "readingProgress"
    | "title"
    | "summary"
    | "contentText"
  >
): SourceEventKey | null {
  if (event.eventType === "impression") {
    return event.eventWeight < 0 ? "impression" : null;
  }

  if (event.eventType === "read_progress") {
    if (isQuickBounce(event)) {
      return "quick_bounce";
    }
    return readProgressTierFor(event) === "read_complete" ? "read_complete" : null;
  }

  return event.eventType in SOURCE_EVENT_WEIGHTS
    ? (event.eventType as SourceEventKey)
    : null;
}

function readProgressTierFor(
  event: Pick<
    ProfileBehaviorEventRow,
    "metadataJson" | "readingProgress" | "title" | "summary" | "contentText"
  >
): ReadProgressTier | null {
  const progress = progressFromMetadata(event.metadataJson) ?? event.readingProgress;
  if (isReadComplete(event, progress)) {
    return "read_complete";
  }
  if (progress >= 0.75) {
    return "read_progress_75";
  }
  if (progress >= 0.5) {
    return "read_progress_50";
  }
  if (progress >= 0.25) {
    return "read_progress_25";
  }
  return null;
}

function isReadComplete(
  event: Pick<
    ProfileBehaviorEventRow,
    "metadataJson" | "title" | "summary" | "contentText"
  >,
  progress: number
): boolean {
  if (progress >= profileAlgorithmDefaults.readCompleteProgressThreshold) {
    return true;
  }

  const activeDurationMs = activeDurationMsFromMetadata(event.metadataJson);
  if (
    progress < profileAlgorithmDefaults.readCompleteActiveProgressThreshold ||
    activeDurationMs === null
  ) {
    return false;
  }

  return activeDurationMs >= readCompleteActiveDurationThresholdMs(event);
}

function readCompleteActiveDurationThresholdMs(
  event: Pick<ProfileBehaviorEventRow, "title" | "summary" | "contentText">
): number {
  return Math.min(
    profileAlgorithmDefaults.readCompleteActiveDurationMs,
    estimateReadTimeMs(event) * 0.5
  );
}

function estimateReadTimeMs(
  event: Pick<ProfileBehaviorEventRow, "title" | "summary" | "contentText">
): number {
  const text = [event.title, event.summary, event.contentText].filter(Boolean).join(" ");
  const units = text.length > 0 ? text.trim().split(/\s+/u).length : 1;
  const estimated = (units / profileAlgorithmDefaults.estimatedReadingUnitsPerMinute) * 60_000;
  return clamp(
    estimated,
    profileAlgorithmDefaults.minEstimatedReadTimeMs,
    profileAlgorithmDefaults.maxEstimatedReadTimeMs
  );
}

function isQuickBounce(
  event: Pick<ProfileBehaviorEventRow, "metadataJson" | "readingProgress">
): boolean {
  const progress = progressFromMetadata(event.metadataJson) ?? event.readingProgress;
  const activeDurationMs = activeDurationMsFromMetadata(event.metadataJson);
  return (
    activeDurationMs !== null &&
    activeDurationMs <= profileAlgorithmDefaults.quickBounceDurationMs &&
    progress <= profileAlgorithmDefaults.quickBounceProgressThreshold
  );
}

function profileWeightForReadProgressTier(tier: ReadProgressTier): number {
  return PROFILE_EVENT_WEIGHTS[tier];
}

function isHigherTier(next: ReadProgressTier, current: ReadProgressTier | undefined): boolean {
  return !current || READ_PROGRESS_TIER_ORDER[next] > READ_PROGRESS_TIER_ORDER[current];
}

function progressFromMetadata(metadataJson: string | null): number | null {
  if (!metadataJson) {
    return null;
  }

  try {
    const metadata = JSON.parse(metadataJson) as unknown;
    const progress =
      typeof metadata === "object" && metadata !== null && !Array.isArray(metadata)
        ? (metadata as { progress?: unknown }).progress
        : undefined;
    return typeof progress === "number" && Number.isFinite(progress) ? progress : null;
  } catch {
    return null;
  }
}

function activeDurationMsFromMetadata(metadataJson: string | null): number | null {
  if (!metadataJson) {
    return null;
  }

  try {
    const metadata = JSON.parse(metadataJson) as unknown;
    const activeDurationMs =
      typeof metadata === "object" && metadata !== null && !Array.isArray(metadata)
        ? (metadata as { activeDurationMs?: unknown }).activeDurationMs
        : undefined;
    return typeof activeDurationMs === "number" && Number.isFinite(activeDurationMs)
      ? activeDurationMs
      : null;
  } catch {
    return null;
  }
}

function decayRateFor(polarity: InterestClusterPolarity, inactiveDays: number): number {
  if (polarity === "negative") {
    return inactiveDays <= profileAlgorithmDefaults.inactiveAfterDays
      ? profileAlgorithmDefaults.negativeDailyDecayRate
      : profileAlgorithmDefaults.negativeInactiveDecayRate;
  }

  return inactiveDays <= profileAlgorithmDefaults.inactiveAfterDays
    ? profileAlgorithmDefaults.dailyDecayRate
    : profileAlgorithmDefaults.inactiveDecayRate;
}

function parseSnapshot(value: string | null): ProfileSnapshot {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as ProfileSnapshot)
      : {};
  } catch {
    return {};
  }
}

function snapshotBucket(
  snapshot: ProfileSnapshot,
  embeddingIndexId: string,
  contentHash: string
): ProfileContentSnapshot {
  snapshot.profileV0 ??= {};
  snapshot.profileV0[embeddingIndexId] ??= {};
  snapshot.profileV0[embeddingIndexId][contentHash] ??= {};
  return snapshot.profileV0[embeddingIndexId][contentHash];
}

function snapshotHasProcessedEvent(
  snapshot: ProfileSnapshot,
  embeddingIndexId: string,
  eventId: string
): boolean {
  const indexSnapshot = snapshot.profileV0?.[embeddingIndexId];
  if (!indexSnapshot) {
    return false;
  }

  return Object.values(indexSnapshot).some((bucket) =>
    bucket.processedEventIds?.includes(eventId)
  );
}

function bestClusterMatch(vector: number[], clusters: InterestClusterRow[]) {
  let best:
    | {
        cluster: InterestClusterRow;
        centroid: number[];
        similarity: number;
      }
    | null = null;

  for (const cluster of clusters) {
    const centroid = fromVectorBlob(cluster.centroidVectorBlob);
    const similarity = cosineSimilarity(vector, centroid);
    if (!best || similarity > best.similarity) {
      best = { cluster, centroid, similarity };
    }
  }

  return best;
}

function emptyResult(): ProfileUpdateResult {
  return {
    articleIds: [],
    feedStatsChanged: false,
    profileChanged: false
  };
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function randomClusterId(): string {
  return `cluster_${randomBytes(10).toString("hex")}`;
}

function evidenceVectorSimilarities(
  vector: number[],
  evidence: InterestClusterEvidenceRow[]
): number[] {
  return evidence
    .map((row) => fromVectorBlob(row.vectorBlob))
    .filter((evidenceVector) => evidenceVector.length === vector.length)
    .map((evidenceVector) => cosineSimilarity(vector, evidenceVector))
    .filter((similarity) => Number.isFinite(similarity))
    .sort((left, right) => right - left);
}

function crossEvidenceSimilarities(input: {
  leftVector: number[];
  rightVector: number[];
  leftEvidence: InterestClusterEvidenceRow[];
  rightEvidence: InterestClusterEvidenceRow[];
}): number[] {
  const leftVectors = evidenceVectors(input.leftEvidence, input.leftVector);
  const rightVectors = evidenceVectors(input.rightEvidence, input.rightVector);
  const similarities: number[] = [];
  for (const left of leftVectors) {
    for (const right of rightVectors) {
      if (left.length === right.length) {
        similarities.push(cosineSimilarity(left, right));
      }
    }
  }
  return similarities
    .filter((similarity) => Number.isFinite(similarity))
    .sort((left, right) => right - left);
}

function evidenceVectors(
  evidence: InterestClusterEvidenceRow[],
  fallback: number[]
): number[][] {
  const vectors = evidence
    .map((row) => fromVectorBlob(row.vectorBlob))
    .filter((vector) => vector.length === fallback.length);
  return vectors.length > 0 ? vectors : [fallback];
}
