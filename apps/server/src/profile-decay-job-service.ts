import { randomBytes } from "node:crypto";
import type { AppSettingsRepository, JobRepository, JobRow } from "@dibao/db";
import { PermanentJobFailure } from "./job-runner.js";
import type { JobRunner } from "./job-runner.js";
import type { ProfileService } from "./profile-service.js";
import type { RankingRecalculateJobService } from "./ranking-job-service.js";

export const PROFILE_DECAY_JOB_TYPE = "profile_decay" as const;
export const DEFAULT_PROFILE_DECAY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const PROFILE_DECAY_LAST_RUN_SETTING = "profile.decayLastRunAt";

export type ProfileDecayJobServiceOptions = {
  jobs: Pick<JobRepository, "enqueue" | "listOpenByType">;
  profile: Pick<ProfileService, "decayClusters">;
  rankingJobs: Pick<RankingRecalculateJobService, "enqueueAll">;
  settings: Pick<AppSettingsRepository, "getJson" | "setJson">;
  now?: () => number;
  jobIdFactory?: () => string;
};

export class ProfileDecayJobService {
  private readonly now: () => number;
  private readonly jobIdFactory: () => string;

  constructor(private readonly options: ProfileDecayJobServiceOptions) {
    this.now = options.now ?? Date.now;
    this.jobIdFactory = options.jobIdFactory ?? randomJobId;
  }

  enqueueDueDecay(): JobRow | null {
    const lastRunAt = this.options.settings.getJson<number>(PROFILE_DECAY_LAST_RUN_SETTING);
    const now = this.now();
    if (typeof lastRunAt === "number" && now - lastRunAt < DEFAULT_PROFILE_DECAY_INTERVAL_MS) {
      return null;
    }

    return this.enqueueDecay();
  }

  enqueueDecay(): JobRow {
    const existing = this.options.jobs.listOpenByType(PROFILE_DECAY_JOB_TYPE)[0];
    if (existing) {
      return existing;
    }

    const now = this.now();
    return this.options.jobs.enqueue({
      id: this.jobIdFactory(),
      type: PROFILE_DECAY_JOB_TYPE,
      payloadJson: null,
      maxAttempts: 1,
      runAfter: now,
      now
    });
  }

  handleProfileDecayJob(job: JobRow): void {
    if (!isValidProfileDecayPayload(job.payloadJson)) {
      throw new PermanentJobFailure("Invalid profile_decay job payload");
    }

    const now = this.now();
    const lastRunAt = this.options.settings.getJson<number>(PROFILE_DECAY_LAST_RUN_SETTING);
    const elapsedDays =
      typeof lastRunAt === "number"
        ? Math.max(0, Math.floor((now - lastRunAt) / DEFAULT_PROFILE_DECAY_INTERVAL_MS))
        : 1;

    this.options.profile.decayClusters({ elapsedDays });
    this.options.settings.setJson(PROFILE_DECAY_LAST_RUN_SETTING, now, now);
    this.options.rankingJobs.enqueueAll();
  }
}

export type ProfileDecaySchedulerOptions = {
  decayJobs: Pick<ProfileDecayJobService, "enqueueDueDecay">;
  runner?: Pick<JobRunner, "drainDue">;
  intervalMs?: number;
  initialDelayMs?: number;
  onError?: (error: unknown) => void;
};

export class ProfileDecayScheduler {
  private readonly intervalMs: number;
  private readonly initialDelayMs: number;
  private interval: ReturnType<typeof setInterval> | null = null;
  private initialTick: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: ProfileDecaySchedulerOptions) {
    this.intervalMs = options.intervalMs ?? DEFAULT_PROFILE_DECAY_INTERVAL_MS;
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

  async tick(): Promise<string | null> {
    const job = this.options.decayJobs.enqueueDueDecay();
    if (job && this.options.runner) {
      await this.options.runner.drainDue();
    }
    return job?.id ?? null;
  }
}

function isValidProfileDecayPayload(payloadJson: string | null): boolean {
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
  return `job_profile_decay_${randomBytes(10).toString("hex")}`;
}
