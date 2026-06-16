import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { JobRepository, JobRow } from "@dibao/db";
import { PermanentJobFailure } from "./job-runner.js";
import type { ArticleRankingRecalculator, RankingRecalculateChunkResult } from "./ranking-service.js";

export const RANKING_RECALCULATE_JOB_TYPE = "ranking_recalculate" as const;
export const RANKING_RECALCULATE_ARTICLE_LIMIT = 500;
export const RANKING_RECALCULATE_CHUNK_SIZE = 10;
export const RANKING_RECALCULATE_MAX_CHUNK_SIZE = 200;
export const RANKING_RECALCULATE_CHUNK_DELAY_MS = 5_000;
export const RANKING_RECALCULATE_TARGET_CHUNK_MS = 500;
export const RANKING_RECALCULATE_MIN_CHUNK_SIZE = 1;
export const RANKING_RECALCULATE_JOB_PRIORITY = -20;

export type RankingRecalculateJobPayload = {
  articleIds?: string[];
  cursor?: string | null;
  limit?: number;
};

export type RankingRecalculateEnqueueOptions = {
  delayMs?: number;
};

export type RankingRecalculateJobServiceOptions = {
  jobs: Pick<JobRepository, "enqueue" | "listOpenByType">;
  ranking: ArticleRankingRecalculator;
  now?: () => number;
  jobIdFactory?: () => string;
  targetChunkMs?: number;
  onChunk?: (record: {
    jobId: string;
    processed: number;
    durationMs: number;
    limit: number;
    nextLimit: number;
    nextCursor: string | null;
    paused: boolean;
    pauseReason?: "foreground" | "time_budget";
    resumeAfter: number | null;
  }) => void;
};

export class RankingRecalculateJobService {
  private readonly now: () => number;
  private readonly jobIdFactory: () => string;

  constructor(private readonly options: RankingRecalculateJobServiceOptions) {
    this.now = options.now ?? Date.now;
    this.jobIdFactory = options.jobIdFactory ?? randomJobId;
  }

  enqueueAll(options: RankingRecalculateEnqueueOptions = {}): JobRow {
    const existing = this.options.jobs
      .listOpenByType(RANKING_RECALCULATE_JOB_TYPE)
      .find((job) => {
        const payload = parseRankingRecalculatePayload(job.payloadJson);
        return payload && !payload.articleIds;
      });
    if (existing) {
      return existing;
    }

    const now = this.now();
    return this.options.jobs.enqueue({
      id: this.jobIdFactory(),
      type: RANKING_RECALCULATE_JOB_TYPE,
      payloadJson: null,
      maxAttempts: 2,
      priority: RANKING_RECALCULATE_JOB_PRIORITY,
      runAfter: now + Math.max(0, options.delayMs ?? 0),
      now
    });
  }

  enqueueArticles(articleIds: string[]): JobRow | null {
    const uniqueArticleIds = uniqueStrings(articleIds).slice(0, RANKING_RECALCULATE_ARTICLE_LIMIT);
    if (uniqueArticleIds.length === 0) {
      return null;
    }

    const openAll = this.options.jobs
      .listOpenByType(RANKING_RECALCULATE_JOB_TYPE)
      .some((job) => {
        const payload = parseRankingRecalculatePayload(job.payloadJson);
        return payload && !payload.articleIds;
      });
    if (openAll) {
      return null;
    }

    const now = this.now();
    return this.options.jobs.enqueue({
      id: this.jobIdFactory(),
      type: RANKING_RECALCULATE_JOB_TYPE,
      payloadJson: JSON.stringify({ articleIds: uniqueArticleIds } satisfies RankingRecalculateJobPayload),
      maxAttempts: 2,
      priority: RANKING_RECALCULATE_JOB_PRIORITY,
      runAfter: now,
      now
    });
  }

