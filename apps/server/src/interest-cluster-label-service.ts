import { setImmediate as delayImmediate } from "node:timers/promises";
import {
  fromVectorBlob,
  type AppSettingsRepository,
  type DibaoDatabase,
  type InterestClusterLabelRow,
  type InterestClusterLabelSource,
  type InterestClusterPolarity
} from "@dibao/db";
import { clamp, cosineSimilarity, profileAlgorithmDefaults } from "@dibao/ranking";
import defaultLabelLexicon from "./recommendation-label-lexicon.default.json" with { type: "json" };

export const INTEREST_CLUSTER_LABEL_REBUILD_JOB_TYPE =
  "interest_cluster_label_rebuild" as const;
export const CLUSTER_LABEL_LEXICON_SETTINGS_KEY = "recommendation.clusterLabelLexicon";

const MAX_MANUAL_LABEL_LENGTH = 30;
const MAX_LEXICON_ARRAY_LENGTH = 500;
const MAX_LEXICON_TERM_LENGTH = 64;
const MAX_LEXICON_PATTERN_LENGTH = 128;

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
  labelDiagnosticsJson: string | null;
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

type TermSource = "title" | "summary" | "feed" | "profile" | "representative" | "event";

type TermCandidate = {
  term: string;
  key: string;
  weight: number;
  sources: Set<TermSource>;
};

type LabelGenerationSettings = {
  maxTerms: number;
  maxRepresentativeArticles: number;
  maxFeedTitles: number;
  profileTermWeight: number;
  titleTermWeight: number;
  summaryTermWeight: number;
  representativeTitleWeight: number;
  feedTitleWeight: number;
  commonTermClusterRatioPenalty: number;
  commonTermClusterRatioDrop: number;
};

type RawDefaultLexicon = {
  version: number;
  stopwords: {
    en: string[];
    zh: string[];
  };
  protectedTerms: {
    en: string[];
    zh: string[];
  };
  badTermPatterns: string[];
  domainSuffixes: string[];
  labelGeneration: LabelGenerationSettings;
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
};

export type LabelDiagnostics = {
  collision: boolean;
  collisionGroupSize: number;
  lowConfidence: boolean;
};

type EffectiveLabelLexicon = {
  defaultVersion: number;
  stopwords: Set<string>;
  protectedTerms: Map<string, string>;
  badPatternSources: string[];
  badPatterns: RegExp[];
  domainSuffixes: Set<string>;
  labelGeneration: LabelGenerationSettings;
  overrides: ClusterLabelLexiconOverrides;
  warnings: string[];
};

type ClusterLabelDraft = {
  cluster: ClusterDbRow;
  displayIndex: number;
  candidates: Map<string, TermCandidate>;
  evidence: EvidenceArticle[];
  representativeArticles: ClusterDisplayLabel["representativeArticles"];
  feedTitles: string[];
  generatedAt: number;
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
  labelDiagnostics: LabelDiagnostics;
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
  labelDiagnostics: LabelDiagnostics;
  generatedAt: number;
};

export type ClusterLabelRebuildProgress = {
  clusterCount: number;
  clustersProcessed: number;
  chunksProcessed: number;
};

export type ClusterLabelRebuildInput = {
  chunkSize?: number;
  onProgress?: (progress: ClusterLabelRebuildProgress) => void;
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
  settings?: Pick<AppSettingsRepository, "getJson" | "setJson">;
  now?: () => number;
};

