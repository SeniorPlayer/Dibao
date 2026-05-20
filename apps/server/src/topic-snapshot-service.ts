import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import {
  fromVectorBlob,
  toVectorBlob,
  type DibaoDatabase,
  type JobRow
} from "@dibao/db";
import { clamp, cosineSimilarity, normalizeVector } from "@dibao/ranking";

export const TOPIC_SNAPSHOT_REBUILD_JOB_TYPE = "topic_snapshot_rebuild" as const;
export const TOPIC_SNAPSHOT_RUNNER_UNAVAILABLE = "TOPIC_SNAPSHOT_RUNNER_UNAVAILABLE";

export const DEFAULT_TOPIC_SNAPSHOT_MAX_ARTICLES = 3000;
export const DEFAULT_TOPIC_SNAPSHOT_SCOPE_DAYS = 60;
export const DEFAULT_TOPIC_SNAPSHOT_MIN_TOPIC_SIZE = 15;
export const DEFAULT_TOPIC_SNAPSHOT_MIN_ARTICLES = 20;

const DAY_MS = 24 * 60 * 60 * 1000;
const TOPIC_SNAPSHOT_CANDIDATE_QUERY = "active_enabled_feeds_with_current_embeddings";

type TopicSnapshotAlgorithm = "bertopic_precomputed_embeddings" | "fixture" | "local_fallback";

export type TopicSnapshotTokenizer = "mixed" | "zh" | "ja";

type TopicSnapshotRunStatus = "running" | "succeeded" | "failed";

type TopicSnapshotRunRow = {
  id: string;
  embeddingIndexId: string;
  status: TopicSnapshotRunStatus;
  algorithm: TopicSnapshotAlgorithm;
  algorithmVersion: string | null;
  scopeJson: string;
  paramsJson: string | null;
  articleCount: number;
  topicCount: number;
  skippedMissingEmbeddingCount: number;
  skippedStaleEmbeddingCount: number;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
};

type CorpusTopicRow = {
  id: string;
  runId: string;
  topicKey: string;
  label: string | null;
  topTermsJson: string;
  representativeArticlesJson: string;
  articleCount: number;
  centroidVectorBlob: Buffer | null;
  confidence: number;
  createdAt: number;
  updatedAt: number;
};

type CandidateStats = {
  articleCount: number;
  currentEmbeddingCount: number;
  missingEmbeddingCount: number;
  staleEmbeddingCount: number;
};

type CurrentArticleVector = {
  articleId: string;
  title: string;
  feedTitle: string;
  vector: number[];
};

export type TopicSnapshotRebuildOptions = {
  maxArticles?: number;
  scopeDays?: number;
  minTopicSize?: number;
  minArticles?: number;
};

export type TopicSnapshotRunnerInput = Required<
  Pick<TopicSnapshotRebuildOptions, "maxArticles" | "scopeDays" | "minTopicSize">
> & {
  dbPath: string;
  embeddingIndexId: string;
  tokenizer: TopicSnapshotTokenizer;
  outputPath?: string;
};

export type TopicSnapshotRunnerOutput = {
  algorithm: TopicSnapshotAlgorithm;
  algorithmVersion?: string | null;
  embeddingIndexId: string;
  params?: Record<string, unknown> | null;
  articleCount: number;
  topics: TopicSnapshotOutputTopic[];
  skipped?: {
    missingEmbeddingCount?: number;
    staleEmbeddingCount?: number;
  };
};

export type TopicSnapshotOutputTopic = {
  topicKey: string;
  label?: string | null;
  topTerms: Array<{ term: string; weight: number }>;
  representativeArticles: Array<{
    articleId: string;
    title?: string | null;
    feedTitle?: string | null;
    score?: number | null;
  }>;
  assignments: Array<{
    articleId: string;
    assignmentScore?: number | null;
    isRepresentative?: boolean;
  }>;
  confidence?: number | null;
};

export type TopicSnapshotRunner = (
  input: TopicSnapshotRunnerInput
) => Promise<TopicSnapshotRunnerOutput> | TopicSnapshotRunnerOutput;

export type TopicSnapshotRebuildResult = {
  runId: string;
  embeddingIndexId: string;
  status: "succeeded" | "failed";
  articleCount: number;
  topicCount: number;
  skippedMissingEmbeddingCount: number;
  skippedStaleEmbeddingCount: number;
  error: string | null;
};

