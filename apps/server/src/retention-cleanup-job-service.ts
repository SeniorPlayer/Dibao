import { randomBytes } from "node:crypto";
import type { JobRepository, JobRow } from "@dibao/db";
import type { JobRunner } from "./job-runner.js";
import { DeferredJobRun, PermanentJobFailure } from "./job-runner.js";
import type { ArticleRetentionService } from "./article-retention-service.js";

export const RETENTION_CLEANUP_JOB_TYPE = "retention_cleanup" as const;
export const DEFAULT_RETENTION_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RETENTION_CLEANUP_BATCHES_PER_JOB_RUN = 1;
const RETENTION_CLEANUP_DEFER_MS = 2_000;

export type RetentionCleanupJobServiceOptions = {
  jobs: JobRepository;
  retention: Pick<ArticleRetentionService, "runCleanup">;
  now?: () => number;
  jobIdFactory?: () => string;
};

export class RetentionCleanupJobService {
  private readonly now: () => number;
  private readonly jobIdFactory: () => string;

  constructor(private readonly options: RetentionCleanupJobServiceOptions) {
    this.now = options.now ?? Date.now;
    this.jobIdFactory = options.jobIdFactory ?? randomJobId;
  }

  enqueueCleanup(): JobRow {
    const existing = this.options.jobs.listOpenByType(RETENTION_CLEANUP_JOB_TYPE)[0];
    if (existing) {
      return existing;
    }

    const now = this.now();
    return this.options.jobs.enqueue({
      id: this.jobIdFactory(),
      type: RETENTION_CLEANUP_JOB_TYPE,
      payloadJson: null,
      maxAttempts: 1,
      runAfter: now,
      now
    });
  }

  handleRetentionCleanupJob(job: JobRow): void {
    if (!isValidRetentionPayload(job.payloadJson)) {
      throw new PermanentJobFailure("Invalid retention_cleanup job payload");
    }

    const result = this.options.retention.runCleanup({
      maxBatches: RETENTION_CLEANUP_BATCHES_PER_JOB_RUN
    });
    if (result.hasMoreCandidates) {
      throw new DeferredJobRun(
        "Retention cleanup deferred after one batch",
        this.now() + RETENTION_CLEANUP_DEFER_MS
      );
    }
  }
}

export type RetentionCleanupSchedulerOptions = {
  cleanupJobs: Pick<RetentionCleanupJobService, "enqueueCleanup">;
  runner?: Pick<JobRunner, "drainDue">;
  intervalMs?: number;
  onError?: (error: unknown) => void;
};

export class RetentionCleanupScheduler {
  private readonly intervalMs: number;
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: RetentionCleanupSchedulerOptions) {
    this.intervalMs = options.intervalMs ?? DEFAULT_RETENTION_CLEANUP_INTERVAL_MS;
  }

  start(): void {
    if (this.interval || this.intervalMs <= 0) {
      return;
    }

    void this.tick().catch((error) => this.options.onError?.(error));
    this.interval = setInterval(() => {
      void this.tick().catch((error) => this.options.onError?.(error));
    }, this.intervalMs);
    this.interval.unref?.();
  }

  stop(): void {
    if (!this.interval) {
      return;
    }

    clearInterval(this.interval);
    this.interval = null;
  }

  async tick(): Promise<string> {
    const job = this.options.cleanupJobs.enqueueCleanup();
    if (this.options.runner) {
      await this.options.runner.drainDue();
    }
    return job.id;
  }
}

function isValidRetentionPayload(payloadJson: string | null): boolean {
  if (payloadJson === null) {
    return true;
  }

  try {
    const payload = JSON.parse(payloadJson) as unknown;
    return (
      typeof payload === "object" &&
      payload !== null &&
      !Array.isArray(payload) &&
      Object.keys(payload).length === 0
    );
  } catch {
    return false;
  }
}

function randomJobId(): string {
  return `job_${randomBytes(10).toString("hex")}`;
}
