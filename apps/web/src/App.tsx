import type { ChangeEvent, CSSProperties, FormEvent, MouseEvent } from "react";
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
  type Feed,
  type FeedFolder,
  type OpmlImportResponse,
  type RankExplanation,
  type RankExplanationReason,
  type ReaderSettings,
  type SetupStatus,
  type UpdateFeedFolderInput,
  type UpdateFeedInput,
  type UpdateSettingsInput
} from "./api.js";
import styles from "./design-system/AppShell/AppShell.module.css";
import { FeedManagementWorkspace } from "./FeedManagementPanel.js";
import { defaultLocale, useI18n, type Dictionary, type NavigationItemKey } from "./i18n.js";

const navigationItems: NavigationItemKey[] = [
  "latest",
  "recommended",
  "saved",
  "readLater",
  "search",
  "feeds",
  "settings"
];

type Notice =
  | { type: "feedAddedAndRefreshed"; feedTitle: string }
  | { type: "feedRefreshed"; feedTitle: string }
  | { type: "allFeedsRefreshQueued"; jobCount: number }
  | { type: "opmlImported"; result: OpmlImportResponse }
  | { type: "opmlExported" }
  | { type: "settingsSaved" };

export type SourceSelection =
  | { type: "all" }
  | { type: "folder"; folderId: string }
  | { type: "feed"; feedId: string };

type AuthMode = "setup" | "login";

export type AppPage =
  | { type: "reader"; view: ArticleView }
  | { type: "feed-management" }
  | { type: "settings" };

export type AppStage =
  | { type: "auth-loading" }
  | { type: "welcome" }
  | { type: "setup-password" }
  | { type: "login" }
  | { type: "setup-status-loading" }
  | { type: "setup-sources" }
  | { type: "setup-provider-placeholder" }
  | { type: "reader" };

export type ArticleActionIntent = "favorite" | "readLater" | "readStatus" | "notInterested";

