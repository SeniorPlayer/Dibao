import {
  fromVectorBlob,
  type DibaoDatabase,
  type InterestClusterLabelRow,
  type InterestClusterLabelSource,
  type InterestClusterPolarity
} from "@dibao/db";
import { clamp, cosineSimilarity, profileAlgorithmDefaults } from "@dibao/ranking";

export const INTEREST_CLUSTER_LABEL_REBUILD_JOB_TYPE =
  "interest_cluster_label_rebuild" as const;

const MAX_MANUAL_LABEL_LENGTH = 30;
const MAX_LABEL_TERMS = 5;
const MAX_REPRESENTATIVE_ARTICLES = 5;
const MAX_FEED_TITLES = 5;

type ClusterDbRow = {
  id: string;
  embeddingIndexId: string;
  polarity: InterestClusterPolarity;
  label: string | null;
  centroidVectorBlob: Buffer;
  weight: number;
  sampleCount: number;
  updatedAt: number;
};

type LabelDbRow = {
  clusterId: string;
  autoLabel: string | null;
  manualLabel: string | null;
  labelSource: InterestClusterLabelSource;
  labelTermsJson: string | null;
  representativeArticlesJson: string | null;
  feedTitlesJson: string | null;
  confidence: number;
  generatedAt: number | null;
  updatedAt: number;
};

type EvidenceSource = "live_event" | "reconstructed" | "dynamic_fallback";

type EvidenceArticle = {
  articleId: string;
  title: string;
  summary: string | null;
  feedTitle: string;
  eventType: string;
  evidenceSource: EvidenceSource;
  confidence: number;
  similarity: number | null;
  weightDelta: number;
  createdAt: number;
};

type ProfileTerm = {
  term: string;
  weight: number;
  evidenceCount: number;
};

type TermCandidate = {
  term: string;
  weight: number;
  sources: Set<"title" | "summary" | "feed" | "profile">;
};

export type ClusterDisplayLabel = {
  clusterId: string;
  displayLabel: string;
  labelSource: InterestClusterLabelSource;
  autoLabel: string | null;
  manualLabel: string | null;
  confidence: number;
  topTerms: string[];
  representativeArticles: Array<{
    articleId: string;
    title: string;
    feedTitle: string;
    eventType: string;
    confidence: number;
    similarity: number | null;
  }>;
  feedTitles: string[];
  generatedAt: number | null;
  updatedAt: number | null;
};

export type GeneratedClusterLabel = {
  autoLabel: string | null;
  labelSource: Exclude<InterestClusterLabelSource, "manual">;
  labelTerms: Array<{ term: string; weight: number }>;
  representativeArticles: ClusterDisplayLabel["representativeArticles"];
  feedTitles: string[];
  confidence: number;
  generatedAt: number;
};

export class InterestClusterLabelServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "InterestClusterLabelServiceError";
  }
}

export type InterestClusterLabelServiceOptions = {
  db: DibaoDatabase;
  now?: () => number;
};

export class InterestClusterLabelService {
  private readonly now: () => number;

