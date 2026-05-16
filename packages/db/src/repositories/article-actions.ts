import { randomUUID } from "node:crypto";
import type {
  ArticleActionType,
  ArticleInteractionStatus,
  ArticleStateSnapshot,
  DibaoDatabase,
  RecordArticleActionInput,
  RecordArticleActionResult
} from "../types.js";

export const ARTICLE_ACTION_EVENT_WEIGHTS = {
  impression: -0.15,
  open: 0.2,
  mark_read: 0.7,
  mark_unread: -0.1,
  favorite: 1,
  unfavorite: -0.4,
  read_later: 0.4,
  remove_read_later: -0.2,
  hide: -0.8,
  not_interested: -1,
  read_progress: 0.1
} as const satisfies Record<ArticleActionType, number>;

type ArticleStateDbRow = {
  read: 0 | 1;
  favorited: 0 | 1;
  readLater: 0 | 1;
  hidden: 0 | 1;
  notInterested: 0 | 1;
  readingProgress: number;
  lastOpenedAt: number | null;
  lastIgnoredAt: number | null;
};

export interface ArticleActionRepository {
  record(input: RecordArticleActionInput): RecordArticleActionResult | null;
}

export class SqliteArticleActionRepository implements ArticleActionRepository {
  private readonly recordTransaction: (
    input: Required<Omit<RecordArticleActionInput, "progress" | "metadata">> &
      Pick<RecordArticleActionInput, "progress" | "metadata">
  ) => RecordArticleActionResult | null;

  constructor(private readonly db: DibaoDatabase) {
    this.recordTransaction = this.db.transaction((input) => {
      if (!this.articleExists(input.articleId)) {
        return null;
      }

      this.ensureStateRow(input.articleId, input.now);
      this.insertBehaviorEvent(input);
      this.applyStateChange(input);

      return {
        state: this.getState(input.articleId),
        eventId: input.eventId
      };
    });
  }

  record(input: RecordArticleActionInput): RecordArticleActionResult | null {
    return this.recordTransaction({
      ...input,
      now: input.now ?? Date.now(),
      eventId: input.eventId ?? randomUUID()
    });
  }

  private articleExists(articleId: string): boolean {
    return Boolean(
      this.db
        .prepare(
          `
            select 1
            from articles
            where id = ?
              and deleted_at is null
              and status != 'deleted'
          `
        )
        .get(articleId)
    );
  }

  private ensureStateRow(articleId: string, now: number): void {
    this.db
      .prepare(
        `
          insert into article_states (
            article_id,
            read_at,
            favorited_at,
            read_later_at,
            hidden_at,
            not_interested_at,
            reading_progress,
            last_opened_at,
            updated_at
          )
          values (?, null, null, null, null, null, 0, null, ?)
          on conflict(article_id) do nothing
        `
      )
      .run(articleId, now);
  }

