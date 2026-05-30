import { createHash } from "node:crypto";
import {
  fromVectorBlob,
  toVectorBlob,
  type DibaoDatabase,
  type InterestClusterPolarity,
  type InterestClusterRow,
  type InterestFamilyRow
} from "@dibao/db";
import { clamp, cosineSimilarity, normalizeVector } from "@dibao/ranking";
import type {
  InterestClusterCalibration,
  InterestClusterPolarityThresholds
} from "./interest-cluster-calibration-service.js";

export const INTEREST_FAMILY_REBUILD_JOB_TYPE = "interest_family_rebuild" as const;

const POSITIVE_CENTROID_THRESHOLD = 0.76;
const NEGATIVE_CENTROID_THRESHOLD = 0.82;
const LABEL_ASSISTED_CENTROID_THRESHOLD = 0.68;
const SHARED_LABEL_CENTROID_THRESHOLD = 0.64;
const MAX_CLUSTERS_PER_POLARITY = 256;
const DEFAULT_POSITIVE_FAMILY_LIMIT = 16;
const DEFAULT_NEGATIVE_FAMILY_LIMIT = 12;

type ClusterFamilyDbRow = InterestClusterRow;

type ClusterLabelRow = {
  clusterId: string;
  autoLabel: string | null;
  manualLabel: string | null;
  labelTermsJson: string | null;
  representativeArticlesJson: string | null;
  feedTitlesJson: string | null;
};

type ClusterEvidenceSummary = {
  articleIds: Set<string>;
  feedKeys: Set<string>;
  eventCount: number;
  strongSignalCount: number;
  sourceCounts: Map<string, number>;
};

type FamilyDraft = {
  id: string;
  polarity: InterestClusterPolarity;
  clusters: ClusterFamilyDbRow[];
  vectorSum: number[];
  vectorWeight: number;
  centroid: number[];
  labelTerms: Map<string, number>;
  representativeClusterIds: string[];
  memberships: Array<{
    clusterId: string;
    confidence: number;
    centroidSimilarity: number;
  }>;
};

export type InterestFamilyRebuildResult = {
  embeddingIndexId: string | null;
  familyCount: number;
  memberCount: number;
};

