import type { ChangeEvent, CSSProperties, FormEvent, MouseEvent, RefObject } from "react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dibaoVersion } from "@dibao/shared";
import {
  defaultAppSettings,
  dibaoApi,
  userMessageForError,
  type ArticleActionRequest,
  type ArticleDetail,
  type ArticleListItem,
  type ArticleSearchSort,
  type ArticleSearchState,
  type ArticleState,
  type ArticleTimeWindow,
  type ArticleView,
  type AppSettings,
  type AuthSession,
  type CreateEmbeddingProviderInput,
  type DerivedDataUpgradeStatus,
  type EmbeddingIndex,
  type EmbeddingProvider,
  type EmbeddingProviderType,
  type FavoriteArticleSort,
  type Feed,
  type FeedDiagnosticItem,
  type FeedDiagnosticsResponse,
  type FeedDiscoveryCandidate,
  type FeedDiscoveryResponse,
  type FeedFolder,
  type FullContentBackfillResponse,
  type FullContentPreviewResponse,
  type JobListItem,
  type LatestReleaseStatus,
  type OpmlImportResponse,
  type PluginListItem,
  type RankExplanation,
  type RankExplanationReason,
  type ReadLaterArticleSort,
  type ReaderSettings,
  type RecommendationStatus,
  type RecommendationClusterItem,
  type RecommendationClusterMergeCandidate,
  type RecommendationFamilySummaryItem,
  type RecommendationTransparency,
  type RecommendationMaintenanceTask,
  type RecommendationMaintenanceTaskResponse,
  type ClusterLabelLexiconResponse,
  type ClusterLabelLexiconOverrides,
  type ReaderCommandScope,
  type SetupStatus,
  type UpdateFeedFolderInput,
  type UpdateFeedInput,
  type UpdateEmbeddingProviderInput,
  type UpdateSettingsInput
} from "./api.js";
import {
  articleInteractionStatusForState,
  articleListAfterStateUpdate,
  articleListWithKnownLocalStates,
  articlesVisibleForUnreadFilter,
  unreadCountWithKnownLocalStates,
  unreadCountAfterStateChange
} from "./articleListState.js";
import styles from "./design-system/AppShell/AppShell.module.css";
import { FeedManagementWorkspace } from "./FeedManagementPanel.js";
import {
  browserPreferredLocale,
  useI18n,
  type Dictionary,
  type Locale,
  type NavigationItemKey
} from "./i18n.js";
import {
  configureClientTelemetry,
  readStoredTelemetryPreference,
  storeTelemetryPreference
} from "./telemetry.js";
import { PwaStatusBanner, SetupWelcomePanel, AuthGatePanel, DerivedDataUpgradePanel, SetupSourcesPanel, SetupOptionalPluginsPanel } from "./setup/SetupPanels.js";
import { FeedPanel, ArticleListPanel, SearchResultsPanel, ArticleDetailPanel, ArticleExplanationDialog, NavigationIcon, ActionIcon, type PluginActionButton, type PluginActionContext } from "./reader/ReaderPanels.js";
import {
  actionErrorMessageFor,
  appendUniqueArticles,
  articleQueryFor,
  articleSortForView,
  canLoadRankExplanation,
  classNames,
  correctSourceSelection,
  countFeedsByFolder,
  defaultFavoriteArticleSort,
  defaultReadLaterArticleSort,
  defaultSearchForm,
  downloadTextFile,
  isNavigationItemActive,
  isUtilityNavigationActive,
  maintenanceResultWasExisting,
  navigationItems,
  noticeTextFor,
  optimisticOpenedState,
  optimisticReadProgressState,
  optimisticStateForArticleAction,
  pageForNavigationItem,
  persistReaderFilters,
  readPersistedReaderFilters,
  readerFiltersForView,
  rememberArticleStates,
  requestForArticleAction,
  routeFromLocation,
  sameAppPage,
  sameSourceSelection,
  searchFormFromLocation,
  shouldLetBrowserHandleLinkClick,
  shouldLoadDetailRankExplanation,
  stageForAuthSession,
  stageForSetupStatus,
  supportsQuickFilters,
  supportsUnreadOnly,
  urlFavoriteSortParam,
  urlForAppPage,
  urlForArticle,
  urlForSearchPage,
  urlReadLaterSortParam,
  utilityNavigationItems,
  type AppPage,
  type AppStage,
  type ArticleActionIntent,
  type ArticleActionTarget,
  type AuthMode,
  type FeedDiagnosticsByFeedId,
  type Notice,
  type PendingArticleAction,
  type PwaUpdateAvailableEvent,
  type ReadProgressMetadata,
  type ReadProgressPostOptions,
  type SearchFormState,
  type SourceSelection
} from "./app/shared.js";

const LazySetupProviderPanel = lazy(() =>
  import("./setup/SetupProviderPanel.js").then((module) => ({ default: module.SetupProviderPanel }))
);
const LazyFullContentPreviewPage = lazy(() =>
  import("./fullContent/FullContentPreviewPage.js").then((module) => ({ default: module.FullContentPreviewPage }))
);
const LazySettingsWorkspace = lazy(() =>
  import("./settings/SettingsWorkspace.js").then((module) => ({ default: module.SettingsWorkspace }))
);
const LazyAlgorithmTransparencyPage = lazy(() =>
  import("./algorithm/AlgorithmPages.js").then((module) => ({ default: module.AlgorithmTransparencyPage }))
);
const LazyAlgorithmClustersPage = lazy(() =>
  import("./algorithm/AlgorithmPages.js").then((module) => ({ default: module.AlgorithmClustersPage }))
);

