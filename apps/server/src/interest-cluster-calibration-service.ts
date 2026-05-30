import {
  fromVectorBlob,
  type DibaoDatabase,
  type InterestClusterPolarity
} from "@dibao/db";
import { clamp, cosineSimilarity, profileAlgorithmDefaults } from "@dibao/ranking";

export const INTEREST_CLUSTER_CALIBRATION_ALGORITHM_VERSION =
  "interest_profile_calibration_v2" as const;

export type InterestClusterCalibrationConfidence = "low" | "medium" | "high";

export type InterestClusterPolarityThresholds = {
  mergeThreshold: number;
  attachThreshold: number;
  pairwiseGuardThreshold: number;
  compactThreshold: number;
  maxClusterSamples: number;
  familyCentroidThreshold: number;
  familyLabelAssistedThreshold: number;
  familySharedLabelThreshold: number;
};

export type InterestClusterCalibration = {
  embeddingIndexId: string;
  algorithmVersion: typeof INTEREST_CLUSTER_CALIBRATION_ALGORITHM_VERSION;
  providerType: string | null;
  providerModel: string | null;
  embeddingDimension: number | null;
  confidence: InterestClusterCalibrationConfidence;
  positiveSampleCount: number;
  negativeSampleCount: number;
  backgroundSampleCount: number;
  thresholds: Record<InterestClusterPolarity, InterestClusterPolarityThresholds>;
  percentiles: InterestClusterCalibrationPercentiles;
  diagnostics: {
    fallbackPositive: boolean;
    fallbackNegative: boolean;
  };
  createdAt: number;
  updatedAt: number;
};

type InterestClusterCalibrationPercentiles = {
  background: PercentileSummary;
  positiveNearestNeighbor: PercentileSummary;
  negativeNearestNeighbor: PercentileSummary;
};

type PercentileSummary = {
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
};

type CalibrationDbRow = {
  embeddingIndexId: string;
  algorithmVersion: string;
  providerType: string | null;
  providerModel: string | null;
  embeddingDimension: number | null;
  confidence: InterestClusterCalibrationConfidence;
  positiveSampleCount: number;
  negativeSampleCount: number;
  backgroundSampleCount: number;
  thresholdsJson: string;
  percentilesJson: string;
  diagnosticsJson: string | null;
  createdAt: number;
  updatedAt: number;
};

type EmbeddingIndexCalibrationContext = {
  embeddingIndexId: string;
  providerType: string | null;
  providerModel: string | null;
  embeddingDimension: number | null;
};

const MIN_SIGNAL_SAMPLE_COUNT = 12;
const MEDIUM_SIGNAL_SAMPLE_COUNT = 24;
const HIGH_SIGNAL_SAMPLE_COUNT = 80;
const BACKGROUND_SAMPLE_LIMIT = 260;
const SIGNAL_SAMPLE_LIMIT = 520;

export type InterestClusterCalibrationServiceOptions = {
  db: DibaoDatabase;
  now?: () => number;
};

export class InterestClusterCalibrationService {
  private readonly now: () => number;
  private readonly cache = new Map<string, InterestClusterCalibration>();

