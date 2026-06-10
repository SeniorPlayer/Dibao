import type { JobRepository } from "@dibao/db";

export const DEFAULT_JOB_HISTORY_RETENTION_DAYS = 30;
export const DEFAULT_JOB_HISTORY_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_JOB_HISTORY_CLEANUP_BATCH_SIZE = 5000;

export type JobHistoryCleanupSchedulerOptions = {
  jobs: Pick<JobRepository, "deleteFinishedBefore">;
  retentionDays?: number;
  batchSize?: number;
  intervalMs?: number;
  initialDelayMs?: number;
  now?: () => number;
  onError?: (error: unknown) => void;
  onCleanup?: (result: JobHistoryCleanupResult) => void;
};

export type JobHistoryCleanupResult = {
  cutoff: number;
  deleted: number;
};

export class JobHistoryCleanupScheduler {
  private readonly retentionMs: number;
  private readonly batchSize: number;
  private readonly intervalMs: number;
  private readonly initialDelayMs: number;
  private readonly now: () => number;
  private interval: ReturnType<typeof setInterval> | null = null;
  private initialTick: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: JobHistoryCleanupSchedulerOptions) {
    const retentionDays = positiveNumberOrDefault(
      options.retentionDays,
      DEFAULT_JOB_HISTORY_RETENTION_DAYS
    );
    this.retentionMs = retentionDays * 24 * 60 * 60 * 1000;
    this.batchSize = Math.floor(
      positiveNumberOrDefault(options.batchSize, DEFAULT_JOB_HISTORY_CLEANUP_BATCH_SIZE)
    );
    this.intervalMs = nonNegativeNumberOrDefault(
      options.intervalMs,
      DEFAULT_JOB_HISTORY_CLEANUP_INTERVAL_MS
    );
    this.initialDelayMs = Math.max(0, Math.floor(options.initialDelayMs ?? 0));
    this.now = options.now ?? Date.now;
  }

  start(): void {
    if (this.interval || this.initialTick || this.intervalMs <= 0) {
      return;
    }

    this.initialTick = setTimeout(() => {
      this.initialTick = null;
      this.tick();
    }, this.initialDelayMs);
    this.initialTick.unref?.();
    this.interval = setInterval(() => this.tick(), this.intervalMs);
    this.interval.unref?.();
  }

  stop(): void {
    if (this.initialTick) {
      clearTimeout(this.initialTick);
      this.initialTick = null;
    }
    if (!this.interval) {
      return;
    }

    clearInterval(this.interval);
    this.interval = null;
  }

  runOnce(): JobHistoryCleanupResult {
    const cutoff = this.now() - this.retentionMs;
    const deleted = this.options.jobs.deleteFinishedBefore({
      cutoff,
      limit: this.batchSize
    });
    return { cutoff, deleted };
  }

  private tick(): void {
    try {
      const result = this.runOnce();
      this.options.onCleanup?.(result);
    } catch (error) {
      this.options.onError?.(error);
    }
  }
}

function positiveNumberOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeNumberOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}
