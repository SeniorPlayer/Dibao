import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest
} from "fastify";
import {
  ARTICLE_ACTION_EVENT_WEIGHTS,
  getSqliteVecVersion,
  openDatabase,
  SqliteAppSettingsRepository,
  SqliteArticleActionRepository,
  SqliteArticleRepository,
  SqliteAuthCredentialRepository,
  SqliteEmbeddingRepository,
  SqliteFeedFolderRepository,
  SqliteFeedRepository,
  SqliteJobRepository,
  SqliteProfileRepository,
  SqliteRankingRepository,
  SqliteSessionRepository,
  SqliteVecVectorStore,
  type ArticleActionType,
  type ArticleDetailRow,
  type ArticleListInput,
  type ArticleListItemRow,
  type ArticleListView,
  type ArticleReadStatus,
  type DibaoDatabase,
  type EmbeddingIndexListRow,
  type EmbeddingProviderRow,
  type FeedFolderRow,
  type FeedListInput,
  type FeedRow,
  type JobRow,
  type JobStatus,
  type JobType
} from "@dibao/db";
import { dibaoVersion, type ApiError } from "@dibao/shared";
import {
  ArticleActionService,
  ArticleActionServiceError
} from "./article-action-service.js";
import {
  readSessionCookie,
  serializeClearSessionCookie,
  serializeSessionCookie
} from "./auth-cookie.js";
import { AuthService, AuthServiceError } from "./auth-service.js";
import { ArticleRetentionService } from "./article-retention-service.js";
import {
  EmbeddingJobService,
  EMBEDDING_GENERATE_JOB_TYPE,
  parseEmbeddingGeneratePayload
} from "./embedding-job-service.js";
import {
  EmbeddingProviderService,
  EmbeddingProviderServiceError
} from "./embedding-provider-service.js";
import { OllamaEmbeddingAdapter } from "./embedding/ollama-adapter.js";
import { OpenAiCompatibleEmbeddingAdapter } from "./embedding/openai-compatible-adapter.js";
import {
  FeedManagementService,
  FeedManagementServiceError
} from "./feed-management-service.js";
import {
  DEFAULT_FEED_REFRESH_INTERVAL_MS,
  FeedRefreshCoordinator,
  FeedRefreshJobService,
  FeedRefreshScheduler
} from "./feed-refresh-job-service.js";
import {
  FeedIngestionError,
  FeedRefreshService,
  type FeedFetcher
} from "./feed-refresh-service.js";
import { JobRunner } from "./job-runner.js";
import { OpmlService, OpmlServiceError } from "./opml-service.js";
import {
  DEFAULT_PROFILE_DECAY_INTERVAL_MS,
  ProfileDecayJobService,
  ProfileDecayScheduler
} from "./profile-decay-job-service.js";
import { ProfileService } from "./profile-service.js";
import {
  RankingRecalculateJobService,
  RANKING_RECALCULATE_JOB_TYPE
} from "./ranking-job-service.js";
import { RecommendationRankingService } from "./ranking-service.js";
import {
  DEFAULT_RETENTION_CLEANUP_INTERVAL_MS,
  RetentionCleanupJobService,
  RetentionCleanupScheduler
} from "./retention-cleanup-job-service.js";
import { SettingsService, SettingsServiceError } from "./settings-service.js";
import {
  VectorIndexRebuildJobService,
  VECTOR_INDEX_REBUILD_JOB_TYPE
} from "./vector-index-rebuild-job-service.js";

type HealthStatus = "ok" | "error";

type HealthResponse = {
  ok: boolean;
  database: HealthStatus;
  fts: HealthStatus;
  vectorStore: HealthStatus;
  version: string;
};

type SetupStatusResponse = {
  setupCompleted: boolean;
  hasFeeds: boolean;
  hasEmbeddingProvider: boolean;
  firstRefreshStatus: "idle" | "running" | "succeeded" | "failed";
};

type FeedQuery = {
  folderId?: string;
  enabled?: string;
};

type CreateFeedBody = {
  feedUrl?: unknown;
  folderId?: unknown;
};

type FeedFolderParams = {
  id: string;
};

