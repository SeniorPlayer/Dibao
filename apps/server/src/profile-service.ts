import { randomBytes } from "node:crypto";
import {
  fromVectorBlob,
  toVectorBlob,
  type EmbeddingRepository,
  type InterestClusterPolarity,
  type InterestClusterRow,
  type ProfileBehaviorEventRow,
  type ProfileRepository
} from "@dibao/db";
import {
  clamp,
  cosineSimilarity,
  mergeCentroid,
  profileAlgorithmDefaults
} from "@dibao/ranking";

type ProfileEventPolarity = InterestClusterPolarity | "stats_only";

type ProfileEventImpact = {
  polarity: ProfileEventPolarity;
  profileWeight: number;
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

export type ProfileServiceOptions = {
  embeddings: Pick<EmbeddingRepository, "findActiveProviderWithIndex">;
  profiles: ProfileRepository;
  now?: () => number;
  clusterIdFactory?: () => string;
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
  impression: 0.05,
  open: 0.8,
  read_progress_25: 1.2,
  read_progress_50: 2,
  read_progress_75: 3,
  read_complete: 4,
  favorite: 6,
  read_later: 3,
  mark_read: 1,
  quick_bounce: -1.2,
  hide: -3.5,
  not_interested: -6,
  unfavorite: -1.5,
  remove_read_later: -1,
  mark_unread: -0.5
} as const;

const SOURCE_EVENT_WEIGHTS = {
  open: { positive: 0.3, negative: 0 },
  read_complete: { positive: 1, negative: 0 },
  favorite: { positive: 2, negative: 0 },
  read_later: { positive: 1, negative: 0 },
  quick_bounce: { positive: 0, negative: 0.5 },
  hide: { positive: 0, negative: 1.5 },
  not_interested: { positive: 0, negative: 2.5 }
} as const;

export class ProfileService {
  private readonly now: () => number;
  private readonly clusterIdFactory: () => string;

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

  decayClusters(): ProfileDecayResult {
    const now = this.now();
    let clustersUpdated = 0;
    let clustersDeleted = 0;

    for (const cluster of this.options.profiles.listClusters()) {
      const lastMatchedAt = cluster.lastMatchedAt ?? cluster.createdAt;
      const inactiveDays = Math.max(1, Math.floor((now - lastMatchedAt) / 86_400_000));
      const rate =
        inactiveDays <= profileAlgorithmDefaults.inactiveAfterDays
          ? profileAlgorithmDefaults.dailyDecayRate
          : profileAlgorithmDefaults.inactiveDecayRate;
      const weight = cluster.weight * Math.pow(rate, inactiveDays);

      if (
        weight < profileAlgorithmDefaults.deleteWeightBelow ||
        (cluster.sampleCount <= 1 &&
          inactiveDays > profileAlgorithmDefaults.deleteSingleSampleInactiveDays)
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

    return { clustersUpdated, clustersDeleted };
  }

  private processProfileEvent(event: ProfileBehaviorEventRow): boolean {
    if (!event.embeddingIndexId || !event.embeddingContentHash || !event.vectorBlob) {
      return false;
    }

    const snapshot = parseSnapshot(this.options.profiles.getTopicSnapshot(event.articleId));
    const bucket = snapshotBucket(snapshot, event.embeddingIndexId, event.embeddingContentHash);

    if (bucket.processedEventIds?.includes(event.id)) {
      return false;
    }

    const staleForCurrentContent = event.createdAt < event.articleUpdatedAt;
    const impact = staleForCurrentContent
      ? { polarity: "stats_only" as const, profileWeight: 0 }
      : impactForEvent(event, bucket);

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

    this.applyClusterImpact(event, impact.polarity, Math.abs(impact.profileWeight));
    return true;
  }

  private applyClusterImpact(
    event: ProfileBehaviorEventRow,
    polarity: InterestClusterPolarity,
    eventWeight: number
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
    const thresholds = thresholdsFor(polarity);
    const now = this.now();

    if (!best) {
      this.createCluster(event.embeddingIndexId, polarity, vector, eventWeight, now);
      this.trimClusters(event.embeddingIndexId, polarity);
      return;
    }

    if (best.similarity >= thresholds.merge) {
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
      this.trimClusters(event.embeddingIndexId, polarity);
      return;
    }

    if (best.similarity >= thresholds.create) {
      this.createCluster(event.embeddingIndexId, polarity, vector, eventWeight, now);
      this.trimClusters(event.embeddingIndexId, polarity);
    }
  }

  private createCluster(
    embeddingIndexId: string,
    polarity: InterestClusterPolarity,
    vector: number[],
    eventWeight: number,
    now: number
  ): void {
    this.options.profiles.upsertCluster({
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

  private trimClusters(embeddingIndexId: string, polarity: InterestClusterPolarity): void {
    const max =
      polarity === "positive"
        ? profileAlgorithmDefaults.maxPositiveClusters
        : profileAlgorithmDefaults.maxNegativeClusters;
    const clusters = this.options.profiles.listClusters({ embeddingIndexId, polarity });

    for (const cluster of clusters.slice(max)) {
      this.options.profiles.deleteCluster(cluster.id);
    }
  }

  private recalculateFeedStats(feedId: string): void {
    const events = this.options.profiles.listFeedBehaviorEvents(feedId);
    let positiveScore = 0;
    let negativeScore = 0;
    let openCount = 0;
    let favoriteCount = 0;
    let notInterestedCount = 0;

    for (const event of events) {
      const key = sourceEventKeyFor(event);
      if (!key) {
        continue;
      }
      const weights = SOURCE_EVENT_WEIGHTS[key];
      positiveScore += weights.positive;
      negativeScore += weights.negative;
      if (key === "open") {
        openCount += 1;
      } else if (key === "favorite") {
        favoriteCount += 1;
      } else if (key === "not_interested") {
        notInterestedCount += 1;
      }
    }

    const denominator = Math.max(events.length, 1);
    this.options.profiles.upsertFeedStats({
      feedId,
      positiveScore,
      negativeScore,
      openRate: openCount / denominator,
      favoriteRate: favoriteCount / denominator,
      notInterestedRate: notInterestedCount / denominator,
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
      return { polarity: "positive", profileWeight: PROFILE_EVENT_WEIGHTS.favorite };
    case "read_later":
      return { polarity: "positive", profileWeight: PROFILE_EVENT_WEIGHTS.read_later };
    case "hide":
      return { polarity: "negative", profileWeight: PROFILE_EVENT_WEIGHTS.hide };
    case "not_interested":
      return { polarity: "negative", profileWeight: PROFILE_EVENT_WEIGHTS.not_interested };
    case "read_complete":
      return { polarity: "positive", profileWeight: PROFILE_EVENT_WEIGHTS.read_complete };
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
        profileWeight: Math.max(0, nextWeight - previousWeight)
      };
    }
    default:
      return { polarity: "stats_only", profileWeight: 0 };
  }
}

function sourceEventKeyFor(
  event: Pick<ProfileBehaviorEventRow, "eventType" | "metadataJson" | "readingProgress">
): keyof typeof SOURCE_EVENT_WEIGHTS | null {
  if (event.eventType === "read_progress") {
    return readProgressTierFor(event) === "read_complete" ? "read_complete" : null;
  }

  return event.eventType in SOURCE_EVENT_WEIGHTS
    ? (event.eventType as keyof typeof SOURCE_EVENT_WEIGHTS)
    : null;
}

function readProgressTierFor(
  event: Pick<ProfileBehaviorEventRow, "metadataJson" | "readingProgress">
): ReadProgressTier | null {
  const progress = progressFromMetadata(event.metadataJson) ?? event.readingProgress;
  if (progress >= 0.9) {
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

function thresholdsFor(polarity: InterestClusterPolarity) {
  return polarity === "positive"
    ? {
        merge: profileAlgorithmDefaults.positiveMergeThreshold,
        create: profileAlgorithmDefaults.positiveCreateThreshold
      }
    : {
        merge: profileAlgorithmDefaults.negativeMergeThreshold,
        create: profileAlgorithmDefaults.negativeCreateThreshold
      };
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
