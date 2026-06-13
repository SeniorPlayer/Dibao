import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import type {
  BehaviorEventType,
  DibaoDatabase,
  JobRepository,
  JobRow
} from "@dibao/db";
import { PermanentJobFailure } from "./job-runner.js";
import type { ProfileUpdateResult, ProfileService } from "./profile-service.js";
import type { RankingRecalculateJobService } from "./ranking-job-service.js";

export const BEHAVIOR_EVENT_PROJECT_JOB_TYPE = "behavior_event_project" as const;
export const BEHAVIOR_EVENT_PROJECT_JOB_PRIORITY = 60;
export const BEHAVIOR_EVENT_PROJECT_BATCH_LIMIT = 50;
export const BEHAVIOR_EVENT_PROJECT_TIME_BUDGET_MS = 250;
export const BEHAVIOR_EVENT_PROJECT_CONTINUE_DELAY_MS = 1_000;

const PROFILE_PROJECTOR_ID = "profile";

export type BehaviorEventProjectJobPayload = Record<string, never>;

export type BehaviorEventProjectionResult = {
  processed: number;
  hasMore: boolean;
  enqueuedRanking: boolean;
};

type PendingBehaviorEvent = {
  id: string;
  eventType: BehaviorEventType;
  createdAt: number;
};

type BehaviorProjectionCursor = {
  lastCreatedAt: number;
  lastEventId: string;
};

export type BehaviorProjectionJobServiceOptions = {
  db: DibaoDatabase;
  jobs: Pick<JobRepository, "enqueue" | "listOpenByType">;
  profile: Pick<ProfileService, "processEvent">;
  rankingJobs: Pick<RankingRecalculateJobService, "enqueueAll">;
  now?: () => number;
  jobIdFactory?: () => string;
  batchLimit?: number;
  timeBudgetMs?: number;
};

export class BehaviorProjectionJobService {
  private readonly now: () => number;
  private readonly jobIdFactory: () => string;
  private readonly batchLimit: number;
  private readonly timeBudgetMs: number;

  constructor(private readonly options: BehaviorProjectionJobServiceOptions) {
    this.now = options.now ?? Date.now;
    this.jobIdFactory = options.jobIdFactory ?? randomJobId;
    this.batchLimit = Math.max(1, Math.min(options.batchLimit ?? BEHAVIOR_EVENT_PROJECT_BATCH_LIMIT, 500));
    this.timeBudgetMs = Math.max(0, options.timeBudgetMs ?? BEHAVIOR_EVENT_PROJECT_TIME_BUDGET_MS);
  }

  enqueueProjection(options: { delayMs?: number } = {}): JobRow {
    const existing = this.options.jobs
      .listOpenByType(BEHAVIOR_EVENT_PROJECT_JOB_TYPE)
      .find((job) => parseBehaviorEventProjectPayload(job.payloadJson));
    if (existing) {
      return existing;
    }

    const now = this.now();
    return this.options.jobs.enqueue({
      id: this.jobIdFactory(),
      type: BEHAVIOR_EVENT_PROJECT_JOB_TYPE,
      payloadJson: JSON.stringify({} satisfies BehaviorEventProjectJobPayload),
      maxAttempts: 3,
      priority: BEHAVIOR_EVENT_PROJECT_JOB_PRIORITY,
      runAfter: now + Math.max(0, options.delayMs ?? 0),
      now
    });
  }

  enqueueProjectionIfPending(options: { delayMs?: number } = {}): JobRow | null {
    if (this.listPendingEvents(this.readCursor(), 1).length === 0) {
      return null;
    }

    return this.enqueueProjection(options);
  }

