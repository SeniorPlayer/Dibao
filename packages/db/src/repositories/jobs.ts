import type {
  DibaoDatabase,
  EnqueueJobInput,
  JobListInput,
  JobRow,
  JobStatus,
  JobType
} from "../types.js";

type JobDbRow = {
  id: string;
  type: JobType;
  status: JobStatus;
  payloadJson: string | null;
  error: string | null;
  attempts: number;
  maxAttempts: number;
  runAfter: number;
  startedAt: number | null;
  finishedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export interface JobRepository {
  claimNextDue(now: number): JobRow | null;
  countByTypeAndStatus(type: JobType, status: JobStatus): number;
  enqueue(input: EnqueueJobInput): JobRow;
  findById(id: string): JobRow | null;
  list(input?: JobListInput): JobRow[];
  listOpenByType(type: JobType): JobRow[];
  cancel(id: string, error: string, now: number): JobRow | null;
  defer(id: string, error: string, runAfter: number, now: number): JobRow | null;
  markFailed(id: string, error: string, now: number): JobRow | null;
  markFailedOrRetry(id: string, error: string, now: number, retryDelayMs: number): JobRow | null;
  markSucceeded(id: string, now: number): JobRow | null;
  resetStaleRunning(now: number): number;
}

export class SqliteJobRepository implements JobRepository {
  constructor(private readonly db: DibaoDatabase) {}

  countByTypeAndStatus(type: JobType, status: JobStatus): number {
    const row = this.db
      .prepare(
        `
          select count(*) as count
          from jobs
          where type = ?
            and status = ?
        `
      )
      .get(type, status) as { count: number } | undefined;

    return row?.count ?? 0;
  }

  claimNextDue(now: number): JobRow | null {
    return this.db.transaction(() => {
      const candidate = this.db
        .prepare(
          `
            select id
            from jobs
            where status = 'queued'
              and run_after <= ?
              and attempts < max_attempts
            order by run_after, created_at, id
            limit 1
          `
        )
        .get(now) as { id: string } | undefined;

      if (!candidate) {
        return null;
      }

      this.db
        .prepare(
          `
            update jobs
            set
              status = 'running',
              attempts = attempts + 1,
              started_at = ?,
              finished_at = null,
              updated_at = ?
            where id = ?
              and status = 'queued'
              and attempts < max_attempts
          `
        )
        .run(now, now, candidate.id);

      return this.findById(candidate.id);
    })();
  }

  enqueue(input: EnqueueJobInput): JobRow {
    const now = input.now ?? Date.now();
    const runAfter = input.runAfter ?? now;
    const maxAttempts = input.maxAttempts ?? 3;

    this.db
      .prepare(
        `
          insert into jobs (
            id,
            type,
            status,
            payload_json,
            error,
            attempts,
            max_attempts,
            run_after,
            started_at,
            finished_at,
            created_at,
            updated_at
          )
          values (?, ?, 'queued', ?, null, 0, ?, ?, null, null, ?, ?)
        `
      )
      .run(input.id, input.type, input.payloadJson ?? null, maxAttempts, runAfter, now, now);

    const job = this.findById(input.id);
    if (!job) {
      throw new Error(`Failed to enqueue job: ${input.id}`);
    }
    return job;
  }

  findById(id: string): JobRow | null {
    const row = this.db
      .prepare(
        `
          ${baseJobSelect()}
          where id = ?
        `
      )
      .get(id) as JobDbRow | undefined;

    return row ? mapJob(row) : null;
  }

  list(input: JobListInput = {}): JobRow[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (input.status) {
      conditions.push("status = ?");
      params.push(input.status);
    }

    if (input.type) {
      conditions.push("type = ?");
      params.push(input.type);
    }

    const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);

    return (
      this.db
        .prepare(
          `
            ${baseJobSelect()}
            ${where}
            order by updated_at desc, id desc
            limit ?
          `
        )
        .all(...params, limit) as JobDbRow[]
    ).map(mapJob);
  }

  listOpenByType(type: JobType): JobRow[] {
    return (
      this.db
        .prepare(
          `
            ${baseJobSelect()}
            where type = ?
              and status in ('queued', 'running')
            order by created_at, id
          `
        )
        .all(type) as JobDbRow[]
    ).map(mapJob);
  }

  cancel(id: string, error: string, now: number): JobRow | null {
    this.db
      .prepare(
        `
          update jobs
          set
            status = 'cancelled',
            error = ?,
            finished_at = ?,
            updated_at = ?
          where id = ?
            and status in ('queued', 'running')
        `
      )
      .run(error, now, now, id);

    return this.findById(id);
  }

  defer(id: string, error: string, runAfter: number, now: number): JobRow | null {
    this.db
      .prepare(
        `
          update jobs
          set
            status = 'queued',
            attempts = case when attempts > 0 then attempts - 1 else 0 end,
            error = ?,
            run_after = ?,
            started_at = null,
            finished_at = null,
            updated_at = ?
          where id = ?
        `
      )
      .run(error, runAfter, now, id);

    return this.findById(id);
  }

  markFailed(id: string, error: string, now: number): JobRow | null {
    this.db
      .prepare(
        `
          update jobs
          set
            status = 'failed',
            error = ?,
            finished_at = ?,
            updated_at = ?
          where id = ?
        `
      )
      .run(error, now, now, id);

    return this.findById(id);
  }

  markFailedOrRetry(
    id: string,
    error: string,
    now: number,
    retryDelayMs: number
  ): JobRow | null {
    const job = this.findById(id);
    if (!job) {
      return null;
    }

    if (job.attempts < job.maxAttempts) {
      this.db
        .prepare(
          `
            update jobs
            set
              status = 'queued',
              error = ?,
              run_after = ?,
              started_at = null,
              finished_at = null,
              updated_at = ?
            where id = ?
          `
        )
        .run(error, now + retryDelayMs, now, id);
    } else {
      this.db
        .prepare(
          `
            update jobs
            set
              status = 'failed',
              error = ?,
              finished_at = ?,
              updated_at = ?
            where id = ?
          `
        )
        .run(error, now, now, id);
    }

    return this.findById(id);
  }

  markSucceeded(id: string, now: number): JobRow | null {
    this.db
      .prepare(
        `
          update jobs
          set
            status = 'succeeded',
            error = null,
            finished_at = ?,
            updated_at = ?
          where id = ?
        `
      )
      .run(now, now, id);

    return this.findById(id);
  }

  resetStaleRunning(now: number): number {
    const result = this.db
      .prepare(
        `
          update jobs
          set
            status = case
              when attempts >= max_attempts then 'failed'
              else 'queued'
            end,
            error = case
              when attempts >= max_attempts then 'Job was interrupted and exhausted attempts'
              else 'Job was reset after runner restart'
            end,
            run_after = case
              when attempts >= max_attempts then run_after
              else ?
            end,
            started_at = null,
            finished_at = case
              when attempts >= max_attempts then ?
              else null
            end,
            updated_at = ?
          where status = 'running'
        `
      )
      .run(now, now, now);

    return result.changes;
  }
}

function baseJobSelect(): string {
  return `
    select
      id,
      type,
      status,
      payload_json as payloadJson,
      error,
      attempts,
      max_attempts as maxAttempts,
      run_after as runAfter,
      started_at as startedAt,
      finished_at as finishedAt,
      created_at as createdAt,
      updated_at as updatedAt
    from jobs
  `;
}

function mapJob(row: JobDbRow): JobRow {
  return row;
}
