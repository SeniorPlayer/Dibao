import { randomBytes } from "node:crypto";
import type { FeedRepository, JobRepository, JobRow } from "@dibao/db";
import { FeedRefreshService, type FeedRefreshResult } from "./feed-refresh-service.js";
import { JobRunner, PermanentJobFailure } from "./job-runner.js";

export const FEED_REFRESH_JOB_TYPE = "feed_refresh" as const;
export const DEFAULT_FEED_REFRESH_JOB_MAX_ATTEMPTS = 3;
export const DEFAULT_FEED_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

export type FeedRefreshCoordinatorOptions = {
  refreshService: FeedRefreshService;
  afterRefresh?: (result: FeedRefreshResult) => void | Promise<void>;
};

export class FeedRefreshCoordinator {
  private readonly inFlight = new Map<string, Promise<FeedRefreshResult>>();

  constructor(private readonly options: FeedRefreshCoordinatorOptions) {}

  async refreshFeed(feedId: string): Promise<FeedRefreshResult> {
    const existing = this.inFlight.get(feedId);
    if (existing) {
      return existing;
    }

    const refresh = this.options.refreshService
      .refreshFeed(feedId)
      .then(async (result) => {
        await this.options.afterRefresh?.(result);
        return result;
      })
      .finally(() => this.inFlight.delete(feedId));
    this.inFlight.set(feedId, refresh);
    return refresh;
  }
}

export type FeedRefreshJobServiceOptions = {
  feeds: Pick<FeedRepository, "findById" | "listActiveDue">;
  jobs: JobRepository;
  refresher: Pick<FeedRefreshCoordinator, "refreshFeed">;
  now?: () => number;
  jobIdFactory?: () => string;
  maxAttempts?: number;
};

export class FeedRefreshJobService {
  private readonly now: () => number;
  private readonly jobIdFactory: () => string;
  private readonly maxAttempts: number;

  constructor(private readonly options: FeedRefreshJobServiceOptions) {
    this.now = options.now ?? Date.now;
    this.jobIdFactory = options.jobIdFactory ?? randomJobId;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_FEED_REFRESH_JOB_MAX_ATTEMPTS;
  }

  enqueueAllEnabledFeeds(): JobRow[] {
    return this.enqueueDueFeeds();
  }

  enqueueDueFeeds(): JobRow[] {
    return this.options.feeds
      .listActiveDue(this.now())
      .map((feed) => this.enqueueFeed(feed.id));
  }

  enqueueFeed(feedId: string): JobRow {
    const existing = this.findOpenFeedRefreshJob(feedId);
    if (existing) {
      return existing;
    }

    const now = this.now();
    return this.options.jobs.enqueue({
      id: this.jobIdFactory(),
      type: FEED_REFRESH_JOB_TYPE,
      payloadJson: JSON.stringify({ feedId }),
      maxAttempts: this.maxAttempts,
      runAfter: now,
      now
    });
  }

  async handleFeedRefreshJob(job: JobRow): Promise<void> {
    const payload = parseFeedRefreshPayload(job.payloadJson);
    if (!payload) {
      throw new PermanentJobFailure("Invalid feed_refresh job payload");
    }

    const feed = this.options.feeds.findById(payload.feedId);
    if (!feed) {
      throw new PermanentJobFailure("Feed not found");
    }

    if (!feed.enabled) {
      return;
    }

    await this.options.refresher.refreshFeed(payload.feedId);
  }

  private findOpenFeedRefreshJob(feedId: string): JobRow | null {
    return (
      this.options.jobs
        .listOpenByType(FEED_REFRESH_JOB_TYPE)
        .find((job) => parseFeedRefreshPayload(job.payloadJson)?.feedId === feedId) ?? null
    );
  }
}

export type FeedRefreshSchedulerOptions = {
  refreshJobs: Pick<FeedRefreshJobService, "enqueueDueFeeds">;
  runner?: Pick<JobRunner, "drainDue">;
  intervalMs?: number;
  initialDelayMs?: number;
  onError?: (error: unknown) => void;
};

export class FeedRefreshScheduler {
  private readonly intervalMs: number;
  private readonly initialDelayMs: number;
  private interval: ReturnType<typeof setInterval> | null = null;
  private initialTick: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: FeedRefreshSchedulerOptions) {
    this.intervalMs = options.intervalMs ?? DEFAULT_FEED_REFRESH_INTERVAL_MS;
    this.initialDelayMs = Math.max(0, Math.floor(options.initialDelayMs ?? 0));
  }

  start(): void {
    if (this.interval || this.initialTick || this.intervalMs <= 0) {
      return;
    }

    this.initialTick = setTimeout(() => {
      this.initialTick = null;
      void this.tick().catch((error) => this.options.onError?.(error));
    }, this.initialDelayMs);
    this.initialTick.unref?.();
    this.interval = setInterval(() => {
      void this.tick().catch((error) => this.options.onError?.(error));
    }, this.intervalMs);
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

  async tick(): Promise<string[]> {
    const jobs = this.options.refreshJobs.enqueueDueFeeds();
    if (this.options.runner) {
      await this.options.runner.drainDue();
    }
    return jobs.map((job) => job.id);
  }
}

function parseFeedRefreshPayload(payloadJson: string | null): { feedId: string } | null {
  if (!payloadJson) {
    return null;
  }

  try {
    const payload = JSON.parse(payloadJson) as unknown;
    if (
      typeof payload === "object" &&
      payload !== null &&
      !Array.isArray(payload) &&
      Object.keys(payload).length === 1 &&
      typeof (payload as { feedId?: unknown }).feedId === "string" &&
      (payload as { feedId: string }).feedId.trim() !== ""
    ) {
      return {
        feedId: (payload as { feedId: string }).feedId
      };
    }
  } catch {
    return null;
  }

  return null;
}

function randomJobId(): string {
  return `job_${randomBytes(10).toString("hex")}`;
}
