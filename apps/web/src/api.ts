export type ApiPage = {
  nextCursor: string | null;
};

export type Feed = {
  id: string;
  folderId: string | null;
  title: string;
  siteUrl: string | null;
  feedUrl: string;
  description: string | null;
  enabled: boolean;
  sourceWeight: number;
  lastFetchedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FeedFolder = {
  id: string;
  title: string;
  sortOrder: number;
};

export type UpdateFeedInput = {
  title?: string;
  folderId?: string | null;
  enabled?: boolean;
  sourceWeight?: number;
};

export type UpdateFeedFolderInput = {
  title?: string;
  sortOrder?: number;
};

export type ArticleState = {
  read: boolean;
  favorited: boolean;
  readLater: boolean;
  hidden: boolean;
  notInterested: boolean;
  readingProgress: number;
};

export type ArticleListItem = {
  id: string;
  feedId: string;
  feedTitle: string;
  title: string;
  url: string;
  author: string | null;
  summary: string | null;
  publishedAt: string | null;
  discoveredAt: string;
  state: ArticleState;
};

export type ArticleDetail = ArticleListItem & {
  contentHtml: string | null;
  contentText: string | null;
  extractionStatus: "pending" | "feed_only" | "success" | "failed" | "skipped";
  extractionError: string | null;
};

export type ArticleActionRequest =
  | {
      type: "open" | "hide" | "not_interested";
      value?: true;
      metadata?: Record<string, unknown>;
    }
  | {
      type: "favorite" | "read_later" | "mark_read";
      value: boolean;
      metadata?: Record<string, unknown>;
    }
  | {
      type: "read_progress";
      progress: number;
      metadata?: Record<string, unknown>;
    };

export type ArticleActionResponse = {
  state: ArticleState;
};

export type RankExplanationReasonType =
  | "source"
  | "freshness"
  | "state"
  | "fallback"
  | "negative"
  | "penalty";

export type RankExplanationReason = {
  type: RankExplanationReasonType;
  label: string;
  impact: "positive" | "negative" | "neutral";
};

export type RankExplanation = {
  articleId: string;
  reasons: RankExplanationReason[];
  generatedAt: string;
};

export type ArticleView = "latest" | "recommended";

export type ArticleListResponse = {
  data: ArticleListItem[];
  page: ApiPage;
};

export type OpmlImportResponse = {
  foldersCreated: number;
  feedsCreated: number;
  feedsSkipped: number;
  errors: string[];
};

export type AuthSession = {
  setupCompleted: boolean;
  authenticated: boolean;
};

export type SetupStatus = {
  setupCompleted: boolean;
  hasFeeds: boolean;
  hasEmbeddingProvider: boolean;
  firstRefreshStatus: "idle" | "running" | "succeeded" | "failed";
};

export type AuthOkResponse = {
  ok: true;
};

export type DeleteResponse = {
  ok: true;
};

export type CreateFeedResponse = {
  feed: Feed;
  refreshJobId: string;
};

export type RefreshFeedResponse = {
  jobId: string;
};

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly hasUserMessage = true
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export type ApiErrorMessages = {
  requestFailed: string;
  httpError: (status: number) => string;
};

type ApiFetch = typeof fetch;

type ApiSuccess<T> = {
  data: T;
  page?: ApiPage;
};

type ApiErrorPayload = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export function createDibaoApi(fetcher: ApiFetch = fetch) {
  async function request<T>(path: string, init: RequestInit = {}): Promise<ApiSuccess<T>> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");

    if (init.body && !isFormDataBody(init.body) && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const response = await fetcher(path, {
      ...init,
      credentials: init.credentials ?? "same-origin",
      headers
    });
    const payload = await readJson(response);

    if (!response.ok) {
      const apiError = isApiErrorPayload(payload) ? payload.error : null;
      throw new ApiRequestError(
        response.status,
        apiError?.code ?? "INTERNAL_ERROR",
        apiError?.message ?? "",
        apiError?.details,
        Boolean(apiError?.message)
      );
    }

    if (isApiErrorPayload(payload)) {
      throw new ApiRequestError(response.status, payload.error.code, payload.error.message);
    }

    return payload as ApiSuccess<T>;
  }

  async function requestText(path: string, init: RequestInit = {}): Promise<string> {
    const response = await fetcher(path, {
      ...init,
      credentials: init.credentials ?? "same-origin",
      headers: {
        accept: "application/xml, text/xml, */*",
        ...init.headers
      }
    });
    const text = await response.text();

    if (!response.ok) {
      const payload = parseJsonText(text);
      const apiError = isApiErrorPayload(payload) ? payload.error : null;
      throw new ApiRequestError(
        response.status,
        apiError?.code ?? "INTERNAL_ERROR",
        apiError?.message ?? "",
        apiError?.details,
        Boolean(apiError?.message)
      );
    }

    return text;
  }

  return {
    async getAuthSession(): Promise<AuthSession> {
      return (await request<AuthSession>("/api/auth/session")).data;
    },

    async setupAuth(password: string): Promise<AuthOkResponse> {
      return (
        await request<AuthOkResponse>("/api/auth/setup", {
          method: "POST",
          body: JSON.stringify({ password })
        })
      ).data;
    },

    async login(password: string): Promise<AuthOkResponse> {
      return (
        await request<AuthOkResponse>("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ password })
        })
      ).data;
    },

    async logout(): Promise<AuthOkResponse> {
      return (
        await request<AuthOkResponse>("/api/auth/logout", {
          method: "POST"
        })
      ).data;
    },

    async getSetupStatus(): Promise<SetupStatus> {
      return (await request<SetupStatus>("/api/setup/status")).data;
    },

    async listFeedFolders(): Promise<FeedFolder[]> {
      return (await request<FeedFolder[]>("/api/feed-folders")).data;
    },

    async listFeeds(): Promise<Feed[]> {
      return (await request<Feed[]>("/api/feeds")).data;
    },

    async createFeed(feedUrl: string, folderId?: string | null): Promise<CreateFeedResponse> {
      return (
        await request<CreateFeedResponse>("/api/feeds", {
          method: "POST",
          body: JSON.stringify({
            feedUrl,
            ...(folderId !== undefined ? { folderId } : {})
          })
        })
      ).data;
    },

    async updateFeed(feedId: string, input: UpdateFeedInput): Promise<Feed> {
      return (
        await request<Feed>(`/api/feeds/${encodeURIComponent(feedId)}`, {
          method: "PATCH",
          body: JSON.stringify(input)
        })
      ).data;
    },

    async deleteFeed(feedId: string): Promise<DeleteResponse> {
      return (
        await request<DeleteResponse>(`/api/feeds/${encodeURIComponent(feedId)}`, {
          method: "DELETE"
        })
      ).data;
    },

    async refreshFeed(feedId: string): Promise<RefreshFeedResponse> {
      return (
        await request<RefreshFeedResponse>(`/api/feeds/${encodeURIComponent(feedId)}/refresh`, {
          method: "POST"
        })
      ).data;
    },

    async createFeedFolder(title: string): Promise<FeedFolder> {
      return (
        await request<FeedFolder>("/api/feed-folders", {
          method: "POST",
          body: JSON.stringify({ title })
        })
      ).data;
    },

    async updateFeedFolder(
      folderId: string,
      input: UpdateFeedFolderInput
    ): Promise<FeedFolder> {
      return (
        await request<FeedFolder>(`/api/feed-folders/${encodeURIComponent(folderId)}`, {
          method: "PATCH",
          body: JSON.stringify(input)
        })
      ).data;
    },

    async deleteFeedFolder(folderId: string): Promise<DeleteResponse> {
      return (
        await request<DeleteResponse>(`/api/feed-folders/${encodeURIComponent(folderId)}`, {
          method: "DELETE"
        })
      ).data;
    },

    async listArticles(
      input: {
        view?: ArticleView;
        feedId?: string | null;
        folderId?: string | null;
        limit?: number;
        cursor?: string | null;
      } = {}
    ): Promise<ArticleListResponse> {
      const params = new URLSearchParams({
        view: input.view ?? "latest",
        limit: String(input.limit ?? 50)
      });

      if (input.feedId) {
        params.set("feedId", input.feedId);
      }
      if (input.folderId) {
        params.set("folderId", input.folderId);
      }
      if (input.cursor) {
        params.set("cursor", input.cursor);
      }

      const response = await request<ArticleListItem[]>(`/api/articles?${params.toString()}`);

      return {
        data: response.data,
        page: response.page ?? { nextCursor: null }
      };
    },

    async getArticle(articleId: string): Promise<ArticleDetail> {
      return (await request<ArticleDetail>(`/api/articles/${encodeURIComponent(articleId)}`)).data;
    },

    async getArticleExplanation(articleId: string): Promise<RankExplanation> {
      return (
        await request<RankExplanation>(
          `/api/articles/${encodeURIComponent(articleId)}/explanation`
        )
      ).data;
    },

    async postArticleAction(
      articleId: string,
      input: ArticleActionRequest
    ): Promise<ArticleActionResponse> {
      return (
        await request<ArticleActionResponse>(
          `/api/articles/${encodeURIComponent(articleId)}/actions`,
          {
            method: "POST",
            body: JSON.stringify(input)
          }
        )
      ).data;
    },

    async importOpml(file: File): Promise<OpmlImportResponse> {
      const formData = new FormData();
      formData.append("file", file);

      return (
        await request<OpmlImportResponse>("/api/opml/import", {
          method: "POST",
          body: formData
        })
      ).data;
    },

    async exportOpml(): Promise<string> {
      return requestText("/api/opml/export");
    }
  };
}

export const dibaoApi = createDibaoApi();

export function userMessageForError(error: unknown, messages: ApiErrorMessages): string {
  if (error instanceof ApiRequestError) {
    return error.hasUserMessage && error.message ? error.message : messages.httpError(error.status);
  }

  return messages.requestFailed;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return {};
  }

  return parseJsonText(text);
}

function parseJsonText(text: string): unknown {
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

function isApiErrorPayload(payload: unknown): payload is ApiErrorPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof (payload as ApiErrorPayload).error?.code === "string" &&
    typeof (payload as ApiErrorPayload).error?.message === "string"
  );
}

function isFormDataBody(body: BodyInit): boolean {
  return typeof FormData !== "undefined" && body instanceof FormData;
}