  constructor(private readonly options: InterestClusterCalibrationServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  getOrCreateCalibration(embeddingIndexId: string): InterestClusterCalibration {
    const context = this.embeddingIndexContext(embeddingIndexId);
    const cached = this.cache.get(embeddingIndexId);
    if (cached && calibrationMatchesContext(cached, context)) {
      return cached;
    }

    const stored = this.readCalibration(embeddingIndexId, context);
    if (stored) {
      this.cache.set(embeddingIndexId, stored);
      return stored;
    }

    const calibration = this.computeCalibration(embeddingIndexId, context);
    this.writeCalibration(calibration);
    this.cache.set(embeddingIndexId, calibration);
    return calibration;
  }

  refreshCalibration(embeddingIndexId: string): InterestClusterCalibration {
    const calibration = this.computeCalibration(embeddingIndexId);
    this.writeCalibration(calibration);
    this.cache.set(embeddingIndexId, calibration);
    return calibration;
  }

  private readCalibration(
    embeddingIndexId: string,
    context: EmbeddingIndexCalibrationContext
  ): InterestClusterCalibration | null {
    const row = this.options.db
      .prepare(
        `
          select
            embedding_index_id as embeddingIndexId,
            algorithm_version as algorithmVersion,
            provider_type as providerType,
            provider_model as providerModel,
            embedding_dimension as embeddingDimension,
            confidence,
            positive_sample_count as positiveSampleCount,
            negative_sample_count as negativeSampleCount,
            background_sample_count as backgroundSampleCount,
            thresholds_json as thresholdsJson,
            percentiles_json as percentilesJson,
            diagnostics_json as diagnosticsJson,
            created_at as createdAt,
            updated_at as updatedAt
          from interest_cluster_calibrations
          where embedding_index_id = ?
        `
      )
      .get(embeddingIndexId) as CalibrationDbRow | undefined;

    if (!row || row.algorithmVersion !== INTEREST_CLUSTER_CALIBRATION_ALGORITHM_VERSION) {
      return null;
    }

    const parsed = parseStoredCalibration(row);
    if (!parsed || !calibrationMatchesContext(parsed, context)) {
      return null;
    }
    return parsed;
  }

  private computeCalibration(
    embeddingIndexId: string,
    context = this.embeddingIndexContext(embeddingIndexId)
  ): InterestClusterCalibration {
    const backgroundVectors = this.listBackgroundVectors(embeddingIndexId);
    const positiveVectors = this.listSignalVectors(embeddingIndexId, "positive");
    const negativeVectors = this.listSignalVectors(embeddingIndexId, "negative");
    const backgroundPercentiles = percentileSummary(pairSimilarities(backgroundVectors));
    const positiveNearestNeighbor = percentileSummary(nearestNeighborSimilarities(positiveVectors));
    const negativeNearestNeighbor = percentileSummary(nearestNeighborSimilarities(negativeVectors));
    const fallbackPositive = positiveVectors.length < MIN_SIGNAL_SAMPLE_COUNT;
    const fallbackNegative = negativeVectors.length < MIN_SIGNAL_SAMPLE_COUNT;
    const backgroundP95 = backgroundPercentiles.p95 ?? 0.62;
    const now = this.now();

    const positive = fallbackPositive
      ? fallbackThresholds("positive")
      : calibratedThresholds({
          polarity: "positive",
          sampleCount: positiveVectors.length,
          nearestNeighbor: positiveNearestNeighbor,
          backgroundP95
        });
    const negative = fallbackNegative
      ? fallbackThresholds("negative")
      : calibratedThresholds({
          polarity: "negative",
          sampleCount: negativeVectors.length,
          nearestNeighbor: negativeNearestNeighbor,
          backgroundP95
        });

    return {
      embeddingIndexId,
      algorithmVersion: INTEREST_CLUSTER_CALIBRATION_ALGORITHM_VERSION,
      providerType: context.providerType,
      providerModel: context.providerModel,
      embeddingDimension: context.embeddingDimension,
      confidence: calibrationConfidence({
        positiveSampleCount: positiveVectors.length,
        negativeSampleCount: negativeVectors.length,
        backgroundSampleCount: backgroundVectors.length
      }),
      positiveSampleCount: positiveVectors.length,
      negativeSampleCount: negativeVectors.length,
      backgroundSampleCount: backgroundVectors.length,
      thresholds: {
        positive,
        negative
      },
      percentiles: {
        background: backgroundPercentiles,
        positiveNearestNeighbor,
        negativeNearestNeighbor
      },
      diagnostics: {
        fallbackPositive,
        fallbackNegative
      },
      createdAt: now,
      updatedAt: now
    };
  }

  private writeCalibration(calibration: InterestClusterCalibration): void {
    this.options.db
      .prepare(
        `
          insert into interest_cluster_calibrations (
            embedding_index_id,
            algorithm_version,
            provider_type,
            provider_model,
            embedding_dimension,
            confidence,
            positive_sample_count,
            negative_sample_count,
            background_sample_count,
            thresholds_json,
            percentiles_json,
            diagnostics_json,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          on conflict(embedding_index_id) do update set
            algorithm_version = excluded.algorithm_version,
            provider_type = excluded.provider_type,
            provider_model = excluded.provider_model,
            embedding_dimension = excluded.embedding_dimension,
            confidence = excluded.confidence,
            positive_sample_count = excluded.positive_sample_count,
            negative_sample_count = excluded.negative_sample_count,
            background_sample_count = excluded.background_sample_count,
            thresholds_json = excluded.thresholds_json,
            percentiles_json = excluded.percentiles_json,
            diagnostics_json = excluded.diagnostics_json,
            updated_at = excluded.updated_at
        `
      )
      .run(
        calibration.embeddingIndexId,
        calibration.algorithmVersion,
        calibration.providerType,
        calibration.providerModel,
        calibration.embeddingDimension,
        calibration.confidence,
        calibration.positiveSampleCount,
        calibration.negativeSampleCount,
        calibration.backgroundSampleCount,
        JSON.stringify(calibration.thresholds),
        JSON.stringify(calibration.percentiles),
        JSON.stringify(calibration.diagnostics),
        calibration.createdAt,
        calibration.updatedAt
      );
  }

  private embeddingIndexContext(embeddingIndexId: string): EmbeddingIndexCalibrationContext {
    const row = this.options.db
      .prepare(
        `
          select
            ei.id as embeddingIndexId,
            ep.type as providerType,
            coalesce(ei.model, ep.model) as providerModel,
            ei.dimension as embeddingDimension
          from embedding_indexes ei
          left join embedding_providers ep on ep.id = ei.provider_id
          where ei.id = ?
        `
      )
      .get(embeddingIndexId) as EmbeddingIndexCalibrationContext | undefined;
    return row ?? {
      embeddingIndexId,
      providerType: null,
      providerModel: null,
      embeddingDimension: null
    };
  }

  private listBackgroundVectors(embeddingIndexId: string): number[][] {
    const rows = this.options.db
      .prepare(
        `
          select ae.vector_blob as vectorBlob
          from article_embeddings ae
          join articles a on a.id = ae.article_id
          join feeds f on f.id = a.feed_id
          where ae.embedding_index_id = ?
            and ae.vector_blob is not null
            and ae.content_hash = coalesce(a.content_hash, a.id || ':' || a.updated_at)
            and a.deleted_at is null
            and a.status != 'deleted'
            and f.deleted_at is null
            and f.enabled = 1
          order by a.discovered_at desc, a.id
          limit ?
        `
      )
      .all(embeddingIndexId, BACKGROUND_SAMPLE_LIMIT) as Array<{ vectorBlob: Buffer }>;
    return rows.map((row) => fromVectorBlob(row.vectorBlob));
  }

  private listSignalVectors(
    embeddingIndexId: string,
    polarity: InterestClusterPolarity
  ): number[][] {
    const signalPredicate =
      polarity === "positive"
        ? `
          be.event_type in ('favorite', 'like', 'read_later', 'read_complete')
          or (
            be.event_type = 'read_progress'
            and coalesce(
              case
                when be.metadata_json is not null and json_valid(be.metadata_json)
                then json_extract(be.metadata_json, '$.progress')
              end,
              s.reading_progress,
              0
            ) >= 0.5
          )
        `
        : "be.event_type in ('hide', 'not_interested')";
    const rows = this.options.db
      .prepare(
        `
          select ae.vector_blob as vectorBlob
          from article_embeddings ae
          join articles a on a.id = ae.article_id
          join feeds f on f.id = a.feed_id
          left join article_states s on s.article_id = a.id
          where ae.embedding_index_id = ?
            and ae.vector_blob is not null
            and ae.content_hash = coalesce(a.content_hash, a.id || ':' || a.updated_at)
            and a.deleted_at is null
            and a.status != 'deleted'
            and f.deleted_at is null
            and f.enabled = 1
            and exists (
              select 1
              from behavior_events be
              where be.article_id = a.id
                and (${signalPredicate})
            )
          order by a.id
          limit ?
        `
      )
      .all(embeddingIndexId, SIGNAL_SAMPLE_LIMIT) as Array<{ vectorBlob: Buffer }>;
    return rows.map((row) => fromVectorBlob(row.vectorBlob));
  }
}

function calibratedThresholds(input: {
  polarity: InterestClusterPolarity;
  sampleCount: number;
  nearestNeighbor: PercentileSummary;
  backgroundP95: number;
}): InterestClusterPolarityThresholds {
  const nnP50 = input.nearestNeighbor.p50 ?? (input.polarity === "positive" ? 0.74 : 0.78);
  const nnP25 = input.nearestNeighbor.p25 ?? (input.polarity === "positive" ? 0.68 : 0.72);
  const conservativeOffset = input.polarity === "positive" ? 0.1 : 0.065;
  const thresholdFloor = input.polarity === "positive" ? 0.7 : 0.66;
  const thresholdCeiling = input.polarity === "positive" ? 0.8 : 0.82;
  const mergeThreshold = roundMetric(
    clamp(
      Math.max(input.backgroundP95 + conservativeOffset, nnP50 + 0.01, nnP25 + 0.05),
      thresholdFloor,
      thresholdCeiling
    )
  );
  const attachThreshold = roundMetric(
    clamp(
      mergeThreshold - 0.035,
      Math.max(thresholdFloor - 0.035, input.backgroundP95 + conservativeOffset - 0.025),
      mergeThreshold
    )
  );
  const pairwiseGuardThreshold = roundMetric(
    clamp(
      Math.max(input.backgroundP95 + conservativeOffset - 0.02, attachThreshold),
      thresholdFloor - 0.02,
      mergeThreshold
    )
  );
  const compactThreshold = roundMetric(
    clamp(Math.max(mergeThreshold, pairwiseGuardThreshold + 0.015), thresholdFloor, 0.86)
  );
  const familyCentroidThreshold = roundMetric(
    clamp(
      Math.max(input.backgroundP95 + conservativeOffset + 0.04, mergeThreshold + 0.035),
      input.polarity === "positive" ? 0.77 : 0.76,
      input.polarity === "positive" ? 0.86 : 0.88
    )
  );
  const familyLabelAssistedThreshold = roundMetric(
    clamp(
      Math.max(familyCentroidThreshold - 0.045, input.backgroundP95 + conservativeOffset),
      thresholdFloor,
      familyCentroidThreshold
    )
  );
  const familySharedLabelThreshold = roundMetric(
    clamp(
      Math.max(familyCentroidThreshold - 0.065, input.backgroundP95 + conservativeOffset - 0.005),
      thresholdFloor - 0.015,
      familyCentroidThreshold
    )
  );
  const defaultClusterLimit =
    input.polarity === "positive"
      ? profileAlgorithmDefaults.maxPositiveClusters
      : profileAlgorithmDefaults.maxNegativeClusters;
  const sampleMultiplier = input.polarity === "positive" ? 4 : 3.5;
  const maxClusterSamples = Math.max(
    input.polarity === "positive" ? 6 : 4,
    Math.min(18, Math.ceil((input.sampleCount / defaultClusterLimit) * sampleMultiplier))
  );

  return {
    mergeThreshold,
    attachThreshold,
    pairwiseGuardThreshold,
    compactThreshold,
    maxClusterSamples,
    familyCentroidThreshold,
    familyLabelAssistedThreshold,
    familySharedLabelThreshold
  };
}

function fallbackThresholds(
  polarity: InterestClusterPolarity
): InterestClusterPolarityThresholds {
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

function calibrationMatchesContext(
  calibration: Pick<
    InterestClusterCalibration,
    "providerType" | "providerModel" | "embeddingDimension"
  >,
  context: EmbeddingIndexCalibrationContext
): boolean {
  return (
    calibration.providerType === context.providerType &&
    calibration.providerModel === context.providerModel &&
    calibration.embeddingDimension === context.embeddingDimension
  );
}

function calibrationConfidence(input: {
  positiveSampleCount: number;
  negativeSampleCount: number;
  backgroundSampleCount: number;
}): InterestClusterCalibrationConfidence {
  const signalCount = input.positiveSampleCount + input.negativeSampleCount;
  if (
    signalCount >= HIGH_SIGNAL_SAMPLE_COUNT &&
    input.backgroundSampleCount >= 120 &&
    input.positiveSampleCount >= MEDIUM_SIGNAL_SAMPLE_COUNT
  ) {
    return "high";
  }
  if (signalCount >= MEDIUM_SIGNAL_SAMPLE_COUNT && input.backgroundSampleCount >= 60) {
    return "medium";
  }
  return "low";
}

function nearestNeighborSimilarities(vectors: number[][]): number[] {
  const similarities: number[] = [];
  for (let left = 0; left < vectors.length; left += 1) {
    let nearest = Number.NEGATIVE_INFINITY;
    for (let right = 0; right < vectors.length; right += 1) {
      if (left === right) {
        continue;
      }
      const similarity = cosineSimilarity(vectors[left]!, vectors[right]!);
      if (similarity > nearest) {
        nearest = similarity;
      }
    }
    if (Number.isFinite(nearest)) {
      similarities.push(nearest);
    }
  }
  return similarities;
}

function pairSimilarities(vectors: number[][]): number[] {
  const similarities: number[] = [];
  for (let left = 0; left < vectors.length; left += 1) {
    for (let right = left + 1; right < vectors.length; right += 1) {
      similarities.push(cosineSimilarity(vectors[left]!, vectors[right]!));
    }
  }
  return similarities;
}

function percentileSummary(values: number[]): PercentileSummary {
  if (values.length === 0) {
    return {
      p25: null,
      p50: null,
      p75: null,
      p90: null,
      p95: null,
      p99: null
    };
  }
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  return {
    p25: percentile(sorted, 0.25),
    p50: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99)
  };
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) {
    return null;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return roundMetric(sorted[index]!);
}

function parseStoredCalibration(row: CalibrationDbRow): InterestClusterCalibration | null {
  try {
    const thresholds = JSON.parse(row.thresholdsJson) as InterestClusterCalibration["thresholds"];
    const percentiles = JSON.parse(row.percentilesJson) as InterestClusterCalibrationPercentiles;
    const diagnostics = parseDiagnostics(row.diagnosticsJson);
    if (!isThresholds(thresholds)) {
      return null;
    }
    return {
      embeddingIndexId: row.embeddingIndexId,
      algorithmVersion: INTEREST_CLUSTER_CALIBRATION_ALGORITHM_VERSION,
      providerType: row.providerType,
      providerModel: row.providerModel,
      embeddingDimension: row.embeddingDimension,
      confidence: row.confidence,
      positiveSampleCount: row.positiveSampleCount,
      negativeSampleCount: row.negativeSampleCount,
      backgroundSampleCount: row.backgroundSampleCount,
      thresholds,
      percentiles,
      diagnostics,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  } catch {
    return null;
  }
}

function parseDiagnostics(value: string | null): InterestClusterCalibration["diagnostics"] {
  if (!value) {
    return { fallbackPositive: false, fallbackNegative: false };
  }
  try {
    const parsed = JSON.parse(value) as Partial<InterestClusterCalibration["diagnostics"]>;
    return {
      fallbackPositive: parsed.fallbackPositive === true,
      fallbackNegative: parsed.fallbackNegative === true
    };
  } catch {
    return { fallbackPositive: false, fallbackNegative: false };
  }
}

function isThresholds(value: unknown): value is InterestClusterCalibration["thresholds"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const input = value as Record<string, unknown>;
  return isPolarityThresholds(input.positive) && isPolarityThresholds(input.negative);
}

function isPolarityThresholds(value: unknown): value is InterestClusterPolarityThresholds {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const input = value as Record<string, unknown>;
  return [
    "mergeThreshold",
    "attachThreshold",
    "pairwiseGuardThreshold",
    "compactThreshold",
    "maxClusterSamples",
    "familyCentroidThreshold",
    "familyLabelAssistedThreshold",
    "familySharedLabelThreshold"
  ].every((key) => typeof input[key] === "number" && Number.isFinite(input[key]));
}

function roundMetric(value: number): number {
  return Number(value.toFixed(4));
}
