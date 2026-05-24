import type { JobRepository, JobRow, JobType } from "@dibao/db";

export type JobHandler = (job: JobRow) => Promise<void> | void;

export type JobRunnerOptions = {
  jobs: JobRepository;
  handlers: Partial<Record<JobType, JobHandler>>;
  now?: () => number;
  pollIntervalMs?: number;
  retryDelayMs?: number;
  onError?: (error: unknown) => void;
};

export class PermanentJobFailure extends Error {
  constructor(message: string, readonly details?: unknown) {
    super(message);
    this.name = "PermanentJobFailure";
  }
}

export class DeferredJobRun extends Error {
  constructor(message: string, readonly runAfter: number) {
    super(message);
    this.name = "DeferredJobRun";
  }
}

export class JobRunner {
  private readonly now: () => number;
  private readonly pollIntervalMs: number;
  private readonly retryDelayMs: number;
  private interval: ReturnType<typeof setInterval> | null = null;
  private isDraining = false;

  constructor(private readonly options: JobRunnerOptions) {
    this.now = options.now ?? Date.now;
    this.pollIntervalMs = options.pollIntervalMs ?? 30_000;
    this.retryDelayMs = options.retryDelayMs ?? 60_000;
  }

  start(): void {
    if (this.interval) {
      return;
    }

    this.recoverStaleRunningJobs();
    this.interval = setInterval(() => {
      void this.drainDue().catch((error) => this.options.onError?.(error));
    }, this.pollIntervalMs);
    this.interval.unref?.();
  }

  stop(): void {
    if (!this.interval) {
      return;
    }

    clearInterval(this.interval);
    this.interval = null;
  }

  recoverStaleRunningJobs(): number {
    return this.options.jobs.resetStaleRunning(this.now());
  }

  async drainDue(): Promise<number> {
    if (this.isDraining) {
      return 0;
    }

    this.isDraining = true;
    let completed = 0;

    try {
      while (await this.runDueOnce()) {
        completed += 1;
        await yieldToEventLoop();
      }
    } finally {
      this.isDraining = false;
    }

    return completed;
  }

  async runDueOnce(): Promise<JobRow | null> {
    const job = this.options.jobs.claimNextDue(this.now());
    if (!job) {
      return null;
    }

    const handler = this.options.handlers[job.type];
    if (!handler) {
      this.options.jobs.markFailed(job.id, `No handler registered for job type: ${job.type}`, this.now());
      return job;
    }

    try {
      await handler(job);
      this.options.jobs.markSucceeded(job.id, this.now());
    } catch (error) {
      const message = errorMessage(error);
      if (error instanceof PermanentJobFailure) {
        this.options.jobs.markFailed(job.id, message, this.now());
      } else if (error instanceof DeferredJobRun) {
        this.options.jobs.defer(job.id, message, error.runAfter, this.now());
      } else {
        this.options.jobs.markFailedOrRetry(job.id, message, this.now(), this.retryDelayMs);
      }
    }

    return job;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}
