import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import Fastify, { type FastifyReply } from "fastify";
import {
  ARTICLE_ACTION_EVENT_WEIGHTS,
  getSqliteVecVersion,
  openDatabase,
  SqliteArticleActionRepository,
  SqliteArticleRepository,
  SqliteFeedRepository,
  type ArticleActionType,
  type ArticleDetailRow,
  type ArticleListInput,
  type ArticleListItemRow,
  type ArticleListView,
  type ArticleReadStatus,
  type DibaoDatabase,
  type FeedListInput,
  type FeedRow
} from "@dibao/db";
import { dibaoVersion, type ApiError } from "@dibao/shared";
import {
  ArticleActionService,
  ArticleActionServiceError
} from "./article-action-service.js";
import {
  FeedIngestionError,
  FeedRefreshService,
  type FeedFetcher
} from "./feed-refresh-service.js";

type HealthStatus = "ok" | "error";

type HealthResponse = {
  ok: boolean;
  database: HealthStatus;
  fts: HealthStatus;
  vectorStore: HealthStatus;
  version: string;
};

type FeedQuery = {
  folderId?: string;
  enabled?: string;
};

type CreateFeedBody = {
  feedUrl?: unknown;
  folderId?: unknown;
};

type FeedParams = {
  id: string;
};

type ArticleQuery = {
  view?: string;
  feedId?: string;
  folderId?: string;
  status?: string;
  limit?: string;
  cursor?: string;
};

type ArticleParams = {
  id: string;
};

type ArticleActionBody = {
  type?: unknown;
  value?: unknown;
  progress?: unknown;
  metadata?: unknown;
};

type CursorPayload = {
  offset: number;
};

type BuildServerOptions = {
  db?: DibaoDatabase;
  databasePath?: string;
  migrate?: boolean;
  closeDatabaseOnClose?: boolean;
  feedFetcher?: FeedFetcher;
  now?: () => number;
  logger?: boolean;
};

export function buildServer(options: BuildServerOptions = {}) {
  const db = options.db ?? openConfiguredDatabase(options);
  const closeDatabaseOnClose = options.closeDatabaseOnClose ?? !options.db;
  const feeds = new SqliteFeedRepository(db);
  const articles = new SqliteArticleRepository(db);
  const articleActions = new SqliteArticleActionRepository(db);
  const feedRefreshService = new FeedRefreshService({
    db,
    feeds,
    articles,
    fetcher: options.feedFetcher,
    now: options.now
  });
  const articleActionService = new ArticleActionService({
    actions: articleActions,
    now: options.now
  });

  const app = Fastify({
    logger: options.logger ?? true
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    return sendApiError(reply, 500, "INTERNAL_ERROR", "Internal server error");
  });

  if (closeDatabaseOnClose) {
    app.addHook("onClose", async () => {
      db.close();
    });
  }

  app.get("/api/system/health", async (_request, reply) => {
    const data = getHealth(db);
    const statusCode = data.ok ? 200 : 503;
    return reply.status(statusCode).send({ data });
  });

  app.get<{ Querystring: FeedQuery }>("/api/feeds", async (request, reply) => {
    const enabled = parseBooleanParam(request.query.enabled);
    if (enabled === null) {
      return sendApiError(reply, 400, "VALIDATION_ERROR", "enabled must be true or false");
    }

    const input: FeedListInput = {};
    if (request.query.folderId !== undefined) {
      input.folderId = request.query.folderId;
    }
    if (enabled !== undefined) {
      input.enabled = enabled;
    }

    return {
      data: feeds.list(input).map(mapFeed)
    };
  });

  app.post<{ Body: CreateFeedBody }>("/api/feeds", async (request, reply) => {
    const parsed = parseCreateFeedBody(request.body);
    if (!parsed.ok) {
      return sendApiError(reply, 400, "VALIDATION_ERROR", parsed.message);
    }

    try {
      const result = await feedRefreshService.addFeed(parsed.input);

      return {
        data: {
          feed: mapFeed(result.feed),
          refreshJobId: result.jobId
        }
      };
    } catch (error) {
      return sendFeedIngestionError(reply, error);
    }
  });

  app.post<{ Params: FeedParams }>("/api/feeds/:id/refresh", async (request, reply) => {
    try {
      const result = await feedRefreshService.refreshFeed(request.params.id);

      return {
        data: {
          jobId: result.jobId
        }
      };
    } catch (error) {
      return sendFeedIngestionError(reply, error);
    }
  });

  app.get<{ Querystring: ArticleQuery }>("/api/articles", async (request, reply) => {
    const parsed = parseArticleQuery(request.query);
    if (!parsed.ok) {
      return sendApiError(reply, 400, "VALIDATION_ERROR", parsed.message, parsed.details);
    }

    const result = articles.list(parsed.input);

    return {
      data: result.items.map(mapArticleListItem),
      page: {
        nextCursor: encodeCursor(result.nextOffset)
      }
    };
  });

  app.get<{ Params: ArticleParams }>("/api/articles/:id", async (request, reply) => {
    const article = articles.findDetailById(request.params.id);

    if (!article) {
      return sendApiError(reply, 404, "NOT_FOUND", "Article not found");
    }

    return {
      data: mapArticleDetail(article)
    };
  });

  app.post<{ Params: ArticleParams; Body: ArticleActionBody }>(
    "/api/articles/:id/actions",
    async (request, reply) => {
      const parsed = parseArticleActionBody(request.body);
      if (!parsed.ok) {
        return sendApiError(reply, 400, "VALIDATION_ERROR", parsed.message, parsed.details);
      }

      try {
        const result = articleActionService.record({
          articleId: request.params.id,
          ...parsed.input
        });

        return {
          data: {
            state: result.state
          }
        };
      } catch (error) {
        return sendArticleActionError(reply, error);
      }
    }
  );

  return app;
}

