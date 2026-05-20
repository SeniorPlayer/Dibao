import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  App,
  AlgorithmTransparencyPage,
  ArticleActionControls,
  ArticleExplanationEntry,
  ArticleListPanel,
  AuthGatePanel,
  FeedPanel,
  pageForNavigationItem,
  RankExplanationPanel,
  SettingsWorkspace,
  SetupProviderPlaceholderPanel,
  SetupSourcesPanel,
  SetupWelcomePanel,
  correctSourceSelection,
  readerStyleFor,
  stageForAuthSession,
  stageForSetupStatus
} from "./App.js";
import {
  articleListAfterStateUpdate,
  articleListWithKnownLocalStates,
  articlesVisibleForUnreadFilter,
  unreadCountWithKnownLocalStates,
  unreadCountAfterStateChange
} from "./articleListState.js";
import { defaultAppSettings, type ArticleListItem } from "./api.js";
import { FeedManagementWorkspace } from "./FeedManagementPanel.js";
import {
  DibaoI18nProvider,
  createI18n,
  defaultLocale,
  dictionaries,
  supportedLocales
} from "./i18n.js";

describe("web i18n", () => {
  it("keeps dictionary key structure aligned across locales", () => {
    const [baseLocale, ...otherLocales] = supportedLocales;
    const baseShape = dictionaryShape(dictionaries[baseLocale]);

    for (const locale of otherLocales) {
      expect(dictionaryShape(dictionaries[locale])).toEqual(baseShape);
    }
  });

  it("uses zh-CN defaults for copy and date formatting", () => {
    const i18n = createI18n();

    expect(i18n.locale).toBe(defaultLocale);
    expect(i18n.t.errors.api.requestFailed).toBe("请求失败，请稍后重试。");
    expect(i18n.formatDate("2026-05-14T08:00:00.000Z")).not.toBe("2026-05-14T08:00:00.000Z");
  });

  it("renders App auth loading with dictionary copy for a non-default locale", () => {
    const html = renderToStaticMarkup(
      <DibaoI18nProvider locale="en-US">
        <App />
      </DibaoI18nProvider>
    );

    expect(html).toContain("Checking session");
    expect(html).toContain("Dibao");
    expect(html).not.toContain("正在检查登录状态");
  });

  it("maps auth and setup status to first-run stages", () => {
    expect(
      stageForAuthSession({
        setupCompleted: false,
        authenticated: false
      })
    ).toEqual({ type: "welcome" });
    expect(
      stageForAuthSession({
        setupCompleted: true,
        authenticated: false
      })
    ).toEqual({ type: "login" });
    expect(
      stageForSetupStatus({
        setupCompleted: true,
        hasFeeds: false,
        hasEmbeddingProvider: false,
        firstRefreshStatus: "idle"
      })
    ).toEqual({ type: "setup-sources" });
    expect(
      stageForSetupStatus({
        setupCompleted: true,
        hasFeeds: true,
        hasEmbeddingProvider: false,
        firstRefreshStatus: "idle"
      })
    ).toEqual({ type: "reader" });
  });

  it("corrects source selection when feeds or folders disappear", () => {
    expect(
      correctSourceSelection(
        { type: "feed", feedId: "feed_missing" },
        [{ id: "feed_design" }],
        [{ id: "folder_design" }]
      )
    ).toEqual({ type: "all" });
    expect(
      correctSourceSelection(
        { type: "folder", folderId: "folder_missing" },
        [{ id: "feed_design" }],
        [{ id: "folder_design" }]
      )
    ).toEqual({ type: "all" });
    expect(
      correctSourceSelection(
        { type: "feed", feedId: "feed_design" },
        [{ id: "feed_design" }],
        [{ id: "folder_design" }]
      )
    ).toEqual({ type: "feed", feedId: "feed_design" });
  });

  it("maps favorites and read-later navigation to article views", () => {
    expect(pageForNavigationItem("favorites")).toEqual({ type: "reader", view: "favorites" });
    expect(pageForNavigationItem("read_later")).toEqual({ type: "reader", view: "read_later" });
  });

  it("keeps unread-only initial loads strict while preserving the current queue after state updates", () => {
    const unreadArticle = articleListItem("article_unread", "unseen");
    const ignoredArticle = articleListItem("article_ignored", "ignored");

    expect(
      articlesVisibleForUnreadFilter([unreadArticle, ignoredArticle], true).map(
        (article) => article.id
      )
    ).toEqual(["article_unread"]);
    expect(
      articleListAfterStateUpdate(
        [unreadArticle],
        "article_unread",
        {
          ...unreadArticle.state,
          interactionStatus: "ignored",
          ignoredAt: Date.parse("2026-05-14T08:30:00.000Z")
        }
      )[0].state.interactionStatus
    ).toBe("ignored");
    expect(
      articleListAfterStateUpdate(
        [unreadArticle],
        "article_unread",
        {
          ...unreadArticle.state,
          interactionStatus: "ignored",
          ignoredAt: Date.parse("2026-05-14T08:30:00.000Z")
        }
      )[0].state.interactionStatus
    ).toBe("ignored");
    expect(
      unreadCountAfterStateChange(12, unreadArticle.state, {
        ...unreadArticle.state,
        interactionStatus: "opened",
        openedAt: Date.parse("2026-05-14T08:31:00.000Z")
      })
    ).toBe(11);
    expect(
      unreadCountAfterStateChange(11, unreadArticle.state, {
        ...unreadArticle.state,
        hidden: true
      })
    ).toBe(10);
  });

  it("preserves locally updated article states when a stale list response arrives late", () => {
    const staleUnreadArticle = articleListItem("article_unread", "unseen");
    const openedState = {
      ...staleUnreadArticle.state,
      interactionStatus: "opened" as const,
      openedAt: Date.parse("2026-05-14T08:31:00.000Z")
    };
    const knownStates = new Map([[staleUnreadArticle.id, openedState]]);
    const locallyUpdatedIds = new Set([staleUnreadArticle.id]);

    expect(
      articleListWithKnownLocalStates(
        [staleUnreadArticle],
        knownStates,
        locallyUpdatedIds
      )[0].state
    ).toMatchObject({
      interactionStatus: "opened",
      openedAt: openedState.openedAt
    });
    expect(
      unreadCountWithKnownLocalStates(
        12,
        [staleUnreadArticle],
        knownStates,
        locallyUpdatedIds
      )
    ).toBe(11);
  });

  it("renders setup and login auth gate copy from the dictionary", () => {
    const setupHtml = renderToStaticMarkup(
      <DibaoI18nProvider>
        <AuthGatePanel isSubmitting={false} mode="setup" onSubmit={() => undefined} />
      </DibaoI18nProvider>
    );
    const loginHtml = renderToStaticMarkup(
      <DibaoI18nProvider locale="en-US">
        <AuthGatePanel
          error="Invalid password"
          isSubmitting={false}
          mode="login"
          onSubmit={() => undefined}
        />
      </DibaoI18nProvider>
    );

    expect(setupHtml).toContain("设置访问密码");
    expect(setupHtml).toContain("完成设置");
    expect(loginHtml).toContain("Log in to Dibao");
    expect(loginHtml).toContain("Invalid password");
  });

  it("renders first-run wizard copy without provider configuration fields", () => {
    const welcomeHtml = renderToStaticMarkup(
      <DibaoI18nProvider>
        <SetupWelcomePanel onStart={() => undefined} />
      </DibaoI18nProvider>
    );
    const sourcesHtml = renderToStaticMarkup(
      <DibaoI18nProvider>
        <SetupSourcesPanel
          error={null}
          feedUrl=""
          isAddingFeed={false}
          isImportingOpml={false}
          onAddFeed={() => undefined}
          onImportOpml={() => undefined}
          onUpdateFeedUrl={() => undefined}
          opmlSummary={null}
        />
      </DibaoI18nProvider>
    );
    const providerHtml = renderToStaticMarkup(
      <DibaoI18nProvider>
        <SetupProviderPlaceholderPanel onContinue={() => undefined} />
      </DibaoI18nProvider>
    );

    expect(welcomeHtml).toContain("欢迎使用邸报");
    expect(welcomeHtml).toContain("开始设置");
    expect(sourcesHtml).toContain("添加订阅源");
    expect(sourcesHtml).toContain("导入 OPML 文件");
    expect(sourcesHtml).toContain("RSS / Atom URL");
    expect(providerHtml).toContain("推荐能力");
    expect(providerHtml).toContain("当前使用基础排序");
    expect(providerHtml).toContain("暂不配置，继续");
    expect(providerHtml).not.toContain("API Key");
    expect(providerHtml).not.toContain("Provider URL");
    expect(providerHtml).not.toContain("Model");
    expect(providerHtml).not.toContain("测试连接");
  });

  it("renders OPML, folder, and pagination copy from the dictionary", () => {
    const feedPanel = renderToStaticMarkup(
      <DibaoI18nProvider>
        <FeedPanel
          feedError={null}
          feedFolders={[
            {
              id: "folder_design",
              title: "设计",
              sortOrder: 0
            }
          ]}
          feeds={[
            {
              id: "feed_design",
              folderId: "folder_design",
              title: "Design Feed",
              siteUrl: null,
              feedUrl: "https://example.com/feed.xml",
              description: null,
              enabled: true,
              sourceWeight: 0,
              lastFetchedAt: null,
              lastSuccessAt: null,
              nextRefreshAt: "2026-05-14T09:00:00.000Z",
              lastError: null,
              createdAt: "2026-05-14T08:00:00.000Z",
              updatedAt: "2026-05-14T08:00:00.000Z"
            }
          ]}
          isOpen={false}
          isFeedsLoading={false}
          onRefreshFeed={() => undefined}
          onCloseSources={() => undefined}
          onSelectSource={() => undefined}
          refreshingFeedId={null}
          sourceSelection={{ type: "all" }}
        />
      </DibaoI18nProvider>
    );
    const articlePanel = renderToStaticMarkup(
      <DibaoI18nProvider>
        <ArticleListPanel
          articleError={null}
          articleView="latest"
          articles={[]}
          favoriteSort="favorited_desc"
          readLaterSort="ranked"
          feedCount={1}
          isIgnoreTelemetryEnabled={true}
          isArticlesLoading={false}
          isLoadingMore={false}
          isRecommendationStatusLoading={false}
          loadMoreError={null}
          nextCursor="cursor_1"
          onFavoriteSortChange={() => undefined}
          onReadLaterSortChange={() => undefined}
          onIgnoreArticle={() => undefined}
          onLoadMore={() => undefined}
          onOpenSources={() => undefined}
          onExplainArticle={() => undefined}
          onSelectArticle={() => undefined}
          onTodayOnlyChange={() => undefined}
          onUnreadOnlyChange={() => undefined}
          recommendationStatus={null}
          recommendationStatusError={null}
          selectedArticleId={null}
          selectedFeed={null}
          selectedFolder={{
            id: "folder_design",
            title: "设计",
            sortOrder: 0
          }}
          showRecommendationStatus={false}
          showQuickFilters={true}
          todayOnly={false}
          unreadCount={12}
          unreadOnly={false}
        />
      </DibaoI18nProvider>
    );

    expect(feedPanel).not.toContain("导入 OPML");
    expect(feedPanel).not.toContain("导出 OPML");
    expect(feedPanel).not.toContain("刷新全部");
    expect(feedPanel).toContain("下次抓取");
    expect(feedPanel).toContain("分组");
    expect(feedPanel).toContain('title="刷新 Design Feed"');
    expect(articlePanel).toContain("只看未读");
    expect(articlePanel).toContain("今日");
    expect(articlePanel).toContain("加载更多");
    expect(articlePanel).toContain("设计");
  });

  it("renders recommendation status with diagnostics metrics", () => {
    const html = renderToStaticMarkup(
      <DibaoI18nProvider>
        <ArticleListPanel
          articleError={null}
          articleView="recommended"
          articles={[]}
          favoriteSort="favorited_desc"
          readLaterSort="ranked"
          feedCount={1}
          isIgnoreTelemetryEnabled={true}
          isArticlesLoading={false}
          isLoadingMore={false}
          isRecommendationStatusLoading={false}
          loadMoreError={null}
          nextCursor={null}
          onFavoriteSortChange={() => undefined}
          onReadLaterSortChange={() => undefined}
          onIgnoreArticle={() => undefined}
          onLoadMore={() => undefined}
          onOpenSources={() => undefined}
          onExplainArticle={() => undefined}
          onSelectArticle={() => undefined}
          onTodayOnlyChange={() => undefined}
          onUnreadOnlyChange={() => undefined}
          recommendationStatus={{
            mode: "embedding",
            activeProvider: null,
            activeIndex: null,
            activeRankContext: "base",
            coverage: {
              candidateCount: 4,
              embeddingCount: 2,
              coverageRatio: 0.5,
              pendingJobs: 1,
              failedJobs: 0,
              lastFailedAt: null,
              lastError: null
            },
            behaviorCounts: {
              open: 2,
              read_progress: 1
            },
            clusters: {
              positive: 1,
              negative: 0
            },
            rankedArticles: {
              base: 4,
              active: 2
            },
            lastProfileUpdate: "2026-05-14T08:09:00.000Z",
            lastRankingUpdate: "2026-05-14T08:11:00.000Z",
            warnings: []
          }}
          recommendationStatusError={null}
          selectedArticleId={null}
          selectedFeed={null}
          selectedFolder={null}
          showRecommendationStatus
          showQuickFilters={true}
          todayOnly={false}
          unreadCount={3}
          unreadOnly={true}
        />
      </DibaoI18nProvider>
    );

    expect(html).toContain("推荐状态");
    expect(html).toContain("Embedding 生成中");
    expect(html).toContain("行为 3");
    expect(html).toContain("Coverage 50%");
    expect(html).toContain("兴趣簇 +1 / -0");
  });

  it("renders article summaries as plain text in the list", () => {
    const article: ArticleListItem = {
      id: "article_html_summary",
      feedId: "feed_design",
      feedTitle: "Design Feed",
      title: "HTML summary",
      url: "https://example.com/article",
      author: null,
      summary: "<p>摘要 <strong>正文</strong> &amp; 线索</p>",
      publishedAt: "2026-05-14T08:00:00.000Z",
      discoveredAt: "2026-05-14T08:00:00.000Z",
      state: {
        read: false,
        favorited: false,
        liked: false,
        readLater: false,
        hidden: false,
        notInterested: false,
        readingProgress: 0,
        interactionStatus: "unseen",
        openedAt: null,
        ignoredAt: null
      }
    };
    const html = renderToStaticMarkup(
      <DibaoI18nProvider>
        <ArticleListPanel
          articleError={null}
          articleView="latest"
          articles={[article]}
          favoriteSort="favorited_desc"
          readLaterSort="ranked"
          feedCount={1}
          isIgnoreTelemetryEnabled={false}
          isArticlesLoading={false}
          isLoadingMore={false}
          isRecommendationStatusLoading={false}
          loadMoreError={null}
          nextCursor={null}
          onFavoriteSortChange={() => undefined}
          onReadLaterSortChange={() => undefined}
          onIgnoreArticle={() => undefined}
          onLoadMore={() => undefined}
          onOpenSources={() => undefined}
          onExplainArticle={() => undefined}
          onSelectArticle={() => undefined}
          onTodayOnlyChange={() => undefined}
          onUnreadOnlyChange={() => undefined}
          recommendationStatus={null}
          recommendationStatusError={null}
          selectedArticleId={null}
          selectedFeed={null}
          selectedFolder={null}
          showRecommendationStatus={false}
          showQuickFilters={true}
          todayOnly={false}
          unreadCount={1}
          unreadOnly={false}
        />
      </DibaoI18nProvider>
    );

    expect(html).toContain("摘要 正文 &amp; 线索");
    expect(html).not.toContain("&lt;strong&gt;");
  });

  it("only renders row recommendation explain actions for personalized views", () => {
    const article = articleListItem("article_fixture", "unseen");
    const latestHtml = renderToStaticMarkup(
      <DibaoI18nProvider>
        <ArticleListPanel
          articleError={null}
          articleView="latest"
          articles={[article]}
          favoriteSort="favorited_desc"
          readLaterSort="ranked"
          feedCount={1}
          isIgnoreTelemetryEnabled={false}
          isArticlesLoading={false}
          isLoadingMore={false}
          isRecommendationStatusLoading={false}
          loadMoreError={null}
          nextCursor={null}
          onFavoriteSortChange={() => undefined}
          onReadLaterSortChange={() => undefined}
          onIgnoreArticle={() => undefined}
          onLoadMore={() => undefined}
          onOpenSources={() => undefined}
          onExplainArticle={() => undefined}
          onSelectArticle={() => undefined}
          onTodayOnlyChange={() => undefined}
          onUnreadOnlyChange={() => undefined}
          recommendationStatus={null}
          recommendationStatusError={null}
          selectedArticleId={null}
          selectedFeed={null}
          selectedFolder={null}
          showRecommendationStatus={false}
          showQuickFilters={true}
          todayOnly={false}
          unreadCount={1}
          unreadOnly={false}
        />
      </DibaoI18nProvider>
    );
    const recommendedHtml = renderToStaticMarkup(
      <DibaoI18nProvider>
        <ArticleListPanel
          articleError={null}
          articleView="recommended"
          articles={[article]}
          favoriteSort="favorited_desc"
          readLaterSort="ranked"
          feedCount={1}
          isIgnoreTelemetryEnabled={false}
          isArticlesLoading={false}
          isLoadingMore={false}
          isRecommendationStatusLoading={false}
          loadMoreError={null}
          nextCursor={null}
          onFavoriteSortChange={() => undefined}
          onReadLaterSortChange={() => undefined}
          onIgnoreArticle={() => undefined}
          onLoadMore={() => undefined}
          onOpenSources={() => undefined}
          onExplainArticle={() => undefined}
          onSelectArticle={() => undefined}
          onTodayOnlyChange={() => undefined}
          onUnreadOnlyChange={() => undefined}
          recommendationStatus={null}
          recommendationStatusError={null}
          selectedArticleId={null}
          selectedFeed={null}
          selectedFolder={null}
          showRecommendationStatus={false}
          showQuickFilters={true}
          todayOnly={false}
          unreadCount={1}
          unreadOnly={false}
        />
      </DibaoI18nProvider>
    );

    expect(latestHtml).not.toContain("为什么推荐");
    expect(recommendedHtml).toContain("为什么推荐");
  });

  it("renders favorites and read-later sorting without unread-only controls", () => {
    const likedArticle = articleListItem("liked_article", "unseen");
    const favoriteHtml = renderToStaticMarkup(
      <DibaoI18nProvider>
        <ArticleListPanel
          articleError={null}
          articleView="favorites"
          articles={[{ ...likedArticle, state: { ...likedArticle.state, liked: true } }]}
          favoriteSort="favorited_desc"
          readLaterSort="ranked"
          feedCount={1}
          isIgnoreTelemetryEnabled={false}
          isArticlesLoading={false}
          isLoadingMore={false}
          isRecommendationStatusLoading={false}
          loadMoreError={null}
          nextCursor={null}
          onFavoriteSortChange={() => undefined}
          onReadLaterSortChange={() => undefined}
          onIgnoreArticle={() => undefined}
          onLoadMore={() => undefined}
          onOpenSources={() => undefined}
          onExplainArticle={() => undefined}
          onSelectArticle={() => undefined}
          onTodayOnlyChange={() => undefined}
          onUnreadOnlyChange={() => undefined}
          recommendationStatus={null}
          recommendationStatusError={null}
          selectedArticleId={null}
          selectedFeed={null}
          selectedFolder={null}
          showRecommendationStatus={false}
          showQuickFilters={false}
          todayOnly={false}
          unreadCount={1}
          unreadOnly={true}
        />
      </DibaoI18nProvider>
    );
    const readLaterHtml = renderToStaticMarkup(
      <DibaoI18nProvider>
        <ArticleListPanel
          articleError={null}
          articleView="read_later"
          articles={[]}
          favoriteSort="favorited_desc"
          readLaterSort="ranked"
          feedCount={1}
          isIgnoreTelemetryEnabled={false}
          isArticlesLoading={false}
          isLoadingMore={false}
          isRecommendationStatusLoading={false}
          loadMoreError={null}
          nextCursor={null}
          onFavoriteSortChange={() => undefined}
          onReadLaterSortChange={() => undefined}
          onIgnoreArticle={() => undefined}
          onLoadMore={() => undefined}
          onOpenSources={() => undefined}
          onExplainArticle={() => undefined}
          onSelectArticle={() => undefined}
          onTodayOnlyChange={() => undefined}
          onUnreadOnlyChange={() => undefined}
          recommendationStatus={null}
          recommendationStatusError={null}
          selectedArticleId={null}
          selectedFeed={null}
          selectedFolder={null}
          showRecommendationStatus={false}
          showQuickFilters={false}
          todayOnly={false}
          unreadCount={0}
          unreadOnly={true}
        />
      </DibaoI18nProvider>
    );

    expect(favoriteHtml).toContain("排序");
    expect(favoriteHtml).toContain("最近收藏");
    expect(favoriteHtml).not.toContain("已点赞");
    expect(favoriteHtml).not.toContain("只看未读");
    expect(readLaterHtml).toContain("稍后读");
    expect(readLaterHtml).toContain("排序");
    expect(readLaterHtml).toContain("个性化排序");
    expect(readLaterHtml).toContain("最近加入");
    expect(readLaterHtml).not.toContain("只看未读");
  });

  it("renders algorithm transparency diagnostics and standing explanation", () => {
    const html = renderToStaticMarkup(
      <DibaoI18nProvider>
        <AlgorithmTransparencyPage
          clusterLabelLexicon={null}
          error={null}
          isLoading={false}
          mergeCandidates={[]}
          onBack={() => undefined}
          onIgnoreCandidate={() => Promise.resolve()}
          onMergeCandidate={() => Promise.resolve()}
          onOpenAllClusters={() => undefined}
          onRunMaintenanceTask={() => Promise.resolve()}
          onUpdateClusterLabelLexicon={() => Promise.resolve()}
          onUpdateClusterLabel={() => Promise.resolve()}
          runningMaintenanceTask={null}
          status={{
            mode: "personalized",
            activeProvider: {
              id: "provider_1",
              type: "ollama",
              name: "Ollama",
              model: "bge-m3",
              dimension: 1024,
              lastTestStatus: "success",
              lastTestAt: "2026-05-14T08:00:00.000Z"
            },
            activeIndex: {
              id: "index_1",
              status: "active",
              model: "bge-m3",
              dimension: 1024
            },
            activeRankContext: "profile",
            coverage: {
              candidateCount: 10,
              embeddingCount: 8,
              coverageRatio: 0.8,
              pendingJobs: 0,
              failedJobs: 0,
              lastFailedAt: null,
              lastError: null
            },
            behaviorCounts: {
              like: 2,
              favorite: 1
            },
            clusters: {
              positive: 2,
              negative: 1,
              items: [
                {
                  id: "cluster_positive_design",
                  polarity: "positive",
                  label: null,
                  weight: 8,
                  sampleCount: 3,
                  diagnostics: {
                    supportArticleCount: 2,
                    supportEventCount: 3,
                    sourceCount: 1,
                    strongSignalCount: 1,
                    strongSignalRatio: 0.3333,
                    topSourceShare: 1,
                    averageSimilarity: 0.71,
                    maxSimilarity: 0.92,
                    overfitRisk: "high",
                    warnings: ["OVERFIT_RISK_HIGH", "SINGLE_SOURCE_DOMINANT"]
                  },
                  lastMatchedAt: "2026-05-14T08:08:00.000Z",
                  updatedAt: "2026-05-14T08:09:00.000Z"
                }
              ]
            },
            rankedArticles: {
              base: 10,
              active: 8
            },
            lastProfileUpdate: "2026-05-14T08:09:00.000Z",
            lastRankingUpdate: "2026-05-14T08:11:00.000Z",
            warnings: [
              {
                code: "LOW_COVERAGE",
                message: "Coverage is still warming up"
              }
            ]
          }}
          updatingClusterLexicon={false}
          updatingClusterLabelId={null}
          updatingMergeCandidateId={null}
        />
      </DibaoI18nProvider>
    );

    expect(html).toContain("算法透明说明");
    expect(html).toContain("个性化推荐中");
    expect(html).toContain("当前推荐状态");
    expect(html).toContain("8 / 10 · 80%");
    expect(html).toContain("like: 2");
    expect(html).toContain("LOW_COVERAGE");
    expect(html).toContain("当前兴趣簇");
    expect(html).toContain("兴趣簇 #1");
    expect(html).toContain("权重 8");
    expect(html).toContain("过拟合风险高");
    expect(html).toContain("支撑文章 2");
    expect(html).toContain("SINGLE_SOURCE_DOMINANT");
    expect(html).toContain("用户模型卡");
    expect(html).toContain("Embedding");
    expect(html).toContain("MMR");
    expect(html).toContain("算法解释");
    expect(html).toContain("候选收集");
    expect(html).toContain("+8.0");
    expect(html).toContain("收藏：是资料库/书签");
    expect(html).toContain("fallback 到基础排序");
  });

  it("renders feed management fields without provider configuration copy", () => {
    const html = renderToStaticMarkup(
      <DibaoI18nProvider>
        <FeedManagementWorkspace
          feedError={null}
          feedUrl=""
          feedFolders={[
            {
              id: "folder_design",
              title: "设计",
              sortOrder: 0
            }
          ]}
          feeds={[
            {
              id: "feed_design",
              folderId: "folder_design",
              title: "Design Feed",
              siteUrl: null,
              feedUrl: "https://example.com/feed.xml",
              description: null,
              enabled: true,
              sourceWeight: 0.2,
              lastFetchedAt: "2026-05-14T08:00:00.000Z",
              lastSuccessAt: "2026-05-14T08:10:00.000Z",
              nextRefreshAt: "2026-05-14T09:00:00.000Z",
              lastError: "403 Forbidden",
              createdAt: "2026-05-14T08:00:00.000Z",
              updatedAt: "2026-05-14T08:00:00.000Z"
            }
          ]}
          isAddingFeed={false}
          isExportingOpml={false}
          isImportingOpml={false}
          isLoading={false}
          isRefreshingAllFeeds={false}
          onAddFeed={() => Promise.resolve()}
          onCreateFolder={() => Promise.resolve()}
          onDeleteFeed={() => Promise.resolve()}
          onDeleteFolder={() => Promise.resolve()}
          onExportOpml={() => undefined}
          onImportOpml={() => undefined}
          onRefreshAllFeeds={() => undefined}
          onUpdateFeed={() => Promise.resolve()}
          onUpdateFeedUrl={() => undefined}
          onUpdateFolder={() => Promise.resolve()}
          opmlSummary={null}
        />
      </DibaoI18nProvider>
    );

    expect(html).toContain("新建分组");
    expect(html).toContain("导入 OPML");
    expect(html).toContain("导出 OPML");
    expect(html).toContain("刷新全部");
    expect(html).toContain("添加订阅源");
    expect(html).toContain("RSS / Atom URL");
    expect(html).toContain("导入、导出与刷新");
    expect(html).toContain("重命名");
    expect(html).toContain("删除");
    expect(html).toContain("Design Feed");
    expect(html).toContain("Feed URL");
    expect(html).toContain("https://example.com/feed.xml");
    expect(html).toContain("启用订阅源");
    expect(html).toContain("来源权重");
    expect(html).toContain("下次抓取");
    expect(html).toContain("最近错误");
    expect(html).toContain("403 Forbidden");
    expect(html).not.toContain("AutoTTL");
    expect(html).not.toContain("Provider URL");
    expect(html).not.toContain("API Key");
    expect(html).not.toContain("Embedding");
  });

  it("renders settings page controls and supported provider fields", () => {
    const html = renderToStaticMarkup(
      <DibaoI18nProvider>
        <SettingsWorkspace
          backfillingIndexId={null}
          deletingProviderId={null}
          embeddingError={null}
          embeddingIndexes={[]}
          embeddingProviders={[]}
          error={null}
          isEmbeddingLoading={false}
          isLoading={false}
          isSavingEmbeddingProvider={false}
          isSaving={false}
          rebuildingIndexId={null}
          testingProviderId={null}
                    onBackfillEmbeddingIndex={() => Promise.resolve()}
onDeleteEmbeddingProvider={() => Promise.resolve()}
          onOpenAlgorithmTransparency={() => undefined}
          onPreviewSettings={() => undefined}
          onRebuildEmbeddingIndex={() => Promise.resolve()}
          onSaveEmbeddingProvider={() => Promise.resolve()}
          onSaveSettings={() => Promise.resolve()}
          onTestEmbeddingProvider={() => Promise.resolve()}
          settings={defaultAppSettings}
        />
      </DibaoI18nProvider>
    );

    expect(html).toContain("设置");
    expect(html).toContain("界面语言");
    expect(html).toContain("首页默认打开");
    expect(html).toContain("查看算法透明说明");
    expect(html).toContain("稍后读中的文章读完后，自动移出稍后读");
    expect(html).toContain("type=\"range\"");
    expect(html).toContain("字号");
    expect(html).toContain("行高");
    expect(html).toContain("段距");
    expect(html).toContain("阅读宽度");
    expect(html).toContain("保留天数");
    expect(html).toContain("retention.retentionDays");
    expect(html).toContain("智能能力");
    expect(html).toContain("OpenAI-compatible");
    expect(html).toContain("Ollama");
    expect(html).toContain("API Key");
    expect(html).toContain("Base URL");
    expect(html).toContain("模型");
    expect(html).toContain("bge-m3 / 1024");
    expect(html).toContain("测试连接");
  });

  it("renders provider connection and embedding job status separately", () => {
    const html = renderToStaticMarkup(
      <DibaoI18nProvider>
        <SettingsWorkspace
          backfillingIndexId={null}
          deletingProviderId={null}
          embeddingError={null}
          embeddingIndexes={[
            {
              id: "index_ollama",
              providerId: "provider_ollama",
              model: "bge-m3",
              dimension: 1024,
              distanceMetric: "cosine",
              status: "active",
              candidateCount: 10,
              coveredArticleCount: 6,
              embeddingCount: 6,
              coverageRatio: 0.6,
              pendingJobs: 2,
              failedJobs: 1,
              lastFailedAt: "2026-05-14T08:10:00.000Z",
              lastError: "Provider request failed",
              usage: {
                windows: {
                  "24h": { requestCount: 3, itemCount: 6, estimatedTokens: 1200 },
                  "7d": { requestCount: 3, itemCount: 6, estimatedTokens: 1200 },
                  "30d": { requestCount: 3, itemCount: 6, estimatedTokens: 1200 }
                }
              },
              createdAt: "2026-05-14T08:00:00.000Z",
              updatedAt: "2026-05-14T08:00:00.000Z"
            }
          ]}
          embeddingProviders={[
            {
              id: "provider_ollama",
              type: "ollama",
              name: "Ollama",
              baseUrl: "http://127.0.0.1:11434",
              model: "bge-m3",
              dimension: 1024,
              enabled: true,
              qualityTier: "recommended",
              hasApiKey: false,
              lastTestStatus: "success",
              lastTestError: null,
              lastTestAt: "2026-05-14T08:00:00.000Z",
              createdAt: "2026-05-14T08:00:00.000Z",
              updatedAt: "2026-05-14T08:00:00.000Z"
            }
          ]}
          error={null}
          isEmbeddingLoading={false}
          isLoading={false}
          isSavingEmbeddingProvider={false}
          isSaving={false}
          rebuildingIndexId={null}
          testingProviderId={null}
                    onBackfillEmbeddingIndex={() => Promise.resolve()}
onDeleteEmbeddingProvider={() => Promise.resolve()}
          onOpenAlgorithmTransparency={() => undefined}
          onPreviewSettings={() => undefined}
          onRebuildEmbeddingIndex={() => Promise.resolve()}
          onSaveEmbeddingProvider={() => Promise.resolve()}
          onSaveSettings={() => Promise.resolve()}
          onTestEmbeddingProvider={() => Promise.resolve()}
          settings={defaultAppSettings}
        />
      </DibaoI18nProvider>
    );

    expect(html).toContain("连接测试状态");
    expect(html).toContain("连接测试成功");
    expect(html).toContain("Embedding job 状态");
    expect(html).toContain("6 / 10 · 60%");
    expect(html).toContain("索引总量：6 条 embedding");
    expect(html).toContain("待处理 2");
    expect(html).toContain("失败 1");
    expect(html).toContain("错误：Provider request failed");
    expect(html).toContain("补齐缺失向量");
    expect(html).toContain("重建向量索引");
    expect(html).toContain("bge-m3");
    expect(html).toContain("1024");
  });

  it("builds reader CSS variables from persisted reader settings", () => {
    expect(
      readerStyleFor({
        fontSize: 20,
        lineHeight: 1.8,
        paragraphGap: 1.2,
        readerWidth: 760,
        theme: "paper"
      })
    ).toEqual({
      "--reader-font-size": "20px",
      "--reader-line-height": "1.8",
      "--reader-paragraph-gap": "1.2em",
      "--reader-width": "760px"
    });
  });

  it("renders article action buttons from dictionary copy", () => {
    const html = renderToStaticMarkup(
      <DibaoI18nProvider>
        <ArticleActionControls
          actionError={null}
          article={{
            id: "article_fixture",
            state: {
              read: false,
              favorited: false,
              liked: false,
              readLater: false,
              hidden: false,
              notInterested: false,
              readingProgress: 0
            }
          }}
          onAction={() => undefined}
          pendingAction={null}
        />
      </DibaoI18nProvider>
    );

    expect(html).toContain("收藏");
    expect(html).toContain("点赞");
    expect(html).toContain("稍后读");
    expect(html).toContain("不感兴趣");
    expect(html).toContain('aria-label="收藏这篇文章"');
    expect(html).toContain('aria-label="点赞这篇文章"');
    expect(html).toContain('aria-label="稍后读这篇文章"');
    expect(html).toContain('aria-label="不再推荐类似文章"');
    expect(html).not.toContain("标记已读");
  });

  it("renders rank explanation copy from the dictionary", () => {
    const html = renderToStaticMarkup(
      <DibaoI18nProvider>
        <RankExplanationPanel
          error={null}
          explanation={{
            articleId: "article_fixture",
            generatedAt: "2026-05-14T08:10:00.000Z",
            reasons: [
              {
                type: "freshness",
                label: "Recent article",
                impact: "positive"
              },
              {
                type: "source",
                label: "Fixture Feed",
                impact: "positive"
              }
            ]
          }}
          isLoading={false}
        />
      </DibaoI18nProvider>
    );

    expect(html).toContain("为什么推荐");
    expect(html).toContain("新鲜度");
    expect(html).toContain("文章较新");
    expect(html).toContain("来源 Fixture Feed");
  });

  it("renders sorting notes for non-personalized article detail views", () => {
    const latestHtml = renderToStaticMarkup(
      <DibaoI18nProvider>
        <ArticleExplanationEntry
          articleView="latest"
          error={null}
          explanation={null}
          isLoading={false}
          isOpen={false}
          onClose={() => undefined}
          onOpen={() => undefined}
        />
      </DibaoI18nProvider>
    );
    const favoriteHtml = renderToStaticMarkup(
      <DibaoI18nProvider>
        <ArticleExplanationEntry
          articleView="favorites"
          error={null}
          explanation={null}
          isLoading={false}
          isOpen={false}
          onClose={() => undefined}
          onOpen={() => undefined}
        />
      </DibaoI18nProvider>
    );

    expect(latestHtml).toContain("当前视图正按照发布时间排序");
    expect(latestHtml).not.toContain("查看完整理由");
    expect(favoriteHtml).toContain("收藏视图默认按收藏时间排序");
  });

  it("renders personalized explanation entry as a popover trigger", () => {
    const html = renderToStaticMarkup(
      <DibaoI18nProvider>
        <ArticleExplanationEntry
          articleView="recommended"
          error={null}
          explanation={{
            articleId: "article_fixture",
            generatedAt: "2026-05-14T08:10:00.000Z",
            reasons: [
              {
                type: "interest",
                label: "AI",
                impact: "positive"
              }
            ]
          }}
          isLoading={false}
          isOpen
          onClose={() => undefined}
          onOpen={() => undefined}
        />
      </DibaoI18nProvider>
    );

    expect(html).toContain("查看完整理由");
    expect(html).toContain("与你近期的正向兴趣相似");
    expect(html).toContain("关闭");
  });
});

function dictionaryShape(value: unknown, path = "$"): string[] {
  if (typeof value === "function") {
    return [`${path}:function:${value.length}`];
  }

  if (typeof value !== "object" || value === null) {
    return [`${path}:${typeof value}`];
  }

  return Object.entries(value).flatMap(([key, child]) => dictionaryShape(child, `${path}.${key}`));
}

function articleListItem(
  id: string,
  interactionStatus: ArticleListItem["state"]["interactionStatus"]
): ArticleListItem {
  return {
    id,
    feedId: "feed_fixture",
    feedTitle: "Fixture Feed",
    title: id,
    url: `https://example.com/${id}`,
    author: null,
    summary: null,
    publishedAt: "2026-05-14T08:00:00.000Z",
    discoveredAt: "2026-05-14T08:00:00.000Z",
    state: {
      read: false,
      favorited: false,
      liked: false,
      readLater: false,
      hidden: false,
      notInterested: false,
      readingProgress: 0,
      interactionStatus
    }
  };
}
