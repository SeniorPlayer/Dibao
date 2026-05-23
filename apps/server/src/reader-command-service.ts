import { randomBytes } from "node:crypto";
import type {
  ArticleRepository,
  ArticleScope,
  MarkScopeReadCommandInput,
  MarkScopeReadCommandResult,
  ReaderCommandEventRepository
} from "@dibao/db";
import {
  RANKING_RECALCULATE_ARTICLE_LIMIT,
  type RankingRecalculateJobService
} from "./ranking-job-service.js";

export class ReaderCommandServiceError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "ReaderCommandServiceError";
  }
}

export type ReaderCommandServiceOptions = {
  articles: Pick<
    ArticleRepository,
    "countUnreadForScope" | "listUnreadArticleIdsForScope" | "markArticleIdsRead"
  >;
  commandEvents: ReaderCommandEventRepository;
  rankingJobs?: Pick<RankingRecalculateJobService, "enqueueAll" | "enqueueArticles">;
  now?: () => number;
  commandIdFactory?: () => string;
};

export class ReaderCommandService {
  private readonly now: () => number;
  private readonly commandIdFactory: () => string;

  constructor(private readonly options: ReaderCommandServiceOptions) {
    this.now = options.now ?? Date.now;
    this.commandIdFactory = options.commandIdFactory ?? randomCommandId;
  }

  markScopeRead(input: MarkScopeReadCommandInput): MarkScopeReadCommandResult {
    const now = input.now ?? this.now();
    const scope = normalizeScope(input.scope, now);
    const commandId = this.commandIdFactory();

    return this.options.commandEvents.transaction(() => {
      const expectedCount = this.options.articles.countUnreadForScope(scope);
      const affectedArticleIds = this.options.articles.listUnreadArticleIdsForScope(scope);
      const markedReadCount = this.options.articles.markArticleIdsRead(affectedArticleIds, now);
      const result = {
        commandId,
        markedReadCount: Math.min(markedReadCount, expectedCount),
        affectedArticleIds
      } satisfies MarkScopeReadCommandResult;

      this.options.commandEvents.record({
        id: commandId,
        commandType: "mark_scope_read",
        scope,
        result: {
          markedReadCount: result.markedReadCount,
          affectedArticleIds
        },
        createdAt: now
      });

      this.enqueueRankingUpdate(affectedArticleIds);

      return result;
    });
  }

  private enqueueRankingUpdate(articleIds: string[]): void {
    if (!this.options.rankingJobs || articleIds.length === 0) {
      return;
    }

    if (articleIds.length <= RANKING_RECALCULATE_ARTICLE_LIMIT) {
      this.options.rankingJobs.enqueueArticles(articleIds);
      return;
    }

    this.options.rankingJobs.enqueueAll();
  }
}

function normalizeScope(scope: ArticleScope, now: number): ArticleScope {
  if (scope.feedId && scope.folderId) {
    throw new ReaderCommandServiceError(
      400,
      "VALIDATION_ERROR",
      "feedId and folderId cannot be used together",
      { fields: ["feedId", "folderId"] }
    );
  }

  if (scope.type === "search") {
    const query = scope.query.trim();
    if (!query) {
      throw new ReaderCommandServiceError(400, "VALIDATION_ERROR", "q is required", {
        field: "q"
      });
    }

    return {
      ...scope,
      query
    };
  }

  const timeWindow = scope.timeWindow ?? "all";
  if (timeWindow === "all") {
    return {
      ...scope,
      timeWindow,
      todayStartAt: undefined,
      todayEndAt: undefined
    };
  }

  const range = rollingTimeRange(now, timeWindow);
  return {
    ...scope,
    timeWindow,
    todayStartAt: scope.todayStartAt ?? range.startAt,
    todayEndAt: scope.todayEndAt ?? range.endAt
  };
}

function rollingTimeRange(
  timestamp: number,
  window: "24h" | "7d" | "30d"
): { startAt: number; endAt: number } {
  const durationMs =
    window === "24h"
      ? 24 * 60 * 60 * 1000
      : window === "7d"
        ? 7 * 24 * 60 * 60 * 1000
        : 30 * 24 * 60 * 60 * 1000;
  return {
    startAt: timestamp - durationMs,
    endAt: timestamp
  };
}

function randomCommandId(): string {
  return `cmd_${randomBytes(10).toString("hex")}`;
}
