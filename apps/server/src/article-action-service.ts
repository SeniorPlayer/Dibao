import type {
  ArticleActionRepository,
  ArticleActionType,
  RecordArticleActionResult
} from "@dibao/db";

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

    return result;
  }
}