const rawDefaultLexicon = defaultLabelLexicon as RawDefaultLexicon;
const MAX_LABEL_DEDUPE_SCAN_CANDIDATES = 240;
const MAX_LABEL_TERMS_FOR_DISAMBIGUATION = 8;
const MAX_REPRESENTATIVE_DEDUPE_SCAN_CANDIDATES = 120;

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
    const generated = this.generateIndexLabels(clusters);

    this.options.db.transaction(() => {
      for (const { cluster, label } of generated) {
        this.upsertAutoLabel(cluster, label);
      }
    })();
    return clusters.length;
  }

  async rebuildIndexLabelsAsync(
    embeddingIndexId: string,
    input: ClusterLabelRebuildInput = {}
  ): Promise<number> {
    const clusters = this.listClusters({ embeddingIndexId });
    const generated = await this.generateIndexLabelsAsync(clusters, input);
    const chunkSize = clampLabelChunkSize(input.chunkSize);
    let chunksProcessed = Math.ceil(Math.max(clusters.length, 1) / chunkSize) * 2;
    let labelsWritten = 0;

    for (let offset = 0; offset < generated.length; offset += chunkSize) {
      const chunk = generated.slice(offset, offset + chunkSize);
      this.options.db.transaction(() => {
        for (const { cluster, label } of chunk) {
          this.upsertAutoLabel(cluster, label);
        }
      })();
      labelsWritten += chunk.length;
      chunksProcessed += 1;
      input.onProgress?.({
        clusterCount: clusters.length * 3,
        clustersProcessed: clusters.length * 2 + labelsWritten,
        chunksProcessed
      });
      await delayImmediate();
    }

    return clusters.length;
  }

  getClusterLabelLexicon(): ClusterLabelLexiconResponse {
    const lexicon = this.effectiveLexicon();
    return {
      defaultVersion: lexicon.defaultVersion,
      effective: {
        stopwords: Array.from(lexicon.stopwords).sort(),
        protectedTerms: Array.from(lexicon.protectedTerms.values()).sort((left, right) =>
          left.localeCompare(right)
        ),
        badTermPatterns: lexicon.badPatternSources
      },
      overrides: lexicon.overrides,
      warnings: lexicon.warnings
    };
  }

  updateClusterLabelLexicon(body: unknown): ClusterLabelLexiconResponse {
    if (!this.options.settings) {
      throw new InterestClusterLabelServiceError(
        500,
        "LEXICON_SETTINGS_UNAVAILABLE",
        "Cluster label lexicon settings are not configured"
      );
    }

    const existing = this.parseStoredOverrides({ strict: false }).overrides;
    const patch = parseLexiconOverridesPatch(body);
    const next = {
      ...existing,
      ...patch
    };
    validateRegexPatterns(next.badTermPatternsAdd, "badTermPatternsAdd");
    validateRegexPatterns(next.badTermPatternsRemove, "badTermPatternsRemove");
    this.options.settings.setJson(CLUSTER_LABEL_LEXICON_SETTINGS_KEY, next, this.now());
    return this.getClusterLabelLexicon();
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
      : this.generateSingleClusterLabel(cluster, displayIndex);
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
                label_diagnostics_json,
                confidence,
                generated_at,
                updated_at
              )
              values (?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?)
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
            generated
              ? JSON.stringify(generated.labelDiagnostics)
              : existing?.labelDiagnosticsJson ?? null,
            generated?.confidence ?? existing?.confidence ?? 0,
            generated?.generatedAt ?? existing?.generatedAt ?? null,
            now
          );
      } else {
        const refreshed = this.generateSingleClusterLabel(cluster, displayIndex);
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
      labelDiagnostics: parseLabelDiagnostics(row?.labelDiagnosticsJson ?? null, row?.confidence ?? 0),
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
            label_diagnostics_json,
            confidence,
            generated_at,
            updated_at
          )
          values (?, ?, null, ?, ?, ?, ?, ?, ?, ?, ?)
          on conflict(cluster_id) do update set
            auto_label = excluded.auto_label,
            label_source = ?,
            label_terms_json = excluded.label_terms_json,
            representative_articles_json = excluded.representative_articles_json,
            feed_titles_json = excluded.feed_titles_json,
            label_diagnostics_json = excluded.label_diagnostics_json,
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
        JSON.stringify(generated.labelDiagnostics),
        generated.confidence,
        generated.generatedAt,
        now,
        labelSource
      );
  }

  private generateIndexLabels(
    clusters: ClusterDbRow[]
  ): Array<{ cluster: ClusterDbRow; label: GeneratedClusterLabel }> {
    const lexicon = this.effectiveLexicon();
    const drafts = clusters.map((cluster, index) =>
      this.buildLabelDraft(cluster, index + 1, lexicon)
    );
    const termClusterCounts = new Map<string, number>();
    for (const draft of drafts) {
      for (const key of draft.candidates.keys()) {
        termClusterCounts.set(key, (termClusterCounts.get(key) ?? 0) + 1);
      }
    }

    const generated = drafts.map((draft) => ({
      cluster: draft.cluster,
      label: this.finalizeLabelDraft(draft, {
        lexicon,
        totalClusters: Math.max(drafts.length, 1),
        termClusterCounts
      })
    }));
    disambiguateLabelCollisions(generated, lexicon);
    return generated;
  }

  private async generateIndexLabelsAsync(
    clusters: ClusterDbRow[],
    input: ClusterLabelRebuildInput
  ): Promise<Array<{ cluster: ClusterDbRow; label: GeneratedClusterLabel }>> {
    const lexicon = this.effectiveLexicon();
    const chunkSize = clampLabelChunkSize(input.chunkSize);
    const drafts: ClusterLabelDraft[] = [];
    const termClusterCounts = new Map<string, number>();
    let chunksProcessed = 0;

    for (let offset = 0; offset < clusters.length; offset += chunkSize) {
      const chunk = clusters.slice(offset, offset + chunkSize);
      for (const cluster of chunk) {
        const draft = this.buildLabelDraft(cluster, drafts.length + 1, lexicon);
        drafts.push(draft);
        for (const key of draft.candidates.keys()) {
          termClusterCounts.set(key, (termClusterCounts.get(key) ?? 0) + 1);
        }
      }
      chunksProcessed += 1;
      input.onProgress?.({
        clusterCount: clusters.length * 3,
        clustersProcessed: drafts.length,
        chunksProcessed
      });
      await delayImmediate();
    }

    const generated: Array<{ cluster: ClusterDbRow; label: GeneratedClusterLabel }> = [];
    for (let offset = 0; offset < drafts.length; offset += chunkSize) {
      const chunk = drafts.slice(offset, offset + chunkSize);
      for (const draft of chunk) {
        generated.push({
          cluster: draft.cluster,
          label: this.finalizeLabelDraft(draft, {
            lexicon,
            totalClusters: Math.max(drafts.length, 1),
            termClusterCounts
          })
        });
      }
      chunksProcessed += 1;
      input.onProgress?.({
        clusterCount: clusters.length * 3,
        clustersProcessed: clusters.length + generated.length,
        chunksProcessed
      });
      await delayImmediate();
    }

    disambiguateLabelCollisions(generated, lexicon);
    input.onProgress?.({
      clusterCount: clusters.length * 3,
      clustersProcessed: clusters.length * 2,
      chunksProcessed
    });
    await delayImmediate();
    return generated;
  }

  private generateSingleClusterLabel(
    cluster: ClusterDbRow,
    displayIndex: number
  ): GeneratedClusterLabel {
    const lexicon = this.effectiveLexicon();
    const draft = this.buildLabelDraft(cluster, displayIndex, lexicon);
    const termClusterCounts = new Map<string, number>();
    for (const key of draft.candidates.keys()) {
      termClusterCounts.set(key, 1);
    }
    return this.finalizeLabelDraft(draft, {
      lexicon,
      totalClusters: 1,
      termClusterCounts
    });
  }

  private buildLabelDraft(
    cluster: ClusterDbRow,
    displayIndex: number,
    lexicon: EffectiveLabelLexicon
  ): ClusterLabelDraft {
    const evidence = this.listEvidenceForCluster(cluster);
    const profileTerms = this.listProfileTerms(cluster.polarity);
    const candidates = new Map<string, TermCandidate>();
    const settings = lexicon.labelGeneration;

    for (const item of evidence) {
      const multiplier =
        item.evidenceSource === "live_event"
          ? 1.2
          : item.evidenceSource === "reconstructed"
            ? 1
            : 0.75;
      const confidence = clamp(item.confidence || 0.5, 0.1, 1);
      addTextCandidates(
        candidates,
        item.title,
        settings.titleTermWeight * multiplier * confidence,
        "title",
        lexicon
      );
      addTextCandidates(
        candidates,
        item.summary ?? "",
        settings.summaryTermWeight * multiplier * confidence,
        "summary",
        lexicon
      );
      if (item.evidenceSource === "live_event") {
        addTextCandidates(
          candidates,
          item.title,
          2 * confidence,
          "event",
          lexicon
        );
      }
    }

    const representativeArticles = representativeArticlesFor(
      evidence,
      settings.maxRepresentativeArticles
    );
    for (const article of representativeArticles) {
      addTextCandidates(
        candidates,
        article.title,
        settings.representativeTitleWeight,
        "representative",
        lexicon
      );
    }

    for (const term of profileTerms) {
      const weight = Math.min(8, Math.max(0.2, Math.abs(term.weight))) * settings.profileTermWeight;
      addTextCandidates(candidates, term.term, weight, "profile", lexicon);
    }

    const feedTitles = uniqueNonEmpty(evidence.map((item) => item.feedTitle)).slice(
      0,
      settings.maxFeedTitles
    );
    for (const feedTitle of feedTitles) {
      addTextCandidates(candidates, feedTitle, settings.feedTitleWeight, "feed", lexicon);
    }

    return {
      cluster,
      displayIndex,
      candidates,
      evidence,
      representativeArticles,
      feedTitles,
      generatedAt: this.now()
    };
  }

  private finalizeLabelDraft(
    draft: ClusterLabelDraft,
    input: {
      lexicon: EffectiveLabelLexicon;
      totalClusters: number;
      termClusterCounts: Map<string, number>;
    }
  ): GeneratedClusterLabel {
    const settings = input.lexicon.labelGeneration;
    const candidateRows = Array.from(draft.candidates.values()).map((candidate) => {
      const clusterCount = input.termClusterCounts.get(candidate.key) ?? 0;
      const clusterRatio = clusterCount / Math.max(input.totalClusters, 1);
      const idf = Math.log(1 + input.totalClusters / (1 + clusterCount));
      const protectedTerm = isProtectedTerm(candidate.key, input.lexicon);
      const commonPenalty =
        !protectedTerm && clusterRatio > settings.commonTermClusterRatioPenalty
          ? 0.3
          : 1;
      return {
        ...candidate,
        weight: candidate.weight * idf * commonPenalty,
        clusterRatio,
        protectedTerm
      };
    });
    const hasAlternatives = candidateRows.some(
      (candidate) => candidate.clusterRatio <= settings.commonTermClusterRatioDrop || candidate.protectedTerm
    );
    const rankedLabelCandidates = candidateRows
      .filter((candidate) => {
        if (
          !candidate.protectedTerm &&
          hasAlternatives &&
          candidate.clusterRatio > settings.commonTermClusterRatioDrop
        ) {
          return false;
        }
        return candidate.weight >= 0.35;
      })
      .sort((left, right) => right.weight - left.weight || left.term.localeCompare(right.term));
    const labelTerms = dedupeSubsumedTerms(
      rankedLabelCandidates.slice(0, MAX_LABEL_DEDUPE_SCAN_CANDIDATES),
      input.lexicon,
      Math.max(settings.maxTerms, MAX_LABEL_TERMS_FOR_DISAMBIGUATION)
    )
      .slice(0, settings.maxTerms)
      .map((candidate) => ({
        term: candidate.term,
        weight: Number(candidate.weight.toFixed(4))
      }));

    const confidence = confidenceFor({
      evidence: draft.evidence,
      labelTerms,
      sourceCount: draft.feedTitles.length
    });
    const diagnostics = defaultLabelDiagnostics(confidence);

    if (labelTerms.length > 0 && labelTerms[0]!.weight >= 1.4) {
      return {
        autoLabel: labelTerms.slice(0, 3).map((term) => term.term).join(" / "),
        labelSource: "keywords",
        labelTerms,
        representativeArticles: draft.representativeArticles,
        feedTitles: draft.feedTitles,
        confidence,
        labelDiagnostics: diagnostics,
        generatedAt: draft.generatedAt
      };
    }

    const representativeLabel = labelFromRepresentativeTitles(
      draft.representativeArticles,
      input.lexicon
    );
    if (representativeLabel) {
      return {
        autoLabel: representativeLabel,
        labelSource: "representative_titles",
        labelTerms,
        representativeArticles: draft.representativeArticles,
        feedTitles: draft.feedTitles,
        confidence: Math.max(confidence, 0.25),
        labelDiagnostics: defaultLabelDiagnostics(Math.max(confidence, 0.25)),
        generatedAt: draft.generatedAt
      };
    }

    if (draft.feedTitles.length > 0) {
      return {
        autoLabel: draft.feedTitles.slice(0, 3).join(" / "),
        labelSource: "feeds",
        labelTerms,
        representativeArticles: draft.representativeArticles,
        feedTitles: draft.feedTitles,
        confidence: Math.max(confidence, 0.2),
        labelDiagnostics: defaultLabelDiagnostics(Math.max(confidence, 0.2)),
        generatedAt: draft.generatedAt
      };
    }

    return {
      autoLabel: fallbackLabel(draft.displayIndex),
      labelSource: "fallback",
      labelTerms: [],
      representativeArticles: [],
      feedTitles: [],
      confidence: 0,
      labelDiagnostics: defaultLabelDiagnostics(0),
      generatedAt: draft.generatedAt
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
            label_diagnostics_json as labelDiagnosticsJson,
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

  private effectiveLexicon(): EffectiveLabelLexicon {
    const defaultStopwords = [
      ...rawDefaultLexicon.stopwords.en,
      ...rawDefaultLexicon.stopwords.zh
    ];
    const defaultProtectedTerms = [
      ...rawDefaultLexicon.protectedTerms.en,
      ...rawDefaultLexicon.protectedTerms.zh
    ];
    const parsedOverrides = this.parseStoredOverrides({ strict: false });
    const overrides = parsedOverrides.overrides;
    const stopwords = new Set(defaultStopwords.map(normalizeTermKey).filter(Boolean));
    const protectedTerms = new Map<string, string>();
    const warnings = [...parsedOverrides.warnings];

    for (const term of defaultProtectedTerms) {
      const key = normalizeTermKey(term);
      if (key) {
        protectedTerms.set(key, term.trim());
      }
    }
    for (const term of overrides.stopwordsAdd) {
      const key = normalizeTermKey(term);
      if (key) {
        stopwords.add(key);
      }
    }
    for (const term of overrides.stopwordsRemove) {
      const key = normalizeTermKey(term);
      if (key) {
        stopwords.delete(key);
      }
    }
    for (const term of overrides.protectedTermsAdd) {
      const key = normalizeTermKey(term);
      if (key) {
        protectedTerms.set(key, term.trim());
      }
    }
    for (const term of overrides.protectedTermsRemove) {
      const key = normalizeTermKey(term);
      if (key) {
        protectedTerms.delete(key);
      }
    }

    const badPatternSources = rawDefaultLexicon.badTermPatterns
      .filter((pattern) => !overrides.badTermPatternsRemove.includes(pattern))
      .concat(overrides.badTermPatternsAdd);
    const badPatterns: RegExp[] = [];
    for (const pattern of badPatternSources) {
      try {
        badPatterns.push(new RegExp(pattern, "i"));
      } catch {
        warnings.push(`Invalid badTermPattern ignored: ${pattern}`);
      }
    }

    return {
      defaultVersion: rawDefaultLexicon.version,
      stopwords,
      protectedTerms,
      badPatternSources,
      badPatterns,
      domainSuffixes: new Set(rawDefaultLexicon.domainSuffixes.map((term) => term.toLowerCase())),
      labelGeneration: rawDefaultLexicon.labelGeneration,
      overrides,
      warnings
    };
  }

  private parseStoredOverrides(input: { strict: boolean }): {
    overrides: ClusterLabelLexiconOverrides;
    warnings: string[];
  } {
    if (!this.options.settings) {
      return { overrides: emptyLexiconOverrides(), warnings: [] };
    }

    try {
      const stored = this.options.settings.getJson<unknown>(CLUSTER_LABEL_LEXICON_SETTINGS_KEY);
      if (stored === null) {
        return { overrides: emptyLexiconOverrides(), warnings: [] };
      }
      return {
        overrides: parseLexiconOverrides(stored),
        warnings: []
      };
    } catch (error) {
      if (input.strict) {
        throw error;
      }
      return {
        overrides: emptyLexiconOverrides(),
        warnings: ["Stored cluster label lexicon override is invalid; default lexicon is active."]
      };
    }
  }
}

function addTextCandidates(
  candidates: Map<string, TermCandidate>,
  text: string,
  weight: number,
  source: TermSource,
  lexicon: EffectiveLabelLexicon
): void {
  if (!text || weight <= 0) {
    return;
  }

  for (const term of tokenizeLabelText(text, lexicon)) {
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
        term: formatTerm(term, lexicon),
        key,
        weight,
        sources: new Set([source])
      });
    }
  }
}