type PendingArticleAction = {
  articleId: string;
  intent: ArticleActionIntent;
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
  const [feedFolders, setFeedFolders] = useState<FeedFolder[]>([]);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [articles, setArticles] = useState<ArticleListItem[]>([]);
  const [sourceSelection, setSourceSelection] = useState<SourceSelection>({ type: "all" });
  const [appPage, setAppPage] = useState<AppPage>({ type: "reader", view: "latest" });
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [articleDetail, setArticleDetail] = useState<ArticleDetail | null>(null);
  const [rankExplanation, setRankExplanation] = useState<RankExplanation | null>(null);
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
  const articleRequestVersion = useRef(0);
  const hasLoadedSettingsForSession = useRef(false);

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
    setArticles((current) =>
      current
        .map((article) => (article.id === articleId ? { ...article, state } : article))
        .filter((article) =>
          article.id === articleId ? !state.hidden && !state.notInterested : true
        )
    );
    setArticleDetail((current) =>
      current?.id === articleId
        ? {
            ...current,
            state
          }
        : current
    );
  }

  function resetArticleListForPendingQuery() {
    articleRequestVersion.current += 1;
    setArticles([]);
    setNextArticleCursor(null);
    setSelectedArticleId(null);
    setArticleDetail(null);
    setRankExplanation(null);
    setArticleError(null);
    setLoadMoreError(null);
    setIsLoadingMoreArticles(false);
    setDetailError(null);
    setExplanationError(null);
  }

  function handleSelectSource(source: SourceSelection) {
    if (!sameSourceSelection(sourceSelection, source)) {
      resetArticleListForPendingQuery();
    }
    setSourceSelection(source);
  }

  function handleArticleViewChange(view: ArticleView) {
    if (appPage.type !== "reader" || appPage.view !== view) {
      resetArticleListForPendingQuery();
    }
    setAppPage({ type: "reader", view });
  }

  const resetReaderState = useCallback(() => {
    setFeedFolders([]);
    setFeeds([]);
    setArticles([]);
    setSourceSelection({ type: "all" });
    setAppPage({ type: "reader", view: "latest" });
    setSelectedArticleId(null);
    setArticleDetail(null);
    setRankExplanation(null);
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
    setLocale(defaultLocale);
    setOpmlSummary(null);
    setNextArticleCursor(null);
    setPendingArticleAction(null);
    setNotice(null);
    hasLoadedSettingsForSession.current = false;
    openedArticleIds.current.clear();
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

  const loadArticles = useCallback(async (selection: SourceSelection, view: ArticleView) => {
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
    setDetailError(null);
    setExplanationError(null);

    try {
      const response = await dibaoApi.listArticles({
        ...articleQueryFor(selection),
        view,
        limit: 50
      });
      if (requestVersion !== articleRequestVersion.current) {
        return;
      }
      setArticles(response.data);
      setNextArticleCursor(response.page.nextCursor);
      setSelectedArticleId(response.data[0]?.id ?? null);
    } catch (error) {
      if (requestVersion !== articleRequestVersion.current) {
        return;
      }
      setArticleError(userMessageForError(error, t.errors.api));
      setArticles([]);
      setSelectedArticleId(null);
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

    void Promise.all([loadFeedFolders(), loadFeeds()]);
  }, [appPage.type, appStage.type, loadFeedFolders, loadFeeds]);

  useEffect(() => {
    if (appStage.type !== "reader" || appPage.type !== "reader") {
      return;
    }

    void loadArticles(sourceSelection, appPage.view);
  }, [appPage, appStage.type, loadArticles, sourceSelection]);

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
          ? loadArticles(sourceSelection, appPage.view)
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
          ? loadArticles(sourceSelection, appPage.view)
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
      await loadArticles(nextSourceSelection, appPage.view);
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
        cursor: nextArticleCursor
      });
      if (requestVersion !== articleRequestVersion.current) {
        return;
      }
      setArticles((current) => appendUniqueArticles(current, response.data));
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

  function handleNavigationClick(event: MouseEvent<HTMLAnchorElement>, item: NavigationItemKey) {
    event.preventDefault();
    const page = pageForNavigationItem(item);
    if (!page) {
      return;
    }

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
      : t.shell.pageTitles[currentArticleView];
  const topbarStatus =
    appPage.type === "feed-management"
      ? isFeedsLoading
        ? t.feedManagement.loading
        : t.feedManagement.status(feeds.length, feedFolders.length)
      : appPage.type === "settings"
        ? settingsError ?? noticeText ?? (isSettingsLoading ? t.settings.loading : t.settings.status)
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
            feedFolders={feedFolders}
            feeds={feeds}
            isLoading={isFeedsLoading}
            onCreateFolder={handleCreateManagedFolder}
            onDeleteFeed={handleDeleteManagedFeed}
            onDeleteFolder={handleDeleteManagedFolder}
            onUpdateFeed={handleUpdateManagedFeed}
            onUpdateFolder={handleUpdateManagedFolder}
          />
        ) : appPage.type === "settings" ? (
          <SettingsWorkspace
            error={settingsError}
            isLoading={isSettingsLoading}
            isSaving={isSavingSettings}
            onPreviewSettings={handlePreviewSettings}
            onSaveSettings={handleSaveSettings}
            settings={appSettings}
          />
        ) : (
          <div className={styles.workspace}>
            <FeedPanel
              feedError={feedError}
              feedFolders={feedFolders}
              feeds={feeds}
              feedUrl={feedUrl}
              isAddingFeed={isAddingFeed}
              isFeedsLoading={isFeedsLoading}
              isExportingOpml={isExportingOpml}
              isImportingOpml={isImportingOpml}
              isRefreshingAllFeeds={isRefreshingAllFeeds}
              onAddFeed={handleAddFeed}
              onExportOpml={handleExportOpml}
              onImportOpml={handleImportOpml}
              onRefreshAllFeeds={handleRefreshAllFeeds}
              onRefreshFeed={handleRefreshFeed}
              onSelectSource={handleSelectSource}
              onUpdateFeedUrl={setFeedUrl}
              opmlSummary={opmlSummary}
              refreshingFeedId={refreshingFeedId}
              sourceSelection={sourceSelection}
            />

            <ArticleListPanel
              articleError={articleError}
              articleView={currentArticleView}
              articles={articles}
              feedCount={feeds.length}
              isArticlesLoading={isArticlesLoading}
              isLoadingMore={isLoadingMoreArticles}
              loadMoreError={loadMoreError}
              nextCursor={nextArticleCursor}
              onLoadMore={handleLoadMoreArticles}
              onSelectArticle={setSelectedArticleId}
              selectedArticleId={selectedArticleId}
              selectedFeed={selectedFeed}
              selectedFolder={selectedFolder}
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
  fontSize: string;
  lineHeight: string;
  paragraphGap: string;
  readerWidth: string;
  retentionDays: string;
};

export function SettingsWorkspace(props: {
  error: string | null;
  isLoading: boolean;
  isSaving: boolean;
  onPreviewSettings: (settings: AppSettings) => void;
  onSaveSettings: (input: UpdateSettingsInput) => Promise<void>;
  settings: AppSettings;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<SettingsDraft>(() => draftForSettings(props.settings));
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(draftForSettings(props.settings));
  }, [props.settings]);

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
          <div className={styles.setupStatusBox}>
            <strong>{t.settings.sections.provider.disabled}</strong>
          </div>
        </section>
      </div>
    </form>
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
  feedUrl: string;
  isAddingFeed: boolean;
  isFeedsLoading: boolean;
  isExportingOpml: boolean;
  isImportingOpml: boolean;
  isRefreshingAllFeeds: boolean;
  onAddFeed: (event: FormEvent<HTMLFormElement>) => void;
  onExportOpml: () => void;
  onImportOpml: (event: ChangeEvent<HTMLInputElement>) => void;
  onRefreshAllFeeds: () => void;
  onRefreshFeed: (feed: Feed) => void;
  onSelectSource: (source: SourceSelection) => void;
  onUpdateFeedUrl: (value: string) => void;
  opmlSummary: OpmlImportResponse | null;
  refreshingFeedId: string | null;
  sourceSelection: SourceSelection;
}) {
  const { t, formatDate } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const feedCountByFolder = useMemo(() => countFeedsByFolder(props.feeds), [props.feeds]);

  return (
    <section className={styles.feedPanel} aria-labelledby="feeds-title">
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.kicker}>{t.feeds.kicker}</p>
          <h2 id="feeds-title">{t.feeds.title}</h2>
        </div>
        <span className={styles.count}>{props.feeds.length}</span>
      </div>

      <form className={styles.addFeedForm} onSubmit={props.onAddFeed}>
        <label htmlFor="feed-url">{t.feeds.inputLabel}</label>
        <div className={styles.addFeedRow}>
          <input
            id="feed-url"
            inputMode="url"
            onChange={(event) => props.onUpdateFeedUrl(event.target.value)}
            placeholder={t.feeds.inputPlaceholder}
            type="url"
            value={props.feedUrl}
          />
          <button className={styles.primaryButton} disabled={props.isAddingFeed} type="submit">
            {props.isAddingFeed ? t.feeds.adding : t.feeds.add}
          </button>
        </div>
      </form>

      <div className={styles.opmlActions}>
        <input
          accept=".opml,.xml,text/xml,application/xml"
          className={styles.fileInput}
          onChange={props.onImportOpml}
          ref={fileInputRef}
          type="file"
        />
        <button
          className={styles.secondaryButton}
          disabled={props.isImportingOpml}
          onClick={() => fileInputRef.current?.click()}
          type="button"
        >
          {props.isImportingOpml ? t.opml.importing : t.opml.import}
        </button>
        <button
          className={styles.secondaryButton}
          disabled={props.isExportingOpml}
          onClick={props.onExportOpml}
          type="button"
        >
          {props.isExportingOpml ? t.opml.exporting : t.opml.export}
        </button>
        <button
          className={styles.secondaryButton}
          disabled={props.isRefreshingAllFeeds || !props.feeds.some((feed) => feed.enabled)}
          onClick={props.onRefreshAllFeeds}
          type="button"
        >
          {props.isRefreshingAllFeeds ? t.feeds.refreshingAll : t.feeds.refreshAll}
        </button>
      </div>

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
  feedCount: number;
  isArticlesLoading: boolean;
  isLoadingMore: boolean;
  loadMoreError: string | null;
  nextCursor: string | null;
  onLoadMore: () => void;
  onSelectArticle: (articleId: string) => void;
  selectedArticleId: string | null;
  selectedFeed: Feed | null;
  selectedFolder: FeedFolder | null;
}) {
  const { t, formatDate } = useI18n();
  const sourceTitle =
    props.selectedFeed?.title ?? props.selectedFolder?.title ?? t.articles.allSources;

  return (
    <section className={styles.articlePanel} aria-labelledby="articles-title">
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.kicker}>{sourceTitle}</p>
          <h2 id="articles-title">{t.articles.views[props.articleView]}</h2>
        </div>
        <span className={styles.count}>{props.articles.length}</span>
      </div>

      {props.articleError ? <p className={styles.errorText}>{props.articleError}</p> : null}

      <div className={styles.list} aria-live="polite">
        {props.isArticlesLoading ? <SkeletonRows count={10} /> : null}

        {!props.isArticlesLoading && props.articles.length === 0 ? (
          <EmptyState
            title={
              props.feedCount === 0
                ? t.articles.emptyNoFeedsTitle
                : t.articles.emptyNoArticlesTitle
            }
            body={
              props.feedCount === 0
                ? t.articles.emptyNoFeedsBody
                : t.articles.emptyNoArticlesBody
            }
          />
        ) : null}

        {!props.isArticlesLoading &&
          props.articles.map((article) => (
            <button
              className={
                props.selectedArticleId === article.id
                  ? styles.articleItemActive
                  : article.state.read
                    ? styles.articleItemRead
                    : styles.articleItem
              }
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

function ArticleDetailPanel(props: {
  actionError: string | null;
  article: ArticleDetail | null;
  detailError: string | null;
  explanation: RankExplanation | null;
  explanationError: string | null;
  isDetailLoading: boolean;
  isExplanationLoading: boolean;
  onArticleAction: (article: ArticleDetail, intent: ArticleActionIntent) => void;
  pendingAction: ArticleActionIntent | null;
  readerSettings: ReaderSettings;
}) {
  const { t, formatDate } = useI18n();
  const safeHtml = useMemo(
    () => (props.article?.contentHtml ? sanitizeArticleHtml(props.article.contentHtml) : null),
    [props.article?.contentHtml]
  );

  return (
    <section
      className={styles.readerPanel}
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

  return (
    <span className={styles.articleBadges}>
      <span className={props.state.read ? styles.articleBadgeMuted : styles.articleBadge}>
        {props.state.read ? t.articles.state.read : t.articles.state.unread}
      </span>
      {props.state.favorited ? (
        <span className={styles.articleBadgeAccent}>{t.articles.state.favorited}</span>
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
          ariaLabel={state.read ? t.actions.aria.markUnread : t.actions.aria.markRead}
          busy={props.pendingAction === "readStatus"}
          disabled={isBusy}
          label={state.read ? t.actions.markUnread : t.actions.markRead}
          onClick={() => props.onAction("readStatus")}
          selected={state.read}
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

function draftForSettings(settings: AppSettings): SettingsDraft {
  return {
    locale: settings.ui.locale,
    fontSize: String(settings.reader.fontSize),
    lineHeight: String(settings.reader.lineHeight),
    paragraphGap: String(settings.reader.paragraphGap),
    readerWidth: String(settings.reader.readerWidth),
    retentionDays: String(settings.retention.retentionDays)
  };
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
      retention: {
        retentionDays
      }
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

function pageForNavigationItem(item: NavigationItemKey): AppPage | null {
  if (item === "latest" || item === "recommended") {
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
  }
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
    case "readLater":
      return {
        type: "read_later",
        value: !state.readLater
      };
    case "readStatus":
      return {
        type: "mark_read",
        value: !state.read
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
    case "readLater":
      return t.actions.errors.readLater;
    case "readStatus":
      return t.actions.errors.readStatus;
    case "notInterested":
      return t.actions.errors.notInterested;
  }
}

function explanationReasonText(reason: RankExplanationReason, t: Dictionary): string {
  switch (reason.type) {
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
