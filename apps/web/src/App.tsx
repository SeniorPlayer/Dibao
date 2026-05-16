import type { ChangeEvent, CSSProperties, FormEvent, MouseEvent, RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dibaoVersion } from "@dibao/shared";
import {
  defaultAppSettings,
  dibaoApi,
  userMessageForError,
  type ArticleActionRequest,
  type ArticleDetail,
  type ArticleListItem,
  type ArticleState,
  type ArticleView,
  type AppSettings,
  type AuthSession,
  type CreateEmbeddingProviderInput,
  type EmbeddingIndex,
  type EmbeddingProvider,
  type EmbeddingProviderType,
  type FavoriteArticleSort,
  type Feed,
  type FeedFolder,
  type OpmlImportResponse,
  type RankExplanation,
  type RankExplanationReason,
  type ReaderSettings,
  type RecommendationStatus,
  type SetupStatus,
  type UpdateFeedFolderInput,
  type UpdateFeedInput,
  type UpdateEmbeddingProviderInput,
  type UpdateSettingsInput
} from "./api.js";
import {
  articleInteractionStatusForState,
  articleListAfterStateUpdate,
  articlesVisibleForUnreadFilter,
  unreadCountAfterStateChange
} from "./articleListState.js";
import styles from "./design-system/AppShell/AppShell.module.css";
import { FeedManagementWorkspace } from "./FeedManagementPanel.js";
import { defaultLocale, useI18n, type Dictionary, type NavigationItemKey } from "./i18n.js";

const navigationItems: NavigationItemKey[] = [
  "latest",
  "recommended",
  "favorites",
  "read_later",
  "search",
  "feeds",
  "settings"
];

const defaultFavoriteArticleSort: FavoriteArticleSort = "favorited_desc";

type Notice =
  | { type: "feedAddedAndRefreshed"; feedTitle: string }
  | { type: "feedRefreshed"; feedTitle: string }
  | { type: "allFeedsRefreshQueued"; jobCount: number }
  | { type: "opmlImported"; result: OpmlImportResponse }
  | { type: "opmlExported" }
  | { type: "settingsSaved" }
  | { type: "embeddingProviderSaved" }
  | { type: "embeddingProviderTested" }
  | { type: "embeddingProviderDeleted" }
  | { type: "embeddingIndexRebuildQueued" };

export type SourceSelection =
  | { type: "all" }
  | { type: "folder"; folderId: string }
  | { type: "feed"; feedId: string };

type AuthMode = "setup" | "login";

export type AppPage =
  | { type: "reader"; view: ArticleView }
  | { type: "feed-management" }
  | { type: "settings" }
  | { type: "algorithm-transparency" };

export type AppStage =
  | { type: "auth-loading" }
  | { type: "welcome" }
  | { type: "setup-password" }
  | { type: "login" }
  | { type: "setup-status-loading" }
  | { type: "setup-sources" }
  | { type: "setup-provider-placeholder" }
  | { type: "reader" };

export type ArticleActionIntent = "favorite" | "like" | "readLater" | "notInterested";

type PendingArticleAction = {
  articleId: string;
  intent: ArticleActionIntent;
};

type ReadProgressMetadata = {
  durationMs: number;
  activeDurationMs: number;
  scrollSource: "reader";
};

type ReadProgressPostOptions = {
  keepalive?: boolean;
};

export function stageForAuthSession(session: AuthSession): AppStage {
  if (!session.setupCompleted) {
    return { type: "welcome" };
  }

  if (!session.authenticated) {
    return { type: "login" };
  }

  return { type: "setup-status-loading" };
}

export function stageForSetupStatus(status: SetupStatus): AppStage {
  if (!status.setupCompleted) {
    return { type: "welcome" };
  }

  return { type: status.hasFeeds ? "reader" : "setup-sources" };
}

export function correctSourceSelection(
  source: SourceSelection,
  feeds: Pick<Feed, "id">[],
  folders: Pick<FeedFolder, "id">[]
): SourceSelection {
  if (source.type === "feed") {
    return feeds.some((feed) => feed.id === source.feedId) ? source : { type: "all" };
  }

  if (source.type === "folder") {
    return folders.some((folder) => folder.id === source.folderId) ? source : { type: "all" };
  }

  return source;
}