function tokenizeLabelText(text: string, lexicon: EffectiveLabelLexicon): string[] {
  const withoutMarkup = text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#\d+;/gi, " ");
  const withoutUrls = withoutMarkup
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\b(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/gi, " ");
  const terms: string[] = [];

  const latinMatches = withoutUrls.match(/[A-Za-z][A-Za-z0-9+#.-]{1,30}/g) ?? [];
  for (const match of latinMatches) {
    terms.push(match);
  }

  const hanMatches = withoutUrls.match(/\p{Script=Han}{2,18}/gu) ?? [];
  for (const match of hanMatches) {
    if (match.length <= 6) {
      terms.push(match);
    }
    const maxSize = Math.min(6, match.length);
    for (let size = 2; size <= maxSize; size += 1) {
      for (let index = 0; index + size <= match.length; index += 1) {
        terms.push(match.slice(index, index + size));
      }
    }
  }

  return terms.filter((term) => isUsefulTerm(term, lexicon));
}

function isUsefulTerm(term: string, lexicon: EffectiveLabelLexicon): boolean {
  const normalized = normalizeTermKey(term);
  if (!normalized || normalized.length < 2 || normalized.length > 32) {
    return false;
  }
  if (normalized.includes("://") || normalized.includes("@")) {
    return false;
  }
  if (isDomainLikeTerm(normalized, lexicon)) {
    return false;
  }
  if (lexicon.badPatterns.some((pattern) => pattern.test(normalized))) {
    return false;
  }
  if (/^\d+$/.test(normalized)) {
    return false;
  }
  if (!isProtectedTerm(normalized, lexicon) && lexicon.stopwords.has(normalized)) {
    return false;
  }
  return true;
}

function isDomainLikeTerm(normalized: string, lexicon: EffectiveLabelLexicon): boolean {
  if (normalized.includes(".")) {
    const suffix = normalized.split(".").pop()?.toLowerCase();
    return Boolean(suffix && lexicon.domainSuffixes.has(suffix));
  }
  return lexicon.domainSuffixes.has(normalized) && !isProtectedTerm(normalized, lexicon);
}

function normalizeTermKey(term: string): string {
  return term
    .trim()
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}+#.-]+|[^\p{L}\p{N}+#.-]+$/gu, "");
}

function formatTerm(term: string, lexicon: EffectiveLabelLexicon): string {
  const trimmed = term.trim().replace(/^[^\p{L}\p{N}+#.-]+|[^\p{L}\p{N}+#.-]+$/gu, "");
  const key = normalizeTermKey(trimmed);
  const protectedDisplay = lexicon.protectedTerms.get(key);
  if (protectedDisplay) {
    return protectedDisplay;
  }
  if (/^[a-z0-9+#.-]+$/.test(trimmed)) {
    return trimmed.length <= 4 ? trimmed.toUpperCase() : trimmed;
  }
  return trimmed;
}

function isProtectedTerm(keyOrTerm: string, lexicon: EffectiveLabelLexicon): boolean {
  return lexicon.protectedTerms.has(normalizeTermKey(keyOrTerm));
}

function representativeArticlesFor(
  evidence: EvidenceArticle[],
  limit: number
): ClusterDisplayLabel["representativeArticles"] {
  const seenArticleIds = new Set<string>();
  const representatives: ClusterDisplayLabel["representativeArticles"] = [];

  for (const item of evidence) {
    if (seenArticleIds.has(item.articleId)) {
      continue;
    }
    seenArticleIds.add(item.articleId);
    representatives.push({
      articleId: item.articleId,
      title: item.title,
      feedTitle: item.feedTitle,
      eventType: item.eventType,
      confidence: Number(item.confidence.toFixed(4)),
      similarity: item.similarity === null ? null : Number(item.similarity.toFixed(4))
    });
    if (representatives.length >= limit) {
      break;
    }
  }

  return representatives;
}

function labelFromRepresentativeTitles(
  articles: ClusterDisplayLabel["representativeArticles"],
  lexicon: EffectiveLabelLexicon
): string | null {
  const titleTerms = new Map<string, TermCandidate>();
  for (const article of articles) {
    addTextCandidates(titleTerms, article.title, 1, "title", lexicon);
  }
  const terms = dedupeSubsumedTerms(
    Array.from(titleTerms.values())
      .sort((left, right) => right.weight - left.weight)
      .slice(0, MAX_REPRESENTATIVE_DEDUPE_SCAN_CANDIDATES),
    lexicon,
    6
  )
    .slice(0, 3)
    .map((candidate) => candidate.term);
  return terms.length > 0 ? terms.join(" / ") : null;
}

function dedupeSubsumedTerms<T extends { term: string; weight: number }>(
  candidates: T[],
  lexicon: EffectiveLabelLexicon,
  limit = Number.POSITIVE_INFINITY
): T[] {
  const result: T[] = [];
  for (const candidate of candidates) {
    if (result.length >= limit) {
      break;
    }
    const term = candidate.term;
    const key = normalizeTermKey(term);
    if (!key) {
      continue;
    }
    let duplicate = false;
    for (let index = 0; index < result.length; index += 1) {
      const kept = result[index]!;
      const keptKey = normalizeTermKey(kept.term);
      if (!keptKey) {
        continue;
      }
      if (keptKey === key) {
        duplicate = true;
        break;
      }
      if (isProtectedTerm(key, lexicon) || isProtectedTerm(keptKey, lexicon)) {
        continue;
      }
      if (isHanTerm(key) && isHanTerm(keptKey)) {
        if (key.includes(keptKey) && key.length > keptKey.length && candidate.weight >= kept.weight * 0.35) {
          result.splice(index, 1, candidate);
          duplicate = true;
          break;
        }
        if (keptKey.includes(key)) {
          duplicate = true;
          break;
        }
      }
    }
    if (duplicate) {
      continue;
    }
    result.push(candidate);
  }

  return result;
}

function isHanTerm(term: string): boolean {
  return /\p{Script=Han}/u.test(term);
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

function disambiguateLabelCollisions(
  generated: Array<{ cluster: ClusterDbRow; label: GeneratedClusterLabel }>,
  lexicon: EffectiveLabelLexicon
): void {
  const groups = new Map<string, Array<{ cluster: ClusterDbRow; label: GeneratedClusterLabel }>>();
  for (const item of generated) {
    const key = normalizeLabelForCollision(item.label.autoLabel);
    if (!key) {
      continue;
    }
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  const usedLabels = new Set(
    generated
      .map((item) => normalizeLabelForCollision(item.label.autoLabel))
      .filter((item): item is string => Boolean(item))
  );

  for (const group of groups.values()) {
    if (group.length <= 1) {
      continue;
    }
    group.forEach((item, index) => {
      const original = item.label.autoLabel ?? fallbackLabel(index + 1);
      usedLabels.delete(normalizeLabelForCollision(original) ?? "");
      const next = uniqueDisambiguatedLabel(original, item.label, index + 1, usedLabels, lexicon);
      item.label.autoLabel = next;
      item.label.labelDiagnostics = {
        ...item.label.labelDiagnostics,
        collision: true,
        collisionGroupSize: group.length
      };
      usedLabels.add(normalizeLabelForCollision(next) ?? next);
    });
  }
}

function uniqueDisambiguatedLabel(
  original: string,
  label: GeneratedClusterLabel,
  ordinal: number,
  usedLabels: Set<string>,
  lexicon: EffectiveLabelLexicon
): string {
  const existingTerms = new Set(label.autoLabel?.split("/").map(normalizeTermKey) ?? []);
  const extras = label.labelTerms
    .slice(3, 5)
    .map((term) => term.term)
    .filter((term) => !existingTerms.has(normalizeTermKey(term)));
  const representativeTerm = representativeSpecificTerm(label, existingTerms, lexicon);
  if (representativeTerm) {
    extras.push(representativeTerm);
  }
  const feedTerm = label.feedTitles[0];
  if (feedTerm) {
    extras.push(feedTerm);
  }

  for (const extra of extras) {
    const candidate = `${original} / ${extra}`;
    const key = normalizeLabelForCollision(candidate);
    if (key && !usedLabels.has(key)) {
      return candidate;
    }
  }

  return `${original} / #${ordinal}`;
}

function representativeSpecificTerm(
  label: GeneratedClusterLabel,
  existingTerms: Set<string>,
  lexicon: EffectiveLabelLexicon
): string | null {
  const candidates = new Map<string, TermCandidate>();
  for (const article of label.representativeArticles) {
    addTextCandidates(candidates, article.title, 1, "representative", lexicon);
  }
  return (
    dedupeSubsumedTerms(
      Array.from(candidates.values())
        .sort((left, right) => right.weight - left.weight)
        .slice(0, MAX_REPRESENTATIVE_DEDUPE_SCAN_CANDIDATES),
      lexicon,
      6
    ).find((candidate) => !existingTerms.has(candidate.key))?.term ?? null
  );
}

function normalizeLabelForCollision(label: string | null): string | null {
  const normalized = label
    ?.split("/")
    .map((part) => normalizeTermKey(part))
    .filter(Boolean)
    .join("/");
  return normalized || null;
}

function defaultLabelDiagnostics(confidence: number): LabelDiagnostics {
  return {
    collision: false,
    collisionGroupSize: 1,
    lowConfidence: confidence < 0.4
  };
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
  const seenArticleIds = new Set<string>();
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
      ): item is ClusterDisplayLabel["representativeArticles"][number] => {
        if (item === null || seenArticleIds.has(item.articleId)) {
          return false;
        }
        seenArticleIds.add(item.articleId);
        return true;
      }
    );
}

function parseLabelDiagnostics(value: string | null, confidence: number): LabelDiagnostics {
  if (!value) {
    return defaultLabelDiagnostics(confidence);
  }
  try {
    const parsed = JSON.parse(value) as Partial<LabelDiagnostics>;
    return {
      collision: parsed.collision === true,
      collisionGroupSize:
        typeof parsed.collisionGroupSize === "number" &&
        Number.isFinite(parsed.collisionGroupSize)
          ? parsed.collisionGroupSize
          : parsed.collision === true
            ? 2
            : 1,
      lowConfidence:
        typeof parsed.lowConfidence === "boolean"
          ? parsed.lowConfidence
          : confidence < 0.4
    };
  } catch {
    return defaultLabelDiagnostics(confidence);
  }
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

function emptyLexiconOverrides(): ClusterLabelLexiconOverrides {
  return {
    stopwordsAdd: [],
    stopwordsRemove: [],
    protectedTermsAdd: [],
    protectedTermsRemove: [],
    badTermPatternsAdd: [],
    badTermPatternsRemove: []
  };
}

function parseLexiconOverrides(value: unknown): ClusterLabelLexiconOverrides {
  const input = readPlainObject(value, "cluster label lexicon overrides");
  rejectUnknownKeys(input, [
    "stopwordsAdd",
    "stopwordsRemove",
    "protectedTermsAdd",
    "protectedTermsRemove",
    "badTermPatternsAdd",
    "badTermPatternsRemove"
  ]);
  const overrides = emptyLexiconOverrides();
  for (const key of Object.keys(overrides) as Array<keyof ClusterLabelLexiconOverrides>) {
    if (Object.hasOwn(input, key)) {
      overrides[key] = parseLexiconArray(input[key], key);
    }
  }
  validateRegexPatterns(overrides.badTermPatternsAdd, "badTermPatternsAdd");
  validateRegexPatterns(overrides.badTermPatternsRemove, "badTermPatternsRemove");
  return overrides;
}

function parseLexiconOverridesPatch(value: unknown): Partial<ClusterLabelLexiconOverrides> {
  const input = readPlainObject(value, "cluster label lexicon override patch");
  rejectUnknownKeys(input, [
    "stopwordsAdd",
    "stopwordsRemove",
    "protectedTermsAdd",
    "protectedTermsRemove",
    "badTermPatternsAdd",
    "badTermPatternsRemove"
  ]);
  const patch: Partial<ClusterLabelLexiconOverrides> = {};
  for (const key of Object.keys(emptyLexiconOverrides()) as Array<keyof ClusterLabelLexiconOverrides>) {
    if (Object.hasOwn(input, key)) {
      patch[key] = parseLexiconArray(input[key], key);
    }
  }
  return patch;
}

function parseLexiconArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new InterestClusterLabelServiceError(
      400,
      "VALIDATION_ERROR",
      `${field} must be an array`,
      { field }
    );
  }
  if (value.length > MAX_LEXICON_ARRAY_LENGTH) {
    throw new InterestClusterLabelServiceError(
      400,
      "VALIDATION_ERROR",
      `${field} must contain ${MAX_LEXICON_ARRAY_LENGTH} or fewer items`,
      { field, maxItems: MAX_LEXICON_ARRAY_LENGTH }
    );
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new InterestClusterLabelServiceError(
        400,
        "VALIDATION_ERROR",
        `${field} items must be strings`,
        { field }
      );
    }
    const trimmed = item.trim();
    const maxLength = field.startsWith("badTermPatterns")
      ? MAX_LEXICON_PATTERN_LENGTH
      : MAX_LEXICON_TERM_LENGTH;
    if (trimmed.length < 1 || Array.from(trimmed).length > maxLength) {
      throw new InterestClusterLabelServiceError(
        400,
        "VALIDATION_ERROR",
        `${field} items must be 1-${maxLength} characters`,
        { field, minLength: 1, maxLength }
      );
    }
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }
  return result;
}

function validateRegexPatterns(patterns: string[], field: string): void {
  for (const pattern of patterns) {
    try {
      new RegExp(pattern);
    } catch {
      throw new InterestClusterLabelServiceError(
        400,
        "VALIDATION_ERROR",
        `${field} contains an invalid regular expression`,
        { field, pattern }
      );
    }
  }
}

function readPlainObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InterestClusterLabelServiceError(
      400,
      "VALIDATION_ERROR",
      `${field} must be an object`,
      { field }
    );
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(input: Record<string, unknown>, allowed: string[]): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(input)) {
    if (!allowedSet.has(key)) {
      throw new InterestClusterLabelServiceError(
        400,
        "VALIDATION_ERROR",
        `Unknown field: ${key}`,
        { field: key }
      );
    }
  }
}

function clampLabelChunkSize(value: number | undefined): number {
  if (!Number.isFinite(value) || !value) {
    return 12;
  }
  return Math.min(50, Math.max(1, Math.floor(value)));
}