  handleBehaviorEventProjectJob(job: JobRow): BehaviorEventProjectionResult {
    if (!parseBehaviorEventProjectPayload(job.payloadJson)) {
      throw new PermanentJobFailure("Invalid behavior_event_project job payload");
    }

    const startedAt = performance.now();
    const cursor = this.readCursor();
    const events = this.listPendingEvents(cursor, this.batchLimit + 1);
    const batch = events.slice(0, this.batchLimit);
    let processed = 0;
    let lastEvent: PendingBehaviorEvent | null = null;
    let immediateRanking = false;
    let delayedRanking = false;

    for (const event of batch) {
      if (
        processed > 0 &&
        this.timeBudgetMs > 0 &&
        performance.now() - startedAt >= this.timeBudgetMs
      ) {
        break;
      }

      const result = this.options.profile.processEvent(event.id);
      if (shouldEnqueueImmediateRanking(result, event.eventType)) {
        immediateRanking = true;
      } else if (shouldEnqueueDelayedRanking(result, event.eventType)) {
        delayedRanking = true;
      }
      processed += 1;
      lastEvent = event;
    }

    if (lastEvent) {
      this.writeCursor(lastEvent);
    }

    if (immediateRanking) {
      this.options.rankingJobs.enqueueAll();
    } else if (delayedRanking) {
      this.options.rankingJobs.enqueueAll({
        delayMs: 5 * 60_000
      });
    }

    const hasMore = events.length > processed;
    if (hasMore) {
      this.enqueueProjection({ delayMs: BEHAVIOR_EVENT_PROJECT_CONTINUE_DELAY_MS });
    }

    return {
      processed,
      hasMore,
      enqueuedRanking: immediateRanking || delayedRanking
    };
  }

  private readCursor(): BehaviorProjectionCursor {
    const row = this.options.db
      .prepare(
        `
          select
            last_created_at as lastCreatedAt,
            last_event_id as lastEventId
          from behavior_projection_cursors
          where projector_id = ?
        `
      )
      .get(PROFILE_PROJECTOR_ID) as BehaviorProjectionCursor | undefined;

    return row ?? { lastCreatedAt: 0, lastEventId: "" };
  }

  private writeCursor(event: PendingBehaviorEvent): void {
    const now = this.now();
    this.options.db
      .prepare(
        `
          insert into behavior_projection_cursors (
            projector_id,
            last_created_at,
            last_event_id,
            updated_at
          )
          values (?, ?, ?, ?)
          on conflict(projector_id) do update set
            last_created_at = excluded.last_created_at,
            last_event_id = excluded.last_event_id,
            updated_at = excluded.updated_at
        `
      )
      .run(PROFILE_PROJECTOR_ID, event.createdAt, event.id, now);
  }

  private listPendingEvents(
    cursor: BehaviorProjectionCursor,
    limit: number
  ): PendingBehaviorEvent[] {
    return this.options.db
      .prepare(
        `
          select
            id,
            event_type as eventType,
            created_at as createdAt
          from behavior_events
          where created_at > ?
             or (created_at = ? and id > ?)
          order by created_at, id
          limit ?
        `
      )
      .all(cursor.lastCreatedAt, cursor.lastCreatedAt, cursor.lastEventId, limit) as PendingBehaviorEvent[];
  }
}

export function parseBehaviorEventProjectPayload(
  payloadJson: string | null
): BehaviorEventProjectJobPayload | null {
  if (payloadJson === null) {
    return {};
  }

  try {
    const payload = JSON.parse(payloadJson) as unknown;
    return typeof payload === "object" &&
      payload !== null &&
      !Array.isArray(payload) &&
      Object.keys(payload).length === 0
      ? {}
      : null;
  } catch {
    return null;
  }
}

function shouldEnqueueImmediateRanking(
  result: ProfileUpdateResult,
  eventType: BehaviorEventType
): boolean {
  return (
    !isHighVolumeArticleOnlyAction(eventType) &&
    (result.profileChanged || result.feedStatsChanged)
  );
}

function shouldEnqueueDelayedRanking(
  result: ProfileUpdateResult,
  eventType: BehaviorEventType
): boolean {
  return isHighVolumeArticleOnlyAction(eventType) && result.profileChanged;
}

function isHighVolumeArticleOnlyAction(type: BehaviorEventType): boolean {
  return type === "impression" || type === "open" || type === "read_progress";
}

function randomJobId(): string {
  return `job_behavior_project_${randomBytes(10).toString("hex")}`;
}