export type TopicSnapshotLatestResponse =
  | {
      available: true;
      run: {
        id: string;
        embeddingIndexId: string;
        status: "succeeded";
        algorithm: TopicSnapshotAlgorithm;
        articleCount: number;
        topicCount: number;
        createdAt: number;
        finishedAt: number | null;
      };
      topics: Array<{
        id: string;
        topicKey: string;
        label: string | null;
        topTerms: string[];
        articleCount: number;
        representativeArticles: Array<{
          articleId: string;
          title: string;
          feedTitle: string;
          score: number | null;
        }>;
      }>;
    }
  | {
      available: false;
      reason: "NO_ACTIVE_EMBEDDING_INDEX" | "NO_TOPIC_SNAPSHOT";
    };

export type TopicSnapshotTermsForArticle = {
  articleId: string;
  topicId: string;
  topicKey: string;
  label: string | null;
  terms: Array<{ term: string; weight: number }>;
};

export type TopicSnapshotNearestTopic = {
  id: string;
  topicKey: string;
  label: string | null;
  terms: Array<{ term: string; weight: number }>;
  similarity: number;
  articleCount: number;
};

export class TopicSnapshotServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "TopicSnapshotServiceError";
  }
}

export type TopicSnapshotServiceOptions = {
  db: DibaoDatabase;
  databasePath?: string;
  runner?: TopicSnapshotRunner;
  runnerCommand?: string | null;
  runnerTokenizer?: string | null;
  now?: () => number;
  runIdFactory?: () => string;
};

export class TopicSnapshotService {
  private readonly now: () => number;
  private readonly runIdFactory: () => string;
  private readonly runnerCommand: string | null;
  private readonly runnerTokenizer: TopicSnapshotTokenizer;

  constructor(private readonly options: TopicSnapshotServiceOptions) {
    this.now = options.now ?? Date.now;
    this.runIdFactory = options.runIdFactory ?? randomRunId;
    this.runnerCommand =
      options.runnerCommand === undefined
        ? process.env.DIBAO_TOPIC_SNAPSHOT_COMMAND?.trim() || null
        : options.runnerCommand?.trim() || null;
    this.runnerTokenizer = normalizeTopicSnapshotTokenizer(
      options.runnerTokenizer === undefined
        ? process.env.DIBAO_TOPIC_SNAPSHOT_TOKENIZER
        : options.runnerTokenizer
    );
  }

  isRunnerConfigured(): boolean {
    return Boolean(this.options.runner || (this.runnerCommand && this.options.databasePath));
  }

  async handleTopicSnapshotRebuildJob(job: JobRow): Promise<TopicSnapshotRebuildResult> {
    const payload = parseTopicSnapshotRebuildPayload(job.payloadJson);
    if (!payload) {
      throw new TopicSnapshotServiceError(
        "INVALID_TOPIC_SNAPSHOT_REBUILD_PAYLOAD",
        "Invalid topic_snapshot_rebuild job payload"
      );
    }
    return this.rebuildActiveIndexSnapshot(payload);
  }

  async rebuildActiveIndexSnapshot(
    options: TopicSnapshotRebuildOptions = {}
  ): Promise<TopicSnapshotRebuildResult> {
    const activeIndexId = this.activeEmbeddingIndexId();
    if (!activeIndexId) {
      throw new TopicSnapshotServiceError(
        "NO_ACTIVE_EMBEDDING_INDEX",
        "No active embedding index is available for topic snapshot rebuild"
      );
    }

    const normalized = normalizeRebuildOptions(options);
    const scopeJson = JSON.stringify({
      days: normalized.scopeDays,
      maxArticles: normalized.maxArticles,
      candidateQuery: TOPIC_SNAPSHOT_CANDIDATE_QUERY
    });
    const paramsJson = JSON.stringify({
      maxArticles: normalized.maxArticles,
      scopeDays: normalized.scopeDays,
      minTopicSize: normalized.minTopicSize,
      minArticles: normalized.minArticles,
      tokenizer: this.runnerTokenizer
    });

    if (!this.isRunnerConfigured()) {
      const runId = this.createRun({
        embeddingIndexId: activeIndexId,
        algorithm: "local_fallback",
        scopeJson,
        paramsJson
      });
      this.failRun(runId, TOPIC_SNAPSHOT_RUNNER_UNAVAILABLE, {
        articleCount: 0,
        topicCount: 0
      });
      throw new TopicSnapshotServiceError(
        TOPIC_SNAPSHOT_RUNNER_UNAVAILABLE,
        "Topic snapshot runner is not configured"
      );
    }

    const stats = this.candidateStats(activeIndexId, normalized);
    if (stats.currentEmbeddingCount < normalized.minArticles) {
      const runId = this.createRun({
        embeddingIndexId: activeIndexId,
        algorithm: this.expectedAlgorithm(),
        scopeJson,
        paramsJson
      });
      const error = `INSUFFICIENT_CURRENT_EMBEDDINGS: ${stats.currentEmbeddingCount} current embeddings available, ${normalized.minArticles} required`;
      this.failRun(runId, error, {
        articleCount: stats.currentEmbeddingCount,
        topicCount: 0,
        skippedMissingEmbeddingCount: stats.missingEmbeddingCount,
        skippedStaleEmbeddingCount: stats.staleEmbeddingCount
      });
      return {
        runId,
        embeddingIndexId: activeIndexId,
        status: "failed",
        articleCount: stats.currentEmbeddingCount,
        topicCount: 0,
        skippedMissingEmbeddingCount: stats.missingEmbeddingCount,
        skippedStaleEmbeddingCount: stats.staleEmbeddingCount,
        error
      };
    }

    const runId = this.createRun({
      embeddingIndexId: activeIndexId,
      algorithm: this.expectedAlgorithm(),
      scopeJson,
      paramsJson
    });

    try {
      const output = await this.runRunner({
        embeddingIndexId: activeIndexId,
        maxArticles: normalized.maxArticles,
        scopeDays: normalized.scopeDays,
        minTopicSize: normalized.minTopicSize
      });
      return this.importRunnerOutput(runId, output, stats);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.failRun(runId, message, {
        articleCount: stats.currentEmbeddingCount,
        topicCount: 0,
        skippedMissingEmbeddingCount: stats.missingEmbeddingCount,
        skippedStaleEmbeddingCount: stats.staleEmbeddingCount
      });
      throw error;
    }
  }