function openConfiguredDatabase(options: BuildServerOptions): DibaoDatabase {
  const databasePath = resolveDatabasePath(options.databasePath);
  ensureDatabaseDirectory(databasePath);

  return openDatabase(databasePath, {
    migrate: options.migrate ?? true
  });
}

function resolveDatabasePath(databasePath: string | undefined): string {
  const requested =
    databasePath ??
    process.env.DIBAO_DATABASE_PATH ??
    process.env.DIBAO_DB_PATH ??
    ".dibao/dibao.sqlite";

  if (requested === ":memory:") {
    return requested;
  }

  return isAbsolute(requested) ? requested : resolve(process.cwd(), requested);
}

function ensureDatabaseDirectory(databasePath: string): void {
  if (databasePath === ":memory:") {
    return;
  }

  mkdirSync(dirname(databasePath), { recursive: true });
}

function getHealth(db: DibaoDatabase): HealthResponse {
  const database = checkHealth(() => {
    db.prepare("select 1 as ok").get();
  });
  const fts = checkHealth(() => {
    db.prepare("select count(*) as count from article_fts").get();
  });
  const vectorStore = checkHealth(() => {
    getSqliteVecVersion(db);
  });

  return {
    ok: database === "ok" && fts === "ok" && vectorStore === "ok",
    database,
    fts,
    vectorStore,
    version: dibaoVersion
  };
}

function checkHealth(fn: () => void): HealthStatus {
  try {
    fn();
    return "ok";
  } catch {
    return "error";
  }
}

function parseArticleQuery(query: ArticleQuery):
  | { ok: true; input: ArticleListInput }
  | { ok: false; message: string; details?: unknown } {
  const view = parseArticleView(query.view);
  if (view === null) {
    return {
      ok: false,
      message: "view must be recommended, latest, favorites, or read_later"
    };
  }

  const status = parseArticleStatus(query.status);
  if (status === null) {
    return {
      ok: false,
      message: "status must be unread, read, or all"
    };
  }

  const limit = parseLimit(query.limit);
  if (limit === null) {
    return {
      ok: false,
      message: "limit must be a positive integer"
    };
  }

  const offset = decodeCursor(query.cursor);
  if (offset === null) {
    return {
      ok: false,
      message: "cursor is invalid"
    };
  }

  const input: ArticleListInput = {
    view: view ?? "latest",
    limit,
    offset
  };

  if (query.feedId !== undefined) {
    input.feedId = query.feedId;
  }
  if (query.folderId !== undefined) {
    input.folderId = query.folderId;
  }
  if (status !== undefined) {
    input.status = status;
  }

  return { ok: true, input };
}

function parseCreateFeedBody(body: CreateFeedBody | undefined):
  | { ok: true; input: { feedUrl: string; folderId?: string | null } }
  | { ok: false; message: string } {
  if (!body || typeof body.feedUrl !== "string" || body.feedUrl.trim() === "") {
    return { ok: false, message: "feedUrl is required" };
  }

  if (
    body.folderId !== undefined &&
    body.folderId !== null &&
    typeof body.folderId !== "string"
  ) {
    return { ok: false, message: "folderId must be a string or null" };
  }

  return {
    ok: true,
    input: {
      feedUrl: body.feedUrl,
      ...(body.folderId !== undefined ? { folderId: body.folderId } : {})
    }
  };
}