export function App() {
  const { t, setLocale } = useI18n();
  const initialRoute = useMemo(
    () => routeFromLocation(defaultAppSettings.ui.defaultHomeView),
    []
  );
  const initialReaderFilters = useMemo(
    () =>
      readerFiltersForView(
        initialRoute.page.type === "reader"
          ? initialRoute.page.view
          : defaultAppSettings.ui.defaultHomeView
      ),
    [initialRoute.page]
  );
  const initialSearchForm = useMemo(() => searchFormFromLocation(), []);
  const [appStage, setAppStage] = useState<AppStage>({ type: "auth-loading" });
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [setupSourceError, setSetupSourceError] = useState<string | null>(null);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [derivedDataUpgrade, setDerivedDataUpgrade] =
    useState<DerivedDataUpgradeStatus | null>(null);
  const [derivedDataUpgradeError, setDerivedDataUpgradeError] = useState<string | null>(null);
  const [isRetryingDerivedDataUpgrade, setIsRetryingDerivedDataUpgrade] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings>(defaultAppSettings);
  const [telemetryEnabled, setTelemetryEnabled] = useState(() =>
    readStoredTelemetryPreference()
  );
  const [isSettingsLoading, setIsSettingsLoading] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [pluginContributions, setPluginContributions] = useState<PluginListItem[]>([]);
  const [pluginError, setPluginError] = useState<string | null>(null);
  const [optionalPluginDecisionId, setOptionalPluginDecisionId] = useState<string | null>(null);
  const [embeddingProviders, setEmbeddingProviders] = useState<EmbeddingProvider[]>([]);
  const [embeddingIndexes, setEmbeddingIndexes] = useState<EmbeddingIndex[]>([]);
  const [isEmbeddingLoading, setIsEmbeddingLoading] = useState(false);
  const [isSavingEmbeddingProvider, setIsSavingEmbeddingProvider] = useState(false);
  const [activatingProviderId, setActivatingProviderId] = useState<string | null>(null);
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null);
  const [deletingProviderId, setDeletingProviderId] = useState<string | null>(null);
  const [rebuildingIndexId, setRebuildingIndexId] = useState<string | null>(null);
  const [backfillingIndexId, setBackfillingIndexId] = useState<string | null>(null);
  const [embeddingError, setEmbeddingError] = useState<string | null>(null);
  const [feedFolders, setFeedFolders] = useState<FeedFolder[]>([]);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [articles, setArticles] = useState<ArticleListItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [sourceSelection, setSourceSelection] = useState<SourceSelection>(
    initialReaderFilters.sourceSelection
  );
  const [appPage, setAppPage] = useState<AppPage>(initialRoute.page);
  const [unreadOnly, setUnreadOnly] = useState(initialReaderFilters.unreadOnly);
  const [timeWindow, setTimeWindow] = useState<ArticleTimeWindow>(
    initialReaderFilters.timeWindow
  );
  const [searchForm, setSearchForm] = useState<SearchFormState>(initialSearchForm);
  const [hasSubmittedSearch, setHasSubmittedSearch] = useState(
    () => initialRoute.page.type === "search" && initialSearchForm.q.trim().length > 0
  );
  const [submittedSearchForm, setSubmittedSearchForm] = useState<SearchFormState>(
    initialSearchForm
  );
  const [favoriteSort, setFavoriteSort] = useState<FavoriteArticleSort>(
    () => urlFavoriteSortParam() ?? defaultFavoriteArticleSort
  );
  const [readLaterSort, setReadLaterSort] = useState<ReadLaterArticleSort>(
    () => urlReadLaterSortParam() ?? defaultReadLaterArticleSort
  );
  const [isUtilityMenuOpen, setIsUtilityMenuOpen] = useState(false);
  const [isSourceDrawerOpen, setIsSourceDrawerOpen] = useState(false);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(
    initialRoute.articleId
  );
  const [articleDetail, setArticleDetail] = useState<ArticleDetail | null>(null);
  const [rankExplanation, setRankExplanation] = useState<RankExplanation | null>(null);
  const [listRankExplanation, setListRankExplanation] = useState<RankExplanation | null>(null);
  const [isExplanationOpen, setIsExplanationOpen] = useState(false);
  const [isListExplanationOpen, setIsListExplanationOpen] = useState(false);
  const [recommendationStatus, setRecommendationStatus] = useState<RecommendationStatus | null>(
    null
  );
  const [allRecommendationClusters, setAllRecommendationClusters] = useState<
    RecommendationClusterItem[]
  >([]);
  const [allRecommendationClusterTotal, setAllRecommendationClusterTotal] = useState(0);
  const [isAllClustersLoading, setIsAllClustersLoading] = useState(false);
  const [allClustersError, setAllClustersError] = useState<string | null>(null);
  const [clusterLabelLexicon, setClusterLabelLexicon] =
    useState<ClusterLabelLexiconResponse | null>(null);
  const [mergeCandidates, setMergeCandidates] = useState<RecommendationClusterMergeCandidate[]>(
    []
  );
  const [runningMaintenanceTask, setRunningMaintenanceTask] =
    useState<RecommendationMaintenanceTask | null>(null);
  const [updatingClusterLabelId, setUpdatingClusterLabelId] = useState<string | null>(null);
  const [updatingFamilyLabelId, setUpdatingFamilyLabelId] = useState<string | null>(null);
  const [updatingClusterLexicon, setUpdatingClusterLexicon] = useState(false);
  const [updatingMergeCandidateId, setUpdatingMergeCandidateId] = useState<string | null>(null);
  const [isRecommendationStatusLoading, setIsRecommendationStatusLoading] = useState(false);
  const [recommendationStatusError, setRecommendationStatusError] = useState<string | null>(null);
  const [feedUrl, setFeedUrl] = useState("");
  const [feedDiscovery, setFeedDiscovery] = useState<FeedDiscoveryResponse | null>(null);
  const [feedDiscoveryError, setFeedDiscoveryError] = useState<string | null>(null);
  const [isDiscoveringFeeds, setIsDiscoveringFeeds] = useState(false);
  const [feedDiagnostics, setFeedDiagnostics] = useState<FeedDiagnosticsResponse | null>(null);
  const [isFeedDiagnosticsLoading, setIsFeedDiagnosticsLoading] = useState(false);
  const [isFeedsLoading, setIsFeedsLoading] = useState(true);
  const [isArticlesLoading, setIsArticlesLoading] = useState(true);
  const [isLoadingMoreArticles, setIsLoadingMoreArticles] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isExplanationLoading, setIsExplanationLoading] = useState(false);
  const [isListExplanationLoading, setIsListExplanationLoading] = useState(false);
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
  const [listExplanationError, setListExplanationError] = useState<string | null>(null);
  const [articleActionError, setArticleActionError] = useState<string | null>(null);
  const [readerCommandError, setReaderCommandError] = useState<string | null>(null);
  const [isMarkingScopeRead, setIsMarkingScopeRead] = useState(false);
  const [opmlSummary, setOpmlSummary] = useState<OpmlImportResponse | null>(null);
  const [nextArticleCursor, setNextArticleCursor] = useState<string | null>(null);
  const [pendingArticleAction, setPendingArticleAction] = useState<PendingArticleAction | null>(
    null
  );
  const [notice, setNotice] = useState<Notice | null>(null);
  const [isOffline, setIsOffline] = useState(
    () => typeof navigator !== "undefined" && navigator.onLine === false
  );
  const [pwaUpdateApply, setPwaUpdateApply] = useState<(() => void) | null>(null);
  const openedArticleIds = useRef(new Set<string>());
  const ignoredArticleIds = useRef(new Set<string>());
  const ignoredArticleQueue = useRef<string[]>([]);
  const isSendingIgnoredArticle = useRef(false);
  const selectedArticleIdRef = useRef<string | null>(selectedArticleId);
  const articleStateById = useRef(new Map<string, ArticleState>());
  const locallyUpdatedArticleIds = useRef(new Set<string>());
  const articleRequestVersion = useRef(0);
  const detailExplanationRequestVersion = useRef(0);
  const listExplanationRequestVersion = useRef(0);
  const hasLoadedSettingsForSession = useRef(false);
  const hasAppliedDefaultHomeViewForSession = useRef(false);
  const appPageRef = useRef<AppPage>(appPage);
  const hasExplicitUrlPageIntent = useRef(initialRoute.hasExplicitPage);

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
  const feedDiagnosticsByFeedId = useMemo<FeedDiagnosticsByFeedId>(() => {
    const diagnosticsByFeedId: FeedDiagnosticsByFeedId = {};
    for (const item of feedDiagnostics?.items ?? []) {
      diagnosticsByFeedId[item.feed.id] = item.diagnostic;
    }
    return diagnosticsByFeedId;
  }, [feedDiagnostics]);
  const currentArticleView = appPage.type === "reader" ? appPage.view : "latest";
  const articlesRef = useRef<ArticleListItem[]>(articles);
  const currentArticleViewRef = useRef<ArticleView>(currentArticleView);
  const articleListScrollKey = useMemo(
    () =>
      [
        "dibao:list-scroll",
        currentArticleView,
        sourceSelection.type,
        sourceSelection.type === "feed"
          ? sourceSelection.feedId
          : sourceSelection.type === "folder"
            ? sourceSelection.folderId
            : "all",
        unreadOnly ? "unread" : "all",
        timeWindow,
        currentArticleView === "favorites" ? favoriteSort : "",
        currentArticleView === "read_later" ? readLaterSort : ""
      ].join(":"),
    [
      currentArticleView,
      favoriteSort,
      readLaterSort,
      sourceSelection,
      timeWindow,
      unreadOnly
    ]
  );
  articlesRef.current = articles;
  currentArticleViewRef.current = currentArticleView;

  function applyArticleState(articleId: string, state: ArticleState) {
    const previousState =
      articleStateById.current.get(articleId) ??
      (articleDetail?.id === articleId ? articleDetail.state : null);
    articleStateById.current.set(articleId, state);
    locallyUpdatedArticleIds.current.add(articleId);
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
    detailExplanationRequestVersion.current += 1;
    setSelectedArticleId(null);
    setArticleDetail(null);
    setRankExplanation(null);
    setIsExplanationOpen(false);
    setDetailError(null);
    setExplanationError(null);
  }

  function clearListExplanation() {
    listExplanationRequestVersion.current += 1;
    setListRankExplanation(null);
    setIsListExplanationOpen(false);
    setIsListExplanationLoading(false);
    setListExplanationError(null);
  }

  function resetArticleListForPendingQuery() {
    articleRequestVersion.current += 1;
    setArticles([]);
    setUnreadCount(0);
    articleStateById.current.clear();
    locallyUpdatedArticleIds.current.clear();
    setNextArticleCursor(null);
    clearSelectedArticle();
    clearListExplanation();
    setArticleError(null);
    setReaderCommandError(null);
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
      if (supportsQuickFilters(view)) {
        const filters = readerFiltersForView(view);
        setSourceSelection(filters.sourceSelection);
        setUnreadOnly(filters.unreadOnly);
        setTimeWindow(filters.timeWindow);
      }
    }
    setAppPage({ type: "reader", view });
  }

  function handleFavoriteSortChange(nextSort: FavoriteArticleSort) {
    if (favoriteSort !== nextSort) {
      resetArticleListForPendingQuery();
    }
    setFavoriteSort(nextSort);
  }

  function handleReadLaterSortChange(nextSort: ReadLaterArticleSort) {
    if (readLaterSort !== nextSort) {
      resetArticleListForPendingQuery();
    }
    setReadLaterSort(nextSort);
  }

  function handleUnreadOnlyChange(nextUnreadOnly: boolean) {
    if (unreadOnly !== nextUnreadOnly) {
      resetArticleListForPendingQuery();
    }
    setUnreadOnly(nextUnreadOnly);
  }

  function handleTimeWindowChange(nextTimeWindow: ArticleTimeWindow) {
    if (timeWindow !== nextTimeWindow) {
      resetArticleListForPendingQuery();
    }
    setTimeWindow(nextTimeWindow);
  }

  function handleSearchFormChange(nextForm: SearchFormState) {
    setSearchForm(nextForm);
  }

  function handleSearchSubmit(nextForm: SearchFormState) {
    const normalizedForm = {
      ...nextForm,
      q: nextForm.q.trim()
    };
    resetArticleListForPendingQuery();
    setSearchForm(normalizedForm);
    setSubmittedSearchForm(normalizedForm);
    setHasSubmittedSearch(normalizedForm.q.length > 0);
    window.history.pushState(
      { dibaoPage: "search" },
      "",
      urlForSearchPage(normalizedForm)
    );
  }

  const resetReaderState = useCallback(() => {
    setFeedFolders([]);
    setFeeds([]);
    setArticles([]);
    setUnreadCount(0);
    articleStateById.current.clear();
    locallyUpdatedArticleIds.current.clear();
    setSourceSelection({ type: "all" });
    setAppPage({ type: "reader", view: defaultAppSettings.ui.defaultHomeView });
    setUnreadOnly(false);
    setTimeWindow("all");
    setSearchForm(defaultSearchForm());
    setSubmittedSearchForm(defaultSearchForm());
    setHasSubmittedSearch(false);
    setFavoriteSort(defaultFavoriteArticleSort);
    setReadLaterSort(defaultReadLaterArticleSort);
    setSelectedArticleId(null);
    setArticleDetail(null);
    detailExplanationRequestVersion.current += 1;
    setRankExplanation(null);
    setRecommendationStatus(null);
    setAllRecommendationClusters([]);
    setAllRecommendationClusterTotal(0);
    setIsAllClustersLoading(false);
    setAllClustersError(null);
    setClusterLabelLexicon(null);
    setMergeCandidates([]);
    setRunningMaintenanceTask(null);
    setUpdatingClusterLexicon(false);
    setUpdatingMergeCandidateId(null);
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
    setReaderCommandError(null);
    setIsMarkingScopeRead(false);
    setSetupSourceError(null);
    setAppSettings(defaultAppSettings);
    setIsSettingsLoading(false);
    setIsSavingSettings(false);
    setSettingsError(null);
    setEmbeddingProviders([]);
    setEmbeddingIndexes([]);
    setIsEmbeddingLoading(false);
    setIsSavingEmbeddingProvider(false);
    setActivatingProviderId(null);
    setTestingProviderId(null);
    setDeletingProviderId(null);
    setRebuildingIndexId(null);
    setEmbeddingError(null);
    setLocale(browserPreferredLocale());
    setOpmlSummary(null);
    setNextArticleCursor(null);
    setPendingArticleAction(null);
    setNotice(null);
    hasLoadedSettingsForSession.current = false;
    hasAppliedDefaultHomeViewForSession.current = hasExplicitUrlPageIntent.current;
    openedArticleIds.current.clear();
    ignoredArticleIds.current.clear();
    locallyUpdatedArticleIds.current.clear();
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
    function updateOnlineStatus() {
      setIsOffline(navigator.onLine === false);
    }

    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);
    updateOnlineStatus();

    return () => {
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
    };
  }, []);

  useEffect(() => {
    function handlePwaUpdateAvailable(event: Event) {
      setPwaUpdateApply(() => (event as PwaUpdateAvailableEvent).detail.applyUpdate);
    }

    window.addEventListener("dibao:pwa-update-available", handlePwaUpdateAvailable);

    return () => {
      window.removeEventListener("dibao:pwa-update-available", handlePwaUpdateAvailable);
    };
  }, []);

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
          setDerivedDataUpgrade(status.derivedDataUpgrade ?? null);
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

  useEffect(() => {
    if (appStage.type !== "derived-data-upgrade") {
      return;
    }

    let cancelled = false;
    let timer: number | null = null;

    async function pollUpgradeStatus() {
      try {
        const status = await dibaoApi.getDerivedDataUpgradeStatus();
        if (cancelled) {
          return;
        }
        setDerivedDataUpgrade(status);
        setDerivedDataUpgradeError(null);
        if (!status.blocking) {
          setAppStage({ type: "setup-status-loading" });
          return;
        }
      } catch (error) {
        if (!cancelled) {
          setDerivedDataUpgradeError(userMessageForError(error, t.errors.api));
        }
      }

      if (!cancelled) {
        timer = window.setTimeout(pollUpgradeStatus, 1500);
      }
    }

    void pollUpgradeStatus();

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [appStage.type, t.errors.api]);

  useEffect(() => {
    if (appStage.type !== "reader") {
      return;
    }

    let cancelled = false;

    async function loadPluginContributions() {
      try {
        const plugins = await dibaoApi.listPluginContributions();
        if (!cancelled) {
          setPluginContributions(plugins);
          setPluginError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setPluginError(userMessageForError(error, t.errors.api));
        }
      }
    }

    void loadPluginContributions();

    return () => {
      cancelled = true;
    };
  }, [appStage.type, t.errors.api]);

  const applySettings = useCallback(
    (settings: AppSettings) => {
      setAppSettings(settings);
      setLocale(settings.ui.locale);
      setTelemetryEnabled(settings.telemetry.enabled);
      configureClientTelemetry(settings.telemetry.enabled);
    },
    [setLocale]
  );

  useEffect(() => {
    appPageRef.current = appPage;
  }, [appPage]);

  useEffect(() => {
    selectedArticleIdRef.current = selectedArticleId;
    if (selectedArticleId) {
      ignoredArticleQueue.current = [];
    }
  }, [selectedArticleId]);

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
          const currentAppPage = appPageRef.current;
          if (
            !hasAppliedDefaultHomeViewForSession.current &&
            !hasExplicitUrlPageIntent.current &&
            currentAppPage.type === "reader" &&
            currentAppPage.view !== settings.ui.defaultHomeView
          ) {
            resetArticleListForPendingQuery();
            setAppPage({ type: "reader", view: settings.ui.defaultHomeView });
          }
          hasAppliedDefaultHomeViewForSession.current = true;
        }
      } catch (error) {
        if (!cancelled) {
          setSettingsError(userMessageForError(error, t.errors.api));
          applySettings(defaultAppSettings);
          hasAppliedDefaultHomeViewForSession.current = true;
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

  const loadEmbeddingSettings = useCallback(async (options: { includeIndexes?: boolean } = {}) => {
    setIsEmbeddingLoading(true);
    setEmbeddingError(null);

    try {
      const includeIndexes = options.includeIndexes ?? true;
      const [providers, indexes] = await Promise.all([
        dibaoApi.listEmbeddingProviders(),
        includeIndexes ? dibaoApi.listEmbeddingIndexes() : Promise.resolve([])
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
    if (
      (appStage.type !== "reader" || appPage.type !== "settings") &&
      appStage.type !== "setup-provider"
    ) {
      return;
    }

    void loadEmbeddingSettings({ includeIndexes: false });
  }, [appPage.type, appStage.type, loadEmbeddingSettings]);

  const refreshArticleExplanation = useCallback(async (articleId: string) => {
    const requestVersion = detailExplanationRequestVersion.current + 1;
    detailExplanationRequestVersion.current = requestVersion;
    setIsExplanationLoading(true);
    setExplanationError(null);

    try {
      const explanation = await dibaoApi.getArticleExplanation(articleId);
      if (detailExplanationRequestVersion.current === requestVersion) {
        setRankExplanation(explanation);
      }
    } catch (error) {
      if (detailExplanationRequestVersion.current === requestVersion) {
        setRankExplanation(null);
        setExplanationError(userMessageForError(error, t.errors.api));
      }
    } finally {
      if (detailExplanationRequestVersion.current === requestVersion) {
        setIsExplanationLoading(false);
      }
    }
  }, [t.errors.api]);

  const loadRecommendationStatus = useCallback(async () => {
    setIsRecommendationStatusLoading(true);
    setRecommendationStatusError(null);

    try {
      const [status, lexicon, candidates] = await Promise.all([
        dibaoApi.getRecommendationTransparency(),
        dibaoApi.getClusterLabelLexicon(),
        dibaoApi.listRecommendationClusterMergeCandidates("all")
      ]);
      setRecommendationStatus(status);
      setClusterLabelLexicon(lexicon);
      setMergeCandidates(candidates.candidates);
    } catch (error) {
      setRecommendationStatus(null);
      setClusterLabelLexicon(null);
      setMergeCandidates([]);
      setRecommendationStatusError(userMessageForError(error, t.errors.api));
    } finally {
      setIsRecommendationStatusLoading(false);
    }
  }, [t.errors.api]);

  const loadRecommendationSummaryStatus = useCallback(async () => {
    setIsRecommendationStatusLoading(true);
    setRecommendationStatusError(null);

    try {
      const status = await dibaoApi.getRecommendationStatus({ includeClusterItems: false });
      setRecommendationStatus(status);
      setClusterLabelLexicon(null);
      setMergeCandidates([]);
    } catch (error) {
      setRecommendationStatus(null);
      setClusterLabelLexicon(null);
      setMergeCandidates([]);
      setRecommendationStatusError(userMessageForError(error, t.errors.api));
    } finally {
      setIsRecommendationStatusLoading(false);
    }
  }, [t.errors.api]);

  const loadAllRecommendationClusters = useCallback(async () => {
    setIsAllClustersLoading(true);
    setAllClustersError(null);

    try {
      const result = await dibaoApi.listRecommendationClusters("all");
      setAllRecommendationClusters(result.items);
      setAllRecommendationClusterTotal(result.total);
    } catch (error) {
      setAllRecommendationClusters([]);
      setAllRecommendationClusterTotal(0);
      setAllClustersError(userMessageForError(error, t.errors.api));
    } finally {
      setIsAllClustersLoading(false);
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

  const loadFeedDiagnostics = useCallback(async () => {
    setIsFeedDiagnosticsLoading(true);

    try {
      setFeedDiagnostics(await dibaoApi.getFeedDiagnostics());
    } catch (error) {
      setFeedError(userMessageForError(error, t.errors.api));
    } finally {
      setIsFeedDiagnosticsLoading(false);
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
    sort: FavoriteArticleSort = defaultFavoriteArticleSort,
    laterSort: ReadLaterArticleSort = defaultReadLaterArticleSort,
    selectedTimeWindow: ArticleTimeWindow = "all"
  ) => {
    const requestVersion = articleRequestVersion.current + 1;
    articleRequestVersion.current = requestVersion;
    setIsArticlesLoading(true);
    setArticleError(null);
    setLoadMoreError(null);
    setNextArticleCursor(null);
    setArticles([]);
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
        timeWindow: supportsQuickFilters(view) ? selectedTimeWindow : "all",
        sort: articleSortForView(view, sort, laterSort)
      });
      if (requestVersion !== articleRequestVersion.current) {
        return;
      }
      const responseArticles = articleListWithKnownLocalStates(
        response.data,
        articleStateById.current,
        locallyUpdatedArticleIds.current
      );
      rememberArticleStates(responseArticles, articleStateById.current);
      setArticles(
        articlesVisibleForUnreadFilter(responseArticles, supportsUnreadOnly(view) && onlyUnread)
      );
      setUnreadCount(
        unreadCountWithKnownLocalStates(
          response.meta.unreadCount,
          response.data,
          articleStateById.current,
          locallyUpdatedArticleIds.current
        )
      );
      setNextArticleCursor(response.page.nextCursor);
    } catch (error) {
      if (requestVersion !== articleRequestVersion.current) {
        return;
      }
      setArticleError(userMessageForError(error, t.errors.api));
      setArticles([]);
      setUnreadCount(0);
      articleStateById.current.clear();
      locallyUpdatedArticleIds.current.clear();
      setNextArticleCursor(null);
    } finally {
      if (requestVersion === articleRequestVersion.current) {
        setIsArticlesLoading(false);
      }
    }
  }, [appPage.type, t.errors.api]);

  const loadSearchArticles = useCallback(async (form: SearchFormState) => {
    const requestVersion = articleRequestVersion.current + 1;
    articleRequestVersion.current = requestVersion;
    setIsArticlesLoading(true);
    setArticleError(null);
    setLoadMoreError(null);
    setNextArticleCursor(null);
    setArticles([]);
    setDetailError(null);
    setExplanationError(null);
    setRecommendationStatus(null);
    setIsRecommendationStatusLoading(false);
    setRecommendationStatusError(null);

    try {
      const response = await dibaoApi.searchArticles({
        ...articleQueryFor(form.sourceSelection),
        q: form.q.trim(),
        state: form.state,
        sort: form.sort,
        from: form.from || null,
        to: form.to || null,
        limit: 50
      });
      if (requestVersion !== articleRequestVersion.current) {
        return;
      }
      const responseArticles = articleListWithKnownLocalStates(
        response.data,
        articleStateById.current,
        locallyUpdatedArticleIds.current
      );
      rememberArticleStates(responseArticles, articleStateById.current);
      setArticles(responseArticles);
      setUnreadCount(
        unreadCountWithKnownLocalStates(
          response.meta.unreadCount,
          response.data,
          articleStateById.current,
          locallyUpdatedArticleIds.current
        )
      );
      setNextArticleCursor(response.page.nextCursor);
    } catch (error) {
      if (requestVersion !== articleRequestVersion.current) {
        return;
      }
      setArticleError(userMessageForError(error, t.errors.api));
      setArticles([]);
      setUnreadCount(0);
      articleStateById.current.clear();
      locallyUpdatedArticleIds.current.clear();
      setNextArticleCursor(null);
    } finally {
      if (requestVersion === articleRequestVersion.current) {
        setIsArticlesLoading(false);
      }
    }
  }, [t.errors.api]);

  useEffect(() => {
    if (appStage.type !== "reader") {
      return;
    }

    if (appPage.type === "feed-management") {
      void Promise.all([loadFeedFolders(), loadFeeds(), loadFeedDiagnostics()]);
      return;
    }

    void Promise.all([loadFeedFolders(), loadFeeds()]);
  }, [appPage.type, appStage.type, loadFeedDiagnostics, loadFeedFolders, loadFeeds]);

  useEffect(() => {
    if (appStage.type !== "reader" || appPage.type !== "reader") {
      return;
    }

    void loadArticles(sourceSelection, currentArticleView, unreadOnly, favoriteSort, readLaterSort, timeWindow);
  }, [
    appPage.type,
    appStage.type,
    currentArticleView,
    favoriteSort,
    loadArticles,
    readLaterSort,
    sourceSelection,
    timeWindow,
    unreadOnly
  ]);

  useEffect(() => {
    if (appStage.type !== "reader" || appPage.type !== "search" || !hasSubmittedSearch) {
      return;
    }

    void loadSearchArticles(submittedSearchForm);
  }, [appPage.type, appStage.type, hasSubmittedSearch, loadSearchArticles, submittedSearchForm]);

  useEffect(() => {
    if (
      appStage.type !== "reader" ||
      appPage.type !== "reader" ||
      !supportsQuickFilters(currentArticleView)
    ) {
      return;
    }

    persistReaderFilters(currentArticleView, {
      sourceSelection,
      unreadOnly,
      timeWindow
    });
  }, [appPage.type, appStage.type, currentArticleView, sourceSelection, timeWindow, unreadOnly]);

  useEffect(() => {
    if (appStage.type !== "reader") {
      setRecommendationStatus(null);
      setRecommendationStatusError(null);
      setIsRecommendationStatusLoading(false);
      return;
    }

    if (appPage.type === "reader" && currentArticleView === "recommended") {
      void loadRecommendationSummaryStatus();
      return;
    }

    if (appPage.type === "algorithm-transparency" || appPage.type === "algorithm-clusters") {
      void loadRecommendationStatus();
      return;
    }

    setRecommendationStatus(null);
    setRecommendationStatusError(null);
    setIsRecommendationStatusLoading(false);
  }, [
    appPage.type,
    appStage.type,
    currentArticleView,
    loadRecommendationStatus,
    loadRecommendationSummaryStatus
  ]);

  useEffect(() => {
    if (appStage.type !== "reader" || appPage.type !== "algorithm-clusters") {
      return;
    }

    void loadAllRecommendationClusters();
  }, [appPage.type, appStage.type, loadAllRecommendationClusters]);

  useEffect(() => {
    function handlePopState() {
      const route = routeFromLocation(appSettings.ui.defaultHomeView);
      hasExplicitUrlPageIntent.current = route.hasExplicitPage;
      setIsExplanationOpen(false);
      setIsSourceDrawerOpen(false);

      const currentPage = appPageRef.current;
      if (
        currentPage.type !== route.page.type ||
        (currentPage.type === "reader" &&
          route.page.type === "reader" &&
          currentPage.view !== route.page.view)
      ) {
        resetArticleListForPendingQuery();
      }
      setAppPage((current) => (sameAppPage(current, route.page) ? current : route.page));
      if (route.page.type === "search") {
        const nextSearchForm = searchFormFromLocation();
        setSearchForm(nextSearchForm);
        setSubmittedSearchForm(nextSearchForm);
        setHasSubmittedSearch(nextSearchForm.q.trim().length > 0);
      }
      setSelectedArticleId(route.articleId);
      if (route.page.type === "reader" && supportsQuickFilters(route.page.view)) {
        const filters = readerFiltersForView(route.page.view);
        setSourceSelection((current) =>
          sameSourceSelection(current, filters.sourceSelection) ? current : filters.sourceSelection
        );
        setUnreadOnly((current) => (current === filters.unreadOnly ? current : filters.unreadOnly));
        setTimeWindow((current) => (current === filters.timeWindow ? current : filters.timeWindow));
      }
      setFavoriteSort(urlFavoriteSortParam() ?? defaultFavoriteArticleSort);
      setReadLaterSort(urlReadLaterSortParam() ?? defaultReadLaterArticleSort);
    }

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [appSettings.ui.defaultHomeView]);

  useEffect(() => {
    let cancelled = false;

    async function loadDetail(articleId: string) {
      setIsDetailLoading(true);
      setDetailError(null);
      detailExplanationRequestVersion.current += 1;
      setRankExplanation(null);
      setExplanationError(null);
      setIsExplanationOpen(false);

      try {
        const detail = await dibaoApi.getArticle(articleId);
        const knownState = locallyUpdatedArticleIds.current.has(articleId)
          ? articleStateById.current.get(articleId)
          : null;
        const detailWithKnownState = knownState ? { ...detail, state: knownState } : detail;
        if (!cancelled) {
          articleStateById.current.set(articleId, detailWithKnownState.state);
          setArticleDetail(detailWithKnownState);
          setArticleActionError(null);
          setIsDetailLoading(false);
        }
        if (!cancelled && !openedArticleIds.current.has(articleId)) {
          openedArticleIds.current.add(articleId);
          applyArticleState(articleId, optimisticOpenedState(detailWithKnownState.state));
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
      detailExplanationRequestVersion.current += 1;
      setArticleDetail(null);
      setRankExplanation(null);
      setIsExplanationOpen(false);
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
  }, [
    currentArticleView,
    refreshArticleExplanation,
    selectedArticleId,
    submittedSearchForm.sort,
    t.actions.errors.open,
    t.errors.api
  ]);

  function handleTelemetryEnabledChange(enabled: boolean) {
    setTelemetryEnabled(enabled);
    storeTelemetryPreference(enabled);
    configureClientTelemetry(enabled);
  }

  async function handleAuthSubmit(mode: AuthMode, username: string, password: string) {
    if (!username.trim()) {
      setAuthError(t.auth.usernameRequired);
      return;
    }

    if (!password.trim()) {
      setAuthError(t.auth.passwordRequired);
      return;
    }

    setIsAuthSubmitting(true);
    setAuthError(null);

    try {
      if (mode === "setup") {
        await dibaoApi.setupAuth(username, password, telemetryEnabled);
        resetReaderState();
        setAppStage({ type: "setup-sources" });
      } else {
        await dibaoApi.login(username, password);
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

  async function handleRetryDerivedDataUpgrade() {
    setIsRetryingDerivedDataUpgrade(true);
    setDerivedDataUpgradeError(null);

    try {
      setDerivedDataUpgrade(await dibaoApi.retryDerivedDataUpgrade());
    } catch (error) {
      setDerivedDataUpgradeError(userMessageForError(error, t.errors.api));
    } finally {
      setIsRetryingDerivedDataUpgrade(false);
    }
  }

  async function handleAddFeed(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextFeedUrl = feedUrl.trim();

    if (!nextFeedUrl) {
      setFeedDiscoveryError(t.feedDiscovery.errors.urlRequired);
      return;
    }

    setIsDiscoveringFeeds(true);
    setFeedError(null);
    setFeedDiscoveryError(null);
    setFeedDiscovery(null);
    setNotice(null);

    try {
      setFeedDiscovery(await dibaoApi.discoverFeeds(nextFeedUrl));
    } catch (error) {
      setFeedDiscoveryError(
        userMessageForError(error, t.errors.api) || t.feedDiscovery.errors.discoverFailed
      );
    } finally {
      setIsDiscoveringFeeds(false);
    }
  }

  async function handleAddDiscoveredFeed(candidate: FeedDiscoveryCandidate) {
    if (candidate.status !== "valid") {
      return;
    }

    setIsAddingFeed(true);
    setFeedError(null);
    setFeedDiscoveryError(null);
    setNotice(null);

    try {
      const result = await dibaoApi.createFeed(candidate.feedUrl);
      setFeedUrl("");
      setFeedDiscovery(null);
      setNotice({ type: "feedAddedAndRefreshed", feedTitle: result.feed.title });
      await Promise.all([loadFeeds(), loadFeedDiagnostics()]);
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
      const nextStage = stageForSetupStatus(status);
      setAppStage(nextStage.type === "setup-sources" ? { type: "setup-provider" } : nextStage);
      return;
    }

    setSetupSourceError(noFeedsMessage);
  }

  async function handleOptionalPluginDecision(pluginId: string, enabled: boolean) {
    setOptionalPluginDecisionId(pluginId);
    setAuthError(null);

    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
      await dibaoApi.selectOptionalPlugin(pluginId, { enabled, timezone });
      setPluginContributions(await dibaoApi.listPluginContributions());
      setAppStage({ type: "setup-provider" });
    } catch (error) {
      setAuthError(userMessageForError(error, t.errors.api));
    } finally {
      setOptionalPluginDecisionId(null);
    }
  }

  async function handleSetupAddFeed(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextFeedUrl = feedUrl.trim();

    if (!nextFeedUrl) {
      setSetupSourceError(t.feedDiscovery.errors.urlRequired);
      return;
    }

    setIsDiscoveringFeeds(true);
    setSetupSourceError(null);
    setFeedDiscoveryError(null);
    setFeedDiscovery(null);
    setOpmlSummary(null);

    try {
      setFeedDiscovery(await dibaoApi.discoverFeeds(nextFeedUrl));
    } catch (error) {
      setSetupSourceError(
        userMessageForError(error, t.errors.api) || t.feedDiscovery.errors.discoverFailed
      );
    } finally {
      setIsDiscoveringFeeds(false);
    }
  }

  async function handleSetupAddDiscoveredFeed(candidate: FeedDiscoveryCandidate) {
    if (candidate.status !== "valid") {
      return;
    }

    setIsAddingFeed(true);
    setSetupSourceError(null);
    setFeedDiscoveryError(null);
    setOpmlSummary(null);

    try {
      await dibaoApi.createFeed(candidate.feedUrl);
      setFeedUrl("");
      setFeedDiscovery(null);
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
        loadFeedDiagnostics(),
        appPage.type === "reader"
          ? loadArticles(sourceSelection, appPage.view, unreadOnly, favoriteSort, readLaterSort, timeWindow)
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
      await Promise.all([loadFeeds(), loadFeedDiagnostics()]);
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
        loadFeedDiagnostics(),
        appPage.type === "reader"
          ? loadArticles(sourceSelection, appPage.view, unreadOnly, favoriteSort, readLaterSort, timeWindow)
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
    const [nextFolders, nextFeeds, nextDiagnostics] = await Promise.all([
      dibaoApi.listFeedFolders(),
      dibaoApi.listFeeds(),
      dibaoApi.getFeedDiagnostics()
    ]);
    const nextSourceSelection = correctSourceSelection(sourceSelection, nextFeeds, nextFolders);

    setFeedFolders(nextFolders);
    setFeeds(nextFeeds);
    setFeedDiagnostics(nextDiagnostics);

    if (!sameSourceSelection(sourceSelection, nextSourceSelection)) {
      resetArticleListForPendingQuery();
    }
    setSourceSelection(nextSourceSelection);

    if (articleDetail && !nextFeeds.some((feed) => feed.id === articleDetail.feedId)) {
      detailExplanationRequestVersion.current += 1;
      setSelectedArticleId(null);
      setArticleDetail(null);
      setRankExplanation(null);
      setDetailError(null);
      setExplanationError(null);
    }

    if (appPage.type === "reader") {
      await loadArticles(
        nextSourceSelection,
        appPage.view,
        unreadOnly,
        favoriteSort,
        readLaterSort,
        timeWindow
      );
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

  function handlePreviewFullContent(feedId: string) {
    window.open(urlForAppPage({ type: "full-content-preview", feedId }), "_blank", "noopener");
  }

  async function handleBackfillCurrentFeedFullContent(
    feedId: string
  ): Promise<FullContentBackfillResponse> {
    const result = await dibaoApi.backfillCurrentFeedFullContent(feedId);
    await refreshSourcesAfterManagementMutation();
    if (selectedArticleId) {
      setArticleDetail(await dibaoApi.getArticle(selectedArticleId));
    }
    return result;
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

  async function handleChangePassword(currentPassword: string, newPassword: string) {
    await dibaoApi.changePassword(currentPassword, newPassword);
  }

  async function handleSaveEmbeddingProvider(
    providerId: string | null,
    input: CreateEmbeddingProviderInput | UpdateEmbeddingProviderInput
  ): Promise<string | null> {
    setIsSavingEmbeddingProvider(true);
    setEmbeddingError(null);
    setNotice(null);

    try {
      let savedProviderId = providerId;
      if (providerId) {
        await dibaoApi.updateEmbeddingProvider(providerId, input);
      } else {
        const created = await dibaoApi.createEmbeddingProvider(input as CreateEmbeddingProviderInput);
        savedProviderId = created.id;
      }
      await loadEmbeddingSettings();
      setNotice({ type: "embeddingProviderSaved" });
      return savedProviderId;
    } catch (error) {
      setEmbeddingError(userMessageForError(error, t.errors.api));
      return null;
    } finally {
      setIsSavingEmbeddingProvider(false);
    }
  }

  async function handleActivateEmbeddingProvider(providerId: string): Promise<boolean> {
    setActivatingProviderId(providerId);
    setEmbeddingError(null);
    setNotice(null);

    try {
      await dibaoApi.activateEmbeddingProvider(providerId);
      await loadEmbeddingSettings();
      setNotice({ type: "embeddingProviderActivated" });
      return true;
    } catch (error) {
      setEmbeddingError(userMessageForError(error, t.errors.api));
      await loadEmbeddingSettings();
      return false;
    } finally {
      setActivatingProviderId(null);
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

  async function handleBackfillEmbeddingIndex(indexId: string) {
    setBackfillingIndexId(indexId);
    setEmbeddingError(null);
    setNotice(null);

    try {
      await dibaoApi.backfillEmbeddingIndex(indexId);
      await loadEmbeddingSettings();
      await loadRecommendationStatus();
      setNotice({ type: "embeddingIndexBackfillQueued" });
    } catch (error) {
      setEmbeddingError(userMessageForError(error, t.errors.api));
    } finally {
      setBackfillingIndexId(null);
    }
  }

  async function handleRunRecommendationMaintenanceTask(
    task: RecommendationMaintenanceTask,
    label: string
  ) {
    setRunningMaintenanceTask(task);
    setRecommendationStatusError(null);
    setNotice(null);

    try {
      const result = await dibaoApi.runRecommendationMaintenanceTask(task);
      setNotice({
        type: "recommendationMaintenanceQueued",
        label,
        existing: maintenanceResultWasExisting(result)
      });
      await loadRecommendationStatus();
      if (
        task === "keyword_rebuild" ||
        task === "recent_intent_rebuild" ||
        task === "cluster_label_rebuild" ||
        task === "cluster_merge_diagnostics" ||
        task === "cluster_auto_merge"
      ) {
        await loadAllRecommendationClusters();
      }
    } catch (error) {
      setRecommendationStatusError(userMessageForError(error, t.errors.api));
    } finally {
      setRunningMaintenanceTask(null);
    }
  }

  async function handleUpdateRecommendationClusterLabel(
    clusterId: string,
    manualLabel: string | null
  ) {
    setUpdatingClusterLabelId(clusterId);
    setRecommendationStatusError(null);
    setAllClustersError(null);

    try {
      await dibaoApi.updateRecommendationClusterLabel(clusterId, manualLabel);
      await loadRecommendationStatus();
      if (appPageRef.current.type === "algorithm-clusters") {
        await loadAllRecommendationClusters();
      }
    } catch (error) {
      const message = userMessageForError(error, t.errors.api);
      setRecommendationStatusError(message);
      setAllClustersError(message);
    } finally {
      setUpdatingClusterLabelId(null);
    }
  }

  async function handleUpdateRecommendationFamilyLabel(
    familyId: string,
    manualLabel: string | null
  ) {
    setUpdatingFamilyLabelId(familyId);
    setRecommendationStatusError(null);
    setAllClustersError(null);

    try {
      await dibaoApi.updateRecommendationFamilyLabel(familyId, manualLabel);
      await loadRecommendationStatus();
      if (appPageRef.current.type === "algorithm-clusters") {
        await loadAllRecommendationClusters();
      }
    } catch (error) {
      const message = userMessageForError(error, t.errors.api);
      setRecommendationStatusError(message);
      setAllClustersError(message);
    } finally {
      setUpdatingFamilyLabelId(null);
    }
  }

  async function handleUpdateClusterLabelLexicon(
    overrides: Partial<ClusterLabelLexiconOverrides>
  ) {
    setUpdatingClusterLexicon(true);
    setRecommendationStatusError(null);
    setNotice(null);

    try {
      const result = await dibaoApi.updateClusterLabelLexicon(overrides);
      setClusterLabelLexicon(result);
      setNotice({
        type: "recommendationMaintenanceQueued",
        label: t.algorithmTransparency.lexicon.saveAndRebuild,
        existing: result.rebuildJob?.existing ?? false
      });
      await loadRecommendationStatus();
      if (appPageRef.current.type === "algorithm-clusters") {
        await loadAllRecommendationClusters();
      }
    } catch (error) {
      setRecommendationStatusError(userMessageForError(error, t.errors.api));
    } finally {
      setUpdatingClusterLexicon(false);
    }
  }

  async function handleMergeClusterCandidate(candidateId: string) {
    setUpdatingMergeCandidateId(candidateId);
    setRecommendationStatusError(null);

    try {
      await dibaoApi.mergeRecommendationClusterCandidate(candidateId);
      await loadRecommendationStatus();
      if (appPageRef.current.type === "algorithm-clusters") {
        await loadAllRecommendationClusters();
      }
    } catch (error) {
      setRecommendationStatusError(userMessageForError(error, t.errors.api));
    } finally {
      setUpdatingMergeCandidateId(null);
    }
  }

  async function handleIgnoreClusterCandidate(candidateId: string) {
    setUpdatingMergeCandidateId(candidateId);
    setRecommendationStatusError(null);

    try {
      await dibaoApi.ignoreRecommendationClusterCandidate(candidateId);
      await loadRecommendationStatus();
      if (appPageRef.current.type === "algorithm-clusters") {
        await loadAllRecommendationClusters();
      }
    } catch (error) {
      setRecommendationStatusError(userMessageForError(error, t.errors.api));
    } finally {
      setUpdatingMergeCandidateId(null);
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
      const response =
        appPage.type === "search"
          ? await dibaoApi.searchArticles({
              ...articleQueryFor(submittedSearchForm.sourceSelection),
              q: submittedSearchForm.q.trim(),
              state: submittedSearchForm.state,
              sort: submittedSearchForm.sort,
              from: submittedSearchForm.from || null,
              to: submittedSearchForm.to || null,
              limit: 50,
              cursor: nextArticleCursor
            })
          : await dibaoApi.listArticles({
              ...articleQueryFor(sourceSelection),
              view: currentArticleView,
              limit: 50,
              cursor: nextArticleCursor,
              unreadOnly: supportsUnreadOnly(currentArticleView) ? unreadOnly : false,
              timeWindow: supportsQuickFilters(currentArticleView) ? timeWindow : "all",
              sort: articleSortForView(currentArticleView, favoriteSort, readLaterSort)
            });
      if (requestVersion !== articleRequestVersion.current) {
        return;
      }
      const responseArticles = articleListWithKnownLocalStates(
        response.data,
        articleStateById.current,
        locallyUpdatedArticleIds.current
      );
      rememberArticleStates(responseArticles, articleStateById.current);
      setArticles((current) =>
        appendUniqueArticles(
          current,
          appPage.type === "search"
            ? responseArticles
            : articlesVisibleForUnreadFilter(
                responseArticles,
                supportsUnreadOnly(currentArticleView) && unreadOnly
              )
        )
      );
      setUnreadCount(
        unreadCountWithKnownLocalStates(
          response.meta.unreadCount,
          response.data,
          articleStateById.current,
          locallyUpdatedArticleIds.current
        )
      );
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

  async function handleMarkCurrentArticleListScopeRead() {
    if (currentArticleView !== "latest" && currentArticleView !== "recommended") {
      return;
    }

    await markScopeRead(
      currentArticleListReaderCommandScope(),
      () =>
        loadArticles(
          sourceSelection,
          currentArticleView,
          unreadOnly,
          favoriteSort,
          readLaterSort,
          timeWindow
        )
    );
  }

  async function previewCurrentArticleListScopeRead(): Promise<number> {
    if (currentArticleView !== "latest" && currentArticleView !== "recommended") {
      return 0;
    }

    const result = await dibaoApi.previewMarkScopeRead(currentArticleListReaderCommandScope());
    return result.markedReadCount;
  }

  function currentArticleListReaderCommandScope(): ReaderCommandScope {
    return {
      type: "article_list",
      view: currentArticleView === "recommended" ? "recommended" : "latest",
      ...articleQueryFor(sourceSelection),
      clearWindow: timeWindow
    };
  }

  async function handleMarkCurrentSearchScopeRead() {
    if (!hasSubmittedSearch || submittedSearchForm.q.trim().length === 0) {
      return;
    }

    await markScopeRead(
      {
        type: "search",
        ...articleQueryFor(submittedSearchForm.sourceSelection),
        q: submittedSearchForm.q.trim(),
        state: submittedSearchForm.state,
        from: submittedSearchForm.from || null,
        to: submittedSearchForm.to || null
      },
      () => loadSearchArticles(submittedSearchForm)
    );
  }

  async function markScopeRead(scope: ReaderCommandScope, reload: () => Promise<void>) {
    setIsMarkingScopeRead(true);
    setReaderCommandError(null);
    setNotice(null);

    try {
      const result = await dibaoApi.markScopeRead(scope);
      setNotice({ type: "readerCommandMarkScopeRead", count: result.markedReadCount });
      articleStateById.current.clear();
      locallyUpdatedArticleIds.current.clear();
      await reload();
    } catch {
      setReaderCommandError(t.readerCommands.markScopeRead.error);
    } finally {
      setIsMarkingScopeRead(false);
    }
  }

  async function handleArticleAction(article: ArticleActionTarget, intent: ArticleActionIntent) {
    setPendingArticleAction({ articleId: article.id, intent });
    setArticleActionError(null);
    const previousState =
      articleStateById.current.get(article.id) ??
      (articleDetail?.id === article.id ? articleDetail.state : article.state);
    applyArticleState(article.id, optimisticStateForArticleAction(intent, previousState));

    try {
      const result = await dibaoApi.postArticleAction(
        article.id,
        requestForArticleAction(intent, previousState)
      );
      applyArticleState(article.id, result.state);
      void refreshArticleExplanation(article.id);
    } catch {
      applyArticleState(article.id, previousState);
      setArticleActionError(actionErrorMessageFor(intent, t));
    } finally {
      setPendingArticleAction((current) =>
        current?.articleId === article.id && current.intent === intent ? null : current
      );
    }
  }

  function handleIgnoreArticle(articleId: string) {
    if (
      ignoredArticleIds.current.has(articleId) ||
      ignoredArticleQueue.current.includes(articleId)
    ) {
      return;
    }

    ignoredArticleQueue.current.push(articleId);
    void drainIgnoredArticleQueue();
  }

  async function drainIgnoredArticleQueue() {
    if (isSendingIgnoredArticle.current) {
      return;
    }

    isSendingIgnoredArticle.current = true;
    try {
      while (ignoredArticleQueue.current.length > 0) {
        const articleId = ignoredArticleQueue.current.shift();
        if (articleId) {
          await postIgnoredArticle(articleId);
        }
      }
    } finally {
      isSendingIgnoredArticle.current = false;
    }
  }

  async function postIgnoredArticle(articleId: string) {
    const article = articlesRef.current.find((candidate) => candidate.id === articleId);
    const interactionStatus = article ? articleInteractionStatusForState(article.state) : "unseen";

    if (
      !article ||
      selectedArticleIdRef.current !== null ||
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
          view: currentArticleViewRef.current
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
    const previousState =
      articleStateById.current.get(articleId) ??
      (articleDetail?.id === articleId ? articleDetail.state : null);
    if (previousState) {
      applyArticleState(articleId, optimisticReadProgressState(previousState, progress));
    }
    if (
      progress >= 0.5 &&
      articleId === selectedArticleId &&
      shouldLoadDetailRankExplanation(appPage, currentArticleView, submittedSearchForm.sort) &&
      rankExplanation?.articleId !== articleId &&
      !isExplanationLoading
    ) {
      void refreshArticleExplanation(articleId);
    }

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
    setIsExplanationOpen(false);
    const href =
      appPage.type === "search"
        ? urlForSearchPage(submittedSearchForm, articleId)
        : urlForArticle(currentArticleView, articleId, {
            favoriteSort,
            readLaterSort,
            timeWindow,
            unreadOnly
          });
    if (selectedArticleId !== articleId) {
      window.history.pushState({ dibaoArticleId: articleId }, "", href);
    }
    setSelectedArticleId(articleId);
    setIsSourceDrawerOpen(false);
  }

  function navigateToAppPage(page: AppPage) {
    window.history.pushState({ dibaoPage: page.type }, "", urlForAppPage(page, {
      favoriteSort,
      readLaterSort,
      timeWindow,
      unreadOnly
    }));
    if (page.type === "reader") {
      handleArticleViewChange(page.view);
    } else {
      resetArticleListForPendingQuery();
      setAppPage(page);
    }
    setIsSourceDrawerOpen(false);
  }

  function handleOpenExplanation() {
    if (!shouldLoadDetailRankExplanation(appPage, currentArticleView, submittedSearchForm.sort)) {
      return;
    }

    if (
      selectedArticleId &&
      rankExplanation?.articleId !== selectedArticleId &&
      !isExplanationLoading
    ) {
      void refreshArticleExplanation(selectedArticleId);
    }
    setIsExplanationOpen(true);
  }

  async function handleOpenListExplanation(articleId: string) {
    if (!canLoadRankExplanation(appPageRef.current, currentArticleView)) {
      return;
    }

    const requestVersion = listExplanationRequestVersion.current + 1;
    listExplanationRequestVersion.current = requestVersion;
    setIsListExplanationOpen(true);
    setIsListExplanationLoading(true);
    setListExplanationError(null);
    setListRankExplanation(null);

    try {
      const explanation = await dibaoApi.getArticleExplanation(articleId);
      if (listExplanationRequestVersion.current === requestVersion) {
        setListRankExplanation(explanation);
      }
    } catch (error) {
      if (listExplanationRequestVersion.current === requestVersion) {
        setListRankExplanation(null);
        setListExplanationError(userMessageForError(error, t.errors.api));
      }
    } finally {
      if (listExplanationRequestVersion.current === requestVersion) {
        setIsListExplanationLoading(false);
      }
    }
  }

  function handleCloseExplanation() {
    setIsExplanationOpen(false);
  }

  function handleBackToArticleList() {
    if (isExplanationOpen) {
      handleCloseExplanation();
      return;
    }

    window.history.pushState(
      { dibaoPage: appPage.type === "search" ? "search" : currentArticleView },
      "",
      appPage.type === "search"
        ? urlForSearchPage(submittedSearchForm)
        : urlForAppPage({ type: "reader", view: currentArticleView }, {
            favoriteSort,
            readLaterSort,
            timeWindow,
            unreadOnly
          })
    );
    clearSelectedArticle();
  }

  function handleNavigationClick(event: MouseEvent<HTMLAnchorElement>, item: NavigationItemKey) {
    if (shouldLetBrowserHandleLinkClick(event)) {
      return;
    }
    event.preventDefault();
    const page = pageForNavigationItem(item);
    if (!page) {
      return;
    }
    setIsUtilityMenuOpen(false);
    navigateToAppPage(page);
  }

  function handlePluginNavigationClick(event: MouseEvent<HTMLAnchorElement>, page: AppPage) {
    if (shouldLetBrowserHandleLinkClick(event)) {
      return;
    }
    event.preventDefault();
    setIsUtilityMenuOpen(false);
    navigateToAppPage(page);
  }

  async function handlePluginAction(action: PluginActionButton, context: PluginActionContext) {
    setPluginError(null);
    try {
      if (action.command.startsWith("task:")) {
        const taskId = action.command.slice("task:".length);
        await dibaoApi.startPluginTask(action.pluginId, taskId);
        return;
      }
      if (action.command.startsWith("route:")) {
        navigateToAppPage({
          type: "plugin",
          pluginId: action.pluginId,
          route: action.command.slice("route:".length)
        });
        return;
      }
      if (action.command.startsWith("api:")) {
        await dibaoApi.callPluginApi(action.pluginId, action.command.slice("api:".length), {
          actionId: action.id,
          context
        });
        return;
      }
      await dibaoApi.callPluginApi(action.pluginId, `/${action.command}`, {
        actionId: action.id,
        context
      });
    } catch (error) {
      setPluginError(userMessageForError(error, t.errors.api));
    }
  }

  const noticeText = notice ? noticeTextFor(notice, t) : null;
  const pwaStatusBanner = (
    <PwaStatusBanner
      isOffline={isOffline}
      onApplyUpdate={pwaUpdateApply}
      onDismissUpdate={() => setPwaUpdateApply(null)}
    />
  );
  const activePlugin =
    appPage.type === "plugin"
      ? pluginContributions.find((plugin) => plugin.id === appPage.pluginId) ?? null
      : null;
  const activePluginRoute =
    activePlugin && appPage.type === "plugin"
      ? activePlugin.contributions.routes.find((route) => route.id === appPage.route) ??
        activePlugin.contributions.routes[0] ??
        null
      : null;
  const pluginDesktopNavItems = pluginContributions.flatMap((plugin) =>
    plugin.contributions.primaryNav.map((nav) => ({
      plugin,
      nav,
      page: { type: "plugin", pluginId: plugin.id, route: nav.route } satisfies AppPage
    }))
  );
  const pluginMobilePrimaryNavItems = pluginContributions.flatMap((plugin) =>
    plugin.contributions.primaryMobile.map((nav) => ({
      plugin,
      nav,
      page: { type: "plugin", pluginId: plugin.id, route: nav.route } satisfies AppPage
    }))
  );
  const pluginMobilePrimaryNavKeys = new Set(
    pluginMobilePrimaryNavItems.map(({ plugin, nav }) => `${plugin.id}:${nav.route}`)
  );
  const pluginMobileOverflowNavItems = pluginDesktopNavItems.filter(
    ({ plugin, nav }) => !pluginMobilePrimaryNavKeys.has(`${plugin.id}:${nav.route}`)
  );
  const isMobileUtilityNavigationActive =
    isUtilityNavigationActive(appPage) ||
    pluginMobileOverflowNavItems.some(({ page }) => sameAppPage(appPage, page));
  const pluginActionsBySlot = new Map<string, PluginActionButton[]>();
  for (const plugin of pluginContributions) {
    for (const action of plugin.contributions.actions) {
      const actions = pluginActionsBySlot.get(action.slot) ?? [];
      actions.push({
        ...action,
        pluginId: plugin.id,
        pluginName: plugin.name
      });
      pluginActionsBySlot.set(action.slot, actions);
    }
  }
  for (const actions of pluginActionsBySlot.values()) {
    actions.sort(
      (left, right) =>
        (left.order ?? 100) - (right.order ?? 100) ||
        left.label.localeCompare(right.label)
    );
  }
  const pluginActionsForSlot = (slot: string) => pluginActionsBySlot.get(slot) ?? [];
  const pageTitle =
    appPage.type === "feed-management"
      ? t.feedManagement.pageTitle
      : appPage.type === "full-content-preview"
        ? t.fullContentPreview.pageTitle
      : appPage.type === "search"
        ? t.search.pageTitle
      : appPage.type === "settings"
        ? t.settings.pageTitle
        : appPage.type === "plugin"
          ? activePluginRoute?.title ?? activePlugin?.name ?? "Plugin"
        : appPage.type === "algorithm-transparency" || appPage.type === "algorithm-clusters"
          ? t.algorithmTransparency.pageTitle
          : t.shell.pageTitles[currentArticleView];
  const topbarStatus =
    appPage.type === "feed-management"
      ? isFeedsLoading
        ? t.feedManagement.loading
        : t.feedManagement.status(feeds.length, feedFolders.length)
      : appPage.type === "full-content-preview"
        ? t.fullContentPreview.status
      : appPage.type === "search"
        ? articleError ??
          (hasSubmittedSearch
            ? isArticlesLoading
              ? t.search.submitting
              : t.search.resultsCount(articles.length)
            : t.search.initialTitle)
      : appPage.type === "settings"
        ? settingsError ??
          embeddingError ??
          noticeText ??
          (isSettingsLoading || isEmbeddingLoading ? t.settings.loading : t.settings.status)
        : appPage.type === "plugin"
          ? pluginError ?? activePlugin?.name ?? "Plugin"
        : appPage.type === "algorithm-transparency"
          ? recommendationStatusError ??
            (isRecommendationStatusLoading
              ? t.recommendationStatus.loading
              : t.algorithmTransparency.status)
          : appPage.type === "algorithm-clusters"
            ? allClustersError ??
              (isAllClustersLoading
                ? t.recommendationStatus.loading
                : t.algorithmTransparency.status)
          : noticeText ??
            (isArticlesLoading ? t.shell.loadingArticles : t.shell.viewStatus[currentArticleView]);

  if (appStage.type === "auth-loading" || appStage.type === "setup-status-loading") {
    return (
      <main className={styles.authShell}>
        {pwaStatusBanner}
        <AuthGatePanel isSubmitting={false} mode="loading" />
      </main>
    );
  }

  if (appStage.type === "welcome") {
    return (
      <main className={styles.authShell}>
        {pwaStatusBanner}
        <SetupWelcomePanel onStart={() => setAppStage({ type: "setup-password" })} />
      </main>
    );
  }

  if (appStage.type === "setup-password" || appStage.type === "login") {
    return (
      <main className={styles.authShell}>
        {pwaStatusBanner}
        <AuthGatePanel
          error={authError}
          isSubmitting={isAuthSubmitting}
          mode={appStage.type === "login" ? "login" : "setup"}
          onTelemetryEnabledChange={handleTelemetryEnabledChange}
          onSubmit={handleAuthSubmit}
          telemetryEnabled={telemetryEnabled}
        />
      </main>
    );
  }

  if (appStage.type === "derived-data-upgrade") {
    return (
      <main className={styles.authShell}>
        {pwaStatusBanner}
        <DerivedDataUpgradePanel
          error={derivedDataUpgradeError}
          isRetrying={isRetryingDerivedDataUpgrade}
          onRetry={handleRetryDerivedDataUpgrade}
          status={derivedDataUpgrade}
        />
      </main>
    );
  }

  if (appStage.type === "setup-sources") {
    return (
      <main className={styles.authShell}>
        {pwaStatusBanner}
        <SetupSourcesPanel
          error={setupSourceError}
          discovery={feedDiscovery}
          discoveryError={feedDiscoveryError}
          feedUrl={feedUrl}
          isAddingFeed={isAddingFeed}
          isDiscoveringFeeds={isDiscoveringFeeds}
          isImportingOpml={isImportingOpml}
          onAddCandidate={handleSetupAddDiscoveredFeed}
          onAddFeed={handleSetupAddFeed}
          onImportOpml={handleSetupImportOpml}
          onUpdateFeedUrl={setFeedUrl}
          opmlSummary={opmlSummary}
        />
      </main>
    );
  }

  if (appStage.type === "setup-optional-plugins") {
    return (
      <main className={styles.authShell}>
        {pwaStatusBanner}
        <SetupOptionalPluginsPanel
          busyPluginId={optionalPluginDecisionId}
          error={authError}
          onDecision={handleOptionalPluginDecision}
          plugins={appStage.plugins}
        />
      </main>
    );
  }

  if (appStage.type === "setup-provider") {
    return (
      <main className={styles.authShell}>
        {pwaStatusBanner}
        <Suspense fallback={<AuthGatePanel isSubmitting={false} mode="loading" />}>
          <LazySetupProviderPanel
          activatingProviderId={activatingProviderId}
          embeddingError={embeddingError}
          embeddingProviders={embeddingProviders}
          isEmbeddingLoading={isEmbeddingLoading}
          isSavingEmbeddingProvider={isSavingEmbeddingProvider}
          testingProviderId={testingProviderId}
          onContinue={handleSetupProviderContinue}
          onActivateEmbeddingProvider={handleActivateEmbeddingProvider}
          onSaveEmbeddingProvider={handleSaveEmbeddingProvider}
          onTestEmbeddingProvider={handleTestEmbeddingProvider}
          />
        </Suspense>
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      {pwaStatusBanner}
      <aside className={styles.sidebar} aria-label={t.navigation.ariaLabel}>
        <div className={styles.brand}>
          <img alt="" className={styles.brandMark} src="/logo-64.png" />
          <span>
            <strong>{t.common.brandName}</strong>
            <small>{t.common.brandSubtitle}</small>
          </span>
        </div>
        <nav className={styles.nav}>
          {navigationItems.map((item) => {
            const navigationPage = pageForNavigationItem(item);
            const isPlaceholder = !navigationPage;

            return (
              <a
                aria-disabled={isPlaceholder ? "true" : undefined}
                aria-label={t.navigation.items[item]}
                className={classNames(
                  isNavigationItemActive(item, appPage) ? styles.navItemActive : styles.navItem,
                  utilityNavigationItems.includes(item) ? styles.navUtilityItem : null
                )}
                data-disabled={isPlaceholder ? "true" : undefined}
                href={
                  navigationPage
                    ? urlForAppPage(navigationPage, {
                        favoriteSort,
                        readLaterSort,
                        timeWindow,
                        unreadOnly
                      })
                    : "#"
                }
                key={item}
                onClick={(event) => handleNavigationClick(event, item)}
                title={t.navigation.items[item]}
              >
                <NavigationIcon item={item} />
                <span className={styles.navLabel}>{t.navigation.items[item]}</span>
              </a>
            );
          })}
          {pluginDesktopNavItems.map(({ plugin, nav, page }) => (
            <a
              aria-label={nav.label}
              className={classNames(
                sameAppPage(appPage, page) ? styles.navItemActive : styles.navItem,
                styles.navDesktopOnly
              )}
              href={urlForAppPage(page)}
              key={`${plugin.id}:${nav.route}`}
              onClick={(event) => handlePluginNavigationClick(event, page)}
              title={nav.label}
            >
              <ActionIcon name={iconNameForPlugin(nav.icon)} />
              <span className={styles.navLabel}>{nav.label}</span>
            </a>
          ))}
          {pluginMobilePrimaryNavItems.map(({ plugin, nav, page }) => (
            <a
              aria-label={nav.label}
              className={classNames(
                sameAppPage(appPage, page) ? styles.navItemActive : styles.navItem,
                styles.navMobileOnly
              )}
              href={urlForAppPage(page)}
              key={`${plugin.id}:${nav.route}:mobile`}
              onClick={(event) => handlePluginNavigationClick(event, page)}
              title={nav.label}
            >
              <ActionIcon name={iconNameForPlugin(nav.icon)} />
              <span className={styles.navLabel}>{nav.label}</span>
            </a>
          ))}
          <button
            aria-controls="mobile-utility-menu"
            aria-expanded={isUtilityMenuOpen}
            aria-label={t.navigation.utilityMenuLabel}
            className={classNames(
              isMobileUtilityNavigationActive ? styles.navItemActive : styles.navItem,
              styles.navUtilityToggle
            )}
            onClick={() => setIsUtilityMenuOpen((isOpen) => !isOpen)}
            title={t.navigation.utilityMenuLabel}
            type="button"
          >
            <ActionIcon name="more" />
            <span className={styles.navLabel}>{t.navigation.utilityMenuLabel}</span>
          </button>
          {isUtilityMenuOpen ? (
            <div
              className={styles.utilityMenu}
              id="mobile-utility-menu"
              role="menu"
              aria-label={t.navigation.utilityMenuLabel}
            >
              {utilityNavigationItems.map((item) => {
                const navigationPage = pageForNavigationItem(item);
                const isPlaceholder = !navigationPage;

                return (
                  <a
                    aria-disabled={isPlaceholder ? "true" : undefined}
                    className={styles.utilityMenuItem}
                    data-disabled={isPlaceholder ? "true" : undefined}
                    href={navigationPage ? urlForAppPage(navigationPage) : "#"}
                    key={item}
                    onClick={(event) => handleNavigationClick(event, item)}
                    role="menuitem"
                  >
                    <NavigationIcon item={item} />
                    <span>{t.navigation.items[item]}</span>
                  </a>
                );
              })}
              {pluginMobileOverflowNavItems.map(({ plugin, nav, page }) => (
                <a
                  className={styles.utilityMenuItem}
                  href={urlForAppPage(page)}
                  key={`${plugin.id}:${nav.route}`}
                  onClick={(event) => handlePluginNavigationClick(event, page)}
                  role="menuitem"
                >
                  <ActionIcon name={iconNameForPlugin(nav.icon)} />
                  <span>{nav.label}</span>
                </a>
              ))}
            </div>
          ) : null}
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
            diagnostics={feedDiagnostics}
            diagnosticsByFeedId={feedDiagnosticsByFeedId}
            feedError={feedError}
            feedDiscovery={feedDiscovery}
            feedDiscoveryError={feedDiscoveryError}
            feedUrl={feedUrl}
            feedFolders={feedFolders}
            feeds={feeds}
            isAddingFeed={isAddingFeed}
            isDiscoveringFeeds={isDiscoveringFeeds}
            isFeedDiagnosticsLoading={isFeedDiagnosticsLoading}
            isExportingOpml={isExportingOpml}
            isImportingOpml={isImportingOpml}
            isLoading={isFeedsLoading}
            isRefreshingAllFeeds={isRefreshingAllFeeds}
            onAddCandidate={handleAddDiscoveredFeed}
            onAddFeed={handleAddFeed}
            onCreateFolder={handleCreateManagedFolder}
            onDeleteFeed={handleDeleteManagedFeed}
            onDeleteFolder={handleDeleteManagedFolder}
            onExportOpml={handleExportOpml}
            onImportOpml={handleImportOpml}
            onPluginAction={(action, context) => {
              void handlePluginAction(action, context);
            }}
            onRefreshFeed={handleRefreshFeed}
            onRefreshAllFeeds={handleRefreshAllFeeds}
            onPreviewFullContent={handlePreviewFullContent}
            onBackfillCurrentFeedFullContent={handleBackfillCurrentFeedFullContent}
            onUpdateFeedUrl={setFeedUrl}
            onUpdateFeed={handleUpdateManagedFeed}
            onUpdateFolder={handleUpdateManagedFolder}
            opmlSummary={opmlSummary}
            pluginToolbarActions={pluginActionsForSlot("feed.management.toolbar.end")}
            refreshingFeedId={refreshingFeedId}
          />
        ) : appPage.type === "full-content-preview" ? (
          <Suspense fallback={<p className={styles.settingsNotice}>{t.fullContentPreview.loading}</p>}>
          <LazyFullContentPreviewPage
            feed={feeds.find((feed) => feed.id === appPage.feedId) ?? null}
            feedId={appPage.feedId}
            onBack={() => navigateToAppPage({ type: "feed-management" })}
          />
          </Suspense>
        ) : appPage.type === "settings" ? (
          <Suspense fallback={<p className={styles.settingsNotice}>{t.settings.loading}</p>}>
          <LazySettingsWorkspace
            embeddingError={embeddingError}
            embeddingIndexes={embeddingIndexes}
            embeddingProviders={embeddingProviders}
            error={settingsError}
            isEmbeddingLoading={isEmbeddingLoading}
            isLoading={isSettingsLoading}
            activatingProviderId={activatingProviderId}
            isSavingEmbeddingProvider={isSavingEmbeddingProvider}
            isSaving={isSavingSettings}
            backfillingIndexId={backfillingIndexId}
            deletingProviderId={deletingProviderId}
            rebuildingIndexId={rebuildingIndexId}
            testingProviderId={testingProviderId}
            onBackfillEmbeddingIndex={handleBackfillEmbeddingIndex}
            onActivateEmbeddingProvider={async (providerId) => {
              await handleActivateEmbeddingProvider(providerId);
            }}
            onDeleteEmbeddingProvider={handleDeleteEmbeddingProvider}
            onChangePassword={handleChangePassword}
            onPreviewSettings={handlePreviewSettings}
            onRebuildEmbeddingIndex={handleRebuildEmbeddingIndex}
            onOpenAlgorithmTransparency={() => navigateToAppPage({ type: "algorithm-transparency" })}
            onSaveSettings={handleSaveSettings}
            onSaveEmbeddingProvider={handleSaveEmbeddingProvider}
            onTestEmbeddingProvider={handleTestEmbeddingProvider}
            settings={appSettings}
          />
          </Suspense>
        ) : appPage.type === "plugin" ? (
          <PluginWorkspace
            plugin={activePlugin}
            route={appPage.route}
            onOpenArticle={(articleId) => {
              navigateToAppPage({ type: "reader", view: currentArticleView });
              setSelectedArticleId(articleId);
            }}
          />
        ) : appPage.type === "algorithm-transparency" ? (
          <Suspense fallback={<p className={styles.settingsNotice}>{t.recommendationStatus.loading}</p>}>
          <LazyAlgorithmTransparencyPage
            error={recommendationStatusError}
            isLoading={isRecommendationStatusLoading}
            onBack={() => navigateToAppPage({ type: "settings" })}
            onOpenAllClusters={() => navigateToAppPage({ type: "algorithm-clusters" })}
            onRunMaintenanceTask={handleRunRecommendationMaintenanceTask}
            onUpdateClusterLabelLexicon={handleUpdateClusterLabelLexicon}
            onUpdateClusterLabel={handleUpdateRecommendationClusterLabel}
            onUpdateFamilyLabel={handleUpdateRecommendationFamilyLabel}
            onMergeCandidate={handleMergeClusterCandidate}
            onIgnoreCandidate={handleIgnoreClusterCandidate}
            clusterLabelLexicon={clusterLabelLexicon}
            mergeCandidates={mergeCandidates}
            runningMaintenanceTask={runningMaintenanceTask}
            status={recommendationStatus}
            updatingClusterLexicon={updatingClusterLexicon}
            updatingClusterLabelId={updatingClusterLabelId}
            updatingFamilyLabelId={updatingFamilyLabelId}
            updatingMergeCandidateId={updatingMergeCandidateId}
          />
          </Suspense>
        ) : appPage.type === "algorithm-clusters" ? (
          <Suspense fallback={<p className={styles.settingsNotice}>{t.recommendationStatus.loading}</p>}>
          <LazyAlgorithmClustersPage
            clusters={allRecommendationClusters}
            error={allClustersError}
            isLoading={isAllClustersLoading}
            onBack={() => navigateToAppPage({ type: "algorithm-transparency" })}
            onUpdateClusterLabel={handleUpdateRecommendationClusterLabel}
            onUpdateFamilyLabel={handleUpdateRecommendationFamilyLabel}
            total={allRecommendationClusterTotal}
            updatingClusterLabelId={updatingClusterLabelId}
            updatingFamilyLabelId={updatingFamilyLabelId}
          />
          </Suspense>
        ) : appPage.type === "search" ? (
          <div
            className={classNames(
              styles.workspace,
              selectedArticleId ? styles.workspaceReading : null
            )}
          >
            <SearchResultsPanel
              articleError={articleError}
              articles={articles}
              feedFolders={feedFolders}
              feeds={feeds}
              form={searchForm}
              hasSubmitted={hasSubmittedSearch}
              isArticlesLoading={isArticlesLoading}
              isMarkingScopeRead={isMarkingScopeRead}
              isLoadingMore={isLoadingMoreArticles}
              loadMoreError={loadMoreError}
              nextCursor={nextArticleCursor}
              onArticleAction={handleArticleAction}
              onPluginAction={(action, context) => {
                void handlePluginAction(action, context);
              }}
              onChange={handleSearchFormChange}
              onExplainArticle={(articleId) => {
                void handleOpenListExplanation(articleId);
              }}
              onLoadMore={handleLoadMoreArticles}
              onMarkScopeRead={handleMarkCurrentSearchScopeRead}
              onSelectArticle={handleSelectArticle}
              onSubmit={handleSearchSubmit}
              pendingAction={pendingArticleAction}
              pluginRowActions={pluginActionsForSlot("article.list.item.actions.end")}
              readerCommandError={readerCommandError}
              resultUrlForm={submittedSearchForm}
              selectedArticleId={selectedArticleId}
              unreadCount={unreadCount}
            />

            <ArticleDetailPanel
              actionError={articleActionError}
              article={articleDetail}
              articleView={
                submittedSearchForm.sort === "recommended" ? "recommended" : currentArticleView
              }
              detailError={detailError}
              explanation={
                articleDetail && rankExplanation?.articleId === articleDetail.id
                  ? rankExplanation
                  : null
              }
              explanationError={explanationError}
              isDetailLoading={isDetailLoading}
              isExplanationOpen={isExplanationOpen}
              isExplanationLoading={isExplanationLoading}
              onArticleAction={handleArticleAction}
              onPluginAction={(action, context) => {
                void handlePluginAction(action, context);
              }}
              onBackToList={handleBackToArticleList}
              onCloseExplanation={handleCloseExplanation}
              onOpenExplanation={handleOpenExplanation}
              onReadProgress={handleReadProgress}
              pendingAction={
                articleDetail && pendingArticleAction?.articleId === articleDetail.id
                  ? pendingArticleAction.intent
                  : null
              }
              pluginBottomActions={pluginActionsForSlot("article.reader.bottomSheet.actions")}
              pluginToolbarActions={pluginActionsForSlot("article.reader.toolbar.end")}
              readerSettings={appSettings.reader}
            />

            <ArticleExplanationDialog
              error={listExplanationError}
              explanation={listRankExplanation}
              isLoading={isListExplanationLoading}
              isOpen={isListExplanationOpen}
              onClose={clearListExplanation}
            />
          </div>
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
              diagnosticsByFeedId={feedDiagnosticsByFeedId}
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
                (currentArticleView === "latest" || currentArticleView === "recommended") &&
                selectedArticleId === null
              }
              isArticlesLoading={isArticlesLoading}
              isMarkingScopeRead={isMarkingScopeRead}
              isLoadingMore={isLoadingMoreArticles}
              listScrollKey={articleListScrollKey}
              loadMoreError={loadMoreError}
              nextCursor={nextArticleCursor}
              onIgnoreArticle={handleIgnoreArticle}
              onLoadMore={handleLoadMoreArticles}
              onMarkScopeRead={handleMarkCurrentArticleListScopeRead}
              onPreviewMarkScopeRead={previewCurrentArticleListScopeRead}
              onOpenSources={() => setIsSourceDrawerOpen(true)}
              onArticleAction={handleArticleAction}
              onPluginAction={(action, context) => {
                void handlePluginAction(action, context);
              }}
              onSelectArticle={handleSelectArticle}
              onExplainArticle={(articleId) => {
                void handleOpenListExplanation(articleId);
              }}
              onFavoriteSortChange={handleFavoriteSortChange}
              onReadLaterSortChange={handleReadLaterSortChange}
              onTimeWindowChange={handleTimeWindowChange}
              onUnreadOnlyChange={handleUnreadOnlyChange}
              favoriteSort={favoriteSort}
              readLaterSort={readLaterSort}
              pendingAction={pendingArticleAction}
              pluginListToolbarEndActions={pluginActionsForSlot("article.list.toolbar.end")}
              pluginListToolbarStartActions={pluginActionsForSlot("article.list.toolbar.start")}
              pluginRowActions={pluginActionsForSlot("article.list.item.actions.end")}
              recommendationStatus={
                currentArticleView === "recommended" ? recommendationStatus : null
              }
              recommendationStatusError={
                currentArticleView === "recommended" ? recommendationStatusError : null
              }
              readerCommandError={readerCommandError}
              selectedArticleId={selectedArticleId}
              selectedFeed={selectedFeed}
              selectedFolder={selectedFolder}
              showRecommendationStatus={currentArticleView === "recommended"}
              showQuickFilters={supportsQuickFilters(currentArticleView)}
              isRecommendationStatusLoading={isRecommendationStatusLoading}
              timeWindow={timeWindow}
              unreadCount={unreadCount}
              unreadOnly={unreadOnly}
            />

            <ArticleDetailPanel
              actionError={articleActionError}
              article={articleDetail}
              articleView={currentArticleView}
              detailError={detailError}
              explanation={
                articleDetail && rankExplanation?.articleId === articleDetail.id
                  ? rankExplanation
                  : null
              }
              explanationError={explanationError}
              isDetailLoading={isDetailLoading}
              isExplanationOpen={isExplanationOpen}
              isExplanationLoading={isExplanationLoading}
              onArticleAction={handleArticleAction}
              onPluginAction={(action, context) => {
                void handlePluginAction(action, context);
              }}
              onBackToList={handleBackToArticleList}
              onCloseExplanation={handleCloseExplanation}
              onOpenExplanation={handleOpenExplanation}
              onReadProgress={handleReadProgress}
              pendingAction={
                articleDetail && pendingArticleAction?.articleId === articleDetail.id
                  ? pendingArticleAction.intent
                  : null
              }
              pluginBottomActions={pluginActionsForSlot("article.reader.bottomSheet.actions")}
              pluginToolbarActions={pluginActionsForSlot("article.reader.toolbar.end")}
              readerSettings={appSettings.reader}
            />

            <ArticleExplanationDialog
              error={listExplanationError}
              explanation={listRankExplanation}
              isLoading={isListExplanationLoading}
              isOpen={isListExplanationOpen}
              onClose={clearListExplanation}
            />
          </div>
        )}
      </section>
    </main>
  );
}

function PluginWorkspace(props: {
  plugin: PluginListItem | null;
  route: string;
  onOpenArticle: (articleId: string) => void;
}) {
  const { t } = useI18n();

  useEffect(() => {
    async function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) {
        return;
      }
      const data = event.data as {
        type?: unknown;
        articleId?: unknown;
        requestId?: unknown;
        method?: unknown;
        payload?: unknown;
      };
      if (data.type === "dibao.openArticle" && typeof data.articleId === "string") {
        props.onOpenArticle(data.articleId);
        return;
      }
      if (!props.plugin || data.type !== "dibao.bridge" || typeof data.requestId !== "string") {
        return;
      }
      try {
        const result = await handlePluginBridgeRequest(
          props.plugin,
          data.method,
          data.payload,
          props.onOpenArticle
        );
        (event.source as WindowProxy | null)?.postMessage(
          {
            type: "dibao.bridge.response",
            schemaVersion: 1,
            pluginId: props.plugin.id,
            requestId: data.requestId,
            ok: true,
            result
          },
          event.origin
        );
      } catch (error) {
        (event.source as WindowProxy | null)?.postMessage(
          {
            type: "dibao.bridge.response",
            schemaVersion: 1,
            pluginId: props.plugin.id,
            requestId: data.requestId,
            ok: false,
            error: userMessageForError(error, t.errors.api)
          },
          event.origin
        );
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [props.plugin, props.onOpenArticle, t.errors.api]);

  if (!props.plugin) {
    return (
      <section className={styles.pluginWorkspace}>
        <div className={styles.emptyState}>
          <strong>插件不可用</strong>
          <p>这个插件尚未启用，或当前贡献点已经失效。</p>
        </div>
      </section>
    );
  }

  const baseUrl =
    props.plugin.webEntryUrl ??
    `/api/plugins/${encodeURIComponent(props.plugin.id)}/assets/web/index.html`;
  const params = new URLSearchParams();
  params.set("route", props.route);
  if (props.route === "settings") {
    params.set("panel", "settings");
  }

  return (
    <section className={styles.pluginWorkspace} aria-label={props.plugin.name}>
      <iframe
        className={styles.pluginFrame}
        src={`${baseUrl}?${params.toString()}`}
        title={props.plugin.name || t.common.brandName}
      />
    </section>
  );
}

async function handlePluginBridgeRequest(
  plugin: PluginListItem,
  method: unknown,
  payload: unknown,
  onOpenArticle: (articleId: string) => void
): Promise<unknown> {
  const input = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  switch (method) {
    case "getSettings":
      return await dibaoApi.getPluginSettings(plugin.id);
    case "updatePluginSettings":
      return await dibaoApi.updatePluginSettings(
        plugin.id,
        input.settings && typeof input.settings === "object" && !Array.isArray(input.settings)
          ? input.settings as Record<string, unknown>
          : input
      );
    case "startTask":
      if (typeof input.taskId !== "string") {
        throw new Error("taskId is required");
      }
      return await dibaoApi.startPluginTask(plugin.id, input.taskId);
    case "listJobs":
      return await dibaoApi.listJobs({
        type: typeof input.type === "string" ? input.type : undefined,
        status: isPluginJobStatus(input.status) ? input.status : undefined,
        limit: typeof input.limit === "number" ? input.limit : undefined
      });
    case "readArticles":
      return await dibaoApi.listArticles({
        view: isArticleView(input.view) ? input.view : "recommended",
        limit: typeof input.limit === "number" ? input.limit : undefined
      });
    case "openArticle":
      if (typeof input.articleId !== "string") {
        throw new Error("articleId is required");
      }
      onOpenArticle(input.articleId);
      return { ok: true };
    case "pluginApi":
      if (typeof input.path !== "string") {
        throw new Error("path is required");
      }
      return await dibaoApi.callPluginApi(plugin.id, input.path, input.body ?? {});
    default:
      throw new Error("Unsupported plugin bridge method");
  }
}

function isArticleView(value: unknown): value is ArticleView {
  return value === "latest" || value === "recommended" || value === "favorites" || value === "read_later";
}

function isPluginJobStatus(value: unknown): value is JobListItem["status"] {
  return value === "queued" || value === "running" || value === "succeeded" || value === "failed" || value === "cancelled";
}

function iconNameForPlugin(icon: string | undefined): Parameters<typeof ActionIcon>[0]["name"] {
  if (icon === "settings" || icon === "gear") {
    return "gear";
  }
  if (icon === "search") {
    return "search";
  }
  if (icon === "star" || icon === "favorites") {
    return "star";
  }
  if (icon === "bookmark" || icon === "read_later") {
    return "bookmark";
  }
  if (icon === "sparkle" || icon === "recommended") {
    return "sparkle";
  }
  return "feed";
}