  private insertBehaviorEvent(
    input: Required<Omit<RecordArticleActionInput, "progress" | "metadata">> &
      Pick<RecordArticleActionInput, "progress" | "metadata">
  ): void {
    this.db
      .prepare(
        `
          insert into behavior_events (
            id,
            article_id,
            event_type,
            event_weight,
            metadata_json,
            created_at
          )
          values (?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        input.eventId,
        input.articleId,
        input.type,
        ARTICLE_ACTION_EVENT_WEIGHTS[input.type],
        serializeMetadata(input),
        input.now
      );
  }

  private applyStateChange(
    input: Required<Omit<RecordArticleActionInput, "progress" | "metadata">> &
      Pick<RecordArticleActionInput, "progress" | "metadata">
  ): void {
    const update = this.stateUpdateFor(input);
    this.db.prepare(update.sql).run(...update.params);
  }

  private stateUpdateFor(
    input: Required<Omit<RecordArticleActionInput, "progress" | "metadata">> &
      Pick<RecordArticleActionInput, "progress" | "metadata">
  ): { sql: string; params: unknown[] } {
    switch (input.type) {
      case "impression":
        return {
          sql: "update article_states set updated_at = ? where article_id = ?",
          params: [input.now, input.articleId]
        };
      case "open":
        return {
          sql: "update article_states set last_opened_at = ?, updated_at = ? where article_id = ?",
          params: [input.now, input.now, input.articleId]
        };
      case "mark_read":
        return {
          sql:
            "update article_states set read_at = ?, reading_progress = 1, updated_at = ? where article_id = ?",
          params: [input.now, input.now, input.articleId]
        };
      case "mark_unread":
        return {
          sql:
            "update article_states set read_at = null, reading_progress = 0, updated_at = ? where article_id = ?",
          params: [input.now, input.articleId]
        };
      case "favorite":
        return {
          sql: "update article_states set favorited_at = ?, updated_at = ? where article_id = ?",
          params: [input.now, input.now, input.articleId]
        };
      case "unfavorite":
        return {
          sql:
            "update article_states set favorited_at = null, updated_at = ? where article_id = ?",
          params: [input.now, input.articleId]
        };
      case "read_later":
        return {
          sql: "update article_states set read_later_at = ?, updated_at = ? where article_id = ?",
          params: [input.now, input.now, input.articleId]
        };
      case "remove_read_later":
        return {
          sql:
            "update article_states set read_later_at = null, updated_at = ? where article_id = ?",
          params: [input.now, input.articleId]
        };
      case "hide":
        return {
          sql: "update article_states set hidden_at = ?, updated_at = ? where article_id = ?",
          params: [input.now, input.now, input.articleId]
        };
      case "not_interested":
        return {
          sql:
            "update article_states set not_interested_at = ?, updated_at = ? where article_id = ?",
          params: [input.now, input.now, input.articleId]
        };
      case "read_progress":
        return {
          sql: `
            update article_states
            set
              reading_progress = max(reading_progress, ?),
              last_opened_at = coalesce(last_opened_at, ?),
              read_at = case
                when ? >= 1 and read_at is null then ?
                else read_at
              end,
              updated_at = ?
            where article_id = ?
          `,
          params: [
            input.progress,
            input.now,
            input.progress,
            input.now,
            input.now,
            input.articleId
          ]
        };
    }
  }

  private getState(articleId: string): ArticleStateSnapshot {
    const row = this.db
      .prepare(
        `
          select
            case when read_at is not null then 1 else 0 end as read,
            case when favorited_at is not null then 1 else 0 end as favorited,
            case when read_later_at is not null then 1 else 0 end as readLater,
            case when hidden_at is not null then 1 else 0 end as hidden,
            case when not_interested_at is not null then 1 else 0 end as notInterested,
            reading_progress as readingProgress,
            last_opened_at as lastOpenedAt,
            (
              select max(be.created_at)
              from behavior_events be
              where be.article_id = article_states.article_id
                and be.event_type = 'impression'
            ) as lastIgnoredAt
          from article_states
          where article_id = ?
        `
      )
      .get(articleId) as ArticleStateDbRow | undefined;

    if (!row) {
      throw new Error(`Article state was not created for ${articleId}`);
    }

    return {
      read: row.read === 1,
      favorited: row.favorited === 1,
      readLater: row.readLater === 1,
      hidden: row.hidden === 1,
      notInterested: row.notInterested === 1,
      readingProgress: row.readingProgress,
      interactionStatus: interactionStatusForState(row),
      openedAt: row.lastOpenedAt,
      ignoredAt:
        row.lastIgnoredAt !== null &&
        (row.lastOpenedAt === null || row.lastIgnoredAt > row.lastOpenedAt)
          ? row.lastIgnoredAt
          : null
    };
  }
}

function interactionStatusForState(row: ArticleStateDbRow): ArticleInteractionStatus {
  if (row.read === 1 || row.readingProgress >= 0.9) {
    return "read";
  }
  if (row.readingProgress >= 0.25) {
    return "reading";
  }
  if (row.lastOpenedAt !== null && (row.lastIgnoredAt === null || row.lastOpenedAt >= row.lastIgnoredAt)) {
    return "opened";
  }
  if (row.lastIgnoredAt !== null) {
    return "ignored";
  }
  return "unseen";
}

function serializeMetadata(input: RecordArticleActionInput): string | null {
  const metadata = input.metadata ? { ...input.metadata } : {};

  if (input.type === "read_progress") {
    metadata.progress = input.progress;
  }

  return Object.keys(metadata).length === 0 ? null : JSON.stringify(metadata);
}
