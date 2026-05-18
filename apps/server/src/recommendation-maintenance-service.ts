import { createHash, randomBytes } from "node:crypto";
import type { DibaoDatabase, JobRepository, JobRow, JobType } from "@dibao/db";
import { PermanentJobFailure } from "./job-runner.js";
import type { RankingRecalculateJobService } from "./ranking-job-service.js";

export const ARTICLE_FINGERPRINT_BACKFILL_JOB_TYPE = "article_fingerprint_backfill" as const;
export const DUPLICATE_GROUP_REBUILD_JOB_TYPE = "duplicate_group_rebuild" as const;
export const KEYWORD_PROFILE_REBUILD_JOB_TYPE = "keyword_profile_rebuild" as const;
export const RANKING_EVAL_RUN_JOB_TYPE = "ranking_eval_run" as const;
export const FTRL_TRAIN_JOB_TYPE = "ftrl_train" as const;
export const RECOMMENDATION_BACKFILL_JOB_TYPE = "recommendation_backfill" as const;

type MaintenanceJobType =
  | typeof ARTICLE_FINGERPRINT_BACKFILL_JOB_TYPE
  | typeof DUPLICATE_GROUP_REBUILD_JOB_TYPE
  | typeof KEYWORD_PROFILE_REBUILD_JOB_TYPE
  | typeof RANKING_EVAL_RUN_JOB_TYPE
  | typeof FTRL_TRAIN_JOB_TYPE
  | typeof RECOMMENDATION_BACKFILL_JOB_TYPE;

export type RecommendationMaintenanceResult = {
  jobId: string;
  existing: boolean;
};

export type RecommendationMaintenanceServiceOptions = {
  db: DibaoDatabase;
  jobs: Pick<JobRepository, "enqueue" | "listOpenByType">;
  rankingJobs: Pick<RankingRecalculateJobService, "enqueueAll">;
  now?: () => number;
  jobIdFactory?: () => string;
};

export class RecommendationMaintenanceService {
  private readonly now: () => number;
  private readonly jobIdFactory: () => string;

  constructor(private readonly options: RecommendationMaintenanceServiceOptions) {
    this.now = options.now ?? Date.now;
    this.jobIdFactory = options.jobIdFactory ?? randomJobId;
  }

  enqueueRecalculate(): RecommendationMaintenanceResult {
    const job = this.options.rankingJobs.enqueueAll();
    return { jobId: job.id, existing: job.status === "queued" || job.status === "running" };
  }

  enqueueFingerprintBackfill(): RecommendationMaintenanceResult {
    return this.enqueueUnique(ARTICLE_FINGERPRINT_BACKFILL_JOB_TYPE);
  }

  enqueueDuplicateRebuild(): RecommendationMaintenanceResult {
    return this.enqueueUnique(DUPLICATE_GROUP_REBUILD_JOB_TYPE);
  }

  enqueueKeywordRebuild(): RecommendationMaintenanceResult {
    return this.enqueueUnique(KEYWORD_PROFILE_REBUILD_JOB_TYPE);
  }

  enqueueEvaluation(): RecommendationMaintenanceResult {
    return this.enqueueUnique(RANKING_EVAL_RUN_JOB_TYPE);
  }

  resetFtrl(): { ok: true } {
    this.options.db.transaction(() => {
      this.options.db.prepare("delete from rank_model_weights").run();
      this.options.db.prepare("delete from rank_training_examples").run();
      this.options.db
        .prepare("update rank_model_versions set status = 'retired', updated_at = ? where status != 'retired'")
        .run(this.now());
    })();
    return { ok: true };
  }

  handleJob(job: JobRow): void {
    if (job.payloadJson !== null && job.payloadJson !== "{}") {
      throw new PermanentJobFailure(`Invalid ${job.type} job payload`);
    }

    switch (job.type) {
      case ARTICLE_FINGERPRINT_BACKFILL_JOB_TYPE:
        this.backfillFingerprints();
        return;
      case DUPLICATE_GROUP_REBUILD_JOB_TYPE:
        this.rebuildDuplicateGroups();
        return;
      case KEYWORD_PROFILE_REBUILD_JOB_TYPE:
        this.rebuildKeywordProfile();
        return;
      case RANKING_EVAL_RUN_JOB_TYPE:
        this.runDiagnosticEvaluation();
        return;
      case FTRL_TRAIN_JOB_TYPE:
      case RECOMMENDATION_BACKFILL_JOB_TYPE:
        this.touchBackfillState(job.type, "succeeded", null);
        return;
      default:
        throw new PermanentJobFailure(`Unsupported recommendation maintenance job: ${job.type}`);
    }
  }