  constructor(private readonly options: InterestClusterLabelServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  rebuildActiveIndexLabels(): {
    embeddingIndexId: string | null;
    clusterCount: number;
  } {
    const activeIndexId = this.activeEmbeddingIndexId();
    if (!activeIndexId) {
      return { embeddingIndexId: null, clusterCount: 0 };
    }

    return {
      embeddingIndexId: activeIndexId,
      clusterCount: this.rebuildIndexLabels(activeIndexId)
    };
  }

  rebuildIndexLabels(embeddingIndexId: string): number {
    const clusters = this.listClusters({ embeddingIndexId });
    this.options.db.transaction(() => {
      clusters.forEach((cluster, index) => {
        const generated = this.generateClusterLabel(cluster, index + 1);
        this.upsertAutoLabel(cluster, generated);
      });
    })();
    return clusters.length;
  }

  setManualLabel(clusterId: string, manualLabel: unknown): ClusterDisplayLabel {
    const cluster = this.findClusterById(clusterId);
    if (!cluster) {
      throw new InterestClusterLabelServiceError(
        404,
        "NOT_FOUND",
        "Interest cluster not found"
      );
    }

    const parsed = parseManualLabel(manualLabel);
    if (!parsed.ok) {
      throw new InterestClusterLabelServiceError(
        400,
        "VALIDATION_ERROR",
        parsed.message,
        parsed.details
      );
    }

    const displayIndex = this.clusterDisplayIndex(cluster);
    const existing = this.findLabelByClusterId(cluster.id);
    const generated = existing
      ? null
      : this.generateClusterLabel(cluster, displayIndex);
    const now = this.now();

    this.options.db.transaction(() => {
      if (generated) {
        this.upsertAutoLabel(cluster, generated);
      }

      if (parsed.value) {
        this.options.db
          .prepare(
            `
              insert into interest_cluster_labels (
                cluster_id,
                auto_label,
                manual_label,
                label_source,
                label_terms_json,
                representative_articles_json,
                feed_titles_json,
                confidence,
                generated_at,
                updated_at
              )
              values (?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?)
              on conflict(cluster_id) do update set
                manual_label = excluded.manual_label,
                label_source = 'manual',
                updated_at = excluded.updated_at
            `
          )
          .run(
            cluster.id,
            generated?.autoLabel ?? existing?.autoLabel ?? null,
            parsed.value,
            generated ? JSON.stringify(generated.labelTerms) : existing?.labelTermsJson ?? null,
            generated
              ? JSON.stringify(generated.representativeArticles)
              : existing?.representativeArticlesJson ?? null,
            generated ? JSON.stringify(generated.feedTitles) : existing?.feedTitlesJson ?? null,
            generated?.confidence ?? existing?.confidence ?? 0,
            generated?.generatedAt ?? existing?.generatedAt ?? null,
            now
          );
      } else {
        const refreshed = this.generateClusterLabel(cluster, displayIndex);
        this.upsertAutoLabel(cluster, refreshed);
        this.options.db
          .prepare(
            `
              update interest_cluster_labels
              set
                manual_label = null,
                label_source = ?,
                updated_at = ?
              where cluster_id = ?
            `
          )
          .run(refreshed.labelSource, now, cluster.id);
      }
    })();

    return this.displayLabelForCluster(cluster, displayIndex);
  }

  displayLabelForCluster(
    cluster: {
      id: string;
      label: string | null;
      polarity: InterestClusterPolarity;
      displayIndex?: number;
    },
    displayIndex: number = cluster.displayIndex ?? 1
  ): ClusterDisplayLabel {
    const row = this.findLabelByClusterId(cluster.id);
    const topTerms = parseLabelTerms(row?.labelTermsJson ?? null);
    const representativeArticles = parseRepresentativeArticles(
      row?.representativeArticlesJson ?? null
    );
    const feedTitles = parseStringArray(row?.feedTitlesJson ?? null);
    const displayLabel =
      row?.manualLabel ??
      row?.autoLabel ??
      cluster.label ??
      fallbackLabel(displayIndex);
    const labelSource =
      row?.manualLabel && row.manualLabel.trim().length > 0
        ? "manual"
        : row?.labelSource ?? "fallback";

    return {
      clusterId: cluster.id,
      displayLabel,
      labelSource,
      autoLabel: row?.autoLabel ?? null,
      manualLabel: row?.manualLabel ?? null,
      confidence: row?.confidence ?? 0,
      topTerms,
      representativeArticles,
      feedTitles,
      generatedAt: row?.generatedAt ?? null,
      updatedAt: row?.updatedAt ?? null
    };
  }

  private upsertAutoLabel(cluster: ClusterDbRow, generated: GeneratedClusterLabel): void {
    const existing = this.findLabelByClusterId(cluster.id);
    const labelSource = existing?.manualLabel ? "manual" : generated.labelSource;
    const now = this.now();

    this.options.db
      .prepare(
        `
          insert into interest_cluster_labels (
            cluster_id,
            auto_label,
            manual_label,
            label_source,
            label_terms_json,
            representative_articles_json,
            feed_titles_json,
            confidence,
            generated_at,
            updated_at
          )
          values (?, ?, null, ?, ?, ?, ?, ?, ?, ?)
          on conflict(cluster_id) do update set
            auto_label = excluded.auto_label,
            label_source = ?,
            label_terms_json = excluded.label_terms_json,
            representative_articles_json = excluded.representative_articles_json,
            feed_titles_json = excluded.feed_titles_json,
            confidence = excluded.confidence,
            generated_at = excluded.generated_at,
            updated_at = excluded.updated_at
        `
      )
      .run(
        cluster.id,
        generated.autoLabel,
        labelSource,
        JSON.stringify(generated.labelTerms),
        JSON.stringify(generated.representativeArticles),
        JSON.stringify(generated.feedTitles),
        generated.confidence,
        generated.generatedAt,
        now,
        labelSource
      );
  }

  private generateClusterLabel(
    cluster: ClusterDbRow,
    displayIndex: number
  ): GeneratedClusterLabel {
    const evidence = this.listEvidenceForCluster(cluster);
    const profileTerms = this.listProfileTerms(cluster.polarity);
    const candidates = new Map<string, TermCandidate>();

    for (const item of evidence) {
      const multiplier =
        item.evidenceSource === "live_event"
          ? 1.3
          : item.evidenceSource === "reconstructed"
            ? 1
            : 0.8;
      const confidence = clamp(item.confidence || 0.5, 0.1, 1);
      addTextCandidates(candidates, item.title, 3 * multiplier * confidence, "title");
      addTextCandidates(candidates, item.summary ?? "", 0.6 * multiplier * confidence, "summary");
      addTextCandidates(candidates, item.feedTitle, 0.8 * multiplier * confidence, "feed");
    }

    for (const term of profileTerms) {
      const weight = Math.min(8, Math.max(0.2, Math.abs(term.weight))) * 2.5;
      addTextCandidates(candidates, term.term, weight, "profile");
    }

    const labelTerms = Array.from(candidates.values())
      .filter((candidate) => candidate.weight >= 0.4)
      .sort((left, right) => right.weight - left.weight || left.term.localeCompare(right.term))
      .slice(0, MAX_LABEL_TERMS)
      .map((candidate) => ({
        term: candidate.term,
        weight: Number(candidate.weight.toFixed(4))
      }));

    const representativeArticles = representativeArticlesFor(evidence);
    const feedTitles = uniqueNonEmpty(evidence.map((item) => item.feedTitle)).slice(
      0,
      MAX_FEED_TITLES
    );
    const confidence = confidenceFor({
      evidence,
      labelTerms,
      sourceCount: feedTitles.length
    });
    const generatedAt = this.now();

    if (labelTerms.length > 0 && labelTerms[0]!.weight >= 2.2) {
      return {
        autoLabel: labelTerms.slice(0, 3).map((term) => term.term).join(" / "),
        labelSource: "keywords",
        labelTerms,
        representativeArticles,
        feedTitles,
        confidence,
        generatedAt
      };
    }

    const representativeLabel = labelFromRepresentativeTitles(representativeArticles);
    if (representativeLabel) {
      return {
        autoLabel: representativeLabel,
        labelSource: "representative_titles",
        labelTerms,
        representativeArticles,
        feedTitles,
        confidence: Math.max(confidence, 0.25),
        generatedAt
      };
    }

    if (feedTitles.length > 0) {
      return {
        autoLabel: feedTitles.slice(0, 3).join(" / "),
        labelSource: "feeds",
        labelTerms,
        representativeArticles,
        feedTitles,
        confidence: Math.max(confidence, 0.2),
        generatedAt
      };
    }

    return {
      autoLabel: fallbackLabel(displayIndex),
      labelSource: "fallback",
      labelTerms: [],
      representativeArticles: [],
      feedTitles: [],
      confidence: 0,
      generatedAt
    };
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

  private listClusters(input: { embeddingIndexId: string }): ClusterDbRow[] {
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
            updated_at as updatedAt
          from interest_clusters
          where embedding_index_id = ?
          order by weight desc, updated_at desc, id
        `
      )
      .all(input.embeddingIndexId) as ClusterDbRow[];
  }

  private findClusterById(id: string): ClusterDbRow | null {
    const row = this.options.db
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
            updated_at as updatedAt
          from interest_clusters
          where id = ?
        `
      )
      .get(id) as ClusterDbRow | undefined;
    return row ?? null;
  }

  private clusterDisplayIndex(cluster: ClusterDbRow): number {
    const ids = this.listClusters({ embeddingIndexId: cluster.embeddingIndexId }).map(
      (item) => item.id
    );
    const index = ids.indexOf(cluster.id);
    return index >= 0 ? index + 1 : 1;
  }

  private findLabelByClusterId(clusterId: string): InterestClusterLabelRow | null {
    const row = this.options.db
      .prepare(
        `
          select
            cluster_id as clusterId,
            auto_label as autoLabel,
            manual_label as manualLabel,
            label_source as labelSource,
            label_terms_json as labelTermsJson,
            representative_articles_json as representativeArticlesJson,
            feed_titles_json as feedTitlesJson,
            confidence,
            generated_at as generatedAt,
            updated_at as updatedAt
          from interest_cluster_labels
          where cluster_id = ?
        `
      )
      .get(clusterId) as LabelDbRow | undefined;
    return row ?? null;
  }

  private listEvidenceForCluster(cluster: ClusterDbRow): EvidenceArticle[] {
    const persisted = this.options.db
      .prepare(
        `
          select
            ice.article_id as articleId,
            coalesce(a.title, ice.article_title_snapshot, ice.article_id) as title,
            a.summary as summary,
            coalesce(f.title, ice.feed_title_snapshot, '') as feedTitle,
            coalesce(be.event_type, ice.event_type_snapshot, 'read_complete') as eventType,
            ice.evidence_source as evidenceSource,
            ice.confidence,
            ice.similarity,
            ice.weight_delta as weightDelta,
            ice.created_at as createdAt
          from interest_cluster_evidence ice
          left join articles a on a.id = ice.article_id
          left join feeds f on f.id = coalesce(a.feed_id, ice.feed_id_snapshot)
          left join behavior_events be on be.id = ice.behavior_event_id
          where ice.cluster_id = ?
          order by
            ice.evidence_source = 'live_event' desc,
            ice.confidence desc,
            abs(ice.weight_delta) desc,
            ice.created_at desc,
            ice.id
          limit 10
        `
      )
      .all(cluster.id) as EvidenceArticle[];

    if (persisted.length > 0) {
      return persisted;
    }

    return this.dynamicFallbackEvidence(cluster);
  }

  private dynamicFallbackEvidence(cluster: ClusterDbRow): EvidenceArticle[] {
    const centroid = fromVectorBlob(cluster.centroidVectorBlob);
    const rows = this.options.db
      .prepare(
        `
          select
            a.id as articleId,
            a.title,
            a.summary,
            f.title as feedTitle,
            be.event_type as eventType,
            be.metadata_json as metadataJson,
            coalesce(s.reading_progress, 0) as readingProgress,
            ae.vector_blob as vectorBlob,
            be.created_at as createdAt
          from behavior_events be
          join articles a on a.id = be.article_id
          join feeds f on f.id = a.feed_id
          join article_embeddings ae
            on ae.article_id = a.id
           and ae.embedding_index_id = ?
          left join article_states s on s.article_id = a.id
          where a.deleted_at is null
            and a.status != 'deleted'
            and f.deleted_at is null
            and f.enabled = 1
            and ae.vector_blob is not null
          order by be.created_at desc, be.id
          limit 250
        `
      )
      .all(cluster.embeddingIndexId) as Array<{
      articleId: string;
      title: string;
      summary: string | null;
      feedTitle: string;
      eventType: string;
      metadataJson: string | null;
      readingProgress: number;
      vectorBlob: Buffer;
      createdAt: number;
    }>;

    const threshold =
      cluster.polarity === "positive"
        ? profileAlgorithmDefaults.positiveCreateThreshold
        : profileAlgorithmDefaults.negativeCreateThreshold;

    return rows
      .map((row) => ({
        row,
        polarity: polarityForEvent(row.eventType, row.metadataJson, row.readingProgress),
        similarity: cosineSimilarity(centroid, fromVectorBlob(row.vectorBlob))
      }))
      .filter(
        ({ polarity, similarity }) => polarity === cluster.polarity && similarity >= threshold
      )
      .sort((left, right) => right.similarity - left.similarity || right.row.createdAt - left.row.createdAt)
      .slice(0, 10)
      .map(({ row, similarity }) => ({
        articleId: row.articleId,
        title: row.title,
        summary: row.summary,
        feedTitle: row.feedTitle,
        eventType: row.eventType,
        evidenceSource: "dynamic_fallback",
        confidence: 0.45,
        similarity,
        weightDelta: 0,
        createdAt: row.createdAt
      }));
  }

  private listProfileTerms(polarity: InterestClusterPolarity): ProfileTerm[] {
    return this.options.db
      .prepare(
        `
          select
            term,
            weight,
            evidence_count as evidenceCount
          from profile_terms
          where polarity = ?
          order by abs(weight) desc, evidence_count desc, updated_at desc
          limit 80
        `
      )
      .all(polarity) as ProfileTerm[];
  }
}

function addTextCandidates(
  candidates: Map<string, TermCandidate>,
  text: string,
  weight: number,
  source: "title" | "summary" | "feed" | "profile"
): void {
  if (!text || weight <= 0) {
    return;
  }

  for (const term of tokenizeLabelText(text)) {
    const key = normalizeTermKey(term);
    if (!key) {
      continue;
    }
    const existing = candidates.get(key);
    if (existing) {
      existing.weight += weight;
      existing.sources.add(source);
    } else {
      candidates.set(key, {
        term: formatTerm(term),
        weight,
        sources: new Set([source])
      });
    }
  }
}

function tokenizeLabelText(text: string): string[] {
  const withoutUrls = text
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\b(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/gi, " ");
  const terms: string[] = [];

  const latinMatches = withoutUrls.match(/[A-Za-z][A-Za-z0-9+#.-]{1,30}/g) ?? [];
  for (const match of latinMatches) {
    terms.push(match);
  }

  const hanMatches = withoutUrls.match(/\p{Script=Han}{2,18}/gu) ?? [];
  for (const match of hanMatches) {
    if (match.length <= 8) {
      terms.push(match);
      continue;
    }
    for (let size = 2; size <= 4; size += 1) {
      for (let index = 0; index + size <= match.length; index += 1) {
        terms.push(match.slice(index, index + size));
      }
    }
  }

  return terms.filter(isUsefulTerm);
}

function isUsefulTerm(term: string): boolean {
  const normalized = normalizeTermKey(term);
  if (!normalized || normalized.length < 2 || normalized.length > 32) {
    return false;
  }
  if (/^\d+$/.test(normalized)) {
    return false;
  }
  if (normalized.includes("://") || normalized.includes("@")) {
    return false;
  }
  if (/\.(com|net|org|io|cn|co|ai|dev)$/i.test(normalized)) {
    return false;
  }
  if (STOPWORDS.has(normalized)) {
    return false;
  }
  return true;
}

function normalizeTermKey(term: string): string {
  return term
    .trim()
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}+#.-]+|[^\p{L}\p{N}+#.-]+$/gu, "");
}

function formatTerm(term: string): string {
  const trimmed = term.trim().replace(/^[^\p{L}\p{N}+#.-]+|[^\p{L}\p{N}+#.-]+$/gu, "");
  if (/^[a-z0-9+#.-]+$/.test(trimmed)) {
    return trimmed.length <= 4 ? trimmed.toUpperCase() : trimmed;
  }
  return trimmed;
}

function representativeArticlesFor(
  evidence: EvidenceArticle[]
): ClusterDisplayLabel["representativeArticles"] {
  return evidence.slice(0, MAX_REPRESENTATIVE_ARTICLES).map((item) => ({
    articleId: item.articleId,
    title: item.title,
    feedTitle: item.feedTitle,
    eventType: item.eventType,
    confidence: Number(item.confidence.toFixed(4)),
    similarity: item.similarity === null ? null : Number(item.similarity.toFixed(4))
  }));
}

function labelFromRepresentativeTitles(
  articles: ClusterDisplayLabel["representativeArticles"]
): string | null {
  const titleTerms = new Map<string, TermCandidate>();
  for (const article of articles) {
    addTextCandidates(titleTerms, article.title, 1, "title");
  }
  const terms = Array.from(titleTerms.values())
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 3)
    .map((candidate) => candidate.term);
  return terms.length > 0 ? terms.join(" / ") : null;
}

function confidenceFor(input: {
  evidence: EvidenceArticle[];
  labelTerms: Array<{ term: string; weight: number }>;
  sourceCount: number;
}): number {
  if (input.evidence.length === 0 && input.labelTerms.length === 0) {
    return 0;
  }

  const evidenceFactor = Math.min(1, input.evidence.length / 8);
  const totalWeight = input.labelTerms.reduce((sum, term) => sum + term.weight, 0);
  const topWeight = input.labelTerms[0]?.weight ?? 0;
  const concentration = totalWeight > 0 ? topWeight / totalWeight : 0;
  const sourceDiversity = Math.min(1, input.sourceCount / 3);
  const liveRatio =
    input.evidence.length > 0
      ? input.evidence.filter((item) => item.evidenceSource === "live_event").length /
        input.evidence.length
      : 0;

  return Number(
    clamp(
      evidenceFactor * 0.3 +
        Math.min(1, topWeight / 8) * 0.25 +
        concentration * 0.2 +
        sourceDiversity * 0.15 +
        liveRatio * 0.1,
      0,
      1
    ).toFixed(4)
  );
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function parseManualLabel(
  value: unknown
): { ok: true; value: string | null } | { ok: false; message: string; details?: unknown } {
  if (value === null || value === undefined) {
    return { ok: true, value: null };
  }
  if (typeof value !== "string") {
    return {
      ok: false,
      message: "manualLabel must be a string or null",
      details: { field: "manualLabel" }
    };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: true, value: null };
  }
  if (Array.from(trimmed).length > MAX_MANUAL_LABEL_LENGTH) {
    return {
      ok: false,
      message: "manualLabel must be 30 characters or fewer",
      details: { field: "manualLabel", maxLength: MAX_MANUAL_LABEL_LENGTH }
    };
  }

  return { ok: true, value: trimmed };
}

function polarityForEvent(
  eventType: string,
  metadataJson: string | null,
  readingProgress: number
): InterestClusterPolarity | null {
  switch (eventType) {
    case "favorite":
    case "like":
    case "read_later":
    case "read_complete":
    case "mark_read":
      return "positive";
    case "read_progress":
      return progressFromMetadata(metadataJson, readingProgress) >=
        profileAlgorithmDefaults.readCompleteProgressThreshold
        ? "positive"
        : null;
    case "hide":
    case "not_interested":
    case "quick_bounce":
      return "negative";
    default:
      return null;
  }
}

function progressFromMetadata(metadataJson: string | null, fallback: number): number {
  if (!metadataJson) {
    return fallback;
  }
  try {
    const metadata = JSON.parse(metadataJson) as { progress?: unknown };
    return typeof metadata.progress === "number" && Number.isFinite(metadata.progress)
      ? metadata.progress
      : fallback;
  } catch {
    return fallback;
  }
}

function fallbackLabel(displayIndex: number): string {
  return `兴趣簇 #${displayIndex}`;
}

function parseLabelTerms(value: string | null): string[] {
  const parsed = parseJsonArray(value);
  return parsed
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
    .filter((item): item is string => Boolean(item));
}

function parseRepresentativeArticles(
  value: string | null
): ClusterDisplayLabel["representativeArticles"] {
  return parseJsonArray(value)
    .map((item) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        return null;
      }
      const row = item as Record<string, unknown>;
      if (typeof row.articleId !== "string" || typeof row.title !== "string") {
        return null;
      }
      return {
        articleId: row.articleId,
        title: row.title,
        feedTitle: typeof row.feedTitle === "string" ? row.feedTitle : "",
        eventType: typeof row.eventType === "string" ? row.eventType : "",
        confidence: typeof row.confidence === "number" ? row.confidence : 0,
        similarity: typeof row.similarity === "number" ? row.similarity : null
      };
    })
    .filter(
      (
        item
      ): item is ClusterDisplayLabel["representativeArticles"][number] => item !== null
    );
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

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "new",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
  "about",
  "latest",
  "daily",
  "weekly",
  "news",
  "newsletter",
  "一个",
  "这个",
  "那个",
  "以及",
  "关于",
  "如何",
  "为什么",
  "进行",
  "相关",
  "最新",
  "发布",
  "观察",
  "评论",
  "日报",
  "周报",
  "新闻",
  "文章",
  "阅读"
]);