function parseArticleActionBody(body: ArticleActionBody | undefined):
  | {
      ok: true;
      input: {
        type: ArticleActionType;
        progress?: number;
        metadata?: Record<string, unknown>;
      };
    }
  | { ok: false; message: string; details?: unknown } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, message: "request body must be an object" };
  }

  const type = normalizeArticleActionType(body.type, body.value);
  if (!type) {
    return {
      ok: false,
      message:
        "type must be open, mark_read, mark_unread, favorite, unfavorite, read_later, remove_read_later, hide, not_interested, or read_progress"
    };
  }

  const metadata = parseMetadata(body.metadata);
  if (metadata === null) {
    return { ok: false, message: "metadata must be an object" };
  }

  if (type === "read_progress") {
    const progress = parseProgress(body.progress ?? body.value);
    if (progress === null) {
      return {
        ok: false,
        message: "progress or value must be a number between 0 and 1",
        details: { fields: ["progress", "value"], min: 0, max: 1 }
      };
    }

    return {
      ok: true,
      input: {
        type,
        progress,
        ...(metadata !== undefined ? { metadata } : {})
      }
    };
  }

  return {
    ok: true,
    input: {
      type,
      ...(metadata !== undefined ? { metadata } : {})
    }
  };
}

function parseArticleView(value: string | undefined): ArticleListView | undefined | null {
  if (value === undefined) {
    return undefined;
  }

  if (
    value === "recommended" ||
    value === "latest" ||
    value === "favorites" ||
    value === "read_later"
  ) {
    return value;
  }

  return null;
}

function isArticleActionType(value: unknown): value is ArticleActionType {
  return (
    typeof value === "string" &&
    Object.hasOwn(ARTICLE_ACTION_EVENT_WEIGHTS, value)
  );
}

function normalizeArticleActionType(type: unknown, value: unknown): ArticleActionType | null {
  if (!isArticleActionType(type)) {
    return null;
  }

  if (value === false) {
    if (type === "favorite") {
      return "unfavorite";
    }
    if (type === "read_later") {
      return "remove_read_later";
    }
    if (type === "mark_read") {
      return "mark_unread";
    }
  }

  return type;
}

function parseProgress(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    return null;
  }

  return value;
}

function parseMetadata(value: unknown): Record<string, unknown> | undefined | null {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function parseArticleStatus(value: string | undefined): ArticleReadStatus | undefined | null {
  if (value === undefined) {
    return undefined;
  }

  if (value === "unread" || value === "read" || value === "all") {
    return value;
  }

  return null;
}

function parseBooleanParam(value: string | undefined): boolean | undefined | null {
  if (value === undefined) {
    return undefined;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return null;
}

function parseLimit(value: string | undefined): number | undefined | null {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }

  return Math.min(parsed, 100);
}

function encodeCursor(offset: number | null): string | null {
  if (offset === null) {
    return null;
  }

  return Buffer.from(JSON.stringify({ offset } satisfies CursorPayload)).toString("base64url");
}

function decodeCursor(cursor: string | undefined): number | undefined | null {
  if (cursor === undefined) {
    return undefined;
  }

  try {
    const payload = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<
      CursorPayload
    >;

    const offset = payload.offset;
    if (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0) {
      return null;
    }

    return offset;
  } catch {
    return null;
  }
}

function mapFeed(feed: FeedRow) {
  return {
    ...feed,
    lastFetchedAt: timestampToIso(feed.lastFetchedAt),
    lastSuccessAt: timestampToIso(feed.lastSuccessAt),
    createdAt: timestampToIsoValue(feed.createdAt),
    updatedAt: timestampToIsoValue(feed.updatedAt)
  };
}

function mapArticleListItem(article: ArticleListItemRow) {
  return {
    id: article.id,
    feedId: article.feedId,
    feedTitle: article.feedTitle,
    title: article.title,
    url: article.url,
    author: article.author,
    summary: article.summary,
    publishedAt: timestampToIso(article.publishedAt),
    discoveredAt: timestampToIsoValue(article.discoveredAt),
    state: article.state,
    ...(article.rank
      ? {
          rank: {
            score: article.rank.score,
            calculatedAt: timestampToIsoValue(article.rank.calculatedAt)
          }
        }
      : {})
  };
}

function mapArticleDetail(article: ArticleDetailRow) {
  return {
    ...mapArticleListItem(article),
    contentHtml: article.contentHtml,
    contentText: article.contentText,
    extractionStatus: article.extractionStatus,
    extractionError: article.extractionError
  };
}

function timestampToIso(value: number | null): string | null {
  return value === null ? null : timestampToIsoValue(value);
}

function timestampToIsoValue(value: number): string {
  return new Date(value).toISOString();
}

function sendApiError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
  details?: unknown
) {
  const error: ApiError["error"] = { code, message };

  if (details !== undefined) {
    error.details = details;
  }

  return reply.status(statusCode).send({ error });
}

function sendFeedIngestionError(reply: FastifyReply, error: unknown) {
  if (error instanceof FeedIngestionError) {
    return sendApiError(reply, error.statusCode, error.code, error.message, error.details);
  }

  throw error;
}

function sendArticleActionError(reply: FastifyReply, error: unknown) {
  if (error instanceof ArticleActionServiceError) {
    return sendApiError(reply, error.statusCode, error.code, error.message, error.details);
  }

  throw error;
}