type PasswordBody = {
  password?: unknown;
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

type JobQuery = {
  status?: string;
  type?: string;
  limit?: string;
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

type EmbeddingProviderParams = {
  id: string;
};

type EmbeddingIndexParams = {
  id: string;
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
  cookieSecure?: boolean;
  authRequired?: boolean;
  backgroundJobs?: boolean;
  feedRefreshIntervalMs?: number;
  retentionCleanupIntervalMs?: number;
  profileDecayIntervalMs?: number;
  jobRunnerIntervalMs?: number;
  jobRetryDelayMs?: number;
  embeddingFetcher?: typeof fetch;
  webDistDir?: string | false;
};

export function buildServer(options: BuildServerOptions = {}) {
  const db = options.db ?? openConfiguredDatabase(options);
  const closeDatabaseOnClose = options.closeDatabaseOnClose ?? !options.db;
  const settings = new SqliteAppSettingsRepository(db);
  const credentials = new SqliteAuthCredentialRepository(db);
  const sessions = new SqliteSessionRepository(db);
  const folders = new SqliteFeedFolderRepository(db);
  const feeds = new SqliteFeedRepository(db);
  const jobs = new SqliteJobRepository(db);
  const articles = new SqliteArticleRepository(db);
  const embeddings = new SqliteEmbeddingRepository(db);
  const articleActions = new SqliteArticleActionRepository(db);
  const rankings = new SqliteRankingRepository(db);
  const profiles = new SqliteProfileRepository(db);
  const vectorStore = new SqliteVecVectorStore(db);
  const embeddingAdapters = {
    openai_compatible: new OpenAiCompatibleEmbeddingAdapter({
      fetcher: options.embeddingFetcher
    }),
    ollama: new OllamaEmbeddingAdapter({
      fetcher: options.embeddingFetcher
    })
  };
  const embeddingProviderService = new EmbeddingProviderService({
    embeddings,
    vectorStore,
    adapters: embeddingAdapters,
    now: options.now
  });
  const profileService = new ProfileService({
    embeddings,
    profiles,
    now: options.now
  });
  const rankingService = new RecommendationRankingService({
    embeddings,
    profiles,
    rankings,
    now: options.now
  });
  const rankingJobService = new RankingRecalculateJobService({
    jobs,
    ranking: rankingService,
    now: options.now
  });
  const embeddingJobService = new EmbeddingJobService({
    articles,
    embeddings,
    jobs,
    providerService: embeddingProviderService,
    profile: profileService,
    rankingJobs: rankingJobService,
    vectorStore,
    now: options.now
  });
  const vectorIndexRebuildJobService = new VectorIndexRebuildJobService({
    embeddings,
    jobs,
    vectorStore,
    now: options.now
  });
  const feedRefreshService = new FeedRefreshService({
    db,
    feeds,
    articles,
    ranking: rankingService,
    fetcher: options.feedFetcher,
    now: options.now
  });
  const feedRefreshCoordinator = new FeedRefreshCoordinator({
    refreshService: feedRefreshService,
    afterRefresh: (result) => {
      enqueueEmbeddingArticles(result.articleIds);
    }
  });
  const feedRefreshJobService = new FeedRefreshJobService({
    feeds,
    jobs,
    refresher: feedRefreshCoordinator,
    now: options.now
  });
  const articleActionService = new ArticleActionService({
    actions: articleActions,
    profile: profileService,
    rankingJobs: rankingJobService,
    now: options.now
  });
  const feedManagementService = new FeedManagementService({
    feeds,
    folders,
    ranking: rankingService,
    now: options.now
  });
  const opmlService = new OpmlService({
    folders,
    feeds,
    now: options.now
  });
  const authService = new AuthService({
    credentials,
    sessions,
    settings,
    now: options.now
  });
  const articleRetentionService = new ArticleRetentionService({
    settings,
    articles,
    vectorStore,
    now: options.now
  });
  const settingsService = new SettingsService({
    settings,
    now: options.now
  });
  const retentionCleanupJobService = new RetentionCleanupJobService({
    jobs,
    retention: articleRetentionService,
    now: options.now
  });
  const profileDecayJobService = new ProfileDecayJobService({
    jobs,
    profile: profileService,
    rankingJobs: rankingJobService,
    settings,
    now: options.now
  });
  const cookieOptions = {
    secure: resolveCookieSecure(options.cookieSecure)
  };
  const authRequired = options.authRequired ?? true;
  const backgroundJobs = options.backgroundJobs ?? false;

  const app = Fastify({
    logger: options.logger ?? true
  });
  const jobRunner = new JobRunner({
    jobs,
    handlers: {
      feed_refresh: (job) => feedRefreshJobService.handleFeedRefreshJob(job),
      retention_cleanup: (job) => retentionCleanupJobService.handleRetentionCleanupJob(job),
      profile_decay: (job) => profileDecayJobService.handleProfileDecayJob(job),
      [RANKING_RECALCULATE_JOB_TYPE]: (job) =>
        rankingJobService.handleRankingRecalculateJob(job),
      [EMBEDDING_GENERATE_JOB_TYPE]: (job) =>
        embeddingJobService.handleEmbeddingGenerateJob(job),
      [VECTOR_INDEX_REBUILD_JOB_TYPE]: (job) =>
        vectorIndexRebuildJobService.handleVectorIndexRebuildJob(job)
    },
    now: options.now,
    pollIntervalMs: options.jobRunnerIntervalMs,
    retryDelayMs: options.jobRetryDelayMs,
    onError: (error) => app.log.error(error)
  });
  const feedRefreshScheduler = new FeedRefreshScheduler({
    refreshJobs: feedRefreshJobService,
    runner: jobRunner,
    intervalMs: options.feedRefreshIntervalMs ?? DEFAULT_FEED_REFRESH_INTERVAL_MS,
    onError: (error) => app.log.error(error)
  });
  const retentionCleanupScheduler = new RetentionCleanupScheduler({
    cleanupJobs: retentionCleanupJobService,
    runner: jobRunner,
    intervalMs: options.retentionCleanupIntervalMs ?? DEFAULT_RETENTION_CLEANUP_INTERVAL_MS,
    onError: (error) => app.log.error(error)
  });
  const profileDecayScheduler = new ProfileDecayScheduler({
    decayJobs: profileDecayJobService,
    runner: jobRunner,
    intervalMs: options.profileDecayIntervalMs ?? DEFAULT_PROFILE_DECAY_INTERVAL_MS,
    onError: (error) => app.log.error(error)
  });

  function drainBackgroundJobs(): void {
    if (backgroundJobs) {
      void jobRunner.drainDue().catch((error) => app.log.error(error));
    }
  }

  function enqueueEmbeddingArticles(articleIds: string[]): void {
    try {
      const queued = embeddingJobService.enqueueArticlesForActiveIndex(articleIds);
      if (queued.length > 0) {
        drainBackgroundJobs();
      }
    } catch (error) {
      app.log.error(error);
    }
  }

  function enqueueEmbeddingBackfill(): void {
    try {
      const queued = embeddingJobService.enqueueBackfillForActiveIndex();
      if (queued.length > 0) {
        drainBackgroundJobs();
      }
    } catch (error) {
      app.log.error(error);
    }
  }

  function enqueueRankingAll(): void {
    try {
      rankingJobService.enqueueAll();
      drainBackgroundJobs();
    } catch (error) {
      app.log.error(error);
    }
  }

  app.addContentTypeParser(
    /^multipart\/form-data(?:;.*)?$/i,
    { parseAs: "buffer" },
    (_request, body, done) => {
      done(null, body);
    }
  );
  app.addContentTypeParser(
    /^application\/xml(?:;.*)?$/i,
    { parseAs: "string" },
    (_request, body, done) => {
      done(null, body);
    }
  );
  app.addContentTypeParser(
    /^text\/xml(?:;.*)?$/i,
    { parseAs: "string" },
    (_request, body, done) => {
      done(null, body);
    }
  );

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    return sendApiError(reply, 500, "INTERNAL_ERROR", "Internal server error");
  });

  app.addHook("preHandler", async (request, reply) => {
    const pathname = parseRequestPathname(request.url);
    if (pathname && !isApiPath(pathname)) {
      return;
    }

    if (!authRequired || isAnonymousRoute(request.method, request.routeOptions.url)) {
      return;
    }

    const token = readSessionCookie(request.headers.cookie);
    if (!authService.authenticate(token)) {
      return sendApiError(reply, 401, "UNAUTHORIZED", "Authentication required");
    }
  });

  if (backgroundJobs) {
    app.addHook("onReady", async () => {
      jobRunner.start();
      feedRefreshScheduler.start();
      retentionCleanupScheduler.start();
      profileDecayScheduler.start();
    });
  }

  app.addHook("onClose", async () => {
    profileDecayScheduler.stop();
    retentionCleanupScheduler.stop();
    feedRefreshScheduler.stop();
    jobRunner.stop();
  });

  if (closeDatabaseOnClose) {
    app.addHook("onClose", async () => {
      db.close();
    });
  }

  app.get("/api/auth/session", async (request) => ({
    data: authService.getSessionStatus(readSessionCookie(request.headers.cookie))
  }));

  app.post<{ Body: PasswordBody }>("/api/auth/setup", async (request, reply) => {
    const parsed = parsePasswordBody(request.body);
    if (!parsed.ok) {
      return sendApiError(reply, 400, "VALIDATION_ERROR", parsed.message, parsed.details);
    }

    try {
      const session = await authService.setup(parsed.password, requestMeta(request));
      reply.header(
        "set-cookie",
        serializeSessionCookie(session.token, session.expiresAt, cookieOptions)
      );
      return {
        data: {
          ok: true
        }
      };
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.post<{ Body: PasswordBody }>("/api/auth/login", async (request, reply) => {
    const parsed = parsePasswordBody(request.body);
    if (!parsed.ok) {
      return sendApiError(reply, 400, "VALIDATION_ERROR", parsed.message, parsed.details);
    }

    try {
      const session = await authService.login(parsed.password, requestMeta(request));
      reply.header(
        "set-cookie",
        serializeSessionCookie(session.token, session.expiresAt, cookieOptions)
      );
      return {
        data: {
          ok: true
        }
      };
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.post("/api/auth/logout", async (request, reply) => {
    authService.logout(readSessionCookie(request.headers.cookie));
    reply.header("set-cookie", serializeClearSessionCookie(cookieOptions));
    return {
      data: {
        ok: true
      }
    };
  });

  app.get("/api/setup/status", async () => ({
    data: getSetupStatus(
      credentials.hasCredential(),
      feeds.list().length > 0,
      embeddingProviderService.hasActiveProviderAndIndex()
    )
  }));

  app.get<{ Querystring: JobQuery }>("/api/jobs", async (request, reply) => {
    const parsed = parseJobQuery(request.query);
    if (!parsed.ok) {
      return sendApiError(reply, 400, "VALIDATION_ERROR", parsed.message, parsed.details);
    }

    return {
      data: jobs.list(parsed.input).map(mapJob)
    };
  });

  app.get("/api/recommendation/status", async () => ({
    data: getRecommendationStatus({
      embeddings,
      profiles,
      rankings,
      rankingService
    })
  }));

  app.get("/api/settings", async () => ({
    data: settingsService.getSettings()
  }));

  app.patch<{ Body: unknown }>("/api/settings", async (request, reply) => {
    try {
      return {
        data: settingsService.updateSettings(request.body)
      };
    } catch (error) {
      return sendSettingsError(reply, error);
    }
  });

  app.get("/api/embedding/providers", async () => ({
    data: embeddingProviderService.listProviders()
  }));

  app.post<{ Body: unknown }>("/api/embedding/providers", async (request, reply) => {
    try {
      const provider = embeddingProviderService.createProvider(request.body);
      if (provider.enabled) {
        enqueueEmbeddingBackfill();
        enqueueRankingAll();
      }
      return {
        data: {
          id: provider.id
        }
      };
    } catch (error) {
      return sendEmbeddingProviderError(reply, error);
    }
  });

  app.patch<{ Params: EmbeddingProviderParams; Body: unknown }>(
    "/api/embedding/providers/:id",
    async (request, reply) => {
      try {
        const provider = embeddingProviderService.updateProvider(request.params.id, request.body);
        if (provider.enabled) {
          enqueueEmbeddingBackfill();
          enqueueRankingAll();
        }
        return {
          data: provider
        };
      } catch (error) {
        return sendEmbeddingProviderError(reply, error);
      }
    }
  );

  app.delete<{ Params: EmbeddingProviderParams }>(
    "/api/embedding/providers/:id",
    async (request, reply) => {
      try {
        return {
          data: embeddingProviderService.deleteProvider(request.params.id)
        };
      } catch (error) {
        return sendEmbeddingProviderError(reply, error);
      }
    }
  );

  app.post<{ Params: EmbeddingProviderParams }>(
    "/api/embedding/providers/:id/test",
    async (request, reply) => {
      try {
        return {
          data: await embeddingProviderService.testProvider(request.params.id)
        };
      } catch (error) {
        return sendEmbeddingProviderError(reply, error);
      }
    }
  );

  app.get("/api/embedding/indexes", async () => ({
    data: embeddingProviderService.listIndexes()
  }));

  app.post<{ Params: EmbeddingIndexParams }>(
    "/api/embedding/indexes/:id/rebuild",
    async (request, reply) => {
      try {
        embeddingProviderService.rebuildIndex(request.params.id);
        const job = vectorIndexRebuildJobService.enqueueRebuildIndex(request.params.id);
        enqueueRankingAll();
        drainBackgroundJobs();
        return {
          data: {
            jobId: job.id
          }
        };
      } catch (error) {
        return sendEmbeddingProviderError(reply, error);
      }
    }
  );

  app.post<{ Params: EmbeddingIndexParams }>(
    "/api/embedding/indexes/:id/backfill",
    async (request, reply) => {
      try {
        embeddingProviderService.assertBackfillableIndex(request.params.id);
        const result = embeddingJobService.enqueueBackfillForIndex(request.params.id);
        if (result.jobIds.length > 0) {
          drainBackgroundJobs();
        }
        return {
          data: result
        };
      } catch (error) {
        return sendEmbeddingProviderError(reply, error);
      }
    }
  );

  app.get("/api/system/health", async (_request, reply) => {
    const data = getHealth(db);
    const statusCode = data.ok ? 200 : 503;
    return reply.status(statusCode).send({ data });
  });

  app.get("/api/feed-folders", async () => ({
    data: folders.list().map(mapFeedFolder)
  }));

  app.post<{ Body: unknown }>("/api/feed-folders", async (request, reply) => {
    try {
      return {
        data: mapFeedFolder(feedManagementService.createFolder(request.body))
      };
    } catch (error) {
      return sendFeedManagementError(reply, error);
    }
  });

  app.patch<{ Params: FeedFolderParams; Body: unknown }>(
    "/api/feed-folders/:id",
    async (request, reply) => {
      try {
        return {
          data: mapFeedFolder(feedManagementService.updateFolder(request.params.id, request.body))
        };
      } catch (error) {
        return sendFeedManagementError(reply, error);
      }
    }
  );

  app.delete<{ Params: FeedFolderParams }>("/api/feed-folders/:id", async (request, reply) => {
    try {
      return {
        data: feedManagementService.deleteFolder(request.params.id)
      };
    } catch (error) {
      return sendFeedManagementError(reply, error);
    }
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
      feedManagementService.validateFolderReference(parsed.input.folderId);
      const result = await feedRefreshService.addFeed(parsed.input);
      enqueueEmbeddingArticles(result.articleIds);

      return {
        data: {
          feed: mapFeed(result.feed),
          refreshJobId: result.jobId
        }
      };
    } catch (error) {
      if (error instanceof FeedManagementServiceError) {
        return sendFeedManagementError(reply, error);
      }
      return sendFeedIngestionError(reply, error);
    }
  });

  app.patch<{ Params: FeedParams; Body: unknown }>("/api/feeds/:id", async (request, reply) => {
    try {
      return {
        data: mapFeed(feedManagementService.updateFeed(request.params.id, request.body))
      };
    } catch (error) {
      return sendFeedManagementError(reply, error);
    }
  });

  app.delete<{ Params: FeedParams }>("/api/feeds/:id", async (request, reply) => {
    try {
      return {
        data: feedManagementService.deleteFeed(request.params.id)
      };
    } catch (error) {
      return sendFeedManagementError(reply, error);
    }
  });

  app.post("/api/feeds/refresh", async () => {
    const jobs = feedRefreshJobService.enqueueAllEnabledFeeds();
    if (backgroundJobs) {
      drainBackgroundJobs();
    }

    return {
      data: {
        jobIds: jobs.map((job) => job.id)
      }
    };
  });

  app.post<{ Params: FeedParams }>("/api/feeds/:id/refresh", async (request, reply) => {
    try {
      const result = await feedRefreshCoordinator.refreshFeed(request.params.id);
      drainBackgroundJobs();

      return {
        data: {
          jobId: result.jobId
        }
      };
    } catch (error) {
      return sendFeedIngestionError(reply, error);
    }
  });

  app.post("/api/opml/import", async (request, reply) => {
    const parsed = parseOpmlImportBody(request.body, request.headers["content-type"]);
    if (!parsed.ok) {
      return sendApiError(reply, 400, "VALIDATION_ERROR", parsed.message, parsed.details);
    }

    try {
      const result = opmlService.importOpml(parsed.xml);
      return {
        data: result
      };
    } catch (error) {
      return sendOpmlServiceError(reply, error);
    }
  });

  app.get("/api/opml/export", async (_request, reply) =>
    reply.type("application/xml; charset=utf-8").send(opmlService.exportOpml())
  );

  app.get<{ Querystring: ArticleQuery }>("/api/articles", async (request, reply) => {
    const parsed = parseArticleQuery(request.query);
    if (!parsed.ok) {
      return sendApiError(reply, 400, "VALIDATION_ERROR", parsed.message, parsed.details);
    }

    const result = articles.list({
      ...parsed.input,
      rankContext: rankingService.getActiveRankContext()
    });

    return {
      data: result.items.map(mapArticleListItem),
      page: {
        nextCursor: encodeCursor(result.nextOffset)
      }
    };
  });

  app.get<{ Params: ArticleParams }>("/api/articles/:id", async (request, reply) => {
    const article = articles.findDetailById(request.params.id, {
      rankContext: rankingService.getActiveRankContext()
    });

    if (!article) {
      return sendApiError(reply, 404, "NOT_FOUND", "Article not found");
    }

    return {
      data: mapArticleDetail(article)
    };
  });

  app.get<{ Params: ArticleParams }>("/api/articles/:id/explanation", async (request, reply) => {
    const explanation = rankingService.explainArticle(request.params.id);

    if (!explanation) {
      return sendApiError(reply, 404, "NOT_FOUND", "Article not found");
    }

    return {
      data: {
        articleId: explanation.articleId,
        reasons: explanation.reasons,
        generatedAt: timestampToIsoValue(explanation.generatedAt)
      }
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

  registerWebStaticRoutes(app, options.webDistDir);

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

function registerWebStaticRoutes(
  app: FastifyInstance,
  webDistDirOption: BuildServerOptions["webDistDir"]
): void {
  if (webDistDirOption === false) {
    return;
  }

  const webDistDir = resolveWebDistDir(webDistDirOption);

  app.route({
    method: ["GET", "HEAD"],
    url: "/*",
    handler: async (request, reply) => {
      const pathname = parseRequestPathname(request.url);

      if (!pathname || isApiPath(pathname)) {
        return sendApiError(reply, 404, "NOT_FOUND", "Route not found");
      }

      const assetPath = resolveStaticAssetPath(webDistDir, pathname);
      if (assetPath) {
        return sendStaticFile(reply, request.method, assetPath);
      }

      const indexPath = resolveStaticAssetPath(webDistDir, "/index.html");
      if (!indexPath) {
        return reply.status(404).type("text/plain; charset=utf-8").send("Not found");
      }

      return sendStaticFile(reply, request.method, indexPath);
    }
  });
}

function resolveWebDistDir(webDistDirOption: string | undefined): string {
  if (webDistDirOption) {
    return isAbsolute(webDistDirOption)
      ? webDistDirOption
      : resolve(process.cwd(), webDistDirOption);
  }

  if (process.env.DIBAO_WEB_DIST_DIR) {
    return isAbsolute(process.env.DIBAO_WEB_DIST_DIR)
      ? process.env.DIBAO_WEB_DIST_DIR
      : resolve(process.cwd(), process.env.DIBAO_WEB_DIST_DIR);
  }

  return resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
}

function parseRequestPathname(requestUrl: string): string | null {
  try {
    return new URL(requestUrl, "http://localhost").pathname;
  } catch {
    return null;
  }
}

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function resolveStaticAssetPath(webDistDir: string, pathname: string): string | null {
  const decodedPathname = decodeStaticPathname(pathname);
  if (decodedPathname === null) {
    return null;
  }

  const requestedPath = decodedPathname === "/" ? "/index.html" : decodedPathname;
  const relativePath = requestedPath.replace(/^\/+/, "");
  const candidate = resolve(webDistDir, relativePath);
  const rootPrefix = webDistDir.endsWith(sep) ? webDistDir : `${webDistDir}${sep}`;

  if (candidate !== webDistDir && !candidate.startsWith(rootPrefix)) {
    return null;
  }

  try {
    const stat = statSync(candidate);
    if (stat.isDirectory()) {
      const directoryIndex = resolve(candidate, "index.html");
      return existsSync(directoryIndex) ? directoryIndex : null;
    }

    return stat.isFile() ? candidate : null;
  } catch {
    return null;
  }
}

function decodeStaticPathname(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

function sendStaticFile(reply: FastifyReply, method: string, filePath: string) {
  reply.type(contentTypeForStaticFile(filePath));
  if (method.toUpperCase() === "HEAD") {
    return reply.send();
  }

  return reply.send(readFileSync(filePath));
}

function contentTypeForStaticFile(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".ico":
      return "image/x-icon";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".json":
    case ".map":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".wasm":
      return "application/wasm";
    case ".webp":
      return "image/webp";
    case ".xml":
      return "application/xml; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function resolveCookieSecure(value: boolean | undefined): boolean {
  if (value !== undefined) {
    return value;
  }

  if (process.env.DIBAO_COOKIE_SECURE === "true") {
    return true;
  }
  if (process.env.DIBAO_COOKIE_SECURE === "false") {
    return false;
  }

  return process.env.NODE_ENV === "production";
}

function isAnonymousRoute(method: string, routePath: string | undefined): boolean {
  if (!routePath) {
    return false;
  }

  return anonymousRoutes.has(`${method.toUpperCase()} ${routePath}`);
}

const anonymousRoutes = new Set([
  "GET /api/auth/session",
  "POST /api/auth/setup",
  "POST /api/auth/login",
  "POST /api/auth/logout",
  "GET /api/system/health"
]);

function requestMeta(request: FastifyRequest) {
  const userAgent = request.headers["user-agent"];

  return {
    userAgent: Array.isArray(userAgent) ? userAgent.join(" ") : userAgent,
    ip: request.ip
  };
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

function getSetupStatus(
  setupCompleted: boolean,
  hasFeeds: boolean,
  hasEmbeddingProvider: boolean
): SetupStatusResponse {
  return {
    setupCompleted,
    hasFeeds,
    hasEmbeddingProvider,
    firstRefreshStatus: "idle"
  };
}

function getRecommendationStatus(options: {
  embeddings: SqliteEmbeddingRepository;
  profiles: SqliteProfileRepository;
  rankings: SqliteRankingRepository;
  rankingService: RecommendationRankingService;
}) {
  const activeProvider = options.embeddings.findActiveProvider();
  const indexes = options.embeddings.listIndexes();
  const activeIndex = activeProvider ? activeDiagnosticIndexFor(activeProvider.id, indexes) : null;
  const activeRankContext = options.rankingService.getActiveRankContext();
  const coverage = coverageFor(activeIndex);
  const behaviorCounts = Object.fromEntries(
    options.profiles.countBehaviorEvents().map((row) => [row.eventType, row.count])
  );
  const clusters = options.profiles.countClusters({
    ...(activeIndex ? { embeddingIndexId: activeIndex.id } : {})
  });
  const rankedArticles = options.rankings.countRankedArticles({ activeRankContext });
  const lastProfileUpdate = options.profiles.getLastProfileUpdate({
    ...(activeIndex ? { embeddingIndexId: activeIndex.id } : {})
  });
  const lastRankingUpdate = options.rankings.getLastRankingUpdate({ activeRankContext });
  const profileLearning = isProfileLearning(behaviorCounts, clusters);
  const warnings = recommendationWarnings({
    activeProvider,
    activeIndex,
    coverage,
    profileLearning
  });
  const mode = recommendationMode({
    activeProvider,
    activeIndex,
    coverage
  });

  return {
    mode,
    activeProvider: activeProvider ? mapRecommendationProvider(activeProvider) : null,
    activeIndex: activeIndex ? mapRecommendationIndex(activeIndex) : null,
    activeRankContext,
    coverage: mapCoverage(coverage),
    behaviorCounts,
    clusters,
    rankedArticles,
    lastProfileUpdate: timestampToIso(lastProfileUpdate),
    lastRankingUpdate: timestampToIso(lastRankingUpdate),
    warnings
  };
}

type RecommendationCoverage = {
  candidateCount: number;
  eligibleArticleCount: number;
  missingEmbeddingCount: number;
  staleEmbeddingCount: number;
  embeddingCount: number;
  coverageRatio: number;
  pendingJobs: number;
  failedJobs: number;
  lastFailedAt: number | null;
  lastError: string | null;
};

type RecommendationMode = "baseline" | "learning" | "embedding" | "degraded";

function activeDiagnosticIndexFor(
  providerId: string,
  indexes: EmbeddingIndexListRow[]
): EmbeddingIndexListRow | null {
  return (
    indexes.find((index) => index.providerId === providerId && index.status === "active") ??
    indexes.find((index) => index.providerId === providerId && index.status === "failed") ??
    null
  );
}

function coverageFor(index: EmbeddingIndexListRow | null): RecommendationCoverage {
  if (!index) {
    return {
      candidateCount: 0,
      eligibleArticleCount: 0,
      missingEmbeddingCount: 0,
      staleEmbeddingCount: 0,
      embeddingCount: 0,
      coverageRatio: 0,
      pendingJobs: 0,
      failedJobs: 0,
      lastFailedAt: null,
      lastError: null
    };
  }

  return {
    candidateCount: index.candidateCount,
    eligibleArticleCount: index.eligibleArticleCount,
    missingEmbeddingCount: index.missingEmbeddingCount,
    staleEmbeddingCount: index.staleEmbeddingCount,
    embeddingCount: index.embeddingCount,
    coverageRatio: index.coverageRatio,
    pendingJobs: index.pendingJobs,
    failedJobs: index.failedJobs,
    lastFailedAt: index.lastFailedAt,
    lastError: index.lastError
  };
}

function recommendationMode(input: {
  activeProvider: EmbeddingProviderRow | null;
  activeIndex: EmbeddingIndexListRow | null;
  coverage: RecommendationCoverage;
}): RecommendationMode {
  if (!input.activeProvider || !input.activeIndex) {
    return "baseline";
  }

  if (
    input.activeIndex.status === "failed" ||
    input.activeProvider.lastTestStatus === "failed" ||
    input.coverage.failedJobs > 0
  ) {
    return "degraded";
  }

  if (input.coverage.pendingJobs > 0 || input.coverage.coverageRatio < 1) {
    return "embedding";
  }

  return "learning";
}

function recommendationWarnings(input: {
  activeProvider: EmbeddingProviderRow | null;
  activeIndex: EmbeddingIndexListRow | null;
  coverage: RecommendationCoverage;
  profileLearning: boolean;
}): Array<{ code: string; message: string }> {
  const warnings: Array<{ code: string; message: string }> = [];

  if (!input.activeProvider || !input.activeIndex) {
    warnings.push({
      code: "NO_PROVIDER",
      message: "No active embedding provider and index are configured; recommendations are using baseline ranking."
    });
    return warnings;
  }

  if (input.coverage.pendingJobs > 0 || input.coverage.coverageRatio < 1) {
    warnings.push({
      code: "EMBEDDING_PENDING",
      message: "Embedding generation is still running or incomplete for the active index."
    });
  }

  if (input.coverage.failedJobs > 0 || input.activeIndex.status === "failed") {
    warnings.push({
      code: "EMBEDDING_JOB_FAILED",
      message: "Embedding generation has failed jobs for the active index."
    });
  }

  if (input.activeProvider.lastTestStatus === "failed") {
    warnings.push({
      code: "PROVIDER_TEST_FAILED",
      message: "The active embedding provider's latest connection test failed."
    });
  }

  if (input.profileLearning) {
    warnings.push({
      code: "PROFILE_LEARNING",
      message: "The recommendation profile is still learning from behavior and interest signals."
    });
  }

  return warnings;
}

function isProfileLearning(
  behaviorCounts: Record<string, number>,
  clusters: { positive: number; negative: number }
): boolean {
  const behaviorTotal = Object.values(behaviorCounts).reduce((sum, count) => sum + count, 0);
  return behaviorTotal < 3 || clusters.positive + clusters.negative === 0;
}

function mapRecommendationProvider(provider: EmbeddingProviderRow) {
  return {
    id: provider.id,
    type: provider.type,
    name: provider.name,
    model: provider.model,
    dimension: provider.dimension,
    lastTestStatus: provider.lastTestStatus,
    lastTestAt: timestampToIso(provider.lastTestAt)
  };
}

function mapRecommendationIndex(index: EmbeddingIndexListRow) {
  return {
    id: index.id,
    status: index.status,
    model: index.model,
    dimension: index.dimension
  };
}

function mapCoverage(coverage: RecommendationCoverage) {
  return {
    candidateCount: coverage.candidateCount,
    eligibleArticleCount: coverage.eligibleArticleCount,
    missingEmbeddingCount: coverage.missingEmbeddingCount,
    staleEmbeddingCount: coverage.staleEmbeddingCount,
    embeddingCount: coverage.embeddingCount,
    coverageRatio: coverage.coverageRatio,
    pendingJobs: coverage.pendingJobs,
    failedJobs: coverage.failedJobs,
    lastFailedAt: timestampToIso(coverage.lastFailedAt),
    lastError: coverage.lastError
  };
}

function parseJobQuery(query: JobQuery):
  | {
      ok: true;
      input: {
        status?: JobStatus;
        type?: JobType;
        limit?: number;
      };
    }
  | { ok: false; message: string; details?: unknown } {
  const status = parseJobStatus(query.status);
  if (status === null) {
    return {
      ok: false,
      message: "status must be queued, running, succeeded, failed, or cancelled",
      details: { field: "status" }
    };
  }

  const type = parseJobType(query.type);
  if (type === null) {
    return {
      ok: false,
      message:
        "type must be feed_refresh, content_extract, embedding_generate, ranking_recalculate, profile_decay, retention_cleanup, or vector_index_rebuild",
      details: { field: "type" }
    };
  }

  const limit = parseLimit(query.limit);
  if (limit === null) {
    return {
      ok: false,
      message: "limit must be a positive integer",
      details: { field: "limit" }
    };
  }

  return {
    ok: true,
    input: {
      ...(status !== undefined ? { status } : {}),
      ...(type !== undefined ? { type } : {}),
      ...(limit !== undefined ? { limit } : {})
    }
  };
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

  let folderId: string | null | undefined;
  if (body.folderId !== undefined) {
    if (body.folderId === null) {
      folderId = null;
    } else if (typeof body.folderId === "string" && body.folderId.trim() !== "") {
      folderId = body.folderId.trim();
    } else {
      return { ok: false, message: "folderId must be a string or null" };
    }
  }

  return {
    ok: true,
    input: {
      feedUrl: body.feedUrl,
      ...(folderId !== undefined ? { folderId } : {})
    }
  };
}

function parsePasswordBody(body: PasswordBody | undefined):
  | { ok: true; password: string }
  | { ok: false; message: string; details?: unknown } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, message: "request body must be an object" };
  }

  if (typeof body.password !== "string" || body.password.length === 0) {
    return {
      ok: false,
      message: "password is required",
      details: { field: "password" }
    };
  }

  return {
    ok: true,
    password: body.password
  };
}

function parseOpmlImportBody(
  body: unknown,
  contentTypeHeader: string | string[] | undefined
): { ok: true; xml: string } | { ok: false; message: string; details?: unknown } {
  const contentType = Array.isArray(contentTypeHeader)
    ? contentTypeHeader[0]
    : contentTypeHeader;

  if (typeof body === "string") {
    return body.trim()
      ? { ok: true, xml: body }
      : { ok: false, message: "OPML body is required" };
  }

  if (Buffer.isBuffer(body)) {
    const xml = contentType?.toLowerCase().startsWith("multipart/form-data")
      ? extractMultipartFile(body, contentType)
      : body.toString("utf8");

    if (!xml) {
      return {
        ok: false,
        message: "OPML file is required",
        details: { field: "file" }
      };
    }

    return { ok: true, xml };
  }

  return {
    ok: false,
    message: "OPML import requires multipart/form-data or application/xml"
  };
}

function extractMultipartFile(body: Buffer, contentType: string | undefined): string | null {
  const boundaryMatch = contentType?.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (!boundary) {
    return null;
  }

  const raw = body.toString("utf8");
  for (const part of raw.split(`--${boundary}`)) {
    if (!/content-disposition:/i.test(part)) {
      continue;
    }

    const separator = part.includes("\r\n\r\n") ? "\r\n\r\n" : "\n\n";
    const separatorIndex = part.indexOf(separator);
    if (separatorIndex < 0) {
      continue;
    }

    const headers = part.slice(0, separatorIndex);
    if (!/name="file"/i.test(headers) && !/filename=/i.test(headers)) {
      continue;
    }

    const content = part.slice(separatorIndex + separator.length).replace(/^\r?\n/, "");
    const trimmed = content.replace(/\r?\n$/, "").trim();
    return trimmed || null;
  }

  return null;
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
        "type must be impression, open, mark_read, mark_unread, favorite, unfavorite, read_later, remove_read_later, hide, not_interested, or read_progress"
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

function parseJobStatus(value: string | undefined): JobStatus | undefined | null {
  if (value === undefined) {
    return undefined;
  }

  if (
    value === "queued" ||
    value === "running" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }

  return null;
}

function parseJobType(value: string | undefined): JobType | undefined | null {
  if (value === undefined) {
    return undefined;
  }

  if (
    value === "feed_refresh" ||
    value === "content_extract" ||
    value === "embedding_generate" ||
    value === "ranking_recalculate" ||
    value === "profile_decay" ||
    value === "retention_cleanup" ||
    value === "vector_index_rebuild"
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

function mapFeedFolder(folder: FeedFolderRow) {
  return {
    id: folder.id,
    title: folder.title,
    sortOrder: folder.sortOrder
  };
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

function mapJob(job: JobRow) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    error: job.error,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    runAfter: timestampToIsoValue(job.runAfter),
    startedAt: timestampToIso(job.startedAt),
    finishedAt: timestampToIso(job.finishedAt),
    createdAt: timestampToIsoValue(job.createdAt),
    updatedAt: timestampToIsoValue(job.updatedAt),
    payloadSummary: summarizeJobPayload(job)
  };
}

function summarizeJobPayload(job: JobRow): { embeddingIndexId: string; articleCount: number } | null {
  if (job.type !== EMBEDDING_GENERATE_JOB_TYPE) {
    return null;
  }

  const payload = parseEmbeddingGeneratePayload(job.payloadJson);
  if (!payload) {
    return null;
  }

  return {
    embeddingIndexId: payload.embeddingIndexId,
    articleCount: payload.articleIds.length
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

function sendAuthError(reply: FastifyReply, error: unknown) {
  if (error instanceof AuthServiceError) {
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

function sendFeedManagementError(reply: FastifyReply, error: unknown) {
  if (error instanceof FeedManagementServiceError) {
    return sendApiError(reply, error.statusCode, error.code, error.message, error.details);
  }

  throw error;
}

function sendOpmlServiceError(reply: FastifyReply, error: unknown) {
  if (error instanceof OpmlServiceError) {
    return sendApiError(reply, error.statusCode, error.code, error.message, error.details);
  }

  throw error;
}

function sendSettingsError(reply: FastifyReply, error: unknown) {
  if (error instanceof SettingsServiceError) {
    return sendApiError(reply, error.statusCode, error.code, error.message, error.details);
  }

  throw error;
}

function sendEmbeddingProviderError(reply: FastifyReply, error: unknown) {
  if (error instanceof EmbeddingProviderServiceError) {
    return sendApiError(reply, error.statusCode, error.code, error.message, error.details);
  }

  throw error;
}
