import { describe, expect, it } from "vitest";
import type {
  ArticleActionRepository,
  ArticleActionType,
  JobRow,
  RecordArticleActionInput,
  RecordArticleActionResult
} from "@dibao/db";
import { ArticleActionService } from "./article-action-service.js";
import {
  HIGH_VOLUME_PROFILE_RANKING_DELAY_MS,
  ProfileEventProcessJobService,
  parseProfileEventProcessPayload
} from "./profile-event-job-service.js";

describe("ArticleActionService", () => {
  it("keeps action requests to article-level ranking jobs and defers profile work", () => {
    const calls = createRankingCallRecorder();
    const profileJobs = createProfileJobRecorder();
    const service = new ArticleActionService({
      actions: fixedActionRepository(),
      profileJobs,
      rankingJobs: calls,
      deferPostActionWork: (work) => work()
    });

    for (const type of ["favorite", "impression", "open", "read_progress"] satisfies ArticleActionType[]) {
      service.record({ articleId: "article_1", type });
    }

    expect(calls.enqueueAllCount).toBe(0);
    expect(calls.articleJobs).toEqual([
      ["article_1"],
      ["article_1"],
      ["article_1"],
      ["article_1"]
    ]);
    expect(profileJobs.events).toEqual([
      { actionType: "favorite", articleId: "article_1", eventId: "event_favorite" },
      { actionType: "impression", articleId: "article_1", eventId: "event_impression" },
      { actionType: "open", articleId: "article_1", eventId: "event_open" },
      { actionType: "read_progress", articleId: "article_1", eventId: "event_read_progress" }
    ]);
  });

  it("processes deferred profile events and enqueues full ranking only when needed", () => {
    const jobs = createJobRecorder();
    const rankingJobs = createRankingCallRecorder();
    const service = new ProfileEventProcessJobService({
      jobs,
      profile: {
        processEvent: (eventId: string) => ({
          articleIds: ["article_1"],
          feedStatsChanged: true,
          profileChanged: eventId === "event_profile" || eventId === "event_open_profile"
        })
      },
      rankingJobs,
      jobIdFactory: () => `job_${jobs.enqueued.length + 1}`,
      now: () => 1000
    });

    const profileJob = service.enqueueEvent({
      eventId: "event_profile",
      articleId: "article_1",
      actionType: "favorite"
    });
    service.enqueueEvent({
      eventId: "event_profile",
      articleId: "article_1",
      actionType: "favorite"
    });
    const passiveJob = service.enqueueEvent({
      eventId: "event_passive",
      articleId: "article_1",
      actionType: "read_progress"
    });
    const openProfileJob = service.enqueueEvent({
      eventId: "event_open_profile",
      articleId: "article_1",
      actionType: "open"
    });

    expect(jobs.enqueued).toHaveLength(3);
    expect(parseProfileEventProcessPayload(profileJob.payloadJson)).toMatchObject({
      eventId: "event_profile"
    });

    service.handleProfileEventProcessJob(profileJob);
    service.handleProfileEventProcessJob(passiveJob);
    service.handleProfileEventProcessJob(openProfileJob);

    expect(rankingJobs.enqueueAllCount).toBe(2);
    expect(rankingJobs.enqueueAllOptions).toEqual([
      { delayMs: 0 },
      { delayMs: HIGH_VOLUME_PROFILE_RANKING_DELAY_MS }
    ]);
    expect(rankingJobs.articleJobs).toEqual([]);
  });

  it("can clear read-later state after a read-complete progress event without recording a new action", () => {
    const service = new ArticleActionService({
      actions: fixedActionRepository({
        readLater: true,
        clearReadLaterState: true
      }),
      deferPostActionWork: (work) => work(),
      removeReadLaterOnReadComplete: () => true
    });

    const result = service.record({
      articleId: "article_1",
      type: "read_progress",
      progress: 0.9
    });

    expect(result.eventId).toBe("event_read_progress");
    expect(result.state).toMatchObject({
      readLater: false,
      readingProgress: 0.9,
      interactionStatus: "read"
    });
  });
});

function fixedActionRepository(
  options: {
    readLater?: boolean;
    clearReadLaterState?: boolean;
  } = {}
): ArticleActionRepository {
  return {
    clearReadLater(_articleId: string): RecordArticleActionResult["state"] {
      return {
        read: false,
        favorited: false,
        liked: false,
        readLater: !options.clearReadLaterState,
        hidden: false,
        notInterested: false,
        readingProgress: 0.9,
        interactionStatus: "read",
        openedAt: null,
        ignoredAt: null
      };
    },
    record(input: RecordArticleActionInput): RecordArticleActionResult {
      return {
        eventId: `event_${input.type}`,
        state: {
          read: false,
          favorited: false,
          liked: false,
          readLater: options.readLater ?? false,
          hidden: false,
          notInterested: false,
          readingProgress: input.progress ?? 0,
          interactionStatus:
            input.type === "read_progress" && (input.progress ?? 0) >= 0.9
              ? "read"
              : input.type === "impression"
                ? "ignored"
                : "opened",
          openedAt: input.type === "open" ? input.now ?? 1000 : null,
          ignoredAt: input.type === "impression" ? input.now ?? 1000 : null
        }
      };
    }
  };
}

function createRankingCallRecorder() {
  return {
    enqueueAllCount: 0,
    enqueueAllOptions: [] as Array<{ delayMs?: number }>,
    articleJobs: [] as string[][],
    enqueueAll(options: { delayMs?: number } = {}) {
      this.enqueueAllCount += 1;
      this.enqueueAllOptions.push(options);
      return {} as never;
    },
    enqueueArticles(articleIds: string[]) {
      this.articleJobs.push(articleIds);
      return {} as never;
    }
  };
}

function createProfileJobRecorder() {
  return {
    events: [] as Array<{ eventId: string; articleId: string; actionType: ArticleActionType }>,
    enqueueEvent(input: { eventId: string; articleId: string; actionType: ArticleActionType }) {
      this.events.push(input);
      return {} as never;
    }
  };
}

function createJobRecorder() {
  const enqueued: JobRow[] = [];

  return {
    enqueued,
    enqueue(input: {
      id: string;
      type: "profile_event_process";
      payloadJson: string | null;
    }) {
      const job = {
        id: input.id,
        type: input.type,
        payloadJson: input.payloadJson ?? "",
        status: "queued" as const,
        attempts: 0,
        maxAttempts: 2,
        priority: 0,
        runAfter: 1000,
        createdAt: 1000,
        updatedAt: 1000,
        startedAt: null,
        finishedAt: null,
        error: null
      };
      enqueued.push(job);
      return job;
    },
    listOpenByType() {
      return enqueued;
    }
  };
}