  importRunnerOutput(
    runId: string,
    output: TopicSnapshotRunnerOutput,
    stats?: CandidateStats
  ): TopicSnapshotRebuildResult {
    const run = this.findRunById(runId);
    if (!run) {
      throw new TopicSnapshotServiceError("TOPIC_SNAPSHOT_RUN_NOT_FOUND", "Topic snapshot run not found");
    }
    if (output.embeddingIndexId !== run.embeddingIndexId) {
      throw new TopicSnapshotServiceError(
        "TOPIC_SNAPSHOT_INDEX_MISMATCH",
        "Runner output embedding index does not match the run",
        {
          runEmbeddingIndexId: run.embeddingIndexId,
          outputEmbeddingIndexId: output.embeddingIndexId
        }
      );
    }
    if (!isTopicSnapshotAlgorithm(output.algorithm)) {
      throw new TopicSnapshotServiceError(
        "TOPIC_SNAPSHOT_INVALID_ALGORITHM",
        "Runner output algorithm is not supported"
      );
    }

    const assignmentArticleIds = uniqueStrings(
      output.topics.flatMap((topic) => topic.assignments.map((assignment) => assignment.articleId))
    );
    const currentVectors = this.currentArticleVectors(run.embeddingIndexId, assignmentArticleIds);
    const assignedArticleIds = new Set<string>();
    const now = this.now();
    let topicCount = 0;

    this.options.db.transaction(() => {
      this.options.db.prepare("delete from corpus_topics where run_id = ?").run(runId);

      const insertTopic = this.options.db.prepare(
        `
          insert into corpus_topics (
            id,
            run_id,
            topic_key,
            label,
            top_terms_json,
            representative_articles_json,
            article_count,
            centroid_vector_blob,
            confidence,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      );
      const insertArticle = this.options.db.prepare(
        `
          insert into corpus_topic_articles (
            run_id,
            topic_id,
            article_id,
            assignment_score,
            is_representative,
            created_at
          )
          values (?, ?, ?, ?, ?, ?)
        `
      );

      for (const topic of output.topics) {
        const topicKey = String(topic.topicKey).trim();
        if (!topicKey) {
          continue;
        }
        const representativeArticleIds = new Set(
          topic.representativeArticles.map((article) => article.articleId)
        );
        const topicAssignments = topic.assignments
          .filter((assignment) => {
            if (assignedArticleIds.has(assignment.articleId)) {
              return false;
            }
            return currentVectors.has(assignment.articleId);
          })
          .slice(0, DEFAULT_TOPIC_SNAPSHOT_MAX_ARTICLES);
        if (topicAssignments.length === 0) {
          continue;
        }

        const vectors = topicAssignments.map(
          (assignment) => currentVectors.get(assignment.articleId)!.vector
        );
        const topicId = topicIdFor(runId, topicKey);
        const representativeArticles = this.representativeArticlesForTopic(
          topic,
          currentVectors,
          representativeArticleIds
        );
        const topTerms = normalizeTopTerms(topic.topTerms);

        insertTopic.run(
          topicId,
          runId,
          topicKey,
          normalizeOptionalString(topic.label),
          JSON.stringify(topTerms),
          JSON.stringify(representativeArticles),
          topicAssignments.length,
          toVectorBlob(centroidForVectors(vectors)),
          roundMetric(clamp(topic.confidence ?? 0, 0, 1)),
          now,
          now
        );

        for (const assignment of topicAssignments) {
          assignedArticleIds.add(assignment.articleId);
          insertArticle.run(
            runId,
            topicId,
            assignment.articleId,
            normalizeOptionalNumber(assignment.assignmentScore),
            assignment.isRepresentative || representativeArticleIds.has(assignment.articleId) ? 1 : 0,
            now
          );
        }
        topicCount += 1;
      }

      if (topicCount === 0) {
        throw new TopicSnapshotServiceError(
          "TOPIC_SNAPSHOT_EMPTY_OUTPUT",
          "Topic snapshot runner did not produce any usable topics"
        );
      }

      this.options.db
        .prepare(
          `
            update corpus_topic_runs
            set
              status = 'succeeded',
              algorithm = ?,
              algorithm_version = ?,
              params_json = ?,
              article_count = ?,
              topic_count = ?,
              skipped_missing_embedding_count = ?,
              skipped_stale_embedding_count = ?,
              finished_at = ?,
              error = null,
              updated_at = ?
            where id = ?
          `
        )
        .run(
          output.algorithm,
          output.algorithmVersion ?? null,
          JSON.stringify(output.params ?? {}),
          assignedArticleIds.size,
          topicCount,
          Math.max(stats?.missingEmbeddingCount ?? 0, output.skipped?.missingEmbeddingCount ?? 0),
          Math.max(stats?.staleEmbeddingCount ?? 0, output.skipped?.staleEmbeddingCount ?? 0),
          now,
          now,
          runId
        );
    })();

    const finished = this.findRunById(runId);
    return {
      runId,
      embeddingIndexId: run.embeddingIndexId,
      status: "succeeded",
      articleCount: finished?.articleCount ?? assignedArticleIds.size,
      topicCount: finished?.topicCount ?? topicCount,
      skippedMissingEmbeddingCount: finished?.skippedMissingEmbeddingCount ?? 0,
      skippedStaleEmbeddingCount: finished?.skippedStaleEmbeddingCount ?? 0,
      error: null
    };
  }

  getLatestSuccessfulRun(embeddingIndexId: string): TopicSnapshotRunRow | null {
    const row = this.options.db
      .prepare(
        `
          ${runSelect()}
          where embedding_index_id = ?
            and status = 'succeeded'
          order by finished_at desc, created_at desc, id
          limit 1
        `
      )
      .get(embeddingIndexId) as TopicSnapshotRunRow | undefined;
    return row ?? null;
  }

  getLatestSnapshotForActiveIndex(): TopicSnapshotLatestResponse {
    const activeIndexId = this.activeEmbeddingIndexId();
    if (!activeIndexId) {
      return { available: false, reason: "NO_ACTIVE_EMBEDDING_INDEX" };
    }

    const run = this.getLatestSuccessfulRun(activeIndexId);
    if (!run) {
      return { available: false, reason: "NO_TOPIC_SNAPSHOT" };
    }

    const topics = this.listTopics(run.id, 20).map((topic) => ({
      id: topic.id,
      topicKey: topic.topicKey,
      label: topic.label,
      topTerms: parseTopTerms(topic.topTermsJson).map((term) => term.term),
      articleCount: topic.articleCount,
      representativeArticles: parseRepresentativeArticles(topic.representativeArticlesJson)
    }));

    return {
      available: true,
      run: {
        id: run.id,
        embeddingIndexId: run.embeddingIndexId,
        status: "succeeded",
        algorithm: run.algorithm,
        articleCount: run.articleCount,
        topicCount: run.topicCount,
        createdAt: run.createdAt,
        finishedAt: run.finishedAt
      },
      topics
    };
  }

  listTopicTermsForArticles(
    runId: string,
    articleIds: string[]
  ): TopicSnapshotTermsForArticle[] {
    const uniqueArticleIds = uniqueStrings(articleIds);
    if (uniqueArticleIds.length === 0) {
      return [];
    }

    const rows: Array<{
      articleId: string;
      topicId: string;
      topicKey: string;
      label: string | null;
      topTermsJson: string;
    }> = [];
    for (const chunk of chunks(uniqueArticleIds, 500)) {
      const placeholders = chunk.map(() => "?").join(", ");
      rows.push(
        ...(
          this.options.db
            .prepare(
              `
                select
                  cta.article_id as articleId,
                  ct.id as topicId,
                  ct.topic_key as topicKey,
                  ct.label,
                  ct.top_terms_json as topTermsJson
                from corpus_topic_articles cta
                join corpus_topics ct on ct.id = cta.topic_id
                where cta.run_id = ?
                  and cta.article_id in (${placeholders})
              `
            )
            .all(runId, ...chunk) as Array<{
            articleId: string;
            topicId: string;
            topicKey: string;
            label: string | null;
            topTermsJson: string;
          }>
        )
      );
    }

    return rows.map((row) => ({
      articleId: row.articleId,
      topicId: row.topicId,
      topicKey: row.topicKey,
      label: row.label,
      terms: parseTopTerms(row.topTermsJson)
    }));
  }

  findNearestTopicsForCluster(
    clusterCentroid: Buffer | readonly number[],
    runId: string,
    limit: number = 3
  ): TopicSnapshotNearestTopic[] {
    const centroid = Buffer.isBuffer(clusterCentroid)
      ? fromVectorBlob(clusterCentroid)
      : Array.from(clusterCentroid);
    return this.options.db
      .prepare(
        `
          ${topicSelect()}
          where run_id = ?
            and centroid_vector_blob is not null
          order by article_count desc, topic_key
        `
      )
      .all(runId)
      .map((topic) => {
        const row = topic as CorpusTopicRow;
        return {
          id: row.id,
          topicKey: row.topicKey,
          label: row.label,
          terms: parseTopTerms(row.topTermsJson),
          similarity: cosineSimilarity(centroid, fromVectorBlob(row.centroidVectorBlob!)),
          articleCount: row.articleCount
        };
      })
      .sort((left, right) => right.similarity - left.similarity || right.articleCount - left.articleCount)
      .slice(0, Math.max(1, Math.min(20, limit)));
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

  private candidateStats(
    embeddingIndexId: string,
    options: Required<TopicSnapshotRebuildOptions>
  ): CandidateStats {
    const cutoff = this.now() - options.scopeDays * DAY_MS;
    const rows = this.options.db
      .prepare(
        `
          select
            articleId,
            contentHash,
            embeddingContentHash,
            hasVector
          from (
            select
              a.id as articleId,
              coalesce(a.content_hash, a.id || ':' || a.updated_at) as contentHash,
              ae.content_hash as embeddingContentHash,
              case when ae.vector_blob is not null then 1 else 0 end as hasVector,
              coalesce(a.published_at, a.discovered_at) as articleTime
            from articles a
            join feeds f on f.id = a.feed_id
            left join article_contents ac on ac.article_id = a.id
            left join article_embeddings ae
              on ae.article_id = a.id
             and ae.embedding_index_id = ?
            where f.enabled = 1
              and f.deleted_at is null
              and a.deleted_at is null
              and a.status != 'deleted'
              and coalesce(a.published_at, a.discovered_at) >= ?
              and (
                trim(coalesce(a.title, '')) != ''
                or trim(coalesce(a.summary, '')) != ''
                or trim(substr(coalesce(ac.content_text, ''), 1, 256)) != ''
              )
            order by articleTime desc, a.id
            limit ?
          )
        `
      )
      .all(embeddingIndexId, cutoff, options.maxArticles) as Array<{
      articleId: string;
      contentHash: string;
      embeddingContentHash: string | null;
      hasVector: 0 | 1;
    }>;

    let currentEmbeddingCount = 0;
    let missingEmbeddingCount = 0;
    let staleEmbeddingCount = 0;

    for (const row of rows) {
      if (!row.embeddingContentHash || row.hasVector === 0) {
        missingEmbeddingCount += 1;
      } else if (row.embeddingContentHash !== row.contentHash) {
        staleEmbeddingCount += 1;
      } else {
        currentEmbeddingCount += 1;
      }
    }

    return {
      articleCount: rows.length,
      currentEmbeddingCount,
      missingEmbeddingCount,
      staleEmbeddingCount
    };
  }

  private createRun(input: {
    embeddingIndexId: string;
    algorithm: TopicSnapshotAlgorithm;
    scopeJson: string;
    paramsJson: string;
  }): string {
    const now = this.now();
    const runId = this.runIdFactory();
    this.options.db
      .prepare(
        `
          insert into corpus_topic_runs (
            id,
            embedding_index_id,
            status,
            algorithm,
            algorithm_version,
            scope_json,
            params_json,
            article_count,
            topic_count,
            skipped_missing_embedding_count,
            skipped_stale_embedding_count,
            started_at,
            finished_at,
            error,
            created_at,
            updated_at
          )
          values (?, ?, 'running', ?, null, ?, ?, 0, 0, 0, 0, ?, null, null, ?, ?)
        `
      )
      .run(
        runId,
        input.embeddingIndexId,
        input.algorithm,
        input.scopeJson,
        input.paramsJson,
        now,
        now,
        now
      );
    return runId;
  }

  private failRun(
    runId: string,
    error: string,
    counts: {
      articleCount?: number;
      topicCount?: number;
      skippedMissingEmbeddingCount?: number;
      skippedStaleEmbeddingCount?: number;
    } = {}
  ): void {
    const now = this.now();
    this.options.db
      .prepare(
        `
          update corpus_topic_runs
          set
            status = 'failed',
            article_count = ?,
            topic_count = ?,
            skipped_missing_embedding_count = ?,
            skipped_stale_embedding_count = ?,
            finished_at = ?,
            error = ?,
            updated_at = ?
          where id = ?
        `
      )
      .run(
        counts.articleCount ?? 0,
        counts.topicCount ?? 0,
        counts.skippedMissingEmbeddingCount ?? 0,
        counts.skippedStaleEmbeddingCount ?? 0,
        now,
        error,
        now,
        runId
      );
  }

  private findRunById(runId: string): TopicSnapshotRunRow | null {
    const row = this.options.db
      .prepare(
        `
          ${runSelect()}
          where id = ?
        `
      )
      .get(runId) as TopicSnapshotRunRow | undefined;
    return row ?? null;
  }

  private async runRunner(
    input: Required<Pick<TopicSnapshotRebuildOptions, "maxArticles" | "scopeDays" | "minTopicSize">> & {
      embeddingIndexId: string;
    }
  ): Promise<TopicSnapshotRunnerOutput> {
    if (this.options.runner) {
      if (!this.options.databasePath) {
        return this.options.runner({
          ...input,
          dbPath: ":memory:",
          tokenizer: this.runnerTokenizer
        });
      }
      return this.options.runner({
        ...input,
        dbPath: this.options.databasePath,
        tokenizer: this.runnerTokenizer
      });
    }

    if (!this.runnerCommand || !this.options.databasePath) {
      throw new TopicSnapshotServiceError(
        TOPIC_SNAPSHOT_RUNNER_UNAVAILABLE,
        "Topic snapshot runner is not configured"
      );
    }

    const tempDir = mkdtempSync(join(tmpdir(), "dibao-topic-snapshot-"));
    const outputPath = join(tempDir, "snapshot.json");
    try {
      await runCommand(this.runnerCommand, [
        "--db",
        this.options.databasePath,
        "--embedding-index-id",
        input.embeddingIndexId,
        "--max-articles",
        String(input.maxArticles),
        "--scope-days",
        String(input.scopeDays),
        "--min-topic-size",
        String(input.minTopicSize),
        "--tokenizer",
        this.runnerTokenizer,
        "--output",
        outputPath
      ]);
      return parseRunnerOutput(JSON.parse(readFileSync(outputPath, "utf8")) as unknown);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  private expectedAlgorithm(): TopicSnapshotAlgorithm {
    return this.options.runner ? "fixture" : "bertopic_precomputed_embeddings";
  }

  private currentArticleVectors(
    embeddingIndexId: string,
    articleIds: string[]
  ): Map<string, CurrentArticleVector> {
    const result = new Map<string, CurrentArticleVector>();
    if (articleIds.length === 0) {
      return result;
    }

    for (const chunk of chunks(articleIds, 500)) {
      const placeholders = chunk.map(() => "?").join(", ");
      const rows = this.options.db
        .prepare(
          `
            select
              a.id as articleId,
              a.title,
              f.title as feedTitle,
              ae.vector_blob as vectorBlob
            from articles a
            join feeds f on f.id = a.feed_id
            left join article_contents ac on ac.article_id = a.id
            join article_embeddings ae
              on ae.article_id = a.id
             and ae.embedding_index_id = ?
             and ae.content_hash = coalesce(a.content_hash, a.id || ':' || a.updated_at)
            where a.id in (${placeholders})
              and f.enabled = 1
              and f.deleted_at is null
              and a.deleted_at is null
              and a.status != 'deleted'
              and (
                trim(coalesce(a.title, '')) != ''
                or trim(coalesce(a.summary, '')) != ''
                or trim(substr(coalesce(ac.content_text, ''), 1, 256)) != ''
              )
          `
        )
        .all(embeddingIndexId, ...chunk) as Array<{
        articleId: string;
        title: string;
        feedTitle: string;
        vectorBlob: Buffer;
      }>;

      for (const row of rows) {
        result.set(row.articleId, {
          articleId: row.articleId,
          title: row.title,
          feedTitle: row.feedTitle,
          vector: fromVectorBlob(row.vectorBlob)
        });
      }
    }

    return result;
  }

  private representativeArticlesForTopic(
    topic: TopicSnapshotOutputTopic,
    currentVectors: Map<string, CurrentArticleVector>,
    representativeArticleIds: Set<string>
  ): Array<{ articleId: string; title: string; feedTitle: string; score: number | null }> {
    return topic.representativeArticles
      .filter((article) => currentVectors.has(article.articleId))
      .slice(0, 8)
      .map((article) => {
        const current = currentVectors.get(article.articleId)!;
        representativeArticleIds.add(article.articleId);
        return {
          articleId: article.articleId,
          title: normalizeOptionalString(article.title) ?? current.title,
          feedTitle: normalizeOptionalString(article.feedTitle) ?? current.feedTitle,
          score: normalizeOptionalNumber(article.score)
        };
      });
  }

  private listTopics(runId: string, limit: number): CorpusTopicRow[] {
    return this.options.db
      .prepare(
        `
          ${topicSelect()}
          where run_id = ?
          order by article_count desc, confidence desc, topic_key
          limit ?
        `
      )
      .all(runId, Math.max(1, Math.min(200, limit))) as CorpusTopicRow[];
  }
}

export function parseTopicSnapshotRebuildPayload(
  payloadJson: string | null
): TopicSnapshotRebuildOptions | null {
  if (payloadJson === null) {
    return {};
  }

  try {
    const payload = JSON.parse(payloadJson) as unknown;
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return null;
    }
    const allowedKeys = ["maxArticles", "scopeDays", "minTopicSize"] as const;
    if (!Object.keys(payload).every((key) => allowedKeys.includes(key as (typeof allowedKeys)[number]))) {
      return null;
    }
    const parsed: TopicSnapshotRebuildOptions = {};
    for (const key of allowedKeys) {
      const value = (payload as Record<string, unknown>)[key];
      if (value === undefined) {
        continue;
      }
      if (!Number.isInteger(value) || (value as number) < 1) {
        return null;
      }
      parsed[key] = value as number;
    }
    return parsed;
  } catch {
    return null;
  }
}

function normalizeRebuildOptions(
  options: TopicSnapshotRebuildOptions
): Required<TopicSnapshotRebuildOptions> {
  return {
    maxArticles: normalizeInteger(
      options.maxArticles,
      DEFAULT_TOPIC_SNAPSHOT_MAX_ARTICLES,
      20,
      DEFAULT_TOPIC_SNAPSHOT_MAX_ARTICLES
    ),
    scopeDays: normalizeInteger(options.scopeDays, DEFAULT_TOPIC_SNAPSHOT_SCOPE_DAYS, 1, 3650),
    minTopicSize: normalizeInteger(
      options.minTopicSize,
      DEFAULT_TOPIC_SNAPSHOT_MIN_TOPIC_SIZE,
      2,
      500
    ),
    minArticles: normalizeInteger(
      options.minArticles,
      DEFAULT_TOPIC_SNAPSHOT_MIN_ARTICLES,
      1,
      DEFAULT_TOPIC_SNAPSHOT_MAX_ARTICLES
    )
  };
}

function normalizeInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (!Number.isInteger(value)) {
    return fallback;
  }
  const integerValue = value as number;
  return Math.min(Math.max(integerValue, min), max);
}

function parseRunnerOutput(value: unknown): TopicSnapshotRunnerOutput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TopicSnapshotServiceError("TOPIC_SNAPSHOT_INVALID_OUTPUT", "Runner output must be an object");
  }
  const output = value as Partial<TopicSnapshotRunnerOutput>;
  if (
    !isTopicSnapshotAlgorithm(output.algorithm) ||
    typeof output.embeddingIndexId !== "string" ||
    output.embeddingIndexId.trim() === "" ||
    !Array.isArray(output.topics)
  ) {
    throw new TopicSnapshotServiceError("TOPIC_SNAPSHOT_INVALID_OUTPUT", "Runner output is missing required fields");
  }
  return {
    algorithm: output.algorithm,
    algorithmVersion:
      typeof output.algorithmVersion === "string" ? output.algorithmVersion : null,
    embeddingIndexId: output.embeddingIndexId,
    params:
      typeof output.params === "object" && output.params !== null && !Array.isArray(output.params)
        ? output.params
        : {},
    articleCount: Number.isFinite(output.articleCount) ? Number(output.articleCount) : 0,
    topics: output.topics,
    skipped:
      typeof output.skipped === "object" && output.skipped !== null
        ? output.skipped
        : {
            missingEmbeddingCount: 0,
            staleEmbeddingCount: 0
          }
  };
}

function normalizeTopTerms(
  values: Array<{ term: string; weight: number }>
): Array<{ term: string; weight: number }> {
  return values
    .filter((item) => typeof item.term === "string" && item.term.trim() !== "")
    .slice(0, 24)
    .map((item) => ({
      term: item.term.trim().slice(0, 80),
      weight: roundMetric(Number.isFinite(item.weight) ? item.weight : 0)
    }));
}

function parseTopTerms(value: string): Array<{ term: string; weight: number }> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return normalizeTopTerms(
      parsed.filter(isTermWeight) as Array<{ term: string; weight: number }>
    );
  } catch {
    return [];
  }
}

function parseRepresentativeArticles(
  value: string
): Array<{ articleId: string; title: string; feedTitle: string; score: number | null }> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(
        (item): item is {
          articleId: string;
          title?: string;
          feedTitle?: string;
          score?: number | null;
        } =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as { articleId?: unknown }).articleId === "string"
      )
      .slice(0, 8)
      .map((item) => ({
        articleId: item.articleId,
        title: normalizeOptionalString(item.title) ?? item.articleId,
        feedTitle: normalizeOptionalString(item.feedTitle) ?? "",
        score: normalizeOptionalNumber(item.score)
      }));
  } catch {
    return [];
  }
}

function isTermWeight(value: unknown): value is { term: string; weight: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { term?: unknown }).term === "string" &&
    typeof (value as { weight?: unknown }).weight === "number"
  );
}

function centroidForVectors(vectors: number[][]): number[] {
  const dimension = vectors[0]?.length ?? 0;
  const centroid = Array.from({ length: dimension }, () => 0);
  for (const vector of vectors) {
    if (vector.length !== dimension) {
      continue;
    }
    for (let index = 0; index < dimension; index += 1) {
      centroid[index] += vector[index] ?? 0;
    }
  }
  return normalizeVector(centroid.map((value) => value / Math.max(vectors.length, 1)));
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function normalizeOptionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? roundMetric(value) : null;
}

function roundMetric(value: number): number {
  return Number(value.toFixed(6));
}

function topicIdFor(runId: string, topicKey: string): string {
  return `topic_${createHash("sha1").update(`${runId}:${topicKey}`).digest("hex").slice(0, 24)}`;
}

function randomRunId(): string {
  return `topic_run_${randomBytes(10).toString("hex")}`;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim() !== "")));
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function isTopicSnapshotAlgorithm(value: unknown): value is TopicSnapshotAlgorithm {
  return (
    value === "bertopic_precomputed_embeddings" ||
    value === "fixture" ||
    value === "local_fallback"
  );
}

function normalizeTopicSnapshotTokenizer(value: string | null | undefined): TopicSnapshotTokenizer {
  const normalized = value?.trim();
  return normalized === "zh" || normalized === "ja" || normalized === "mixed"
    ? normalized
    : "mixed";
}

function runSelect(): string {
  return `
    select
      id,
      embedding_index_id as embeddingIndexId,
      status,
      algorithm,
      algorithm_version as algorithmVersion,
      scope_json as scopeJson,
      params_json as paramsJson,
      article_count as articleCount,
      topic_count as topicCount,
      skipped_missing_embedding_count as skippedMissingEmbeddingCount,
      skipped_stale_embedding_count as skippedStaleEmbeddingCount,
      started_at as startedAt,
      finished_at as finishedAt,
      error,
      created_at as createdAt,
      updated_at as updatedAt
    from corpus_topic_runs
  `;
}

function topicSelect(): string {
  return `
    select
      id,
      run_id as runId,
      topic_key as topicKey,
      label,
      top_terms_json as topTermsJson,
      representative_articles_json as representativeArticlesJson,
      article_count as articleCount,
      centroid_vector_blob as centroidVectorBlob,
      confidence,
      created_at as createdAt,
      updated_at as updatedAt
    from corpus_topics
  `;
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = (stderr || stdout).trim();
      reject(
        new TopicSnapshotServiceError(
          "TOPIC_SNAPSHOT_RUNNER_FAILED",
          detail ? `Topic snapshot runner failed: ${detail}` : `Topic snapshot runner failed with exit code ${code}`
        )
      );
    });
  });
}
