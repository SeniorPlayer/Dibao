import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  App,
  ArticleActionControls,
  ArticleListPanel,
  AuthGatePanel,
  FeedPanel,
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
import { defaultAppSettings } from "./api.js";
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
              lastError: null,
              createdAt: "2026-05-14T08:00:00.000Z",
              updatedAt: "2026-05-14T08:00:00.000Z"
            }
          ]}
          feedUrl=""
          isAddingFeed={false}
          isExportingOpml={false}
          isFeedsLoading={false}
          isImportingOpml={false}
          isRefreshingAllFeeds={false}
          onAddFeed={() => undefined}
          onExportOpml={() => undefined}
          onImportOpml={() => undefined}
          onRefreshAllFeeds={() => undefined}
          onRefreshFeed={() => undefined}
          onSelectSource={() => undefined}
          onUpdateFeedUrl={() => undefined}
          opmlSummary={null}
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
          feedCount={1}
          isArticlesLoading={false}
          isLoadingMore={false}
          loadMoreError={null}
          nextCursor="cursor_1"
          onLoadMore={() => undefined}
          onSelectArticle={() => undefined}
          selectedArticleId={null}
          selectedFeed={null}
          selectedFolder={{
            id: "folder_design",
            title: "设计",
            sortOrder: 0
          }}
        />
      </DibaoI18nProvider>
    );

    expect(feedPanel).toContain("导入 OPML");
    expect(feedPanel).toContain("导出 OPML");
    expect(feedPanel).toContain("刷新全部");
    expect(feedPanel).toContain("分组");
    expect(articlePanel).toContain("加载更多");
    expect(articlePanel).toContain("设计");
  });

  it("renders feed management fields without provider configuration copy", () => {
    const html = renderToStaticMarkup(
      <DibaoI18nProvider>
        <FeedManagementWorkspace
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
              lastError: "403 Forbidden",
              createdAt: "2026-05-14T08:00:00.000Z",
              updatedAt: "2026-05-14T08:00:00.000Z"
            }
          ]}
          isLoading={false}
          onCreateFolder={() => Promise.resolve()}
          onDeleteFeed={() => Promise.resolve()}
          onDeleteFolder={() => Promise.resolve()}
          onUpdateFeed={() => Promise.resolve()}
          onUpdateFolder={() => Promise.resolve()}
        />
      </DibaoI18nProvider>
    );

    expect(html).toContain("新建分组");
    expect(html).toContain("重命名");
    expect(html).toContain("删除");
    expect(html).toContain("Design Feed");
    expect(html).toContain("https://example.com/feed.xml");
    expect(html).toContain("启用订阅源");
    expect(html).toContain("来源权重");
    expect(html).toContain("最近错误");
    expect(html).toContain("403 Forbidden");
    expect(html).not.toContain("Provider URL");
    expect(html).not.toContain("API Key");
    expect(html).not.toContain("Embedding");
  });

  it("renders settings page controls and provider placeholder without real provider fields", () => {
    const html = renderToStaticMarkup(
      <DibaoI18nProvider>
        <SettingsWorkspace
          error={null}
          isLoading={false}
          isSaving={false}
          onPreviewSettings={() => undefined}
          onSaveSettings={() => Promise.resolve()}
          settings={defaultAppSettings}
        />
      </DibaoI18nProvider>
    );

    expect(html).toContain("设置");
    expect(html).toContain("界面语言");
    expect(html).toContain("字号");
    expect(html).toContain("行高");
    expect(html).toContain("段距");
    expect(html).toContain("阅读宽度");
    expect(html).toContain("保留天数");
    expect(html).toContain("retention.retentionDays");
    expect(html).toContain("智能能力");
    expect(html).not.toContain("API Key");
    expect(html).not.toContain("Base URL");
    expect(html).not.toContain("Model");
    expect(html).not.toContain("Test connection");
    expect(html).not.toContain("测试连接");
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
    expect(html).toContain("稍后读");
    expect(html).toContain("标记已读");
    expect(html).toContain("不感兴趣");
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
