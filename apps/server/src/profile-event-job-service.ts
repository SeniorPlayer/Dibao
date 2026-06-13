import { randomBytes } from "node:crypto";
import type { ArticleActionType, JobRepository, JobRow } from "@dibao/db";
import { PermanentJobFailure } from "./job-runner.js";
import type { ProfileService, ProfileUpdateResult } from "./profile-service.js";
import type { RankingRecalculateJobService } from "./ranking-job-service.js";

export const PROFILE_EVENT_PROCESS_JOB_TYPE = "profile_event_process" as const;
export const PROFILE_EVENT_PROCESS_JOB_PRIORITY = 40;
export const HIGH_VOLUME_PROFILE_RANKING_DELAY_MS = 5 * 60_000;

export type ProfileEventProcessJobPayload = {
  eventId: string;
  articleId: string;
  actionType: ArticleActionType;
};

export type ProfileEventProcessJobServiceOptions = {
  jobs: Pick<JobRepository, "enqueue" | "listOpenByType">;
  profile: Pick<ProfileService, "processEvent">;
  rankingJobs: Pick<RankingRecalculateJobService, "enqueueAll">;
  now?: () => number;
  jobIdFactory?: () => string;
};

export class ProfileEventProcessJobService {
  private readonly now: () => number;
  private readonly jobIdFactory: () => string;

  constructor(private readonly options: ProfileEventProcessJobServiceOptions) {
    this.now = options.now ?? Date.now;
    this.jobIdFactory = options.jobIdFactory ?? randomJobId;
  }

  enqueueEvent(input: ProfileEventProcessJobPayload): JobRow {
    const existing = this.findOpenProfileEventJob(input.eventId);
    if (existing) {
      return existing;
    }

    const now = this.now();
    return this.options.jobs.enqueue({
      id: this.jobIdFactory(),
      type: PROFILE_EVENT_PROCESS_JOB_TYPE,
      payloadJson: JSON.stringify(input satisfies ProfileEventProcessJobPayload),
      maxAttempts: 2,
      priority: PROFILE_EVENT_PROCESS_JOB_PRIORITY,
      runAfter: now,
      now
    });
  }

  handleProfileEventProcessJob(job: JobRow): void {
    const payload = parseProfileEventProcessPayload(job.payloadJson);
    if (!payload) {
      throw new PermanentJobFailure("Invalid profile_event_process job payload");
    }

    const profileResult = this.options.profile.processEvent(payload.eventId);
    if (shouldRecalculateAll(profileResult, payload.actionType)) {
      this.options.rankingJobs.enqueueAll({
        delayMs: isHighVolumeArticleOnlyAction(payload.actionType)
          ? HIGH_VOLUME_PROFILE_RANKING_DELAY_MS
          : 0
      });
    }
  }

  private findOpenProfileEventJob(eventId: string): JobRow | null {
    return (
      this.options.jobs
        .listOpenByType(PROFILE_EVENT_PROCESS_JOB_TYPE)
        .find((job) => parseProfileEventProcessPayload(job.payloadJson)?.eventId === eventId) ??
      null
    );
  }
}

export function parseProfileEventProcessPayload(
  payloadJson: string | null
): ProfileEventProcessJobPayload | null {
  if (!payloadJson) {
    return null;
  }

  try {
    const payload = JSON.parse(payloadJson) as unknown;
    if (
      typeof payload === "object" &&
      payload !== null &&
      !Array.isArray(payload) &&
      Object.keys(payload).every((key) =>
        key === "eventId" || key === "articleId" || key === "actionType"
      )
    ) {
      const candidate = payload as Partial<ProfileEventProcessJobPayload>;
      if (
        typeof candidate.eventId === "string" &&
        candidate.eventId.length > 0 &&
        typeof candidate.articleId === "string" &&
        candidate.articleId.length > 0 &&
        isArticleActionType(candidate.actionType)
      ) {
        return {
          eventId: candidate.eventId,
          articleId: candidate.articleId,
          actionType: candidate.actionType
        };
      }
    }
  } catch {
    return null;
  }

  return null;
}

function shouldRecalculateAll(
  profileResult: ProfileUpdateResult,
  actionType: ArticleActionType
): boolean {
  return (
    profileResult.profileChanged ||
    (profileResult.feedStatsChanged && !isHighVolumeArticleOnlyAction(actionType))
  );
}

function isHighVolumeArticleOnlyAction(type: ArticleActionType): boolean {
  return type === "impression" || type === "open" || type === "read_progress";
}

function isArticleActionType(value: unknown): value is ArticleActionType {
  return (
    value === "impression" ||
    value === "open" ||
    value === "mark_read" ||
    value === "mark_unread" ||
    value === "favorite" ||
    value === "unfavorite" ||
    value === "like" ||
    value === "unlike" ||
    value === "read_later" ||
    value === "remove_read_later" ||
    value === "hide" ||
    value === "not_interested" ||
    value === "read_progress"
  );
}

function randomJobId(): string {
  return `job_${randomBytes(8).toString("hex")}`;
}
