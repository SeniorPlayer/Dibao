import type {
  ArticleInteractionStatus,
  ArticleListItem,
  ArticleState
} from "./api.js";

export function articleInteractionStatusForState(
  state: ArticleState
): ArticleInteractionStatus {
  if (state.interactionStatus) {
    return state.interactionStatus;
  }
  if (state.read || state.readingProgress >= 0.9) {
    return "read";
  }
  if (state.readingProgress >= 0.25) {
    return "reading";
  }
  if (state.openedAt !== null && state.openedAt !== undefined) {
    return "opened";
  }
  if (state.favorited || state.liked || state.readLater) {
    return "saved";
  }
  if (state.ignoredAt !== null && state.ignoredAt !== undefined) {
    return "ignored";
  }
  return "unseen";
}

export function articlesVisibleForUnreadFilter(
  articles: ArticleListItem[],
  unreadOnly: boolean
): ArticleListItem[] {
  return unreadOnly
    ? articles.filter((article) => isVisibleForUnreadFilter(article.state, true))
    : articles;
}

export function articleListAfterStateUpdate(
  articles: ArticleListItem[],
  articleId: string,
  state: ArticleState
): ArticleListItem[] {
  // Keep the current queue stable while the user is moving through it. Re-fetching
  // still applies strict filters, but passive state changes should not make a row
  // disappear under the user's pointer.
  return articles
    .map((article) => (article.id === articleId ? { ...article, state } : article))
    .filter((article) =>
      article.id === articleId ? !state.hidden && !state.notInterested : true
    );
}

export function articleListWithKnownLocalStates<T extends { id: string; state: ArticleState }>(
  articles: T[],
  knownStates: Map<string, ArticleState>,
  locallyUpdatedIds: Set<string>
): T[] {
  return articles.map((article) => {
    const knownState = knownStates.get(article.id);
    return knownState && locallyUpdatedIds.has(article.id)
      ? { ...article, state: knownState }
      : article;
  });
}

export function unreadCountWithKnownLocalStates<T extends { id: string; state: ArticleState }>(
  current: number,
  articles: T[],
  knownStates: Map<string, ArticleState>,
  locallyUpdatedIds: Set<string>
): number {
  return articles.reduce((count, article) => {
    const knownState = knownStates.get(article.id);
    return knownState && locallyUpdatedIds.has(article.id)
      ? unreadCountAfterStateChange(count, article.state, knownState)
      : count;
  }, current);
}

export function shouldSkipPassiveIgnoreTelemetry(input: {
  articleId: string;
  interactionStatus: ArticleInteractionStatus;
  isAlreadyIgnored: boolean;
  isOpened: boolean;
  selectedArticleId: string | null;
}): boolean {
  return (
    input.selectedArticleId === input.articleId ||
    input.isOpened ||
    input.isAlreadyIgnored ||
    input.interactionStatus !== "unseen"
  );
}

export function unreadCountAfterStateChange(
  current: number,
  previous: ArticleState,
  next: ArticleState
): number {
  const wasUnread = isCountedUnread(previous);
  const isUnread = isCountedUnread(next);

  if (wasUnread === isUnread) {
    return current;
  }

  return Math.max(0, current + (isUnread ? 1 : -1));
}

function isCountedUnread(state: ArticleState): boolean {
  return (
    !state.hidden &&
    !state.notInterested &&
    articleInteractionStatusForState(state) === "unseen"
  );
}

function isVisibleForUnreadFilter(state: ArticleState, unreadOnly: boolean): boolean {
  return !unreadOnly || articleInteractionStatusForState(state) === "unseen";
}