export function App() {
  const { t, setLocale } = useI18n();
  const [appStage, setAppStage] = useState<AppStage>({ type: "auth-loading" });
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [setupSourceError, setSetupSourceError] = useState<string | null>(null);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings>(defaultAppSettings);
  const [isSettingsLoading, setIsSettingsLoading] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [embeddingProviders, setEmbeddingProviders] = useState<EmbeddingProvider[]>([]);
  const [embeddingIndexes, setEmbeddingIndexes] = useState<EmbeddingIndex[]>([]);
  const [isEmbeddingLoading, setIsEmbeddingLoading] = useState(false);
  const [isSavingEmbeddingProvider, setIsSavingEmbeddingProvider] = useState(false);
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null);
  const [deletingProviderId, setDeletingProviderId] = useState<string | null>(null);
  const [rebuildingIndexId, setRebuildingIndexId] = useState<string | null>(null);
  const [embeddingError, setEmbeddingError] = useState<string | null>(null);
  const [feedFolders, setFeedFolders] = useState<FeedFolder[]>([]);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [articles, setArticles] = useState<ArticleListItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [sourceSelection, setSourceSelection] = useState<SourceSelection>({ type: "all" });
  const [appPage, setAppPage] = useState<AppPage>({ type: "reader", view: "latest" });
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [favoriteSort, setFavoriteSort] = useState<FavoriteArticleSort>(
    defaultFavoriteArticleSort
  );
  const [isSourceDrawerOpen, setIsSourceDrawerOpen] = useState(false);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [articleDetail, setArticleDetail] = useState<ArticleDetail | null>(null);
  const [rankExplanation, setRankExplanation] = useState<RankExplanation | null>(null);
  const [recommendationStatus, setRecommendationStatus] = useState<RecommendationStatus | null>(
    null
  );
  const [isRecommendationStatusLoading, setIsRecommendationStatusLoading] = useState(false);
  const [recommendationStatusError, setRecommendationStatusError] = useState<string | null>(null);
  const [feedUrl, setFeedUrl] = useState("");
  const [isFeedsLoading, setIsFeedsLoading] = useState(true);
  const [isArticlesLoading, setIsArticlesLoading] = useState(true);
  const [isLoadingMoreArticles, setIsLoadingMoreArticles] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isExplanationLoading, setIsExplanationLoading] = useState(false);
  const [isAddingFeed, setIsAddingFeed] = useState(false);
  const [isImportingOpml, setIsImportingOpml] = useState(false);
  const [isExportingOpml, setIsExportingOpml] = useState(false);
  const [isRefreshingAllFeeds, setIsRefreshingAllFeeds] = useState(false);
  const [refreshingFeedId, setRefreshingFeedId] = useState<string | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [articleError, setArticleError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [explanationError, setExplanationError] = useState<string | null>(null);
  const [articleActionError, setArticleActionError] = useState<string | null>(null);
  const [opmlSummary, setOpmlSummary] = useState<OpmlImportResponse | null>(null);
  const [nextArticleCursor, setNextArticleCursor] = useState<string | null>(null);
  const [pendingArticleAction, setPendingArticleAction] = useState<PendingArticleAction | null>(
    null
  );
  const [notice, setNotice] = useState<Notice | null>(null);
  const openedArticleIds = useRef(new Set<string>());
  const ignoredArticleIds = useRef(new Set<string>());
  const articleStateById = useRef(new Map<string, ArticleState>());
  const articleRequestVersion = useRef(0);
  const hasLoadedSettingsForSession = useRef(false);
  const mobileArticleHistoryDepth = useRef(0);
  const selectedArticleIdRef = useRef<string | null>(null);

  const selectedFeed = useMemo(
    () =>
      sourceSelection.type === "feed"
        ? feeds.find((feed) => feed.id === sourceSelection.feedId) ?? null
        : null,
    [feeds, sourceSelection]
  );

  const selectedFolder = useMemo(
    () =>
      sourceSelection.type === "folder"
        ? feedFolders.find((folder) => folder.id === sourceSelection.folderId) ?? null
        : null,
    [feedFolders, sourceSelection]
  );
  const currentArticleView = appPage.type === "reader" ? appPage.view : "latest";

  function applyArticleState(articleId: string, state: ArticleState) {
    const previousState =
      articleStateById.current.get(articleId) ??
      (articleDetail?.id === articleId ? articleDetail.state : null);
    articleStateById.current.set(articleId, state);
    if (previousState) {
      setUnreadCount((current) =>
        unreadCountAfterStateChange(current, previousState, state)
      );
    }

    setArticles((current) => articleListAfterStateUpdate(current, articleId, state));
    setArticleDetail((current) =>
      current?.id === articleId
        ? {
            ...current,
            state
          }
        : current
    );
  }

  function clearSelectedArticle() {
    setSelectedArticleId(null);
    setArticleDetail(null);
    setRankExplanation(null);
    setDetailError(null);
    setExplanationError(null);
  }

  function resetArticleListForPendingQuery() {
    articleRequestVersion.current += 1;
    setArticles([]);
    setUnreadCount(0);
    articleStateById.current.clear();
    setNextArticleCursor(null);
    clearSelectedArticle();
    setArticleError(null);
    setLoadMoreError(null);
    setIsLoadingMoreArticles(false);
  }

  function handleSelectSource(source: SourceSelection) {
    if (!sameSourceSelection(sourceSelection, source)) {
      resetArticleListForPendingQuery();
    }
    setSourceSelection(source);
    setIsSourceDrawerOpen(false);
  }

  function handleArticleViewChange(view: ArticleView) {
    if (appPage.type !== "reader" || appPage.view !== view) {
      resetArticleListForPendingQuery();
    }
    setAppPage({ type: "reader", view });
  }

  function handleFavoriteSortChange(nextSort: FavoriteArticleSort) {
    if (favoriteSort !== nextSort) {
      resetArticleListForPendingQuery();
    }
    setFavoriteSort(nextSort);
  }

  function handleUnreadOnlyChange(nextUnreadOnly: boolean) {
    if (unreadOnly !== nextUnreadOnly) {
      resetArticleListForPendingQuery();
    }
    setUnreadOnly(nextUnreadOnly);
  }

  const resetReaderState = useCallback(() => {
    setFeedFolders([]);
    setFeeds([]);
    setArticles([]);
    setUnreadCount(0);
    articleStateById.current.clear();
    setSourceSelection({ type: "all" });
    setAppPage({ type: "reader", view: "latest" });
    setUnreadOnly(false);
    setFavoriteSort(defaultFavoriteArticleSort);
    setSelectedArticleId(null);
    setArticleDetail(null);
    setRankExplanation(null);
    setRecommendationStatus(null);
    setIsRecommendationStatusLoading(false);
    setRecommendationStatusError(null);
    setFeedUrl("");
    setIsFeedsLoading(false);
    setIsArticlesLoading(false);
    setIsLoadingMoreArticles(false);
    setIsDetailLoading(false);
    setIsExplanationLoading(false);
    setIsAddingFeed(false);
    setIsImportingOpml(false);
    setIsExportingOpml(false);
    setIsRefreshingAllFeeds(false);
    setRefreshingFeedId(null);
    setFeedError(null);
    setArticleError(null);
    setLoadMoreError(null);
    setDetailError(null);
    setExplanationError(null);
    setArticleActionError(null);
    setSetupSourceError(null);
    setAppSettings(defaultAppSettings);
    setIsSettingsLoading(false);
    setIsSavingSettings(false);
    setSettingsError(null);
    setEmbeddingProviders([]);
    setEmbeddingIndexes([]);
    setIsEmbeddingLoading(false);
    setIsSavingEmbeddingProvider(false);
    setTestingProviderId(null);
    setDeletingProviderId(null);
    setRebuildingIndexId(null);
    setEmbeddingError(null);
    setLocale(defaultLocale);
    setOpmlSummary(null);
    setNextArticleCursor(null);
    setPendingArticleAction(null);
    setNotice(null);
    hasLoadedSettingsForSession.current = false;
    openedArticleIds.current.clear();
    ignoredArticleIds.current.clear();
    articleRequestVersion.current += 1;
  }, [setLocale]);

  useEffect(() => {
    let cancelled = false;

    async function loadAuthSession() {
      setAppStage({ type: "auth-loading" });
      setAuthError(null);

      try {
        const session = await dibaoApi.getAuthSession();
        if (!cancelled) {
          const nextStage = stageForAuthSession(session);
          if (nextStage.type === "welcome" || nextStage.type === "login") {
            resetReaderState();
          }
          setAppStage(nextStage);
        }
      } catch (error) {
        if (!cancelled) {
          setAuthError(userMessageForError(error, t.errors.api));
          resetReaderState();
          setAppStage({ type: "login" });
        }
      }
    }

    void loadAuthSession();

    return () => {
      cancelled = true;
    };
  }, [resetReaderState, t.errors.api]);

  useEffect(() => {
    if (appStage.type !== "setup-status-loading") {
      return;
    }

    let cancelled = false;

    async function loadSetupStatus() {
      setAuthError(null);

      try {
        const status = await dibaoApi.getSetupStatus();
        if (!cancelled) {
          const nextStage = stageForSetupStatus(status);
          if (nextStage.type === "welcome") {
            resetReaderState();
          }
          setAppStage(nextStage);
        }
      } catch (error) {
        if (!cancelled) {
          setAuthError(userMessageForError(error, t.errors.api));
          resetReaderState();
          setAppStage({ type: "login" });
        }
      }
    }

    void loadSetupStatus();

    return () => {
      cancelled = true;
    };
  }, [appStage.type, resetReaderState, t.errors.api]);

  const applySettings = useCallback(
    (settings: AppSettings) => {
      setAppSettings(settings);
      setLocale(settings.ui.locale);
    },
    [setLocale]
  );

  useEffect(() => {
    if (appStage.type !== "reader" || hasLoadedSettingsForSession.current) {
      return;
    }

    hasLoadedSettingsForSession.current = true;
    let cancelled = false;

    async function loadSettings() {
      setIsSettingsLoading(true);
      setSettingsError(null);

      try {
        const settings = await dibaoApi.getSettings();
        if (!cancelled) {
          applySettings(settings);
        }
      } catch (error) {
        if (!cancelled) {
          setSettingsError(userMessageForError(error, t.errors.api));
          applySettings(defaultAppSettings);
        }
      } finally {
        if (!cancelled) {
          setIsSettingsLoading(false);
        }
      }
    }

    void loadSettings();

    return () => {
      cancelled = true;
    };
  }, [appStage.type, applySettings, t.errors.api]);

  const loadEmbeddingSettings = useCallback(async () => {
    setIsEmbeddingLoading(true);
    setEmbeddingError(null);

    try {
      const [providers, indexes] = await Promise.all([
        dibaoApi.listEmbeddingProviders(),
        dibaoApi.listEmbeddingIndexes()
      ]);
      setEmbeddingProviders(providers);
      setEmbeddingIndexes(indexes);
    } catch (error) {
      setEmbeddingError(userMessageForError(error, t.errors.api));
    } finally {
      setIsEmbeddingLoading(false);
    }
  }, [t.errors.api]);

  useEffect(() => {
    if (appStage.type !== "reader" || appPage.type !== "settings") {
      return;
    }

    void loadEmbeddingSettings();
  }, [appPage.type, appStage.type, loadEmbeddingSettings]);

  const refreshArticleExplanation = useCallback(async (articleId: string) => {
    setIsExplanationLoading(true);
    setExplanationError(null);

    try {
      const explanation = await dibaoApi.getArticleExplanation(articleId);
      setRankExplanation(explanation);
    } catch (error) {
      setRankExplanation(null);
      setExplanationError(userMessageForError(error, t.errors.api));
    } finally {
      setIsExplanationLoading(false);
    }
  }, [t.errors.api]);

  const loadRecommendationStatus = useCallback(async () => {
    setIsRecommendationStatusLoading(true);
    setRecommendationStatusError(null);

    try {
      const status = await dibaoApi.getRecommendationStatus();
      setRecommendationStatus(status);
    } catch (error) {
      setRecommendationStatus(null);
      setRecommendationStatusError(userMessageForError(error, t.errors.api));
    } finally {
      setIsRecommendationStatusLoading(false);
    }
  }, [t.errors.api]);

  const loadFeeds = useCallback(async () => {
    setIsFeedsLoading(true);
    setFeedError(null);

    try {
      const nextFeeds = await dibaoApi.listFeeds();
      setFeeds(nextFeeds);
      setSourceSelection((current) =>
        current.type === "feed" && !nextFeeds.some((feed) => feed.id === current.feedId)
          ? { type: "all" }
          : current
      );
    } catch (error) {
      setFeedError(userMessageForError(error, t.errors.api));
    } finally {
      setIsFeedsLoading(false);
    }
  }, [t.errors.api]);

  const loadFeedFolders = useCallback(async () => {
    try {
      const nextFolders = await dibaoApi.listFeedFolders();
      setFeedFolders(nextFolders);
      setSourceSelection((current) =>
        current.type === "folder" &&
        !nextFolders.some((folder) => folder.id === current.folderId)
          ? { type: "all" }
          : current
      );
    } catch (error) {
      setFeedError(userMessageForError(error, t.errors.api));
    }
  }, [t.errors.api]);

  const loadArticles = useCallback(async (
    selection: SourceSelection,
    view: ArticleView,
    onlyUnread: boolean,
    sort: FavoriteArticleSort = defaultFavoriteArticleSort
  ) => {
    const requestVersion = articleRequestVersion.current + 1;
    articleRequestVersion.current = requestVersion;
    setIsArticlesLoading(true);
    setArticleError(null);
    setLoadMoreError(null);
    setNextArticleCursor(null);
    setArticles([]);
    setSelectedArticleId(null);
    setArticleDetail(null);
    setRankExplanation(null);
    if (view !== "recommended" && appPage.type !== "algorithm-transparency") {
      setRecommendationStatus(null);
      setIsRecommendationStatusLoading(false);
      setRecommendationStatusError(null);
    }
    setDetailError(null);
    setExplanationError(null);

    try {
      const response = await dibaoApi.listArticles({
        ...articleQueryFor(selection),
        view,
        limit: 50,
        unreadOnly: supportsUnreadOnly(view) ? onlyUnread : false,
        sort: view === "favorites" ? sort : undefined
      });
      if (requestVersion !== articleRequestVersion.current) {
        return;
      }
      rememberArticleStates(response.data, articleStateById.current);
      setArticles(
        articlesVisibleForUnreadFilter(response.data, supportsUnreadOnly(view) && onlyUnread)
      );
      setUnreadCount(response.meta.unreadCount);
      setNextArticleCursor(response.page.nextCursor);
      setSelectedArticleId(null);
    } catch (error) {
      if (requestVersion !== articleRequestVersion.current) {
        return;
      }
      setArticleError(userMessageForError(error, t.errors.api));
      setArticles([]);
      setUnreadCount(0);
      articleStateById.current.clear();
      setSelectedArticleId(null);
      setNextArticleCursor(null);
    } finally {
      if (requestVersion === articleRequestVersion.current) {
        setIsArticlesLoading(false);
      }
    }
  }, [appPage.type, t.errors.api]);

  useEffect(() => {
    if (appStage.type !== "reader") {
      return;
    }

    void Promise.all([loadFeedFolders(), loadFeeds()]);
  }, [appPage.type, appStage.type, loadFeedFolders, loadFeeds]);

  useEffect(() => {
    if (appStage.type !== "reader" || appPage.type !== "reader") {
      return;
    }

    void loadArticles(sourceSelection, appPage.view, unreadOnly, favoriteSort);
  }, [appPage, appStage.type, favoriteSort, loadArticles, sourceSelection, unreadOnly]);

  useEffect(() => {
    if (
      appStage.type !== "reader" ||
      (appPage.type !== "reader" && appPage.type !== "algorithm-transparency") ||
      (appPage.type === "reader" && appPage.view !== "recommended")
    ) {
      setRecommendationStatus(null);
      setRecommendationStatusError(null);
      setIsRecommendationStatusLoading(false);
      return;
    }

    void loadRecommendationStatus();
  }, [appPage, appStage.type, loadRecommendationStatus]);

  useEffect(() => {
    selectedArticleIdRef.current = selectedArticleId;
  }, [selectedArticleId]);

  useEffect(() => {
    function handlePopState() {
      if (mobileArticleHistoryDepth.current <= 0) {
        return;
      }

      mobileArticleHistoryDepth.current -= 1;
      if (selectedArticleIdRef.current) {
        clearSelectedArticle();
      }
    }

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadDetail(articleId: string) {
      setIsDetailLoading(true);
      setDetailError(null);
      setRankExplanation(null);
      setExplanationError(null);

      try {
        const detail = await dibaoApi.getArticle(articleId);
        if (!cancelled) {
          articleStateById.current.set(articleId, detail.state);
          setArticleDetail(detail);
          setArticleActionError(null);
        }
        if (!openedArticleIds.current.has(articleId)) {
          openedArticleIds.current.add(articleId);
          try {
            const result = await dibaoApi.postArticleAction(articleId, {
              type: "open",
              value: true
            });
            if (!cancelled) {
              applyArticleState(articleId, result.state);
            }
          } catch {
            openedArticleIds.current.delete(articleId);
            if (!cancelled) {
              setArticleActionError(t.actions.errors.open);
            }
          }
        }
        if (!cancelled) {
          await refreshArticleExplanation(articleId);
        }
      } catch (error) {
        if (!cancelled) {
          setArticleDetail(null);
          setDetailError(userMessageForError(error, t.errors.api));
        }
      } finally {
        if (!cancelled) {
          setIsDetailLoading(false);
        }
      }
    }

    if (!selectedArticleId) {
      setArticleDetail(null);
      setRankExplanation(null);
      setIsDetailLoading(false);
      setIsExplanationLoading(false);
      setDetailError(null);
      setExplanationError(null);
      return;
    }

    void loadDetail(selectedArticleId);

    return () => {
      cancelled = true;
    };
  }, [refreshArticleExplanation, selectedArticleId, t.actions.errors.open, t.errors.api]);

  async function handleAuthSubmit(mode: AuthMode, password: string) {
    if (!password.trim()) {
      setAuthError(t.auth.passwordRequired);
      return;
    }

    setIsAuthSubmitting(true);
    setAuthError(null);

    try {
      if (mode === "setup") {
        await dibaoApi.setupAuth(password);
        resetReaderState();
        setAppStage({ type: "setup-sources" });
      } else {
        await dibaoApi.login(password);
        setAppStage({ type: "setup-status-loading" });
      }
    } catch (error) {
      setAuthError(userMessageForError(error, t.errors.api));
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  async function handleLogout() {
    setLogoutError(null);

    try {
      await dibaoApi.logout();
      setAppStage({ type: "login" });
      resetReaderState();
    } catch (error) {
      setLogoutError(userMessageForError(error, t.errors.api) || t.auth.errors.logout);
    }
  }

  async function handleAddFeed(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextFeedUrl = feedUrl.trim();

    if (!nextFeedUrl) {
      setFeedError(t.feeds.feedUrlRequired);
      return;
    }

    setIsAddingFeed(true);
    setFeedError(null);
    setNotice(null);

    try {
      const result = await dibaoApi.createFeed(nextFeedUrl);
      setFeedUrl("");
      setNotice({ type: "feedAddedAndRefreshed", feedTitle: result.feed.title });
      await loadFeeds();
      handleSelectSource({ type: "feed", feedId: result.feed.id });
    } catch (error) {
      setFeedError(userMessageForError(error, t.errors.api));
    } finally {
      setIsAddingFeed(false);
    }
  }

  async function advanceSetupAfterSource(noFeedsMessage: string) {
    const status = await dibaoApi.getSetupStatus();
    if (status.hasFeeds) {
      setSetupSourceError(null);
      setAppStage({ type: "setup-provider-placeholder" });
      return;
    }

    setSetupSourceError(noFeedsMessage);
  }

  async function handleSetupAddFeed(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextFeedUrl = feedUrl.trim();

    if (!nextFeedUrl) {
      setSetupSourceError(t.feeds.feedUrlRequired);
      return;
    }

    setIsAddingFeed(true);
    setSetupSourceError(null);
    setOpmlSummary(null);

    try {
      await dibaoApi.createFeed(nextFeedUrl);
      setFeedUrl("");
      await advanceSetupAfterSource(t.setup.sources.noFeedsAfterAdd);
    } catch (error) {
      setSetupSourceError(userMessageForError(error, t.errors.api));
    } finally {
      setIsAddingFeed(false);
    }
  }

  async function handleSetupImportOpml(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";

    if (!file) {
      return;
    }

    setIsImportingOpml(true);
    setSetupSourceError(null);
    setOpmlSummary(null);

    try {
      const result = await dibaoApi.importOpml(file);
      setOpmlSummary(result);
      await advanceSetupAfterSource(t.setup.sources.noFeedsAfterImport);
    } catch (error) {
      setSetupSourceError(userMessageForError(error, t.errors.api));
    } finally {
      setIsImportingOpml(false);
    }
  }

  function handleSetupProviderContinue() {
    resetReaderState();
    setIsFeedsLoading(true);
    setIsArticlesLoading(true);
    setAppStage({ type: "reader" });
  }

  async function handleRefreshFeed(feed: Feed) {
    setRefreshingFeedId(feed.id);
    setFeedError(null);
    setArticleError(null);
    setNotice(null);

    try {
      await dibaoApi.refreshFeed(feed.id);
      setNotice({ type: "feedRefreshed", feedTitle: feed.title });
      await Promise.all([
        loadFeeds(),
        appPage.type === "reader"
          ? loadArticles(sourceSelection, appPage.view, unreadOnly, favoriteSort)
          : Promise.resolve()
      ]);
    } catch (error) {
      setFeedError(userMessageForError(error, t.errors.api));
    } finally {
      setRefreshingFeedId(null);
    }
  }

  async function handleRefreshAllFeeds() {
    setIsRefreshingAllFeeds(true);
    setFeedError(null);
    setNotice(null);

    try {
      const result = await dibaoApi.refreshAllFeeds();
      setNotice({ type: "allFeedsRefreshQueued", jobCount: result.jobIds.length });
      await loadFeeds();
    } catch (error) {
      setFeedError(userMessageForError(error, t.errors.api));
    } finally {
      setIsRefreshingAllFeeds(false);
    }
  }

  async function handleImportOpml(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";

    if (!file) {
      return;
    }

    setIsImportingOpml(true);
    setFeedError(null);
    setOpmlSummary(null);
    setNotice(null);

    try {
      const result = await dibaoApi.importOpml(file);
      setOpmlSummary(result);
      setNotice({ type: "opmlImported", result });
      await Promise.all([
        loadFeedFolders(),
        loadFeeds(),
        appPage.type === "reader"
          ? loadArticles(sourceSelection, appPage.view, unreadOnly, favoriteSort)
          : Promise.resolve()
      ]);
    } catch (error) {
      setFeedError(userMessageForError(error, t.errors.api));
    } finally {
      setIsImportingOpml(false);
    }
  }

  async function handleExportOpml() {
    setIsExportingOpml(true);
    setFeedError(null);
    setNotice(null);

    try {
      const xml = await dibaoApi.exportOpml();
      downloadTextFile("dibao-subscriptions.opml", xml, "application/xml");
      setNotice({ type: "opmlExported" });
    } catch (error) {
      setFeedError(userMessageForError(error, t.errors.api));
    } finally {
      setIsExportingOpml(false);
    }
  }

  async function refreshSourcesAfterManagementMutation() {
    const [nextFolders, nextFeeds] = await Promise.all([
      dibaoApi.listFeedFolders(),
      dibaoApi.listFeeds()
    ]);
    const nextSourceSelection = correctSourceSelection(sourceSelection, nextFeeds, nextFolders);

    setFeedFolders(nextFolders);
    setFeeds(nextFeeds);

    if (!sameSourceSelection(sourceSelection, nextSourceSelection)) {
      resetArticleListForPendingQuery();
    }
    setSourceSelection(nextSourceSelection);

    if (articleDetail && !nextFeeds.some((feed) => feed.id === articleDetail.feedId)) {
      setSelectedArticleId(null);
      setArticleDetail(null);
      setRankExplanation(null);
      setDetailError(null);
      setExplanationError(null);
    }

    if (appPage.type === "reader") {
      await loadArticles(nextSourceSelection, appPage.view, unreadOnly, favoriteSort);
    }
  }

  async function handleCreateManagedFolder(title: string) {
    await dibaoApi.createFeedFolder(title);
    await refreshSourcesAfterManagementMutation();
  }

  async function handleUpdateManagedFolder(folderId: string, input: UpdateFeedFolderInput) {
    await dibaoApi.updateFeedFolder(folderId, input);
    await refreshSourcesAfterManagementMutation();
  }

  async function handleDeleteManagedFolder(folderId: string) {
    await dibaoApi.deleteFeedFolder(folderId);
    await refreshSourcesAfterManagementMutation();
  }

  async function handleUpdateManagedFeed(feedId: string, input: UpdateFeedInput) {
    await dibaoApi.updateFeed(feedId, input);
    await refreshSourcesAfterManagementMutation();
  }

  async function handleDeleteManagedFeed(feedId: string) {
    await dibaoApi.deleteFeed(feedId);
    await refreshSourcesAfterManagementMutation();
  }

  function handlePreviewSettings(settings: AppSettings) {
    applySettings(settings);
    setSettingsError(null);
  }

  async function handleSaveSettings(input: UpdateSettingsInput) {
    setIsSavingSettings(true);
    setSettingsError(null);
    setNotice(null);

    try {
      const result = await dibaoApi.updateSettings(input);
      applySettings(result.settings);
      setNotice({ type: "settingsSaved" });
    } catch (error) {
      setSettingsError(userMessageForError(error, t.errors.api));
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function handleSaveEmbeddingProvider(
    providerId: string | null,
    input: CreateEmbeddingProviderInput | UpdateEmbeddingProviderInput
  ) {
    setIsSavingEmbeddingProvider(true);
    setEmbeddingError(null);
    setNotice(null);

    try {
      if (providerId) {
        await dibaoApi.updateEmbeddingProvider(providerId, input);
      } else {
        await dibaoApi.createEmbeddingProvider(input as CreateEmbeddingProviderInput);
      }
      await loadEmbeddingSettings();
      setNotice({ type: "embeddingProviderSaved" });
    } catch (error) {
      setEmbeddingError(userMessageForError(error, t.errors.api));
    } finally {
      setIsSavingEmbeddingProvider(false);
    }
  }

  async function handleTestEmbeddingProvider(providerId: string) {
    setTestingProviderId(providerId);
    setEmbeddingError(null);
    setNotice(null);

    try {
      await dibaoApi.testEmbeddingProvider(providerId);
      await loadEmbeddingSettings();
      setNotice({ type: "embeddingProviderTested" });
    } catch (error) {
      setEmbeddingError(userMessageForError(error, t.errors.api));
      await loadEmbeddingSettings();
    } finally {
      setTestingProviderId(null);
    }
  }

  async function handleDeleteEmbeddingProvider(providerId: string) {
    setDeletingProviderId(providerId);
    setEmbeddingError(null);
    setNotice(null);

    try {
      await dibaoApi.deleteEmbeddingProvider(providerId);
      await loadEmbeddingSettings();
      setNotice({ type: "embeddingProviderDeleted" });
    } catch (error) {
      setEmbeddingError(userMessageForError(error, t.errors.api));
    } finally {
      setDeletingProviderId(null);
    }
  }

  async function handleRebuildEmbeddingIndex(indexId: string) {
    setRebuildingIndexId(indexId);
    setEmbeddingError(null);
    setNotice(null);

    try {
      await dibaoApi.rebuildEmbeddingIndex(indexId);
      await loadEmbeddingSettings();
      setNotice({ type: "embeddingIndexRebuildQueued" });
    } catch (error) {
      setEmbeddingError(userMessageForError(error, t.errors.api));
    } finally {
      setRebuildingIndexId(null);
    }
  }

  async function handleLoadMoreArticles() {
    if (!nextArticleCursor) {
      return;
    }

    const requestVersion = articleRequestVersion.current;
    setIsLoadingMoreArticles(true);
    setLoadMoreError(null);

    try {
      const response = await dibaoApi.listArticles({
        ...articleQueryFor(sourceSelection),
        view: currentArticleView,
        limit: 50,
        cursor: nextArticleCursor,
        unreadOnly: supportsUnreadOnly(currentArticleView) ? unreadOnly : false,
        sort: currentArticleView === "favorites" ? favoriteSort : undefined
      });
      if (requestVersion !== articleRequestVersion.current) {
        return;
      }
      rememberArticleStates(response.data, articleStateById.current);
      setArticles((current) =>
        appendUniqueArticles(
          current,
          articlesVisibleForUnreadFilter(
            response.data,
            supportsUnreadOnly(currentArticleView) && unreadOnly
          )
        )
      );
      setUnreadCount(response.meta.unreadCount);
      setNextArticleCursor(response.page.nextCursor);
    } catch (error) {
      if (requestVersion !== articleRequestVersion.current) {
        return;
      }
      setLoadMoreError(userMessageForError(error, t.errors.api));
    } finally {
      if (requestVersion === articleRequestVersion.current) {
        setIsLoadingMoreArticles(false);
      }
    }
  }

  async function handleArticleAction(article: ArticleDetail, intent: ArticleActionIntent) {
    setPendingArticleAction({ articleId: article.id, intent });
    setArticleActionError(null);

    try {
      const result = await dibaoApi.postArticleAction(
        article.id,
        requestForArticleAction(intent, article.state)
      );
      applyArticleState(article.id, result.state);
      await refreshArticleExplanation(article.id);
    } catch {
      setArticleActionError(actionErrorMessageFor(intent, t));
    } finally {
      setPendingArticleAction((current) =>
        current?.articleId === article.id && current.intent === intent ? null : current
      );
    }
  }

  async function handleIgnoreArticle(articleId: string) {
    const article = articles.find((candidate) => candidate.id === articleId);
    const interactionStatus = article ? articleInteractionStatusForState(article.state) : "unseen";

    if (
      !article ||
      selectedArticleId === articleId ||
      openedArticleIds.current.has(articleId) ||
      ignoredArticleIds.current.has(articleId) ||
      interactionStatus !== "unseen"
    ) {
      return;
    }

    ignoredArticleIds.current.add(articleId);

    try {
      const result = await dibaoApi.postArticleAction(articleId, {
        type: "impression",
        metadata: {
          reason: "scrolled_past_unopened",
          view: currentArticleView
        }
      });
      applyArticleState(articleId, result.state);
    } catch {
      ignoredArticleIds.current.delete(articleId);
      // Passive list telemetry should not interrupt browsing.
    }
  }

  async function handleReadProgress(
    articleId: string,
    progress: number,
    metadata: ReadProgressMetadata,
    options: ReadProgressPostOptions = {}
  ) {
    const request: ArticleActionRequest = {
      type: "read_progress",
      progress,
      metadata
    };

    if (options.keepalive) {
      dibaoApi.postArticleActionKeepalive(articleId, request);
      return;
    }

    try {
      const result = await dibaoApi.postArticleAction(articleId, request);
      applyArticleState(articleId, result.state);
    } catch {
      // Automatic reading telemetry should never interrupt the reader surface.
    }
  }

  function handleSelectArticle(articleId: string) {
    if (isMobileArticleHistoryEnabled() && selectedArticleId !== articleId) {
      window.history.pushState({ dibaoArticleId: articleId }, "", window.location.href);
      mobileArticleHistoryDepth.current += 1;
    }
    setSelectedArticleId(articleId);
    setIsSourceDrawerOpen(false);
  }

  function handleBackToArticleList() {
    if (isMobileArticleHistoryEnabled() && mobileArticleHistoryDepth.current > 0) {
      window.history.back();
      return;
    }

    clearSelectedArticle();
  }

  function handleNavigationClick(event: MouseEvent<HTMLAnchorElement>, item: NavigationItemKey) {
    event.preventDefault();
    const page = pageForNavigationItem(item);
    if (!page) {
      return;
    }

    setIsSourceDrawerOpen(false);
    if (page.type === "reader") {
      handleArticleViewChange(page.view);
    } else {
      setAppPage(page);
    }
  }

  const noticeText = notice ? noticeTextFor(notice, t) : null;
  const pageTitle =
    appPage.type === "feed-management"
      ? t.feedManagement.pageTitle
      : appPage.type === "settings"
        ? t.settings.pageTitle
        : appPage.type === "algorithm-transparency"
          ? t.algorithmTransparency.pageTitle
          : t.shell.pageTitles[currentArticleView];
  const topbarStatus =
    appPage.type === "feed-management"
      ? isFeedsLoading
        ? t.feedManagement.loading
        : t.feedManagement.status(feeds.length, feedFolders.length)
      : appPage.type === "settings"
        ? settingsError ??
          embeddingError ??
          noticeText ??
          (isSettingsLoading || isEmbeddingLoading ? t.settings.loading : t.settings.status)
        : appPage.type === "algorithm-transparency"
          ? recommendationStatusError ??
            (isRecommendationStatusLoading
              ? t.recommendationStatus.loading
              : t.algorithmTransparency.status)
          : noticeText ??
            (isArticlesLoading ? t.shell.loadingArticles : t.shell.viewStatus[currentArticleView]);

  if (appStage.type === "auth-loading" || appStage.type === "setup-status-loading") {
    return (
      <main className={styles.authShell}>
        <AuthGatePanel isSubmitting={false} mode="loading" />
      </main>
    );
  }

  if (appStage.type === "welcome") {
    return (
      <main className={styles.authShell}>
        <SetupWelcomePanel onStart={() => setAppStage({ type: "setup-password" })} />
      </main>
    );
  }

  if (appStage.type === "setup-password" || appStage.type === "login") {
    return (
      <main className={styles.authShell}>
        <AuthGatePanel
          error={authError}
          isSubmitting={isAuthSubmitting}
          mode={appStage.type === "login" ? "login" : "setup"}
          onSubmit={handleAuthSubmit}
        />
      </main>
    );
  }

  if (appStage.type === "setup-sources") {
    return (
      <main className={styles.authShell}>
        <SetupSourcesPanel
          error={setupSourceError}
          feedUrl={feedUrl}
          isAddingFeed={isAddingFeed}
          isImportingOpml={isImportingOpml}
          onAddFeed={handleSetupAddFeed}
          onImportOpml={handleSetupImportOpml}
          onUpdateFeedUrl={setFeedUrl}
          opmlSummary={opmlSummary}
        />
      </main>
    );
  }

  if (appStage.type === "setup-provider-placeholder") {
    return (
      <main className={styles.authShell}>
        <SetupProviderPlaceholderPanel onContinue={handleSetupProviderContinue} />
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      <aside className={styles.sidebar} aria-label={t.navigation.ariaLabel}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>{t.common.brandMark}</span>
          <span>
            <strong>{t.common.brandName}</strong>
            <small>{t.common.brandSubtitle}</small>
          </span>
        </div>
        <nav className={styles.nav}>
          {navigationItems.map((item) => (
            <a
              className={isNavigationItemActive(item, appPage) ? styles.navItemActive : styles.navItem}
              href="#"
              key={item}
              onClick={(event) => handleNavigationClick(event, item)}
            >
              {t.navigation.items[item]}
            </a>
          ))}
        </nav>
      </aside>

      <section className={styles.content} aria-labelledby="page-title">
        <header className={styles.topbar}>
          <div>
            <p className={styles.kicker}>{t.shell.kicker}</p>
            <h1 id="page-title">{pageTitle}</h1>
          </div>
          <div className={styles.topbarMeta}>
            <span className={styles.statusText} aria-live="polite">
              {topbarStatus}
            </span>
            {logoutError ? <span className={styles.logoutError}>{logoutError}</span> : null}
            <button
              className={styles.secondaryButton}
              onClick={handleLogout}
              title={t.auth.logoutTitle}
              type="button"
            >
              {t.auth.logout}
            </button>
            <span className={styles.version}>{t.common.version(dibaoVersion)}</span>
          </div>
        </header>

        {appPage.type === "feed-management" ? (
          <FeedManagementWorkspace
            feedError={feedError}
            feedUrl={feedUrl}
            feedFolders={feedFolders}
            feeds={feeds}
            isAddingFeed={isAddingFeed}
            isExportingOpml={isExportingOpml}
            isImportingOpml={isImportingOpml}
            isLoading={isFeedsLoading}
            isRefreshingAllFeeds={isRefreshingAllFeeds}
            onAddFeed={handleAddFeed}
            onCreateFolder={handleCreateManagedFolder}
            onDeleteFeed={handleDeleteManagedFeed}
            onDeleteFolder={handleDeleteManagedFolder}
            onExportOpml={handleExportOpml}
            onImportOpml={handleImportOpml}
            onRefreshAllFeeds={handleRefreshAllFeeds}
            onUpdateFeedUrl={setFeedUrl}
            onUpdateFeed={handleUpdateManagedFeed}
            onUpdateFolder={handleUpdateManagedFolder}
            opmlSummary={opmlSummary}
          />
        ) : appPage.type === "settings" ? (
          <SettingsWorkspace
            embeddingError={embeddingError}
            embeddingIndexes={embeddingIndexes}
            embeddingProviders={embeddingProviders}
            error={settingsError}
            isEmbeddingLoading={isEmbeddingLoading}
            isLoading={isSettingsLoading}
            isSavingEmbeddingProvider={isSavingEmbeddingProvider}
            isSaving={isSavingSettings}
            deletingProviderId={deletingProviderId}
            rebuildingIndexId={rebuildingIndexId}
            testingProviderId={testingProviderId}
            onDeleteEmbeddingProvider={handleDeleteEmbeddingProvider}
            onPreviewSettings={handlePreviewSettings}
            onRebuildEmbeddingIndex={handleRebuildEmbeddingIndex}
            onOpenAlgorithmTransparency={() => setAppPage({ type: "algorithm-transparency" })}
            onSaveSettings={handleSaveSettings}
            onSaveEmbeddingProvider={handleSaveEmbeddingProvider}
            onTestEmbeddingProvider={handleTestEmbeddingProvider}
            settings={appSettings}
          />
        ) : appPage.type === "algorithm-transparency" ? (
          <AlgorithmTransparencyPage
            error={recommendationStatusError}
            isLoading={isRecommendationStatusLoading}
            onBack={() => setAppPage({ type: "settings" })}
            status={recommendationStatus}
          />
        ) : (
          <div
            className={classNames(
              styles.workspace,
              selectedArticleId ? styles.workspaceReading : null,
              isSourceDrawerOpen ? styles.workspaceSourcesOpen : null
            )}
          >
            <button
              aria-label={t.feeds.closeSources}
              className={styles.sourceBackdrop}
              onClick={() => setIsSourceDrawerOpen(false)}
              type="button"
            />
            <FeedPanel
              feedError={feedError}
              feedFolders={feedFolders}
              feeds={feeds}
              isOpen={isSourceDrawerOpen}
              isFeedsLoading={isFeedsLoading}
              onRefreshFeed={handleRefreshFeed}
              onCloseSources={() => setIsSourceDrawerOpen(false)}
              onSelectSource={handleSelectSource}
              refreshingFeedId={refreshingFeedId}
              sourceSelection={sourceSelection}
            />

            <ArticleListPanel
              articleError={articleError}
              articleView={currentArticleView}
              articles={articles}
              feedCount={feeds.length}
              isIgnoreTelemetryEnabled={
                appSettings.behavior.markScrolledArticlesIgnored &&
                (currentArticleView === "latest" || currentArticleView === "recommended")
              }
              isArticlesLoading={isArticlesLoading}
              isLoadingMore={isLoadingMoreArticles}
              loadMoreError={loadMoreError}
              nextCursor={nextArticleCursor}
              onIgnoreArticle={handleIgnoreArticle}
              onLoadMore={handleLoadMoreArticles}
              onOpenSources={() => setIsSourceDrawerOpen(true)}
              onSelectArticle={handleSelectArticle}
              onFavoriteSortChange={handleFavoriteSortChange}
              onUnreadOnlyChange={handleUnreadOnlyChange}
              favoriteSort={favoriteSort}
              recommendationStatus={
                currentArticleView === "recommended" ? recommendationStatus : null
              }
              recommendationStatusError={
                currentArticleView === "recommended" ? recommendationStatusError : null
              }
              selectedArticleId={selectedArticleId}
              selectedFeed={selectedFeed}
              selectedFolder={selectedFolder}
              showRecommendationStatus={currentArticleView === "recommended"}
              showUnreadOnlyFilter={supportsUnreadOnly(currentArticleView)}
              isRecommendationStatusLoading={isRecommendationStatusLoading}
              unreadCount={unreadCount}
              unreadOnly={unreadOnly}
            />

            <ArticleDetailPanel
              actionError={articleActionError}
              article={articleDetail}
              detailError={detailError}
              explanation={
                articleDetail && rankExplanation?.articleId === articleDetail.id
                  ? rankExplanation
                  : null
              }
              explanationError={explanationError}
              isDetailLoading={isDetailLoading}
              isExplanationLoading={isExplanationLoading}
              onArticleAction={handleArticleAction}
              onBackToList={handleBackToArticleList}
              onReadProgress={handleReadProgress}
              pendingAction={
                articleDetail && pendingArticleAction?.articleId === articleDetail.id
                  ? pendingArticleAction.intent
                  : null
              }
              readerSettings={appSettings.reader}
            />
          </div>
        )}
      </section>
    </main>
  );
}

export function SetupWelcomePanel(props: { onStart: () => void }) {
  const { t } = useI18n();

  return (
    <section className={styles.authPanel} aria-labelledby="setup-welcome-title">
      <div className={styles.brand}>
        <span className={styles.brandMark}>{t.common.brandMark}</span>
        <span>
          <strong>{t.common.brandName}</strong>
          <small>{t.common.brandSubtitle}</small>
        </span>
      </div>
      <div>
        <p className={styles.kicker}>{t.setup.kicker}</p>
        <h1 id="setup-welcome-title">{t.setup.welcome.title}</h1>
        <p>{t.setup.welcome.body}</p>
      </div>
      <button className={styles.primaryButton} onClick={props.onStart} type="button">
        {t.setup.welcome.start}
      </button>
    </section>
  );
}

export function AuthGatePanel(props: {
  error?: string | null;
  isSubmitting: boolean;
  mode: AuthMode | "loading";
  onSubmit?: (mode: AuthMode, password: string) => void;
}) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");

  if (props.mode === "loading") {
    return (
      <section className={styles.authPanel} aria-live="polite">
        <div className={styles.brand}>
          <span className={styles.brandMark}>{t.common.brandMark}</span>
          <span>
            <strong>{t.common.brandName}</strong>
            <small>{t.common.brandSubtitle}</small>
          </span>
        </div>
        <p>{t.auth.loading}</p>
      </section>
    );
  }

  const title = props.mode === "setup" ? t.auth.setupTitle : t.auth.loginTitle;
  const body = props.mode === "setup" ? t.auth.setupBody : t.auth.loginBody;
  const submitLabel = props.mode === "setup" ? t.auth.setupSubmit : t.auth.loginSubmit;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    props.onSubmit?.(props.mode as AuthMode, password);
  }

  return (
    <section className={styles.authPanel} aria-labelledby="auth-title">
      <div className={styles.brand}>
        <span className={styles.brandMark}>{t.common.brandMark}</span>
        <span>
          <strong>{t.common.brandName}</strong>
          <small>{t.common.brandSubtitle}</small>
        </span>
      </div>
      <div>
        <p className={styles.kicker}>{t.shell.kicker}</p>
        <h1 id="auth-title">{title}</h1>
        <p>{body}</p>
      </div>

      <form className={styles.authForm} onSubmit={handleSubmit}>
        <label htmlFor="auth-password">{t.auth.passwordLabel}</label>
        <input
          autoComplete={props.mode === "setup" ? "new-password" : "current-password"}
          id="auth-password"
          onChange={(event) => setPassword(event.target.value)}
          placeholder={t.auth.passwordPlaceholder}
          type="password"
          value={password}
        />
        <button className={styles.primaryButton} disabled={props.isSubmitting} type="submit">
          {props.isSubmitting ? t.auth.submitting : submitLabel}
        </button>
      </form>

      {props.error ? <p className={styles.errorText}>{props.error}</p> : null}
    </section>
  );
}

export function SetupSourcesPanel(props: {
  error: string | null;
  feedUrl: string;
  isAddingFeed: boolean;
  isImportingOpml: boolean;
  onAddFeed: (event: FormEvent<HTMLFormElement>) => void;
  onImportOpml: (event: ChangeEvent<HTMLInputElement>) => void;
  onUpdateFeedUrl: (value: string) => void;
  opmlSummary: OpmlImportResponse | null;
}) {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <section className={styles.authPanel} aria-labelledby="setup-sources-title">
      <div className={styles.brand}>
        <span className={styles.brandMark}>{t.common.brandMark}</span>
        <span>
          <strong>{t.common.brandName}</strong>
          <small>{t.common.brandSubtitle}</small>
        </span>
      </div>
      <div>
        <p className={styles.kicker}>{t.setup.kicker}</p>
        <h1 id="setup-sources-title">{t.setup.sources.title}</h1>
        <p>{t.setup.sources.body}</p>
      </div>

      <div className={styles.setupSourceActions}>
        <input
          accept=".opml,.xml,text/xml,application/xml"
          className={styles.fileInput}
          onChange={props.onImportOpml}
          ref={fileInputRef}
          type="file"
        />
        <button
          className={styles.secondaryButton}
          disabled={props.isImportingOpml || props.isAddingFeed}
          onClick={() => fileInputRef.current?.click()}
          type="button"
        >
          {props.isImportingOpml ? t.opml.importing : t.setup.sources.importOpml}
        </button>
      </div>

      <form className={styles.authForm} onSubmit={props.onAddFeed}>
        <label htmlFor="setup-feed-url">{t.feeds.inputLabel}</label>
        <input
          id="setup-feed-url"
          inputMode="url"
          onChange={(event) => props.onUpdateFeedUrl(event.target.value)}
          placeholder={t.feeds.inputPlaceholder}
          type="url"
          value={props.feedUrl}
        />
        <button
          className={styles.primaryButton}
          disabled={props.isAddingFeed || props.isImportingOpml}
          type="submit"
        >
          {props.isAddingFeed ? t.feeds.adding : t.setup.sources.addFeed}
        </button>
      </form>

      {props.opmlSummary ? (
        <div className={styles.opmlSummary}>
          <p>
            {t.opml.importSummary(
              props.opmlSummary.feedsCreated,
              props.opmlSummary.feedsSkipped,
              props.opmlSummary.foldersCreated
            )}
          </p>
          {props.opmlSummary.errors.length > 0 ? (
            <>
              <p>{t.opml.importErrors(props.opmlSummary.errors.length)}</p>
              <ul>
                {props.opmlSummary.errors.map((error, index) => (
                  <li key={`${error}-${index}`}>{error}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}

      {props.error ? <p className={styles.errorText}>{props.error}</p> : null}
    </section>
  );
}

export function SetupProviderPlaceholderPanel(props: { onContinue: () => void }) {
  const { t } = useI18n();

  return (
    <section className={styles.authPanel} aria-labelledby="setup-provider-title">
      <div className={styles.brand}>
        <span className={styles.brandMark}>{t.common.brandMark}</span>
        <span>
          <strong>{t.common.brandName}</strong>
          <small>{t.common.brandSubtitle}</small>
        </span>
      </div>
      <div>
        <p className={styles.kicker}>{t.setup.kicker}</p>
        <h1 id="setup-provider-title">{t.setup.provider.title}</h1>
        <p>{t.setup.provider.body}</p>
      </div>
      <div className={styles.setupStatusBox}>
        <strong>{t.setup.provider.currentTitle}</strong>
        <p>{t.setup.provider.currentBody}</p>
      </div>
      <button className={styles.primaryButton} onClick={props.onContinue} type="button">
        {t.setup.provider.continue}
      </button>
    </section>
  );
}

type SettingsDraft = {
  locale: AppSettings["ui"]["locale"];
  markScrolledArticlesIgnored: boolean;
  fontSize: string;
  lineHeight: string;
  paragraphGap: string;
  readerWidth: string;
  retentionDays: string;
};

type SupportedEmbeddingProviderType = Extract<
  EmbeddingProviderType,
  "openai_compatible" | "ollama"
>;

type EmbeddingProviderDraft = {
  providerId: string;
  type: SupportedEmbeddingProviderType;
  name: string;
  baseUrl: string;
  model: string;
  dimension: string;
  apiKey: string;
  enabled: boolean;
  qualityTier: "basic" | "recommended" | "best_quality";
};

const newEmbeddingProviderId = "__new_provider__";

export function SettingsWorkspace(props: {
  deletingProviderId: string | null;
  embeddingError: string | null;
  embeddingIndexes: EmbeddingIndex[];
  embeddingProviders: EmbeddingProvider[];
  error: string | null;
  isEmbeddingLoading: boolean;
  isLoading: boolean;
  isSavingEmbeddingProvider: boolean;
  isSaving: boolean;
  rebuildingIndexId: string | null;
  testingProviderId: string | null;
  onDeleteEmbeddingProvider: (providerId: string) => Promise<void>;
  onOpenAlgorithmTransparency: () => void;
  onPreviewSettings: (settings: AppSettings) => void;
  onRebuildEmbeddingIndex: (indexId: string) => Promise<void>;
  onSaveSettings: (input: UpdateSettingsInput) => Promise<void>;
  onSaveEmbeddingProvider: (
    providerId: string | null,
    input: CreateEmbeddingProviderInput | UpdateEmbeddingProviderInput
  ) => Promise<void>;
  onTestEmbeddingProvider: (providerId: string) => Promise<void>;
  settings: AppSettings;
}) {
  const { t, formatDate } = useI18n();
  const initialProvider =
    props.embeddingProviders.find((provider) => provider.enabled) ??
    props.embeddingProviders[0] ??
    null;
  const [draft, setDraft] = useState<SettingsDraft>(() => draftForSettings(props.settings));
  const [providerDraft, setProviderDraft] = useState<EmbeddingProviderDraft>(() =>
    draftForEmbeddingProvider(initialProvider)
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const [providerLocalError, setProviderLocalError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(draftForSettings(props.settings));
  }, [props.settings]);

  useEffect(() => {
    const activeProvider =
      props.embeddingProviders.find((provider) => provider.enabled) ??
      props.embeddingProviders[0] ??
      null;
    setProviderDraft(draftForEmbeddingProvider(activeProvider));
    setProviderLocalError(null);
  }, [props.embeddingProviders]);

  function applyDraft(nextDraft: SettingsDraft) {
    setDraft(nextDraft);
    setLocalError(null);

    const parsed = parseSettingsDraft(nextDraft, props.settings, t);
    if (parsed.ok) {
      props.onPreviewSettings(parsed.settings);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseSettingsDraft(draft, props.settings, t);

    if (!parsed.ok) {
      setLocalError(parsed.error);
      return;
    }

    await props.onSaveSettings(parsed.input);
  }

  async function handleProviderSubmit() {
    const parsed = parseEmbeddingProviderDraft(providerDraft, t);

    if (!parsed.ok) {
      setProviderLocalError(parsed.error);
      return;
    }

    setProviderLocalError(null);
    await props.onSaveEmbeddingProvider(
      providerDraft.providerId === newEmbeddingProviderId ? null : providerDraft.providerId,
      parsed.input
    );
  }

  const selectedProvider =
    providerDraft.providerId === newEmbeddingProviderId
      ? null
      : props.embeddingProviders.find((provider) => provider.id === providerDraft.providerId) ??
        null;
  const selectedProviderIndexes = selectedProvider
    ? props.embeddingIndexes.filter((index) => index.providerId === selectedProvider.id)
    : [];

  return (
    <form
      className={styles.settingsWorkspace}
      onSubmit={(event) => void handleSubmit(event)}
      aria-labelledby="settings-title"
    >
      <div className={styles.settingsHeader}>
        <div>
          <p className={styles.kicker}>{t.navigation.items.settings}</p>
          <h2 id="settings-title">{t.settings.pageTitle}</h2>
        </div>
        <button className={styles.primaryButton} disabled={props.isSaving} type="submit">
          {props.isSaving ? t.settings.actions.saving : t.settings.actions.save}
        </button>
      </div>

      <div className={styles.settingsContent}>
        {props.isLoading ? <p className={styles.settingsNotice}>{t.settings.loading}</p> : null}
        {props.error ? <p className={styles.errorText}>{props.error}</p> : null}
        {localError ? <p className={styles.errorText}>{localError}</p> : null}

        <section className={styles.settingsSection} aria-labelledby="settings-language-title">
          <div>
            <h3 id="settings-language-title">{t.settings.sections.language.title}</h3>
            <p>{t.settings.sections.language.body}</p>
          </div>
          <label className={styles.settingsField} htmlFor="settings-locale">
            <span>{t.settings.sections.language.localeLabel}</span>
            <select
              id="settings-locale"
              onChange={(event) =>
                applyDraft({
                  ...draft,
                  locale: event.target.value === "en-US" ? "en-US" : "zh-CN"
                })
              }
              value={draft.locale}
            >
              <option value="zh-CN">{t.settings.sections.language.zhCN}</option>
              <option value="en-US">{t.settings.sections.language.enUS}</option>
            </select>
          </label>
        </section>

        <section className={styles.settingsSection} aria-labelledby="settings-behavior-title">
          <div>
            <h3 id="settings-behavior-title">{t.settings.sections.behavior.title}</h3>
            <p>{t.settings.sections.behavior.body}</p>
            <a
              className={styles.textLink}
              href="#"
              onClick={(event) => {
                event.preventDefault();
                props.onOpenAlgorithmTransparency();
              }}
            >
              {t.settings.sections.behavior.algorithmTransparencyLink}
            </a>
          </div>
          <label className={styles.managementCheckbox} htmlFor="settings-ignore-scrolled">
            <input
              checked={draft.markScrolledArticlesIgnored}
              id="settings-ignore-scrolled"
              onChange={(event) =>
                applyDraft({
                  ...draft,
                  markScrolledArticlesIgnored: event.target.checked
                })
              }
              type="checkbox"
            />
            <span>{t.settings.sections.behavior.markScrolledArticlesIgnored}</span>
          </label>
        </section>

        <section className={styles.settingsSection} aria-labelledby="settings-reader-title">
          <div>
            <h3 id="settings-reader-title">{t.settings.sections.reader.title}</h3>
            <p>{t.settings.sections.reader.body}</p>
          </div>
          <div className={styles.settingsGrid}>
            <NumberSettingField
              id="settings-font-size"
              label={t.settings.sections.reader.fontSize}
              max={24}
              min={16}
              onChange={(value) => applyDraft({ ...draft, fontSize: value })}
              step={1}
              unit={t.settings.units.px}
              value={draft.fontSize}
            />
            <NumberSettingField
              id="settings-line-height"
              label={t.settings.sections.reader.lineHeight}
              max={2.1}
              min={1.45}
              onChange={(value) => applyDraft({ ...draft, lineHeight: value })}
              step={0.05}
              value={draft.lineHeight}
            />
            <NumberSettingField
              id="settings-paragraph-gap"
              label={t.settings.sections.reader.paragraphGap}
              max={1.6}
              min={0.6}
              onChange={(value) => applyDraft({ ...draft, paragraphGap: value })}
              step={0.1}
              value={draft.paragraphGap}
            />
            <NumberSettingField
              id="settings-reader-width"
              label={t.settings.sections.reader.readerWidth}
              max={860}
              min={560}
              onChange={(value) => applyDraft({ ...draft, readerWidth: value })}
              step={40}
              unit={t.settings.units.px}
              value={draft.readerWidth}
            />
          </div>
        </section>

        <section className={styles.settingsSection} aria-labelledby="settings-retention-title">
          <div>
            <h3 id="settings-retention-title">{t.settings.sections.retention.title}</h3>
            <p>{t.settings.sections.retention.body}</p>
          </div>
          <NumberSettingField
            id="settings-retention-days"
            label={t.settings.sections.retention.retentionDays}
            max={3650}
            min={1}
            onChange={(value) => applyDraft({ ...draft, retentionDays: value })}
            step={1}
            unit={t.settings.units.days}
            value={draft.retentionDays}
          />
          <div className={styles.settingsInlineStatus}>
            <span>{t.settings.sections.retention.keepFavorites}</span>
            <strong>
              {props.settings.retention.keepFavorites
                ? t.settings.sections.retention.enabled
                : t.settings.sections.retention.disabled}
            </strong>
          </div>
          <div className={styles.settingsInlineStatus}>
            <span>{t.settings.sections.retention.keepReadLater}</span>
            <strong>
              {props.settings.retention.keepReadLater
                ? t.settings.sections.retention.enabled
                : t.settings.sections.retention.disabled}
            </strong>
          </div>
          <p className={styles.managementHint}>{t.settings.sections.retention.mappingHint}</p>
        </section>

        <section className={styles.settingsSection} aria-labelledby="settings-provider-title">
          <div>
            <h3 id="settings-provider-title">{t.settings.sections.provider.title}</h3>
            <p>{t.settings.sections.provider.body}</p>
          </div>
          {props.isEmbeddingLoading ? (
            <p className={styles.settingsNotice}>{t.settings.sections.provider.loading}</p>
          ) : null}
          {props.embeddingError ? <p className={styles.errorText}>{props.embeddingError}</p> : null}
          {providerLocalError ? <p className={styles.errorText}>{providerLocalError}</p> : null}

          <div className={styles.settingsGrid}>
            <label className={styles.settingsField} htmlFor="settings-provider-select">
              <span>{t.settings.sections.provider.providerLabel}</span>
              <select
                id="settings-provider-select"
                onChange={(event) => {
                  const provider =
                    props.embeddingProviders.find(
                      (candidate) => candidate.id === event.target.value
                    ) ?? null;
                  setProviderDraft(draftForEmbeddingProvider(provider));
                  setProviderLocalError(null);
                }}
                value={providerDraft.providerId}
              >
                <option value={newEmbeddingProviderId}>
                  {t.settings.sections.provider.newProvider}
                </option>
                {props.embeddingProviders.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.settingsField} htmlFor="settings-provider-type">
              <span>{t.settings.sections.provider.typeLabel}</span>
              <select
                id="settings-provider-type"
                onChange={(event) => {
                  const nextType =
                    event.target.value === "ollama" ? "ollama" : "openai_compatible";
                  setProviderDraft(draftWithProviderType(providerDraft, nextType));
                  setProviderLocalError(null);
                }}
                value={providerDraft.type}
              >
                <option value="openai_compatible">
                  {t.settings.sections.provider.openaiCompatible}
                </option>
                <option value="ollama">{t.settings.sections.provider.ollama}</option>
              </select>
            </label>

            <label className={styles.settingsField} htmlFor="settings-provider-name">
              <span>{t.settings.sections.provider.nameLabel}</span>
              <input
                id="settings-provider-name"
                onChange={(event) =>
                  setProviderDraft({ ...providerDraft, name: event.target.value })
                }
                value={providerDraft.name}
              />
            </label>

            <label className={styles.settingsField} htmlFor="settings-provider-base-url">
              <span>{t.settings.sections.provider.baseUrlLabel}</span>
              <input
                id="settings-provider-base-url"
                inputMode="url"
                onChange={(event) =>
                  setProviderDraft({ ...providerDraft, baseUrl: event.target.value })
                }
                placeholder={
                  providerDraft.type === "ollama"
                    ? t.settings.sections.provider.ollamaBaseUrlPlaceholder
                    : t.settings.sections.provider.baseUrlPlaceholder
                }
                type="url"
                value={providerDraft.baseUrl}
              />
            </label>

            <label className={styles.settingsField} htmlFor="settings-provider-model">
              <span>{t.settings.sections.provider.modelLabel}</span>
              <input
                id="settings-provider-model"
                onChange={(event) =>
                  setProviderDraft({ ...providerDraft, model: event.target.value })
                }
                placeholder={
                  providerDraft.type === "ollama"
                    ? t.settings.sections.provider.ollamaModelPlaceholder
                    : t.settings.sections.provider.modelPlaceholder
                }
                value={providerDraft.model}
              />
            </label>

            <NumberSettingField
              id="settings-provider-dimension"
              label={t.settings.sections.provider.dimensionLabel}
              max={20000}
              min={1}
              onChange={(value) => setProviderDraft({ ...providerDraft, dimension: value })}
              step={1}
              value={providerDraft.dimension}
            />

            {providerDraft.type === "openai_compatible" ? (
              <label className={styles.settingsField} htmlFor="settings-provider-api-key">
                <span>{t.settings.sections.provider.apiKeyLabel}</span>
                <input
                  autoComplete="off"
                  id="settings-provider-api-key"
                  onChange={(event) =>
                    setProviderDraft({ ...providerDraft, apiKey: event.target.value })
                  }
                  placeholder={
                    selectedProvider?.hasApiKey
                      ? t.settings.sections.provider.apiKeyRetainPlaceholder
                      : t.settings.sections.provider.apiKeyPlaceholder
                  }
                  type="password"
                  value={providerDraft.apiKey}
                />
              </label>
            ) : (
              <p className={styles.managementHint}>
                {t.settings.sections.provider.ollamaApiKeyHint}
              </p>
            )}

            <label className={styles.settingsField} htmlFor="settings-provider-quality">
              <span>{t.settings.sections.provider.qualityTierLabel}</span>
              <select
                id="settings-provider-quality"
                onChange={(event) =>
                  setProviderDraft({
                    ...providerDraft,
                    qualityTier: event.target.value as EmbeddingProviderDraft["qualityTier"]
                  })
                }
                value={providerDraft.qualityTier}
              >
                <option value="basic">{t.settings.sections.provider.quality.basic}</option>
                <option value="recommended">
                  {t.settings.sections.provider.quality.recommended}
                </option>
                <option value="best_quality">
                  {t.settings.sections.provider.quality.bestQuality}
                </option>
              </select>
            </label>
          </div>

          <p className={styles.managementHint}>{t.settings.sections.provider.modelHint}</p>

          <label className={styles.settingsInlineStatus} htmlFor="settings-provider-enabled">
            <span>{t.settings.sections.provider.enabledLabel}</span>
            <input
              checked={providerDraft.enabled}
              id="settings-provider-enabled"
              onChange={(event) =>
                setProviderDraft({ ...providerDraft, enabled: event.target.checked })
              }
              type="checkbox"
            />
          </label>

          {selectedProvider ? (
            <div className={styles.setupStatusBox}>
              <strong>{t.settings.sections.provider.connectionStatusTitle}</strong>
              <p>
                {selectedProvider.enabled
                  ? t.settings.sections.provider.enabledStatus
                  : t.settings.sections.provider.disabledStatus}
                {" · "}
                {selectedProvider.lastTestStatus === "success"
                  ? t.settings.sections.provider.lastTestSuccess(
                      selectedProvider.lastTestAt ?? t.feedManagement.na
                    )
                  : selectedProvider.lastTestStatus === "failed"
                    ? t.settings.sections.provider.lastTestFailed(
                        selectedProvider.lastTestError ?? t.feedManagement.na
                      )
                    : t.settings.sections.provider.lastTestUnknown}
              </p>
            </div>
          ) : null}

          <div className={styles.managementActions}>
            <button
              className={styles.primaryButton}
              disabled={props.isSavingEmbeddingProvider}
              onClick={() => void handleProviderSubmit()}
              type="button"
            >
              {props.isSavingEmbeddingProvider
                ? t.settings.sections.provider.saving
                : t.settings.sections.provider.save}
            </button>
            <button
              className={styles.secondaryButton}
              disabled={!selectedProvider || props.testingProviderId === selectedProvider.id}
              onClick={() =>
                selectedProvider ? void props.onTestEmbeddingProvider(selectedProvider.id) : undefined
              }
              type="button"
            >
              {selectedProvider && props.testingProviderId === selectedProvider.id
                ? t.settings.sections.provider.testing
                : t.settings.sections.provider.test}
            </button>
            <button
              className={styles.dangerButton}
              disabled={!selectedProvider || props.deletingProviderId === selectedProvider.id}
              onClick={() =>
                selectedProvider
                  ? void props.onDeleteEmbeddingProvider(selectedProvider.id)
                  : undefined
              }
              type="button"
            >
              {selectedProvider && props.deletingProviderId === selectedProvider.id
                ? t.settings.sections.provider.deleting
                : t.settings.sections.provider.delete}
            </button>
          </div>

          <p className={styles.managementHint}>{t.settings.sections.provider.deleteHint}</p>

          <div className={styles.settingsSection} aria-labelledby="settings-indexes-title">
            <div>
              <h3 id="settings-indexes-title">{t.settings.sections.provider.indexesTitle}</h3>
              <p>{t.settings.sections.provider.indexesBody}</p>
            </div>
            {selectedProviderIndexes.length === 0 ? (
              <div className={styles.setupStatusBox}>
                <strong>{t.settings.sections.provider.noIndexes}</strong>
              </div>
            ) : (
              selectedProviderIndexes.map((index) => (
                <div className={styles.settingsIndexStatus} key={index.id}>
                  <div>
                    <strong>
                      {t.settings.sections.provider.indexStatus(
                        index.model,
                        index.status,
                        index.embeddingCount
                      )}
                    </strong>
                    <p>{embeddingCoverageText(index, t)}</p>
                    <p>
                      {t.settings.sections.provider.embeddingJobStatusTitle}:{" "}
                      {t.settings.sections.provider.pendingJobs(index.pendingJobs)}
                      {" · "}
                      {t.settings.sections.provider.failedJobs(index.failedJobs)}
                    </p>
                    {index.lastFailedAt ? (
                      <p>
                        {t.settings.sections.provider.lastFailedAt(
                          formatDate(index.lastFailedAt)
                        )}
                      </p>
                    ) : null}
                    {index.lastError ? (
                      <p>{t.settings.sections.provider.lastError(index.lastError)}</p>
                    ) : index.failedJobs > 0 ? null : (
                      <p>{t.settings.sections.provider.noJobFailures}</p>
                    )}
                  </div>
                  <button
                    className={styles.secondaryButton}
                    disabled={props.rebuildingIndexId === index.id}
                    onClick={() => void props.onRebuildEmbeddingIndex(index.id)}
                    type="button"
                  >
                    {props.rebuildingIndexId === index.id
                      ? t.settings.sections.provider.rebuilding
                      : t.settings.sections.provider.rebuild}
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </form>
  );
}

export function AlgorithmTransparencyPage(props: {
  error: string | null;
  isLoading: boolean;
  onBack: () => void;
  status: RecommendationStatus | null;
}) {
  const { t, formatDate } = useI18n();
  const statusText = props.error
    ? t.recommendationStatus.fallback
    : props.status
      ? t.recommendationStatus.modes[props.status.mode]
      : props.isLoading
        ? t.recommendationStatus.loading
        : t.recommendationStatus.fallback;
  const behaviorEntries = props.status ? Object.entries(props.status.behaviorCounts) : [];

  return (
    <section className={styles.settingsWorkspace} aria-labelledby="algorithm-transparency-title">
      <div className={styles.settingsHeader}>
        <div>
          <p className={styles.kicker}>{t.settings.pageTitle}</p>
          <h2 id="algorithm-transparency-title">{t.algorithmTransparency.pageTitle}</h2>
        </div>
        <button className={styles.secondaryButton} onClick={props.onBack} type="button">
          {t.algorithmTransparency.backToSettings}
        </button>
      </div>

      <div className={styles.settingsContent}>
        {props.isLoading ? (
          <p className={styles.settingsNotice}>{t.recommendationStatus.loading}</p>
        ) : null}
        {props.error ? <p className={styles.errorText}>{props.error}</p> : null}

        <section className={styles.settingsSection}>
          <div>
            <h3>{t.algorithmTransparency.sections.currentStatus}</h3>
            <p>{statusText}</p>
          </div>
          {props.status ? (
            <dl className={styles.managementStatusRows}>
              <div>
                <dt>{t.algorithmTransparency.fields.provider}</dt>
                <dd>
                  {props.status.activeProvider
                    ? `${props.status.activeProvider.name} · ${props.status.activeProvider.model}`
                    : t.settings.sections.provider.disabled}
                </dd>
              </div>
              <div>
                <dt>{t.algorithmTransparency.fields.index}</dt>
                <dd>
                  {props.status.activeIndex
                    ? `${props.status.activeIndex.model} · ${props.status.activeIndex.status}`
                    : t.settings.sections.provider.coverageUnavailable}
                </dd>
              </div>
              <div>
                <dt>{t.algorithmTransparency.fields.coverage}</dt>
                <dd>
                  {t.settings.sections.provider.coverage(
                    props.status.coverage.embeddingCount,
                    props.status.coverage.candidateCount,
                    formatPercent(props.status.coverage.coverageRatio)
                  )}
                </dd>
              </div>
              <div>
                <dt>{t.algorithmTransparency.fields.behaviorCounts}</dt>
                <dd>
                  {behaviorEntries.length > 0
                    ? behaviorEntries.map(([name, count]) => `${name}: ${count}`).join(" · ")
                    : t.recommendationStatus.metrics.unknown}
                </dd>
              </div>
              <div>
                <dt>{t.algorithmTransparency.fields.clusters}</dt>
                <dd>
                  {t.recommendationStatus.metrics.clusters(
                    props.status.clusters.positive,
                    props.status.clusters.negative
                  )}
                </dd>
              </div>
              <div>
                <dt>{t.algorithmTransparency.fields.lastUpdates}</dt>
                <dd>
                  {t.recommendationStatus.metrics.lastUpdate(
                    props.status.lastRankingUpdate
                      ? formatDate(props.status.lastRankingUpdate)
                      : t.recommendationStatus.metrics.unknown,
                    props.status.lastProfileUpdate
                      ? formatDate(props.status.lastProfileUpdate)
                      : t.recommendationStatus.metrics.unknown
                  )}
                </dd>
              </div>
              <div>
                <dt>{t.algorithmTransparency.fields.warnings}</dt>
                <dd>
                  {props.status.warnings.length > 0
                    ? props.status.warnings
                        .map((warning) => `${warning.code}: ${warning.message}`)
                        .join(" · ")
                    : t.algorithmTransparency.noWarnings}
                </dd>
              </div>
            </dl>
          ) : null}
        </section>

        <section className={styles.settingsSection}>
          <div>
            <h3>{t.algorithmTransparency.sections.howItWorks}</h3>
            <p>{t.algorithmTransparency.copy.behavior}</p>
          </div>
          <p>{t.algorithmTransparency.copy.channelRanking}</p>
          <p>{t.algorithmTransparency.copy.localData}</p>
          <p>{t.algorithmTransparency.copy.fallback}</p>
        </section>
      </div>
    </section>
  );
}

function NumberSettingField(props: {
  id: string;
  label: string;
  max: number;
  min: number;
  onChange: (value: string) => void;
  step: number;
  unit?: string;
  value: string;
}) {
  return (
    <label className={styles.settingsField} htmlFor={props.id}>
      <span>{props.label}</span>
      <div className={styles.settingsNumberRow}>
        <input
          id={props.id}
          max={props.max}
          min={props.min}
          onChange={(event) => props.onChange(event.target.value)}
          step={props.step}
          type="number"
          value={props.value}
        />
        {props.unit ? <small>{props.unit}</small> : null}
      </div>
    </label>
  );
}

export function FeedPanel(props: {
  feedError: string | null;
  feedFolders: FeedFolder[];
  feeds: Feed[];
  isOpen: boolean;
  isFeedsLoading: boolean;
  onRefreshFeed: (feed: Feed) => void;
  onCloseSources: () => void;
  onSelectSource: (source: SourceSelection) => void;
  refreshingFeedId: string | null;
  sourceSelection: SourceSelection;
}) {
  const { t, formatDate } = useI18n();
  const feedCountByFolder = useMemo(() => countFeedsByFolder(props.feeds), [props.feeds]);

  return (
    <section
      className={classNames(styles.feedPanel, props.isOpen ? styles.feedPanelOpen : null)}
      data-testid="feed-scroll-container"
      aria-labelledby="feeds-title"
    >
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.kicker}>{t.feeds.kicker}</p>
          <h2 id="feeds-title">{t.feeds.title}</h2>
        </div>
        <div className={styles.panelHeaderActions}>
          <button
            className={styles.mobileSourceCloseButton}
            onClick={props.onCloseSources}
            type="button"
          >
            {t.feeds.closeSources}
          </button>
          <span className={styles.count}>{props.feeds.length}</span>
        </div>
      </div>

      {props.feedError ? <p className={styles.errorText}>{props.feedError}</p> : null}

      <div className={styles.feedList}>
        <button
          className={
            props.sourceSelection.type === "all" ? styles.feedItemActive : styles.feedItem
          }
          onClick={() => props.onSelectSource({ type: "all" })}
          type="button"
        >
          <span>{t.feeds.allFeeds}</span>
          <small>{t.feeds.sourceCount(props.feeds.length)}</small>
        </button>

        {props.isFeedsLoading ? <SkeletonRows count={5} /> : null}

        {!props.isFeedsLoading && props.feedFolders.length > 0 ? (
          <>
            <span className={styles.folderSectionLabel}>{t.folders.title}</span>
            {props.feedFolders.map((folder) => (
              <button
                className={
                  props.sourceSelection.type === "folder" &&
                  props.sourceSelection.folderId === folder.id
                    ? styles.feedItemActive
                    : styles.feedItem
                }
                key={folder.id}
                onClick={() => props.onSelectSource({ type: "folder", folderId: folder.id })}
                type="button"
              >
                <span>{folder.title}</span>
                <small>{t.folders.feedCount(feedCountByFolder.get(folder.id) ?? 0)}</small>
              </button>
            ))}
          </>
        ) : null}

        {!props.isFeedsLoading &&
          props.feeds.map((feed) => (
            <div className={styles.feedRow} key={feed.id}>
              <button
                className={
                  props.sourceSelection.type === "feed" &&
                  props.sourceSelection.feedId === feed.id
                    ? styles.feedItemActive
                    : styles.feedItem
                }
                onClick={() => props.onSelectSource({ type: "feed", feedId: feed.id })}
                type="button"
              >
                <span>{feed.title}</span>
                <small>
                  {feed.lastSuccessAt
                    ? t.feeds.successAt(formatDate(feed.lastSuccessAt))
                    : feed.feedUrl}
                </small>
                <small>
                  {t.feeds.nextRefreshAt(
                    feed.nextRefreshAt ? formatDate(feed.nextRefreshAt) : t.feedManagement.na
                  )}
                </small>
              </button>
              <button
                className={styles.iconButton}
                disabled={props.refreshingFeedId === feed.id}
                onClick={() => props.onRefreshFeed(feed)}
                title={t.feeds.refreshTitle(feed.title)}
                type="button"
              >
                {props.refreshingFeedId === feed.id ? t.feeds.refreshing : t.feeds.refresh}
              </button>
            </div>
          ))}
      </div>
    </section>
  );
}

export function ArticleListPanel(props: {
  articleError: string | null;
  articleView: ArticleView;
  articles: ArticleListItem[];
  favoriteSort: FavoriteArticleSort;
  feedCount: number;
  isIgnoreTelemetryEnabled: boolean;
  isArticlesLoading: boolean;
  isLoadingMore: boolean;
  isRecommendationStatusLoading: boolean;
  loadMoreError: string | null;
  nextCursor: string | null;
  onFavoriteSortChange: (sort: FavoriteArticleSort) => void;
  onIgnoreArticle: (articleId: string) => void;
  onLoadMore: () => void;
  onOpenSources: () => void;
  onSelectArticle: (articleId: string) => void;
  onUnreadOnlyChange: (unreadOnly: boolean) => void;
  recommendationStatus: RecommendationStatus | null;
  recommendationStatusError: string | null;
  selectedArticleId: string | null;
  selectedFeed: Feed | null;
  selectedFolder: FeedFolder | null;
  showRecommendationStatus: boolean;
  showUnreadOnlyFilter: boolean;
  unreadCount: number;
  unreadOnly: boolean;
}) {
  const { t, formatDate } = useI18n();
  const scrollContainerRef = useRef<HTMLElement>(null);
  const sourceTitle =
    props.selectedFeed?.title ?? props.selectedFolder?.title ?? t.articles.allSources;

  useArticleListIgnoreTelemetry({
    articles: props.articles,
    enabled: props.isIgnoreTelemetryEnabled,
    onIgnoreArticle: props.onIgnoreArticle,
    rootRef: scrollContainerRef,
    selectedArticleId: props.selectedArticleId
  });

  return (
    <section
      className={styles.articlePanel}
      data-testid="article-list-scroll-container"
      ref={scrollContainerRef}
      aria-labelledby="articles-title"
    >
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.kicker}>{sourceTitle}</p>
          <h2 id="articles-title">{t.articles.views[props.articleView]}</h2>
        </div>
        <div className={styles.panelHeaderActions}>
          <button
            aria-label={t.feeds.openSourcesLabel}
            className={styles.mobileSourceButton}
            onClick={props.onOpenSources}
            type="button"
          >
            {t.feeds.openSources}
          </button>
          {props.articleView === "favorites" ? (
            <label className={styles.articleSortControl} htmlFor="favorite-article-sort">
              <span>{t.articles.sort.label}</span>
              <select
                id="favorite-article-sort"
                onChange={(event) =>
                  props.onFavoriteSortChange(event.target.value as FavoriteArticleSort)
                }
                value={props.favoriteSort}
              >
                <option value="favorited_desc">{t.articles.sort.favorited_desc}</option>
                <option value="favorited_asc">{t.articles.sort.favorited_asc}</option>
                <option value="published_desc">{t.articles.sort.published_desc}</option>
                <option value="published_asc">{t.articles.sort.published_asc}</option>
              </select>
            </label>
          ) : null}
          {props.showUnreadOnlyFilter ? (
            <label className={styles.unreadOnlyToggle} htmlFor="article-unread-only">
              <input
                checked={props.unreadOnly}
                id="article-unread-only"
                onChange={(event) => props.onUnreadOnlyChange(event.target.checked)}
                type="checkbox"
              />
              <span>{t.articles.unreadOnly}</span>
            </label>
          ) : null}
          <span className={styles.count}>{props.unreadCount}</span>
        </div>
      </div>

      {props.showRecommendationStatus ? (
        <RecommendationStatusBar
          error={props.recommendationStatusError}
          isLoading={props.isRecommendationStatusLoading}
          status={props.recommendationStatus}
        />
      ) : null}

      {props.articleError ? <p className={styles.errorText}>{props.articleError}</p> : null}

      <div className={styles.list} aria-live="polite">
        {props.isArticlesLoading ? <SkeletonRows count={10} /> : null}

        {!props.isArticlesLoading && props.articles.length === 0 ? (
          <EmptyState
            title={
              props.feedCount === 0
                ? t.articles.emptyNoFeedsTitle
                : props.showUnreadOnlyFilter && props.unreadOnly
                  ? t.articles.emptyNoUnreadTitle
                : t.articles.emptyNoArticlesTitle
            }
            body={
              props.feedCount === 0
                ? t.articles.emptyNoFeedsBody
                : props.showUnreadOnlyFilter && props.unreadOnly
                  ? t.articles.emptyNoUnreadBody
                : t.articles.emptyNoArticlesBody
            }
          />
        ) : null}

        {!props.isArticlesLoading &&
          props.articles.map((article) => (
            <button
              className={articleItemClassName(article, props.selectedArticleId)}
              data-article-id={article.id}
              key={article.id}
              onClick={() => props.onSelectArticle(article.id)}
              type="button"
            >
              <span className={styles.meta}>
                {t.articles.itemMeta(
                  formatDate(article.publishedAt ?? article.discoveredAt),
                  article.feedTitle
                )}
              </span>
              <strong>{article.title}</strong>
              {article.summary ? <span className={styles.summary}>{article.summary}</span> : null}
              <ArticleStateBadges state={article.state} />
            </button>
          ))}

        {!props.isArticlesLoading && props.nextCursor ? (
          <div className={styles.loadMoreBar}>
            <button
              className={styles.secondaryButton}
              disabled={props.isLoadingMore}
              onClick={props.onLoadMore}
              type="button"
            >
              {props.isLoadingMore ? t.articles.loadingMore : t.articles.loadMore}
            </button>
          </div>
        ) : null}

        {!props.isArticlesLoading && props.loadMoreError ? (
          <p className={styles.paginationError}>{props.loadMoreError}</p>
        ) : null}
      </div>
    </section>
  );
}

function RecommendationStatusBar(props: {
  error: string | null;
  isLoading: boolean;
  status: RecommendationStatus | null;
}) {
  const { t, formatDate } = useI18n();
  const statusText = props.error
    ? t.recommendationStatus.fallback
    : props.status
      ? t.recommendationStatus.modes[props.status.mode]
      : props.isLoading
        ? t.recommendationStatus.loading
        : t.recommendationStatus.fallback;
  const metrics = props.status ? recommendationStatusMetrics(props.status, t, formatDate) : [];

  return (
    <section className={styles.recommendationStatusBar} aria-live="polite">
      <div>
        <span className={styles.recommendationStatusLabel}>{t.recommendationStatus.title}</span>
        <strong>{statusText}</strong>
      </div>
      {metrics.length > 0 ? (
        <dl className={styles.recommendationStatusMetrics}>
          {metrics.map((metric) => (
            <div key={metric}>
              <dd>{metric}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}

function useArticleListIgnoreTelemetry(props: {
  articles: ArticleListItem[];
  enabled: boolean;
  onIgnoreArticle: (articleId: string) => void;
  rootRef: RefObject<HTMLElement | null>;
  selectedArticleId: string | null;
}) {
  const onIgnoreArticleRef = useRef(props.onIgnoreArticle);
  const selectedArticleIdRef = useRef(props.selectedArticleId);
  const seenVisibleIds = useRef(new Set<string>());
  const sentIds = useRef(new Set<string>());

  useEffect(() => {
    onIgnoreArticleRef.current = props.onIgnoreArticle;
  }, [props.onIgnoreArticle]);

  useEffect(() => {
    selectedArticleIdRef.current = props.selectedArticleId;
  }, [props.selectedArticleId]);

  useEffect(() => {
    const root = props.rootRef.current;
    if (!props.enabled || !root || typeof IntersectionObserver === "undefined") {
      return;
    }

    const visibleCandidates = props.articles.filter(
      (article) => articleInteractionStatusForState(article.state) === "unseen"
    );
    const candidateIds = new Set(visibleCandidates.map((article) => article.id));

    for (const id of Array.from(seenVisibleIds.current)) {
      if (!candidateIds.has(id)) {
        seenVisibleIds.current.delete(id);
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const target = entry.target as HTMLElement;
          const articleId = target.dataset.articleId;
          if (
            !articleId ||
            !candidateIds.has(articleId) ||
            sentIds.current.has(articleId) ||
            selectedArticleIdRef.current === articleId
          ) {
            continue;
          }

          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            seenVisibleIds.current.add(articleId);
            continue;
          }

          const rootTop = entry.rootBounds?.top ?? root.getBoundingClientRect().top;
          const hasScrolledPast = entry.boundingClientRect.bottom <= rootTop;
          if (seenVisibleIds.current.has(articleId) && hasScrolledPast) {
            sentIds.current.add(articleId);
            onIgnoreArticleRef.current(articleId);
          }
        }
      },
      {
        root,
        threshold: [0, 0.6]
      }
    );

    for (const article of visibleCandidates) {
      const element = root.querySelector<HTMLElement>(
        `[data-article-id="${cssEscape(article.id)}"]`
      );
      if (element) {
        observer.observe(element);
      }
    }

    return () => {
      observer.disconnect();
    };
  }, [props.articles, props.enabled, props.rootRef]);
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return value.replace(/["\\]/g, "\\$&");
}

function articleItemClassName(article: ArticleListItem, selectedArticleId: string | null): string {
  if (selectedArticleId === article.id) {
    return styles.articleItemActive;
  }

  const status = articleInteractionStatusForState(article.state);
  return status === "read" || status === "ignored" ? styles.articleItemRead : styles.articleItem;
}

function ArticleDetailPanel(props: {
  actionError: string | null;
  article: ArticleDetail | null;
  detailError: string | null;
  explanation: RankExplanation | null;
  explanationError: string | null;
  isDetailLoading: boolean;
  isExplanationLoading: boolean;
  onArticleAction: (article: ArticleDetail, intent: ArticleActionIntent) => void;
  onBackToList: () => void;
  onReadProgress: (
    articleId: string,
    progress: number,
    metadata: ReadProgressMetadata,
    options?: ReadProgressPostOptions
  ) => void;
  pendingAction: ArticleActionIntent | null;
  readerSettings: ReaderSettings;
}) {
  const { t, formatDate } = useI18n();
  const readerPanelRef = useRef<HTMLElement>(null);
  const safeHtml = useMemo(
    () => (props.article?.contentHtml ? sanitizeArticleHtml(props.article.contentHtml) : null),
    [props.article?.contentHtml]
  );

  useReaderReadProgress({
    article: props.article,
    onReadProgress: props.onReadProgress,
    scrollContainerRef: readerPanelRef
  });

  return (
    <section
      className={styles.readerPanel}
      data-testid="reader-scroll-container"
      ref={readerPanelRef}
      style={readerStyleFor(props.readerSettings)}
      aria-labelledby="reader-title"
    >
      {props.isDetailLoading ? <ReaderSkeleton /> : null}

      {!props.isDetailLoading && props.detailError ? (
        <p className={styles.errorText}>{props.detailError}</p>
      ) : null}

      {!props.isDetailLoading && !props.detailError && !props.article ? (
        <EmptyState title={t.reader.selectArticleTitle} body={t.reader.selectArticleBody} />
      ) : null}

      {!props.isDetailLoading && !props.detailError && props.article ? (
        <article className={styles.reader} data-reader-theme={props.readerSettings.theme}>
          <button
            className={styles.mobileBackButton}
            onClick={props.onBackToList}
            type="button"
          >
            {t.reader.backToList}
          </button>
          <header className={styles.readerHeader}>
            <a href={props.article.url} rel="noreferrer" target="_blank">
              {t.reader.originalLink}
            </a>
            <h2 id="reader-title">{props.article.title}</h2>
            <p>
              {t.reader.meta(
                props.article.feedTitle,
                props.article.publishedAt ? formatDate(props.article.publishedAt) : undefined,
                props.article.author
              )}
            </p>
            {props.article.extractionStatus === "feed_only" ? (
              <span className={styles.inlineNotice}>{t.reader.feedOnlyNotice}</span>
            ) : null}
            <ArticleActionControls
              actionError={props.actionError}
              article={props.article}
              onAction={(intent) => props.onArticleAction(props.article as ArticleDetail, intent)}
              pendingAction={props.pendingAction}
            />
            <RankExplanationPanel
              error={props.explanationError}
              explanation={props.explanation}
              isLoading={props.isExplanationLoading}
            />
          </header>

          {safeHtml ? (
            <div
              className={styles.readerBody}
              dangerouslySetInnerHTML={{ __html: safeHtml }}
            />
          ) : (
            <div className={styles.readerBody}>
              <p>{props.article.contentText ?? props.article.summary ?? t.reader.noContent}</p>
            </div>
          )}
        </article>
      ) : null}
    </section>
  );
}

function ArticleStateBadges(props: { state: ArticleState }) {
  const { t } = useI18n();
  const interactionStatus = articleInteractionStatusForState(props.state);

  return (
    <span className={styles.articleBadges}>
      <span
        className={
          interactionStatus === "unseen" || interactionStatus === "opened"
            ? styles.articleBadge
            : styles.articleBadgeMuted
        }
      >
        {t.articles.state[interactionStatus]}
      </span>
      {props.state.favorited ? (
        <span className={styles.articleBadgeAccent}>{t.articles.state.favorited}</span>
      ) : null}
      {props.state.liked ? (
        <span className={styles.articleBadgeAccent}>{t.articles.state.liked}</span>
      ) : null}
      {props.state.readLater ? (
        <span className={styles.articleBadgeAccent}>{t.articles.state.readLater}</span>
      ) : null}
    </span>
  );
}

export function ArticleActionControls(props: {
  actionError: string | null;
  article: Pick<ArticleDetail, "id" | "state">;
  onAction: (intent: ArticleActionIntent) => void;
  pendingAction: ArticleActionIntent | null;
}) {
  const { t } = useI18n();
  const { state } = props.article;
  const isBusy = props.pendingAction !== null;

  return (
    <div className={styles.readerActions} aria-live="polite">
      <div className={styles.actionButtonRow}>
        <ActionButton
          ariaLabel={state.favorited ? t.actions.aria.unfavorite : t.actions.aria.favorite}
          busy={props.pendingAction === "favorite"}
          disabled={isBusy}
          label={state.favorited ? t.actions.unfavorite : t.actions.favorite}
          onClick={() => props.onAction("favorite")}
          selected={state.favorited}
        />
        <ActionButton
          ariaLabel={state.liked ? t.actions.aria.unlike : t.actions.aria.like}
          busy={props.pendingAction === "like"}
          disabled={isBusy}
          label={state.liked ? t.actions.unlike : t.actions.like}
          onClick={() => props.onAction("like")}
          selected={state.liked}
        />
        <ActionButton
          ariaLabel={
            state.readLater ? t.actions.aria.removeReadLater : t.actions.aria.readLater
          }
          busy={props.pendingAction === "readLater"}
          disabled={isBusy}
          label={state.readLater ? t.actions.removeReadLater : t.actions.readLater}
          onClick={() => props.onAction("readLater")}
          selected={state.readLater}
        />
        <ActionButton
          ariaLabel={
            state.notInterested
              ? t.actions.aria.notInterestedActive
              : t.actions.aria.notInterested
          }
          busy={props.pendingAction === "notInterested"}
          danger
          disabled={isBusy || state.notInterested}
          label={
            state.notInterested ? t.actions.notInterestedActive : t.actions.notInterested
          }
          onClick={() => props.onAction("notInterested")}
          selected={state.notInterested}
        />
      </div>
      {props.actionError ? <p className={styles.actionError}>{props.actionError}</p> : null}
    </div>
  );
}

export function RankExplanationPanel(props: {
  error: string | null;
  explanation: RankExplanation | null;
  isLoading: boolean;
}) {
  const { t, formatDate } = useI18n();

  return (
    <section className={styles.explanationBox} aria-labelledby="rank-explanation-title">
      <div className={styles.explanationHeader}>
        <h3 id="rank-explanation-title">{t.explanation.title}</h3>
        {props.explanation ? (
          <span>{t.explanation.generatedAt(formatDate(props.explanation.generatedAt))}</span>
        ) : null}
      </div>

      {props.isLoading ? <p className={styles.explanationMeta}>{t.explanation.loading}</p> : null}
      {!props.isLoading && props.error ? (
        <p className={styles.explanationError}>{props.error}</p>
      ) : null}
      {!props.isLoading && !props.error && props.explanation ? (
        props.explanation.reasons.length > 0 ? (
          <ul className={styles.explanationList}>
            {props.explanation.reasons.map((reason, index) => (
              <li className={styles.explanationReason} key={`${reason.type}-${index}`}>
                <span className={styles.explanationType}>
                  {t.explanation.types[reason.type]}
                </span>
                <span>{explanationReasonText(reason, t)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.explanationMeta}>{t.explanation.empty}</p>
        )
      ) : null}
    </section>
  );
}

function ActionButton(props: {
  ariaLabel: string;
  busy: boolean;
  danger?: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
  selected: boolean;
}) {
  const { t } = useI18n();
  const className = props.danger
    ? styles.actionButtonDanger
    : props.selected
      ? styles.actionButtonSelected
      : styles.actionButton;

  return (
    <button
      aria-busy={props.busy}
      aria-label={props.ariaLabel}
      aria-pressed={props.selected}
      className={className}
      disabled={props.disabled}
      onClick={props.onClick}
      type="button"
    >
      {props.busy ? t.actions.saving : props.label}
    </button>
  );
}

function EmptyState(props: { title: string; body: string }) {
  return (
    <div className={styles.emptyState}>
      <strong>{props.title}</strong>
      <p>{props.body}</p>
    </div>
  );
}

function SkeletonRows(props: { count: number }) {
  return (
    <div className={styles.skeletonStack} aria-hidden="true">
      {Array.from({ length: props.count }).map((_, index) => (
        <span className={styles.skeletonRow} key={index} />
      ))}
    </div>
  );
}

function ReaderSkeleton() {
  return (
    <div className={styles.readerSkeleton} aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}

const readProgressThresholds = [0.25, 0.5, 0.75, 0.9] as const;
const readProgressMinIntervalMs = 5_000;

type ReadProgressThreshold = (typeof readProgressThresholds)[number];

type ReadProgressSession = {
  activeDurationMs: number;
  activeSince: number | null;
  articleId: string;
  highestReached: ReadProgressThreshold | null;
  lastSentAt: number | null;
  pendingProgress: ReadProgressThreshold | null;
  sentThresholds: Set<ReadProgressThreshold>;
  startedAt: number;
  throttleTimer: number | null;
};

function useReaderReadProgress(props: {
  article: ArticleDetail | null;
  onReadProgress: (
    articleId: string,
    progress: number,
    metadata: ReadProgressMetadata,
    options?: ReadProgressPostOptions
  ) => void;
  scrollContainerRef: RefObject<HTMLElement | null>;
}) {
  const onReadProgressRef = useRef(props.onReadProgress);

  useEffect(() => {
    onReadProgressRef.current = props.onReadProgress;
  }, [props.onReadProgress]);

  useEffect(() => {
    const article = props.article;
    const container = props.scrollContainerRef.current;
    if (!article || !container) {
      return;
    }
    const scrollContainer = container;

    const now = Date.now();
    const session: ReadProgressSession = {
      activeDurationMs: 0,
      activeSince: isReaderTimingActive() ? now : null,
      articleId: article.id,
      highestReached: thresholdForProgress(article.state.readingProgress),
      lastSentAt: null,
      pendingProgress: null,
      sentThresholds: sentThresholdsForProgress(article.state.readingProgress),
      startedAt: now,
      throttleTimer: null
    };

    scrollContainer.scrollTop = 0;

    function handleScroll() {
      updateReadProgressActiveDuration(session);
      const progress = progressForScrollContainer(scrollContainer);
      const threshold = thresholdForProgress(progress);
      if (threshold) {
        session.highestReached = maxThreshold(session.highestReached, threshold);
        queueReadProgress(session, threshold, false, onReadProgressRef.current);
      }
    }

    function handleFocusChange() {
      updateReadProgressActiveDuration(session);
    }

    function handleVisibilityChange() {
      updateReadProgressActiveDuration(session);
      if (document.visibilityState === "hidden") {
        flushReadProgress(session, true, onReadProgressRef.current);
      }
    }

    function handlePageHide() {
      updateReadProgressActiveDuration(session);
      flushReadProgress(session, true, onReadProgressRef.current);
    }

    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("focus", handleFocusChange);
    window.addEventListener("blur", handleFocusChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      scrollContainer.removeEventListener("scroll", handleScroll);
      window.removeEventListener("focus", handleFocusChange);
      window.removeEventListener("blur", handleFocusChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
      updateReadProgressActiveDuration(session);
      flushReadProgress(session, true, onReadProgressRef.current);
      clearReadProgressTimer(session);
    };
  }, [props.article?.id, props.scrollContainerRef]);
}

function progressForScrollContainer(container: HTMLElement): number {
  if (container.scrollHeight <= container.clientHeight) {
    return 1;
  }

  return clampNumber(
    (container.scrollTop + container.clientHeight) / container.scrollHeight,
    0,
    1
  );
}

function sentThresholdsForProgress(progress: number): Set<ReadProgressThreshold> {
  return new Set(readProgressThresholds.filter((threshold) => progress >= threshold));
}

function thresholdForProgress(progress: number): ReadProgressThreshold | null {
  let matched: ReadProgressThreshold | null = null;
  for (const threshold of readProgressThresholds) {
    if (progress >= threshold) {
      matched = threshold;
    }
  }
  return matched;
}

function maxThreshold(
  left: ReadProgressThreshold | null,
  right: ReadProgressThreshold
): ReadProgressThreshold {
  return left === null || right > left ? right : left;
}

function queueReadProgress(
  session: ReadProgressSession,
  progress: ReadProgressThreshold,
  keepalive: boolean,
  onReadProgress: (
    articleId: string,
    progress: number,
    metadata: ReadProgressMetadata,
    options?: ReadProgressPostOptions
  ) => void
): void {
  if (session.sentThresholds.has(progress)) {
    return;
  }

  const now = Date.now();
  if (
    session.lastSentAt !== null &&
    now - session.lastSentAt < readProgressMinIntervalMs &&
    !keepalive
  ) {
    session.pendingProgress = maxThreshold(session.pendingProgress, progress);
    schedulePendingReadProgress(session, onReadProgress);
    return;
  }

  sendReadProgress(session, progress, keepalive, onReadProgress);
}

function schedulePendingReadProgress(
  session: ReadProgressSession,
  onReadProgress: (
    articleId: string,
    progress: number,
    metadata: ReadProgressMetadata,
    options?: ReadProgressPostOptions
  ) => void
): void {
  if (session.throttleTimer || session.lastSentAt === null) {
    return;
  }

  const remaining = Math.max(0, readProgressMinIntervalMs - (Date.now() - session.lastSentAt));
  session.throttleTimer = window.setTimeout(() => {
    session.throttleTimer = null;
    const pending = session.pendingProgress;
    if (pending) {
      sendReadProgress(session, pending, false, onReadProgress);
    }
  }, remaining);
}

function flushReadProgress(
  session: ReadProgressSession,
  keepalive: boolean,
  onReadProgress: (
    articleId: string,
    progress: number,
    metadata: ReadProgressMetadata,
    options?: ReadProgressPostOptions
  ) => void
): void {
  const progress =
    session.pendingProgress ??
    session.highestReached ??
    thresholdForProgress(session.sentThresholds.size > 0 ? Math.max(...session.sentThresholds) : 0);

  if (progress && !session.sentThresholds.has(progress)) {
    sendReadProgress(session, progress, keepalive, onReadProgress);
  }
}

function sendReadProgress(
  session: ReadProgressSession,
  progress: ReadProgressThreshold,
  keepalive: boolean,
  onReadProgress: (
    articleId: string,
    progress: number,
    metadata: ReadProgressMetadata,
    options?: ReadProgressPostOptions
  ) => void
): void {
  const now = Date.now();
  updateReadProgressActiveDuration(session, now);
  session.lastSentAt = now;
  session.pendingProgress = null;
  markSentThresholds(session, progress);
  onReadProgress(session.articleId, progress, readProgressMetadata(session, now), {
    keepalive
  });
}

function markSentThresholds(session: ReadProgressSession, progress: ReadProgressThreshold): void {
  for (const threshold of readProgressThresholds) {
    if (threshold <= progress) {
      session.sentThresholds.add(threshold);
    }
  }
}

function readProgressMetadata(session: ReadProgressSession, now: number): ReadProgressMetadata {
  return {
    durationMs: Math.max(0, now - session.startedAt),
    activeDurationMs: Math.max(0, activeDurationFor(session, now)),
    scrollSource: "reader"
  };
}

function activeDurationFor(session: ReadProgressSession, now: number): number {
  return session.activeDurationMs + (session.activeSince === null ? 0 : now - session.activeSince);
}

function updateReadProgressActiveDuration(
  session: ReadProgressSession,
  now = Date.now()
): void {
  const isActive = isReaderTimingActive();

  if (session.activeSince !== null && !isActive) {
    session.activeDurationMs += now - session.activeSince;
    session.activeSince = null;
    return;
  }

  if (session.activeSince === null && isActive) {
    session.activeSince = now;
  }
}

function isReaderTimingActive(): boolean {
  return (
    typeof document !== "undefined" &&
    document.visibilityState === "visible" &&
    (typeof document.hasFocus !== "function" || document.hasFocus())
  );
}

function clearReadProgressTimer(session: ReadProgressSession): void {
  if (session.throttleTimer) {
    window.clearTimeout(session.throttleTimer);
    session.throttleTimer = null;
  }
}

function draftForSettings(settings: AppSettings): SettingsDraft {
  return {
    locale: settings.ui.locale,
    markScrolledArticlesIgnored: settings.behavior.markScrolledArticlesIgnored,
    fontSize: String(settings.reader.fontSize),
    lineHeight: String(settings.reader.lineHeight),
    paragraphGap: String(settings.reader.paragraphGap),
    readerWidth: String(settings.reader.readerWidth),
    retentionDays: String(settings.retention.retentionDays)
  };
}

function draftForEmbeddingProvider(provider: EmbeddingProvider | null): EmbeddingProviderDraft {
  const supportedType = supportedProviderType(provider?.type);
  const defaults = defaultEmbeddingProviderDraft(supportedType);
  return {
    providerId: provider?.id ?? newEmbeddingProviderId,
    type: supportedType,
    name: provider?.name ?? defaults.name,
    baseUrl: provider?.baseUrl ?? defaults.baseUrl,
    model: provider?.model ?? defaults.model,
    dimension: String(provider?.dimension ?? defaults.dimension),
    apiKey: "",
    enabled: provider?.enabled ?? false,
    qualityTier: provider?.qualityTier ?? "recommended"
  };
}

function draftWithProviderType(
  draft: EmbeddingProviderDraft,
  type: SupportedEmbeddingProviderType
): EmbeddingProviderDraft {
  const defaults = defaultEmbeddingProviderDraft(type);
  const previousDefaults = defaultEmbeddingProviderDraft(draft.type);

  return {
    ...draft,
    type,
    name:
      draft.name === previousDefaults.name || draft.name.trim() === ""
        ? defaults.name
        : draft.name,
    baseUrl:
      draft.baseUrl === previousDefaults.baseUrl || draft.baseUrl.trim() === ""
        ? defaults.baseUrl
        : draft.baseUrl,
    model:
      draft.model === previousDefaults.model || draft.model.trim() === ""
        ? defaults.model
        : draft.model,
    dimension:
      draft.dimension === String(previousDefaults.dimension) || draft.dimension.trim() === ""
        ? String(defaults.dimension)
        : draft.dimension,
    apiKey: type === "ollama" ? "" : draft.apiKey
  };
}

function defaultEmbeddingProviderDraft(type: SupportedEmbeddingProviderType) {
  if (type === "ollama") {
    return {
      name: "Ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "nomic-embed-text",
      dimension: 768
    };
  }

  return {
    name: "OpenAI Compatible",
    baseUrl: "",
    model: "text-embedding-3-small",
    dimension: 1536
  };
}

function supportedProviderType(
  type: EmbeddingProviderType | undefined
): SupportedEmbeddingProviderType {
  return type === "ollama" ? "ollama" : "openai_compatible";
}

function parseSettingsDraft(
  draft: SettingsDraft,
  current: AppSettings,
  t: Dictionary
):
  | { ok: true; input: UpdateSettingsInput; settings: AppSettings }
  | { ok: false; error: string } {
  const fontSize = parseNumberDraft(draft.fontSize, 16, 24, true);
  if (fontSize === null) {
    return { ok: false, error: t.settings.errors.fontSize };
  }

  const lineHeight = parseNumberDraft(draft.lineHeight, 1.45, 2.1);
  if (lineHeight === null) {
    return { ok: false, error: t.settings.errors.lineHeight };
  }

  const paragraphGap = parseNumberDraft(draft.paragraphGap, 0.6, 1.6);
  if (paragraphGap === null) {
    return { ok: false, error: t.settings.errors.paragraphGap };
  }

  const readerWidth = parseNumberDraft(draft.readerWidth, 560, 860, true);
  if (readerWidth === null) {
    return { ok: false, error: t.settings.errors.readerWidth };
  }

  const retentionDays = parseNumberDraft(draft.retentionDays, 1, 3650, true);
  if (retentionDays === null) {
    return { ok: false, error: t.settings.errors.retentionDays };
  }

  const settings: AppSettings = {
    ...current,
    ui: {
      locale: draft.locale
    },
    reader: {
      ...current.reader,
      fontSize,
      lineHeight,
      paragraphGap,
      readerWidth
    },
    behavior: {
      ...current.behavior,
      markScrolledArticlesIgnored: draft.markScrolledArticlesIgnored
    },
    retention: {
      ...current.retention,
      retentionDays
    }
  };

  return {
    ok: true,
    settings,
    input: {
      ui: {
        locale: draft.locale
      },
      reader: {
        fontSize,
        lineHeight,
        paragraphGap,
        readerWidth
      },
      behavior: {
        markScrolledArticlesIgnored: draft.markScrolledArticlesIgnored
      },
      retention: {
        retentionDays
      }
    }
  };
}

function parseEmbeddingProviderDraft(
  draft: EmbeddingProviderDraft,
  t: Dictionary
):
  | { ok: true; input: CreateEmbeddingProviderInput | UpdateEmbeddingProviderInput }
  | { ok: false; error: string } {
  const name = draft.name.trim();
  if (!name) {
    return { ok: false, error: t.settings.sections.provider.errors.nameRequired };
  }

  const baseUrl = draft.baseUrl.trim();
  if (!baseUrl) {
    return { ok: false, error: t.settings.sections.provider.errors.baseUrlRequired };
  }

  const model = draft.model.trim();
  if (!model) {
    return { ok: false, error: t.settings.sections.provider.errors.modelRequired };
  }

  const dimension = parseNumberDraft(draft.dimension, 1, 20000, true);
  if (dimension === null) {
    return { ok: false, error: t.settings.sections.provider.errors.dimension };
  }

  return {
    ok: true,
    input: {
      type: draft.type,
      name,
      baseUrl,
      model,
      dimension,
      enabled: draft.enabled,
      qualityTier: draft.qualityTier,
      ...(draft.type === "openai_compatible" && draft.apiKey.trim()
        ? { apiKey: draft.apiKey.trim() }
        : {})
    }
  };
}

function parseNumberDraft(
  value: string,
  min: number,
  max: number,
  integer = false
): number | null {
  if (value.trim() === "") {
    return null;
  }

  const parsed = Number(value);
  if (
    !Number.isFinite(parsed) ||
    parsed < min ||
    parsed > max ||
    (integer && !Number.isInteger(parsed))
  ) {
    return null;
  }

  return parsed;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

type ReaderStyle = CSSProperties & {
  "--reader-font-size": string;
  "--reader-line-height": string;
  "--reader-paragraph-gap": string;
  "--reader-width": string;
};

export function readerStyleFor(settings: ReaderSettings): ReaderStyle {
  return {
    "--reader-font-size": `${settings.fontSize}px`,
    "--reader-line-height": String(settings.lineHeight),
    "--reader-paragraph-gap": `${settings.paragraphGap}em`,
    "--reader-width": `${settings.readerWidth}px`
  };
}

function articleQueryFor(source: SourceSelection): { feedId?: string; folderId?: string } {
  if (source.type === "feed") {
    return { feedId: source.feedId };
  }

  if (source.type === "folder") {
    return { folderId: source.folderId };
  }

  return {};
}

function supportsUnreadOnly(view: ArticleView): boolean {
  return view === "latest" || view === "recommended";
}

function isMobileArticleHistoryEnabled(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 767px)").matches
  );
}

function classNames(...values: Array<string | null | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

function rememberArticleStates(
  articles: Pick<ArticleListItem, "id" | "state">[],
  target: Map<string, ArticleState>
): void {
  for (const article of articles) {
    target.set(article.id, article.state);
  }
}

function sameSourceSelection(left: SourceSelection, right: SourceSelection): boolean {
  if (left.type !== right.type) {
    return false;
  }

  if (left.type === "feed" && right.type === "feed") {
    return left.feedId === right.feedId;
  }

  if (left.type === "folder" && right.type === "folder") {
    return left.folderId === right.folderId;
  }

  return true;
}

function appendUniqueArticles(
  current: ArticleListItem[],
  next: ArticleListItem[]
): ArticleListItem[] {
  const seen = new Set(current.map((article) => article.id));
  return [
    ...current,
    ...next.filter((article) => {
      if (seen.has(article.id)) {
        return false;
      }
      seen.add(article.id);
      return true;
    })
  ];
}

function countFeedsByFolder(feeds: Feed[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const feed of feeds) {
    if (feed.folderId) {
      counts.set(feed.folderId, (counts.get(feed.folderId) ?? 0) + 1);
    }
  }

  return counts;
}

export function pageForNavigationItem(item: NavigationItemKey): AppPage | null {
  if (
    item === "latest" ||
    item === "recommended" ||
    item === "favorites" ||
    item === "read_later"
  ) {
    return { type: "reader", view: item };
  }

  if (item === "feeds") {
    return { type: "feed-management" };
  }

  if (item === "settings") {
    return { type: "settings" };
  }

  return null;
}

function isNavigationItemActive(item: NavigationItemKey, page: AppPage): boolean {
  if (page.type === "reader") {
    return item === page.view;
  }

  if (page.type === "feed-management") {
    return item === "feeds";
  }

  if (page.type === "algorithm-transparency") {
    return item === "settings";
  }

  return item === "settings";
}

function noticeTextFor(notice: Notice, t: Dictionary): string {
  switch (notice.type) {
    case "feedAddedAndRefreshed":
      return t.notices.feedAddedAndRefreshed(notice.feedTitle);
    case "feedRefreshed":
      return t.notices.feedRefreshed(notice.feedTitle);
    case "allFeedsRefreshQueued":
      return t.notices.allFeedsRefreshQueued(notice.jobCount);
    case "opmlImported":
      return t.notices.opmlImported(
        notice.result.feedsCreated,
        notice.result.feedsSkipped,
        notice.result.foldersCreated
      );
    case "opmlExported":
      return t.notices.opmlExported;
    case "settingsSaved":
      return t.settings.notices.saved;
    case "embeddingProviderSaved":
      return t.settings.sections.provider.notices.saved;
    case "embeddingProviderTested":
      return t.settings.sections.provider.notices.tested;
    case "embeddingProviderDeleted":
      return t.settings.sections.provider.notices.deleted;
    case "embeddingIndexRebuildQueued":
      return t.settings.sections.provider.notices.rebuildQueued;
  }
}

function recommendationStatusMetrics(
  status: RecommendationStatus,
  t: Dictionary,
  formatDate: (value: string | Date) => string
): string[] {
  const behaviorCount = Object.values(status.behaviorCounts).reduce((sum, count) => sum + count, 0);
  const coverageRatio =
    typeof status.coverage.coverageRatio === "number"
      ? formatPercent(status.coverage.coverageRatio)
      : t.recommendationStatus.metrics.unknown;
  const lastRanking = status.lastRankingUpdate
    ? formatDate(status.lastRankingUpdate)
    : t.recommendationStatus.metrics.unknown;
  const lastProfile = status.lastProfileUpdate
    ? formatDate(status.lastProfileUpdate)
    : t.recommendationStatus.metrics.unknown;

  return [
    t.recommendationStatus.metrics.behaviorCount(behaviorCount),
    t.recommendationStatus.metrics.coverage(coverageRatio),
    t.recommendationStatus.metrics.clusters(status.clusters.positive, status.clusters.negative),
    t.recommendationStatus.metrics.lastUpdate(lastRanking, lastProfile)
  ];
}

function embeddingCoverageText(index: EmbeddingIndex, t: Dictionary): string {
  if (
    typeof index.candidateCount !== "number" ||
    typeof index.coverageRatio !== "number"
  ) {
    return t.settings.sections.provider.coverageUnavailable;
  }

  return t.settings.sections.provider.coverage(
    index.embeddingCount,
    index.candidateCount,
    formatPercent(index.coverageRatio)
  );
}

function formatPercent(value: number): string {
  return `${Math.round(clampNumber(value, 0, 1) * 100)}%`;
}

function downloadTextFile(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function requestForArticleAction(
  intent: ArticleActionIntent,
  state: ArticleState
): ArticleActionRequest {
  switch (intent) {
    case "favorite":
      return {
        type: "favorite",
        value: !state.favorited
      };
    case "like":
      return {
        type: "like",
        value: !state.liked
      };
    case "readLater":
      return {
        type: "read_later",
        value: !state.readLater
      };
    case "notInterested":
      return {
        type: "not_interested",
        value: true
      };
  }
}

function actionErrorMessageFor(intent: ArticleActionIntent, t: Dictionary) {
  switch (intent) {
    case "favorite":
      return t.actions.errors.favorite;
    case "like":
      return t.actions.errors.like;
    case "readLater":
      return t.actions.errors.readLater;
    case "notInterested":
      return t.actions.errors.notInterested;
  }
}

function explanationReasonText(reason: RankExplanationReason, t: Dictionary): string {
  switch (reason.type) {
    case "interest":
      return t.explanation.reasons.interest;
    case "source":
      return reason.impact === "negative"
        ? t.explanation.reasons.sourceNegative(reason.label)
        : t.explanation.reasons.sourcePositive(reason.label);
    case "freshness":
      return t.explanation.reasons.freshness;
    case "state":
      return reason.impact === "negative"
        ? t.explanation.reasons.stateNegative
        : t.explanation.reasons.statePositive;
    case "fallback":
      return t.explanation.reasons.fallback;
    case "negative":
      return t.explanation.reasons.negative;
    case "penalty":
      return t.explanation.reasons.penalty;
  }
}

function sanitizeArticleHtml(html: string): string {
  const parser = new DOMParser();
  const document = parser.parseFromString(`<main>${html}</main>`, "text/html");
  const allowedTags = new Set([
    "A",
    "B",
    "BLOCKQUOTE",
    "BR",
    "CODE",
    "EM",
    "H2",
    "H3",
    "H4",
    "I",
    "LI",
    "OL",
    "P",
    "PRE",
    "STRONG",
    "UL"
  ]);

  function clean(node: Node): Node | null {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.cloneNode();
    }

    if (!(node instanceof Element)) {
      return null;
    }

    if (!allowedTags.has(node.tagName)) {
      const fragment = document.createDocumentFragment();
      for (const child of Array.from(node.childNodes)) {
        const cleaned = clean(child);
        if (cleaned) {
          fragment.appendChild(cleaned);
        }
      }
      return fragment;
    }

    const element = document.createElement(node.tagName.toLowerCase());
    if (node.tagName === "A") {
      const href = node.getAttribute("href");
      if (href && /^(https?:|mailto:)/i.test(href)) {
        element.setAttribute("href", href);
        element.setAttribute("rel", "noreferrer");
        element.setAttribute("target", "_blank");
      }
    }

    for (const child of Array.from(node.childNodes)) {
      const cleaned = clean(child);
      if (cleaned) {
        element.appendChild(cleaned);
      }
    }

    return element;
  }

  const output = document.createElement("main");
  for (const child of Array.from(document.body.firstElementChild?.childNodes ?? [])) {
    const cleaned = clean(child);
    if (cleaned) {
      output.appendChild(cleaned);
    }
  }

  return output.innerHTML;
}