  handleRankingRecalculateJob(job: JobRow): {
    processed: number;
    nextCursor: string | null;
    paused: boolean;
  } {
    const payload = parseRankingRecalculatePayload(job.payloadJson);
    if (!payload) {
      throw new PermanentJobFailure("Invalid ranking_recalculate job payload");
    }

    if (payload.articleIds) {
      const processed = this.options.ranking.recalculateArticles(payload.articleIds);
      return {
        processed,
        nextCursor: null,
        paused: false
      };
    } else {
      const limit = normalizeRankingChunkLimit(payload.limit);
      const startedAt = performance.now();
      const result: RankingRecalculateChunkResult = this.options.ranking.recalculateChunk
        ? this.options.ranking.recalculateChunk({
            cursor: payload.cursor ?? null,
            limit
          })
        : {
            processed: this.options.ranking.recalculateAll(),
            nextCursor: null
          };
      const durationMs = performance.now() - startedAt;
      const nextLimit = result.paused === true && result.processed === 0 && result.pauseReason !== "time_budget"
        ? limit
        : adaptiveNextLimit(
            limit,
            durationMs,
            this.options.targetChunkMs ?? RANKING_RECALCULATE_TARGET_CHUNK_MS
          );
      this.options.onChunk?.({
        jobId: job.id,
        processed: result.processed,
        durationMs,
        limit,
        nextLimit,
        nextCursor: result.nextCursor,
        paused: result.paused === true,
        pauseReason: result.pauseReason,
        resumeAfter: result.resumeAfter ?? null
      });
      if (result.nextCursor || result.paused === true) {
        const now = this.now();
        this.options.jobs.enqueue({
          id: this.jobIdFactory(),
          type: RANKING_RECALCULATE_JOB_TYPE,
          payloadJson: JSON.stringify({
            cursor: result.nextCursor ?? null,
            limit: nextLimit
          } satisfies RankingRecalculateJobPayload),
          maxAttempts: 2,
          priority: RANKING_RECALCULATE_JOB_PRIORITY,
          runAfter: result.paused === true
            ? Math.max(now, result.resumeAfter ?? now + RANKING_RECALCULATE_CHUNK_DELAY_MS)
            : now + RANKING_RECALCULATE_CHUNK_DELAY_MS,
          now
        });
      }
      return {
        processed: result.processed,
        nextCursor: result.nextCursor,
        paused: result.paused === true
      };
    }
  }
}

export function parseRankingRecalculatePayload(
  payloadJson: string | null
): RankingRecalculateJobPayload | null {
  if (payloadJson === null) {
    return {};
  }

  try {
    const payload = JSON.parse(payloadJson) as unknown;
    if (
      typeof payload === "object" &&
      payload !== null &&
      !Array.isArray(payload) &&
      Object.keys(payload).length === 0
    ) {
      return {};
    }

    if (
      typeof payload === "object" &&
      payload !== null &&
      !Array.isArray(payload) &&
      Object.keys(payload).every((key) => key === "cursor" || key === "limit") &&
      (payload as { cursor?: unknown }).cursor !== undefined &&
      ((payload as { cursor?: unknown }).cursor === null ||
        (typeof (payload as { cursor?: unknown }).cursor === "string" &&
          (payload as { cursor: string }).cursor.trim() !== "")) &&
      ((payload as { limit?: unknown }).limit === undefined ||
        (typeof (payload as { limit?: unknown }).limit === "number" &&
          Number.isInteger((payload as { limit: number }).limit) &&
          (payload as { limit: number }).limit >= 1 &&
          (payload as { limit: number }).limit <= RANKING_RECALCULATE_ARTICLE_LIMIT))
    ) {
      return {
        cursor: (payload as { cursor: string | null }).cursor,
        limit: (payload as { limit?: number }).limit
      };
    }

    if (
      typeof payload === "object" &&
      payload !== null &&
      !Array.isArray(payload) &&
      Object.keys(payload).length === 1 &&
      Array.isArray((payload as { articleIds?: unknown }).articleIds) &&
      (payload as { articleIds: unknown[] }).articleIds.length >= 1 &&
      (payload as { articleIds: unknown[] }).articleIds.length <=
        RANKING_RECALCULATE_ARTICLE_LIMIT &&
      (payload as { articleIds: unknown[] }).articleIds.every(
        (value) => typeof value === "string" && value.trim() !== ""
      )
    ) {
      return {
        articleIds: uniqueStrings((payload as { articleIds: string[] }).articleIds)
      };
    }
  } catch {
    return null;
  }

  return null;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function randomJobId(): string {
  return `job_rank_${randomBytes(10).toString("hex")}`;
}

function adaptiveNextLimit(limit: number, durationMs: number, targetMs: number): number {
  const normalizedLimit = normalizeRankingChunkLimit(limit);
  if (targetMs <= 0) {
    return normalizedLimit;
  }

  if (
    durationMs > targetMs * 1.25 &&
    normalizedLimit > RANKING_RECALCULATE_MIN_CHUNK_SIZE
  ) {
    return normalizeRankingChunkLimit(Math.floor(normalizedLimit / 2));
  }

  if (
    durationMs < targetMs * 0.35 &&
    normalizedLimit < RANKING_RECALCULATE_MAX_CHUNK_SIZE
  ) {
    return normalizeRankingChunkLimit(
      Math.max(
        normalizedLimit + RANKING_RECALCULATE_MIN_CHUNK_SIZE,
        Math.ceil(normalizedLimit * 1.5)
      )
    );
  }

  return normalizedLimit;
}

function normalizeRankingChunkLimit(limit: number | undefined): number {
  const normalized = Number.isInteger(limit) && limit !== undefined
    ? limit
    : RANKING_RECALCULATE_CHUNK_SIZE;
  return Math.max(
    RANKING_RECALCULATE_MIN_CHUNK_SIZE,
    Math.min(RANKING_RECALCULATE_MAX_CHUNK_SIZE, normalized)
  );
}