export type RecommendationFamilySummaryItem = {
  id: string;
  polarity: InterestClusterPolarity;
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

export type RecommendationClusterFamily = {
  id: string;
  polarity: InterestClusterPolarity;
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
};

export type InterestFamilyServiceOptions = {
  db: DibaoDatabase;
  now?: () => number;
  getFamilyLimits?: () => {
    maxPositiveInterestFamilies: number;
    maxNegativeInterestFamilies: number;
  };
  getClusterCalibration?: (embeddingIndexId: string) => InterestClusterCalibration;
};

export class InterestFamilyService {
  private readonly now: () => number;

  constructor(private readonly options: InterestFamilyServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  rebuildActiveIndexFamilies(): InterestFamilyRebuildResult {
    const activeIndexId = this.activeEmbeddingIndexId();
    if (!activeIndexId) {
      return { embeddingIndexId: null, familyCount: 0, memberCount: 0 };
    }

    return this.rebuildFamiliesForIndex(activeIndexId);
  }

  rebuildFamiliesForIndex(embeddingIndexId: string): InterestFamilyRebuildResult {
    const now = this.now();
    const labels = this.listLabels();
    const evidence = this.evidenceSummaries(embeddingIndexId);
    const familyDrafts: FamilyDraft[] = [];

    for (const polarity of ["positive", "negative"] as const) {
      const clusters = this.listClusters({
        embeddingIndexId,
        polarity
      }).slice(0, MAX_CLUSTERS_PER_POLARITY);
      const thresholds = this.thresholdsFor(embeddingIndexId, polarity);
      for (const cluster of clusters) {
        const vector = fromVectorBlob(cluster.centroidVectorBlob);
        const terms = clusterLabelTerms(labels.get(cluster.id), cluster.label);
        const assignment = bestFamilyAssignment({
          vector,
          terms,
          polarity,
          thresholds,
          families: familyDrafts.filter((family) => family.polarity === polarity)
        });

        if (!assignment) {
          familyDrafts.push(createFamilyDraft(cluster, vector, terms));
          continue;
        }

        assignClusterToFamily({
          family: assignment.family,
          cluster,
          vector,
          terms,
          centroidSimilarity: assignment.centroidSimilarity,
          confidence: assignment.confidence
        });
      }
    }

    const totalWeightByPolarity = new Map<InterestClusterPolarity, number>();
    for (const family of familyDrafts) {
      totalWeightByPolarity.set(
        family.polarity,
        (totalWeightByPolarity.get(family.polarity) ?? 0) + family.clusters.reduce((sum, cluster) => sum + cluster.weight, 0)
      );
    }

    const rows = rowsWithinFamilyLimits(
      familyDrafts
        .map((family) =>
          familyRowForDraft({
            family,
            labels,
            evidence,
            embeddingIndexId,
            now,
            totalPolarityWeight: totalWeightByPolarity.get(family.polarity) ?? 0
          })
        )
        .filter((row) => isMatureFamilyRow(row.family)),
      this.familyLimits()
    );

    this.options.db.transaction(() => {
      this.options.db
        .prepare("delete from interest_cluster_family_members where embedding_index_id = ?")
        .run(embeddingIndexId);
      this.options.db
        .prepare("delete from interest_families where embedding_index_id = ?")
        .run(embeddingIndexId);

      const insertFamily = this.options.db.prepare(
        `
          insert into interest_families (
            id,
            embedding_index_id,
            polarity,
            display_label,
            centroid_vector_blob,
            weight,
            cluster_count,
            support_article_count,
            support_event_count,
            source_count,
            strong_signal_count,
            top_source_share,
            maturity,
            dominance_ratio,
            label_terms_json,
            representative_cluster_ids_json,
            diagnostics_json,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      );
      const insertMember = this.options.db.prepare(
        `
          insert into interest_cluster_family_members (
            cluster_id,
            family_id,
            embedding_index_id,
            polarity,
            membership_confidence,
            centroid_similarity,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?)
        `
      );

      for (const row of rows) {
        insertFamily.run(
          row.family.id,
          embeddingIndexId,
          row.family.polarity,
          row.family.displayLabel,
          row.family.centroidVectorBlob,
          row.family.weight,
          row.family.clusterCount,
          row.family.supportArticleCount,
          row.family.supportEventCount,
          row.family.sourceCount,
          row.family.strongSignalCount,
          row.family.topSourceShare,
          row.family.maturity,
          row.family.dominanceRatio,
          row.family.labelTermsJson,
          row.family.representativeClusterIdsJson,
          row.family.diagnosticsJson,
          now,
          now
        );

        for (const member of row.members) {
          insertMember.run(
            member.clusterId,
            row.family.id,
            embeddingIndexId,
            row.family.polarity,
            member.confidence,
            member.centroidSimilarity,
            now,
            now
          );
        }
      }
    })();

    return {
      embeddingIndexId,
      familyCount: rows.length,
      memberCount: rows.reduce((sum, row) => sum + row.members.length, 0)
    };
  }

  listFamilySummary(embeddingIndexId: string | null, limit = 8): RecommendationFamilySummary {
    if (!embeddingIndexId) {
      return emptyFamilySummary();
    }
    const rows = this.listFamilies(embeddingIndexId);
    return familySummaryFromRows(rows, limit);
  }

  familyMapForClusters(clusterIds: string[]): Map<string, RecommendationClusterFamily> {
    if (clusterIds.length === 0) {
      return new Map();
    }

    const rows = this.options.db
      .prepare(
        `
          select
            m.cluster_id as clusterId,
            m.membership_confidence as membershipConfidence,
            m.centroid_similarity as centroidSimilarity,
            f.id,
            f.polarity,
            f.display_label as displayLabel,
            f.weight,
            f.cluster_count as clusterCount,
            f.support_article_count as supportArticleCount,
            f.support_event_count as supportEventCount,
            f.source_count as sourceCount,
            f.maturity,
            f.dominance_ratio as dominanceRatio
          from interest_cluster_family_members m
          join interest_families f on f.id = m.family_id
          where m.cluster_id in (${clusterIds.map(() => "?").join(", ")})
        `
      )
      .all(...clusterIds) as Array<RecommendationClusterFamily & { clusterId: string }>;

    return new Map(
      rows.map((row) => [
        row.clusterId,
        {
          id: row.id,
          polarity: row.polarity,
          displayLabel: row.displayLabel,
          weight: row.weight,
          clusterCount: row.clusterCount,
          supportArticleCount: row.supportArticleCount,
          supportEventCount: row.supportEventCount,
          sourceCount: row.sourceCount,
          maturity: row.maturity,
          dominanceRatio: row.dominanceRatio,
          membershipConfidence: row.membershipConfidence,
          centroidSimilarity: row.centroidSimilarity
        }
      ])
    );
  }

  private activeEmbeddingIndexId(): string | null {
    const row = this.options.db
      .prepare(
        `
          select ei.id
          from embedding_indexes ei
          join embedding_providers ep on ep.id = ei.provider_id
          where ep.enabled = 1
            and ei.status = 'active'
          order by ei.updated_at desc, ei.id
          limit 1
        `
      )
      .get() as { id: string } | undefined;
    return row?.id ?? null;
  }

  private listClusters(input: {
    embeddingIndexId: string;
    polarity: InterestClusterPolarity;
  }): ClusterFamilyDbRow[] {
    return this.options.db
      .prepare(
        `
          select
            id,
            embedding_index_id as embeddingIndexId,
            polarity,
            label,
            centroid_vector_blob as centroidVectorBlob,
            weight,
            sample_count as sampleCount,
            last_matched_at as lastMatchedAt,
            created_at as createdAt,
            updated_at as updatedAt
          from interest_clusters
          where embedding_index_id = ?
            and polarity = ?
          order by weight desc, updated_at desc, id
        `
      )
      .all(input.embeddingIndexId, input.polarity) as ClusterFamilyDbRow[];
  }

  private listLabels(): Map<string, ClusterLabelRow> {
    const rows = this.options.db
      .prepare(
        `
          select
            cluster_id as clusterId,
            auto_label as autoLabel,
            manual_label as manualLabel,
            label_terms_json as labelTermsJson,
            representative_articles_json as representativeArticlesJson,
            feed_titles_json as feedTitlesJson
          from interest_cluster_labels
        `
      )
      .all() as ClusterLabelRow[];
    return new Map(rows.map((row) => [row.clusterId, row]));
  }

  private listFamilies(embeddingIndexId: string): InterestFamilyRow[] {
    return this.options.db
      .prepare(
        `
          select
            id,
            embedding_index_id as embeddingIndexId,
            polarity,
            display_label as displayLabel,
            centroid_vector_blob as centroidVectorBlob,
            weight,
            cluster_count as clusterCount,
            support_article_count as supportArticleCount,
            support_event_count as supportEventCount,
            source_count as sourceCount,
            strong_signal_count as strongSignalCount,
            top_source_share as topSourceShare,
            maturity,
            dominance_ratio as dominanceRatio,
            label_terms_json as labelTermsJson,
            representative_cluster_ids_json as representativeClusterIdsJson,
            diagnostics_json as diagnosticsJson,
            created_at as createdAt,
            updated_at as updatedAt
          from interest_families
          where embedding_index_id = ?
          order by weight desc, updated_at desc, id
        `
      )
      .all(embeddingIndexId) as InterestFamilyRow[];
  }

  private evidenceSummaries(embeddingIndexId: string): Map<string, ClusterEvidenceSummary> {
    const rows = this.options.db
      .prepare(
        `
          select
            ice.cluster_id as clusterId,
            ice.article_id as articleId,
            coalesce(ice.feed_id_snapshot, a.feed_id, '') as feedId,
            coalesce(ice.feed_title_snapshot, f.title, '') as feedTitle,
            coalesce(ice.event_type_snapshot, be.event_type, '') as eventType,
            coalesce(ice.reading_progress_snapshot, s.reading_progress, 0) as readingProgress
          from interest_cluster_evidence ice
          join interest_clusters ic on ic.id = ice.cluster_id
          left join articles a on a.id = ice.article_id
          left join feeds f on f.id = coalesce(a.feed_id, ice.feed_id_snapshot)
          left join behavior_events be on be.id = ice.behavior_event_id
          left join article_states s on s.article_id = ice.article_id
          where ic.embedding_index_id = ?
        `
      )
      .all(embeddingIndexId) as Array<{
      clusterId: string;
      articleId: string;
      feedId: string;
      feedTitle: string;
      eventType: string;
      readingProgress: number;
    }>;

    const summaries = new Map<string, ClusterEvidenceSummary>();
    for (const row of rows) {
      const summary = summaries.get(row.clusterId) ?? emptyEvidenceSummary();
      summary.articleIds.add(row.articleId);
      const feedKey = row.feedId || row.feedTitle;
      if (feedKey) {
        summary.feedKeys.add(feedKey);
        summary.sourceCounts.set(feedKey, (summary.sourceCounts.get(feedKey) ?? 0) + 1);
      }
      summary.eventCount += 1;
      if (isStrongFamilySignal(row.eventType, row.readingProgress)) {
        summary.strongSignalCount += 1;
      }
      summaries.set(row.clusterId, summary);
    }
    return summaries;
  }

  private thresholdsFor(
    embeddingIndexId: string,
    polarity: InterestClusterPolarity
  ): InterestClusterPolarityThresholds {
    const calibration = this.options.getClusterCalibration?.(embeddingIndexId);
    if (calibration) {
      return calibration.thresholds[polarity];
    }
    return {
      mergeThreshold: polarity === "positive" ? 0.82 : 0.84,
      attachThreshold: polarity === "positive" ? 0.82 : 0.84,
      pairwiseGuardThreshold: polarity === "positive" ? 0.82 : 0.84,
      compactThreshold: 0.92,
      maxClusterSamples: polarity === "positive" ? 8 : 6,
      familyCentroidThreshold:
        polarity === "positive" ? POSITIVE_CENTROID_THRESHOLD : NEGATIVE_CENTROID_THRESHOLD,
      familyLabelAssistedThreshold: LABEL_ASSISTED_CENTROID_THRESHOLD,
      familySharedLabelThreshold: SHARED_LABEL_CENTROID_THRESHOLD
    };
  }

  private familyLimits(): { positive: number; negative: number } {
    const configured = this.options.getFamilyLimits?.();
    return {
      positive: configured?.maxPositiveInterestFamilies ?? DEFAULT_POSITIVE_FAMILY_LIMIT,
      negative: configured?.maxNegativeInterestFamilies ?? DEFAULT_NEGATIVE_FAMILY_LIMIT
    };
  }
}

function bestFamilyAssignment(input: {
  vector: number[];
  terms: string[];
  polarity: InterestClusterPolarity;
  thresholds: InterestClusterPolarityThresholds;
  families: FamilyDraft[];
}): { family: FamilyDraft; centroidSimilarity: number; confidence: number } | null {
  let best:
    | { family: FamilyDraft; centroidSimilarity: number; labelJaccard: number; sharedLabel: boolean; score: number }
    | null = null;
  for (const family of input.families) {
    if (family.centroid.length !== input.vector.length) {
      continue;
    }
    const centroidSimilarity = cosineSimilarity(input.vector, family.centroid);
    const familyTerms = new Set(family.labelTerms.keys());
    const labelJaccard = jaccard(new Set(input.terms), familyTerms);
    const sharedLabel = input.terms.some((term) => familyTerms.has(term));
    const score = centroidSimilarity * 0.72 + labelJaccard * 0.2 + (sharedLabel ? 0.08 : 0);
    if (!best || score > best.score) {
      best = { family, centroidSimilarity, labelJaccard, sharedLabel, score };
    }
  }

  if (!best) {
    return null;
  }

  const assign =
    best.centroidSimilarity >= input.thresholds.familyCentroidThreshold ||
    (best.labelJaccard >= 0.34 &&
      best.centroidSimilarity >= input.thresholds.familyLabelAssistedThreshold) ||
    (best.sharedLabel && best.centroidSimilarity >= input.thresholds.familySharedLabelThreshold);

  if (!assign) {
    return null;
  }

  return {
    family: best.family,
    centroidSimilarity: roundMetric(best.centroidSimilarity),
    confidence: roundMetric(clamp(best.score, 0, 1))
  };
}

function createFamilyDraft(
  cluster: ClusterFamilyDbRow,
  vector: number[],
  terms: string[]
): FamilyDraft {
  const weight = clusterVectorWeight(cluster);
  return {
    id: stableFamilyId(cluster.embeddingIndexId, cluster.polarity, cluster.id),
    polarity: cluster.polarity,
    clusters: [cluster],
    vectorSum: vector.map((value) => value * weight),
    vectorWeight: weight,
    centroid: vector,
    labelTerms: termsToWeightedMap(terms),
    representativeClusterIds: [cluster.id],
    memberships: [
      {
        clusterId: cluster.id,
        confidence: 1,
        centroidSimilarity: 1
      }
    ]
  };
}

function assignClusterToFamily(input: {
  family: FamilyDraft;
  cluster: ClusterFamilyDbRow;
  vector: number[];
  terms: string[];
  centroidSimilarity: number;
  confidence: number;
}): void {
  const weight = clusterVectorWeight(input.cluster);
  input.family.clusters.push(input.cluster);
  input.family.vectorSum = mergeWeightedVector(input.family.vectorSum, input.vector, weight);
  input.family.vectorWeight += weight;
  input.family.centroid = normalizeVector(input.family.vectorSum.map((value) => value / input.family.vectorWeight));
  input.family.representativeClusterIds.push(input.cluster.id);
  input.family.memberships.push({
    clusterId: input.cluster.id,
    confidence: input.confidence,
    centroidSimilarity: input.centroidSimilarity
  });
  for (const term of input.terms) {
    input.family.labelTerms.set(term, (input.family.labelTerms.get(term) ?? 0) + weight);
  }
}

function familyRowForDraft(input: {
  family: FamilyDraft;
  labels: Map<string, ClusterLabelRow>;
  evidence: Map<string, ClusterEvidenceSummary>;
  embeddingIndexId: string;
  now: number;
  totalPolarityWeight: number;
}): {
  family: InterestFamilyRow;
  members: FamilyDraft["memberships"];
} {
  const clusterEvidence = input.family.clusters.map((cluster) => input.evidence.get(cluster.id) ?? emptyEvidenceSummary());
  const articleIds = unionSets(clusterEvidence.map((item) => item.articleIds));
  const feedKeys = unionSets(clusterEvidence.map((item) => item.feedKeys));
  const supportEventCount = clusterEvidence.reduce((sum, item) => sum + item.eventCount, 0);
  const strongSignalCount = clusterEvidence.reduce((sum, item) => sum + item.strongSignalCount, 0);
  const sourceCounts = new Map<string, number>();
  for (const item of clusterEvidence) {
    for (const [source, count] of item.sourceCounts) {
      sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + count);
    }
  }
  const weight = input.family.clusters.reduce((sum, cluster) => sum + cluster.weight, 0);
  const topSourceShare =
    supportEventCount > 0 ? Math.max(0, ...sourceCounts.values()) / supportEventCount : 0;
  const strongSignalRatio = supportEventCount > 0 ? strongSignalCount / supportEventCount : 0;
  const maturity = familyMaturity({
    supportArticleCount: articleIds.size,
    sourceCount: feedKeys.size,
    strongSignalRatio
  });
  const lowSupportClusterCount = input.family.clusters.filter((cluster) => {
    const evidence = input.evidence.get(cluster.id) ?? emptyEvidenceSummary();
    return evidence.articleIds.size <= 1 || evidence.feedKeys.size <= 1;
  }).length;
  const singleArticleClusterCount = input.family.clusters.filter((cluster) => {
    const evidence = input.evidence.get(cluster.id) ?? emptyEvidenceSummary();
    return evidence.articleIds.size <= 1;
  }).length;
  const labelTerms = topTermsFromFamily(input.family, input.labels);
  const dominanceRatio =
    input.totalPolarityWeight > 0 ? clamp(weight / input.totalPolarityWeight, 0, 1) : 0;
  const diagnostics = {
    lowSupportClusterCount,
    singleArticleClusterCount,
    concentrationRisk: concentrationRiskFor({
      dominanceRatio,
      clusterCount: input.family.clusters.length,
      lowSupportClusterCount
    })
  };

  return {
    family: {
      id: input.family.id,
      embeddingIndexId: input.embeddingIndexId,
      polarity: input.family.polarity,
      displayLabel: familyDisplayLabel(input.family, input.labels, labelTerms),
      centroidVectorBlob: toVectorBlob(input.family.centroid),
      weight: roundMetric(weight),
      clusterCount: input.family.clusters.length,
      supportArticleCount: articleIds.size,
      supportEventCount,
      sourceCount: feedKeys.size,
      strongSignalCount,
      topSourceShare: roundMetric(topSourceShare),
      maturity: roundMetric(maturity),
      dominanceRatio: roundMetric(dominanceRatio),
      labelTermsJson: JSON.stringify(labelTerms),
      representativeClusterIdsJson: JSON.stringify(input.family.representativeClusterIds.slice(0, 8)),
      diagnosticsJson: JSON.stringify(diagnostics),
      createdAt: input.now,
      updatedAt: input.now
    },
    members: input.family.memberships
  };
}

function rowsWithinFamilyLimits(
  rows: Array<ReturnType<typeof familyRowForDraft>>,
  limits: { positive: number; negative: number }
): Array<ReturnType<typeof familyRowForDraft>> {
  return (["positive", "negative"] as const).flatMap((polarity) =>
    rows
      .filter((row) => row.family.polarity === polarity)
      .sort(
        (left, right) =>
          right.family.weight - left.family.weight ||
          right.family.maturity - left.family.maturity ||
          right.family.supportArticleCount - left.family.supportArticleCount ||
          left.family.id.localeCompare(right.family.id)
      )
      .slice(0, polarity === "positive" ? limits.positive : limits.negative)
  );
}

function isMatureFamilyRow(family: InterestFamilyRow): boolean {
  if (family.supportArticleCount < 2 || family.maturity < 0.48) {
    return false;
  }
  if (family.clusterCount < 2 && family.supportEventCount < 2 && family.sourceCount < 2) {
    return false;
  }
  return true;
}

function familySummaryFromRows(rows: InterestFamilyRow[], limit: number): RecommendationFamilySummary {
  const topFamilies = rows
    .slice()
    .sort((left, right) => right.weight - left.weight || right.dominanceRatio - left.dominanceRatio)
    .slice(0, Math.max(0, limit))
    .map(mapFamilySummaryItem);
  const dominantFamily =
    topFamilies.length > 0
      ? topFamilies.slice().sort((left, right) => right.dominanceRatio - left.dominanceRatio)[0] ?? null
      : null;

  return {
    positive: rows.filter((row) => row.polarity === "positive").length,
    negative: rows.filter((row) => row.polarity === "negative").length,
    topFamilies,
    dominantFamily,
    concentrationRisk: dominantFamily?.diagnostics.concentrationRisk ?? "low"
  };
}

function mapFamilySummaryItem(row: InterestFamilyRow): RecommendationFamilySummaryItem {
  return {
    id: row.id,
    polarity: row.polarity,
    displayLabel: row.displayLabel,
    weight: row.weight,
    clusterCount: row.clusterCount,
    supportArticleCount: row.supportArticleCount,
    supportEventCount: row.supportEventCount,
    sourceCount: row.sourceCount,
    strongSignalCount: row.strongSignalCount,
    topSourceShare: row.topSourceShare,
    maturity: row.maturity,
    dominanceRatio: row.dominanceRatio,
    labelTerms: parseStringArray(row.labelTermsJson).slice(0, 8),
    representativeClusterIds: parseStringArray(row.representativeClusterIdsJson).slice(0, 8),
    diagnostics: parseFamilyDiagnostics(row.diagnosticsJson),
    updatedAt: row.updatedAt
  };
}

function emptyFamilySummary(): RecommendationFamilySummary {
  return {
    positive: 0,
    negative: 0,
    topFamilies: [],
    dominantFamily: null,
    concentrationRisk: "low"
  };
}

function clusterLabelTerms(label: ClusterLabelRow | undefined, fallbackLabel: string | null): string[] {
  const terms = [
    ...parseLabelTerms(label?.labelTermsJson ?? null),
    ...(label?.manualLabel ? tokenize(label.manualLabel) : []),
    ...(label?.autoLabel ? tokenize(label.autoLabel) : []),
    ...(fallbackLabel ? tokenize(fallbackLabel) : [])
  ].map(normalizeTerm).filter((term) => term.length > 0);
  return uniqueStrings(terms).slice(0, 12);
}

function familyDisplayLabel(
  family: FamilyDraft,
  labels: Map<string, ClusterLabelRow>,
  labelTerms: string[]
): string {
  const head = family.clusters[0];
  const headLabel = head ? labels.get(head.id) : undefined;
  const explicit = headLabel?.manualLabel ?? headLabel?.autoLabel ?? head?.label ?? null;
  if (explicit && explicit.trim().length > 0) {
    return explicit.trim();
  }
  if (labelTerms.length > 0) {
    return labelTerms.slice(0, 3).join(" / ");
  }
  return family.polarity === "positive" ? "正向主题组" : "负向主题组";
}

function topTermsFromFamily(
  family: FamilyDraft,
  labels: Map<string, ClusterLabelRow>
): string[] {
  const weighted = new Map(family.labelTerms);
  for (const cluster of family.clusters) {
    const label = labels.get(cluster.id);
    for (const term of clusterLabelTerms(label, cluster.label)) {
      weighted.set(term, (weighted.get(term) ?? 0) + clusterVectorWeight(cluster) * 0.4);
    }
  }
  return Array.from(weighted.entries())
    .filter(([term]) => term.length > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([term]) => term)
    .slice(0, 12);
}

function familyMaturity(input: {
  supportArticleCount: number;
  sourceCount: number;
  strongSignalRatio: number;
}): number {
  const base =
    0.22 +
    Math.min(input.supportArticleCount, 8) * 0.09 +
    Math.min(input.sourceCount, 5) * 0.08 +
    clamp(input.strongSignalRatio, 0, 1) * 0.22;
  const value = clamp(base, 0.2, 1);
  if (input.supportArticleCount <= 1) {
    return Math.min(value, 0.35);
  }
  if (input.supportArticleCount <= 2 && input.sourceCount <= 1) {
    return Math.min(value, 0.52);
  }
  return value;
}

function concentrationRiskFor(input: {
  dominanceRatio: number;
  clusterCount: number;
  lowSupportClusterCount: number;
}): "low" | "medium" | "high" {
  if (input.dominanceRatio >= 0.62 && input.clusterCount >= 5) {
    return "high";
  }
  if (input.dominanceRatio >= 0.45 || input.lowSupportClusterCount >= 4) {
    return "medium";
  }
  return "low";
}

function termsToWeightedMap(terms: string[]): Map<string, number> {
  const result = new Map<string, number>();
  terms.forEach((term, index) => {
    result.set(term, (result.get(term) ?? 0) + 1 / (index + 1));
  });
  return result;
}

function mergeWeightedVector(current: number[], next: number[], weight: number): number[] {
  return current.map((value, index) => value + (next[index] ?? 0) * weight);
}

function clusterVectorWeight(cluster: ClusterFamilyDbRow): number {
  return Math.max(0.2, Math.log1p(Math.max(0, cluster.weight)) + Math.log1p(Math.max(1, cluster.sampleCount)) * 0.3);
}

function stableFamilyId(
  embeddingIndexId: string,
  polarity: InterestClusterPolarity,
  seedClusterId: string
): string {
  const hash = createHash("sha1")
    .update(`${embeddingIndexId}:${polarity}:${seedClusterId}`)
    .digest("hex")
    .slice(0, 16);
  return `family_${polarity}_${hash}`;
}

function emptyEvidenceSummary(): ClusterEvidenceSummary {
  return {
    articleIds: new Set(),
    feedKeys: new Set(),
    eventCount: 0,
    strongSignalCount: 0,
    sourceCounts: new Map()
  };
}

function isStrongFamilySignal(eventType: string, readingProgress: number): boolean {
  return (
    eventType === "favorite" ||
    eventType === "like" ||
    eventType === "read_later" ||
    eventType === "mark_read" ||
    eventType === "read_complete" ||
    eventType === "hide" ||
    eventType === "not_interested" ||
    (eventType === "read_progress" && readingProgress >= 0.75)
  );
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const item of left) {
    if (right.has(item)) {
      intersection += 1;
    }
  }
  const union = left.size + right.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function unionSets<T>(sets: Array<Set<T>>): Set<T> {
  const result = new Set<T>();
  for (const set of sets) {
    for (const item of set) {
      result.add(item);
    }
  }
  return result;
}

function parseFamilyDiagnostics(value: string | null): RecommendationFamilySummaryItem["diagnostics"] {
  if (!value) {
    return {
      lowSupportClusterCount: 0,
      singleArticleClusterCount: 0,
      concentrationRisk: "low"
    };
  }
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const risk =
      parsed.concentrationRisk === "high" || parsed.concentrationRisk === "medium"
        ? parsed.concentrationRisk
        : "low";
    return {
      lowSupportClusterCount:
        typeof parsed.lowSupportClusterCount === "number" ? parsed.lowSupportClusterCount : 0,
      singleArticleClusterCount:
        typeof parsed.singleArticleClusterCount === "number"
          ? parsed.singleArticleClusterCount
          : 0,
      concentrationRisk: risk
    };
  } catch {
    return {
      lowSupportClusterCount: 0,
      singleArticleClusterCount: 0,
      concentrationRisk: "low"
    };
  }
}

function parseLabelTerms(value: string | null): string[] {
  return parseJsonArray(value)
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      if (
        typeof item === "object" &&
        item !== null &&
        !Array.isArray(item) &&
        typeof (item as { term?: unknown }).term === "string"
      ) {
        return (item as { term: string }).term;
      }
      return null;
    })
    .filter((item): item is string => item !== null);
}

function parseStringArray(value: string | null): string[] {
  return parseJsonArray(value).filter((item): item is string => typeof item === "string");
}

function parseJsonArray(value: string | null): unknown[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map(normalizeTerm)
    .filter((term) => term.length >= 2)
    .slice(0, 12);
}

function normalizeTerm(value: string): string {
  const term = value.trim().toLowerCase();
  if (!term || FAMILY_TERM_STOPWORDS.has(term) || /^\d+$/.test(term)) {
    return "";
  }
  return term;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function roundMetric(value: number): number {
  return Number(value.toFixed(4));
}

const FAMILY_TERM_STOPWORDS = new Set([
  "interest",
  "cluster",
  "positive",
  "negative",
  "topic",
  "topics",
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "https",
  "http",
  "com",
  "www",
  "img",
  "src",
  "href",
  "class"
]);
