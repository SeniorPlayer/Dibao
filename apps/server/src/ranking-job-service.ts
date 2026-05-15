import { randomBytes } from "node:crypto";
import type { JobRepository, JobRow } from "@dibao/db";
import { PermanentJobFailure } from "./job-runner.js";
import type { ArticleRankingRecalculator } from "./ranking-service.js";

export const RANKING_RECALCULATE_JOB_TYPE = "ranking_recalculate" as const;
export const RANKING_RECALCULATE_ARTICLE_LIMIT = 500;

export type RankingRecalculateJobPayload = {
  articleIds?: string[];
};

export type RankingRecalculateJobServiceOptions = {
  jobs: Pick<JobRepository, "enqueue" | "listOpenByType">;
  ranking: ArticleRankingRecalculator;
  now?: () => number;
  jobIdFactory?: () => string;
};

export class RankingRecalculateJobService {
  private readonly now: () => number;
  private readonly jobIdFactory: () => string;

  constructor(private readonly options: RankingRecalculateJobServiceOptions) {
    this.now = options.now ?? Date.now;
    this.jobIdFactory = options.jobIdFactory ?? randomJobId;
  }

  enqueueAll(): JobRow {
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
      runAfter: now,
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
      runAfter: now,
      now
    });
  }

  handleRankingRecalculateJob(job: JobRow): void {
    const payload = parseRankingRecalculatePayload(job.payloadJson);
    if (!payload) {
      throw new PermanentJobFailure("Invalid ranking_recalculate job payload");
    }

    if (payload.articleIds) {
      this.options.ranking.recalculateArticles(payload.articleIds);
    } else {
      this.options.ranking.recalculateAll();
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