  private enqueueUnique(type: MaintenanceJobType): RecommendationMaintenanceResult {
    const existing = this.options.jobs.listOpenByType(type)[0];
    if (existing) {
      return { jobId: existing.id, existing: true };
    }

    const now = this.now();
    const job = this.options.jobs.enqueue({
      id: this.jobIdFactory(),
      type,
      payloadJson: null,
      maxAttempts: 1,
      now,
      runAfter: now
    });
    return { jobId: job.id, existing: false };
  }

  private backfillFingerprints(): void {
    const now = this.now();
    const rows = this.options.db
      .prepare(
        `
          select
            id,
            dedupe_key as dedupeKey,
            content_hash as contentHash,
            canonical_url as canonicalUrl,
            url,
            title,
            summary
          from articles
          where deleted_at is null
            and status != 'deleted'
        `
      )
      .all() as Array<{
        id: string;
        dedupeKey: string | null;
        contentHash: string | null;
        canonicalUrl: string | null;
        url: string;
        title: string;
        summary: string | null;
      }>;

    const insert = this.options.db.prepare(
      `
        insert into article_fingerprints (
          article_id,
          dedupe_key,
          content_hash,
          canonical_url,
          normalized_url,
          normalized_title,
          title_hash,
          title_simhash,
          summary_simhash,
          calculated_at
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(article_id) do update set
          dedupe_key = excluded.dedupe_key,
          content_hash = excluded.content_hash,
          canonical_url = excluded.canonical_url,
          normalized_url = excluded.normalized_url,
          normalized_title = excluded.normalized_title,
          title_hash = excluded.title_hash,
          title_simhash = excluded.title_simhash,
          summary_simhash = excluded.summary_simhash,
          calculated_at = excluded.calculated_at
      `
    );

    this.options.db.transaction(() => {
      for (const row of rows) {
        const normalizedTitle = normalizeTitle(row.title);
        insert.run(
          row.id,
          row.dedupeKey,
          row.contentHash,
          row.canonicalUrl,
          normalizeUrl(row.canonicalUrl ?? row.url),
          normalizedTitle,
          sha256(normalizedTitle),
          simhash(normalizedTitle),
          simhash(normalizeTitle(row.summary ?? "")),
          now
        );
      }
      this.touchBackfillState("article_fingerprint_backfill", "succeeded", rows.length);
    })();
  }

  private rebuildDuplicateGroups(): void {
    this.backfillFingerprints();
    const now = this.now();
    const buckets = this.options.db
      .prepare(
        `
          select
            coalesce(dedupe_key, content_hash, normalized_url, title_hash) as bucketKey,
            case
              when dedupe_key is not null then 'dedupe_key'
              when content_hash is not null then 'content_hash'
              when normalized_url is not null then 'normalized_url'
              else 'title_hash'
            end as reason,
            group_concat(article_id, char(31)) as articleIds,
            count(*) as count
          from article_fingerprints
          where coalesce(dedupe_key, content_hash, normalized_url, title_hash) is not null
          group by bucketKey
          having count(*) > 1
        `
      )
      .all() as Array<{ bucketKey: string; reason: string; articleIds: string; count: number }>;

    this.options.db.transaction(() => {
      this.options.db.prepare("delete from duplicate_group_members").run();
      this.options.db.prepare("delete from duplicate_groups").run();

      const insertGroup = this.options.db.prepare(
        `
          insert into duplicate_groups (
            id,
            representative_article_id,
            duplicate_reason,
            confidence,
            article_count,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?)
        `
      );
      const insertMember = this.options.db.prepare(
        `
          insert into duplicate_group_members (
            duplicate_group_id,
            article_id,
            confidence,
            reason,
            is_representative,
            created_at
          )
          values (?, ?, ?, ?, ?, ?)
        `
      );

      for (const bucket of buckets) {
        const articleIds = bucket.articleIds.split(String.fromCharCode(31)).filter(Boolean);
        const representative = articleIds[0]!;
        const groupId = `dup_${sha256(bucket.reason + ":" + bucket.bucketKey).slice(0, 24)}`;
        const confidence = bucket.reason === "dedupe_key" || bucket.reason === "content_hash" ? 0.98 : 0.82;
        insertGroup.run(groupId, representative, bucket.reason, confidence, articleIds.length, now, now);
        for (const articleId of articleIds) {
          insertMember.run(groupId, articleId, confidence, bucket.reason, articleId === representative ? 1 : 0, now);
        }
      }

      this.touchBackfillState("duplicate_group_rebuild", "succeeded", buckets.length);
    })();
  }

