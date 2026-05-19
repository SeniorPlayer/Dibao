import type {
  ArticleActionRepository,
  ArticleActionType,
  RecordArticleActionResult
} from "@dibao/db";
import type { ProfileEventProcessJobService } from "./profile-event-job-service.js";
import type { RankingRecalculateJobService } from "./ranking-job-service.js";

export class ArticleActionServiceError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "ArticleActionServiceError";
  }
}

export type RecordArticleActionServiceInput = {
  articleId: string;
  type: ArticleActionType;
  progress?: number;
  metadata?: Record<string, unknown>;
};

export type ArticleActionServiceOptions = {
  actions: ArticleActionRepository;
  profileJobs?: Pick<ProfileEventProcessJobService, "enqueueEvent">;
  rankingJobs?: Pick<RankingRecalculateJobService, "enqueueAll" | "enqueueArticles">;
  maintenance?: { enqueueStrongActionMaintenance: (now?: number) => unknown };
  removeReadLaterOnReadComplete?: () => boolean;
  now?: () => number;
};

export class ArticleActionService {
  private readonly now: () => number;

  constructor(private readonly options: ArticleActionServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  record(input: RecordArticleActionServiceInput): RecordArticleActionResult {
    const result = this.options.actions.record({
      ...input,
      now: this.now()
    });

    if (!result) {
      throw new ArticleActionServiceError(404, "NOT_FOUND", "Article not found");
    }

    let finalResult = result;
    if (
      result.state.readLater &&
      isReadCompleteAction(input) &&
      this.options.removeReadLaterOnReadComplete?.()
    ) {
      const nextState = this.options.actions.clearReadLater(input.articleId, this.now());
      if (nextState) {
        finalResult = {
          ...result,
          state: nextState
        };
      }
    }

    this.options.rankingJobs?.enqueueArticles([input.articleId]);
    this.options.profileJobs?.enqueueEvent({
      eventId: result.eventId,
      articleId: input.articleId,
      actionType: input.type
    });
    if (isStrongMaintenanceAction(input)) {
      this.options.maintenance?.enqueueStrongActionMaintenance(this.now());
    }

    return finalResult;
  }
}

function isReadCompleteAction(input: RecordArticleActionServiceInput): boolean {
  if (input.type === "mark_read") {
    return true;
  }

  return (
    input.type === "read_progress" &&
    typeof input.progress === "number" &&
    input.progress >= 0.9
  );
}

function isStrongMaintenanceAction(input: RecordArticleActionServiceInput): boolean {
  if (
    input.type === "favorite" ||
    input.type === "like" ||
    input.type === "read_later" ||
    input.type === "mark_read" ||
    input.type === "hide" ||
    input.type === "not_interested"
  ) {
    return true;
  }

  return (
    input.type === "read_progress" &&
    typeof input.progress === "number" &&
    input.progress >= 0.75
  );
}
