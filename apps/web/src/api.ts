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

export type ArticleListResponse = {
  data: ArticleListItem[];
  page: ApiPage;
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
    readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

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
    const response = await fetcher(path, {
      ...init,
      headers: {
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers
      }
    });
    const payload = await readJson(response);

    if (!response.ok) {
      const apiError = isApiErrorPayload(payload) ? payload.error : null;
      throw new ApiRequestError(
        response.status,
        apiError?.code ?? "INTERNAL_ERROR",
        apiError?.message ?? `Request failed with ${response.status}`,
        apiError?.details
      );
    }

    if (isApiErrorPayload(payload)) {
      throw new ApiRequestError(response.status, payload.error.code, payload.error.message);
    }

    return payload as ApiSuccess<T>;
  }

  return {
    async listFeeds(): Promise<Feed[]> {
      return (await request<Feed[]>("/api/feeds")).data;
    },

    async createFeed(feedUrl: string): Promise<CreateFeedResponse> {
      return (
        await request<CreateFeedResponse>("/api/feeds", {
          method: "POST",
          body: JSON.stringify({ feedUrl })
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

    async listArticles(input: { feedId?: string | null; limit?: number } = {}): Promise<ArticleListResponse> {
      const params = new URLSearchParams({
        view: "latest",
        limit: String(input.limit ?? 50)
      });

      if (input.feedId) {
        params.set("feedId", input.feedId);
      }

      const response = await request<ArticleListItem[]>(`/api/articles?${params.toString()}`);

      return {
        data: response.data,
        page: response.page ?? { nextCursor: null }
      };
    },

    async getArticle(articleId: string): Promise<ArticleDetail> {
      return (await request<ArticleDetail>(`/api/articles/${encodeURIComponent(articleId)}`)).data;
    }
  };
}

export const dibaoApi = createDibaoApi();

export function userMessageForError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "请求失败，请稍后重试。";
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
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