  private rebuildKeywordProfile(): void {
    const now = this.now();
    const rows = this.options.db
      .prepare(
        `
          select
            be.event_type as eventType,
            a.title,
            a.summary
          from behavior_events be
          join articles a on a.id = be.article_id
          join feeds f on f.id = a.feed_id
          where a.deleted_at is null
            and a.status != 'deleted'
            and f.deleted_at is null
            and f.enabled = 1
        `
      )
      .all() as Array<{ eventType: string; title: string; summary: string | null }>;

    const weights = new Map<string, number>();
    for (const row of rows) {
      const polarity = keywordPolarity(row.eventType);
      if (!polarity) {
        continue;
      }
      const sign = polarity === "positive" ? 1 : -1;
      for (const term of tokenize(`${row.title} ${row.summary ?? ""}`).slice(0, 16)) {
        weights.set(`${polarity}:${term}`, (weights.get(`${polarity}:${term}`) ?? 0) + sign);
      }
    }

    this.options.db.transaction(() => {
      this.options.db.prepare("delete from profile_terms").run();
      const insert = this.options.db.prepare(
        `
          insert into profile_terms (
            term,
            polarity,
            scope,
            weight,
            evidence_count,
            last_event_at,
            updated_at
          )
          values (?, ?, 'long', ?, ?, ?, ?)
        `
      );
      for (const [key, weight] of weights) {
        const [polarity, term] = key.split(":");
        if (!polarity || !term || weight === 0) {
          continue;
        }
        insert.run(term, polarity, Math.abs(weight), Math.max(1, Math.round(Math.abs(weight))), now, now);
      }
      this.touchBackfillState("keyword_profile_rebuild", "succeeded", weights.size);
    })();
  }

  private runDiagnosticEvaluation(): void {
    const now = this.now();
    const runId = `eval_${now}_${randomBytes(4).toString("hex")}`;
    const metrics = this.options.db
      .prepare(
        `
          select
            count(*) as candidateCount,
            sum(case when s.favorited_at is not null or s.read_later_at is not null or coalesce(s.reading_progress, 0) >= 0.75 then 1 else 0 end) as positiveCount,
            count(distinct a.feed_id) as sourceCount
          from articles a
          join feeds f on f.id = a.feed_id
          left join article_states s on s.article_id = a.id
          where a.deleted_at is null
            and a.status != 'deleted'
            and f.deleted_at is null
        `
      )
      .get() as { candidateCount: number; positiveCount: number | null; sourceCount: number };

    this.options.db
      .prepare(
        `
          insert into ranking_eval_runs (
            id,
            algorithm_version,
            rank_context,
            status,
            metrics_json,
            error,
            created_at,
            started_at,
            finished_at
          )
          values (?, 'rec_v2', 'diagnostic', 'succeeded', ?, null, ?, ?, ?)
        `
      )
      .run(
        runId,
        JSON.stringify({
          diagnosticReplay: true,
          note: "Diagnostic replay only; not a causal A/B result.",
          candidateCount: metrics.candidateCount,
          positiveCount: metrics.positiveCount ?? 0,
          sourceCount: metrics.sourceCount
        }),
        now,
        now,
        now
      );
    this.touchBackfillState("ranking_eval_run", "succeeded", 1);
  }

  private touchBackfillState(
    taskKey: string,
    status: "running" | "succeeded" | "failed",
    processedCount: number | null
  ): void {
    const now = this.now();
    this.options.db
      .prepare(
        `
          insert into recommendation_backfill_state (
            task_key,
            status,
            cursor,
            processed_count,
            error,
            started_at,
            updated_at,
            finished_at
          )
          values (?, ?, null, ?, null, ?, ?, ?)
          on conflict(task_key) do update set
            status = excluded.status,
            processed_count = case
              when excluded.processed_count is null then recommendation_backfill_state.processed_count
              else excluded.processed_count
            end,
            error = null,
            updated_at = excluded.updated_at,
            finished_at = excluded.finished_at
        `
      )
      .run(taskKey, status, processedCount ?? null, now, now, status === "succeeded" ? now : null);
  }
}

function randomJobId(): string {
  return `job_${Date.now()}_${randomBytes(6).toString("hex")}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url.trim().toLowerCase();
  }
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function simhash(text: string): string {
  const tokens = tokenize(text);
  const bits = new Array<number>(64).fill(0);
  for (const token of tokens) {
    const hash = BigInt(`0x${sha256(token).slice(0, 16)}`);
    for (let bit = 0; bit < 64; bit += 1) {
      bits[bit] += (hash & (1n << BigInt(bit))) === 0n ? -1 : 1;
    }
  }
  let result = 0n;
  for (let bit = 0; bit < 64; bit += 1) {
    if ((bits[bit] ?? 0) > 0) {
      result |= 1n << BigInt(bit);
    }
  }
  return result.toString(16).padStart(16, "0");
}

function tokenize(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .map((term) => term.trim())
        .filter((term) => term.length >= 2)
        .slice(0, 64)
    )
  );
}

function keywordPolarity(eventType: string): "positive" | "negative" | null {
  switch (eventType) {
    case "favorite":
    case "like":
    case "read_later":
    case "read_complete":
      return "positive";
    case "hide":
    case "not_interested":
      return "negative";
    default:
      return null;
  }
}
