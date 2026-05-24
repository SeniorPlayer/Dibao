export const dibaoVersion = "0.1.0";

export const dibaoSentryConfig = {
  dsn: "https://c1995e42a000cc801d61d097be748759@o4511442089541632.ingest.us.sentry.io/4511442099044352",
  org: "akashio",
  project: "dibao",
  tracesSampleRate: 0.1,
  devTracesSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0
} as const;

export function hasDibaoSentryDsn(): boolean {
  return dibaoSentryConfig.dsn.length > 0;
}

export function hasDibaoSentrySourceMapProject(): boolean {
  return dibaoSentryConfig.org.length > 0 && dibaoSentryConfig.project.length > 0;
}

export type ApiSuccess<T> = {
  data: T;
};

export type ApiError = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type ArticleInteractionStatus = "unseen" | "ignored" | "opened" | "reading" | "read";

export type ArticleState = {
  read: boolean;
  favorited: boolean;
  liked: boolean;
  readLater: boolean;
  hidden: boolean;
  notInterested: boolean;
  readingProgress: number;
  interactionStatus: ArticleInteractionStatus;
  openedAt: number | null;
  ignoredAt: number | null;
};

export type RankReasonImpact = "positive" | "negative" | "neutral";

export type RankReason = {
  type:
    | "positive_cluster"
    | "negative_cluster"
    | "source"
    | "freshness"
    | "duplicate"
    | "state"
    | "fallback";
  label: string;
  impact: RankReasonImpact;
};
