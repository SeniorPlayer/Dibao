import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { dibaoVersion } from "@dibao/shared";
import {
  dibaoApi,
  userMessageForError,
  type ArticleDetail,
  type ArticleListItem,
  type Feed
} from "./api.js";
import styles from "./design-system/AppShell/AppShell.module.css";

const navigationItems = ["最新", "推荐", "收藏", "稍后读", "搜索", "订阅源", "设置"];

export function App() {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [articles, setArticles] = useState<ArticleListItem[]>([]);
  const [selectedFeedId, setSelectedFeedId] = useState<string | null>(null);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [articleDetail, setArticleDetail] = useState<ArticleDetail | null>(null);
  const [feedUrl, setFeedUrl] = useState("");
  const [isFeedsLoading, setIsFeedsLoading] = useState(true);
  const [isArticlesLoading, setIsArticlesLoading] = useState(true);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isAddingFeed, setIsAddingFeed] = useState(false);
  const [refreshingFeedId, setRefreshingFeedId] = useState<string | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [articleError, setArticleError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedFeed = useMemo(
    () => feeds.find((feed) => feed.id === selectedFeedId) ?? null,
    [feeds, selectedFeedId]
  );

  const loadFeeds = useCallback(async () => {
    setIsFeedsLoading(true);
    setFeedError(null);

    try {
      const nextFeeds = await dibaoApi.listFeeds();
      setFeeds(nextFeeds);
      setSelectedFeedId((current) =>
        current && nextFeeds.some((feed) => feed.id === current) ? current : null
      );
    } catch (error) {
      setFeedError(userMessageForError(error));
    } finally {
      setIsFeedsLoading(false);
    }
  }, []);

  const loadArticles = useCallback(async (feedId: string | null) => {
    setIsArticlesLoading(true);
    setArticleError(null);

    try {
      const response = await dibaoApi.listArticles({ feedId, limit: 50 });
      setArticles(response.data);
      setSelectedArticleId((current) =>
        current && response.data.some((article) => article.id === current)
          ? current
          : response.data[0]?.id ?? null
      );
    } catch (error) {
      setArticleError(userMessageForError(error));
      setArticles([]);
      setSelectedArticleId(null);
    } finally {
      setIsArticlesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFeeds();
  }, [loadFeeds]);

  useEffect(() => {
    void loadArticles(selectedFeedId);
  }, [loadArticles, selectedFeedId]);

  useEffect(() => {
    let cancelled = false;

    async function loadDetail(articleId: string) {
      setIsDetailLoading(true);
      setDetailError(null);

      try {
        const detail = await dibaoApi.getArticle(articleId);
        if (!cancelled) {
          setArticleDetail(detail);
        }
      } catch (error) {
        if (!cancelled) {
          setArticleDetail(null);
          setDetailError(userMessageForError(error));
        }
      } finally {
        if (!cancelled) {
          setIsDetailLoading(false);
        }
      }
    }

    if (!selectedArticleId) {
      setArticleDetail(null);
      setIsDetailLoading(false);
      setDetailError(null);
      return;
    }

    void loadDetail(selectedArticleId);

    return () => {
      cancelled = true;
    };
  }, [selectedArticleId]);

  async function handleAddFeed(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextFeedUrl = feedUrl.trim();

    if (!nextFeedUrl) {
      setFeedError("请输入 RSS / Atom 地址。");
      return;
    }

    setIsAddingFeed(true);
    setFeedError(null);
    setNotice(null);

    try {
      const result = await dibaoApi.createFeed(nextFeedUrl);
      setFeedUrl("");
      setNotice(`已添加并刷新：${result.feed.title}`);
      await loadFeeds();
      setSelectedFeedId(result.feed.id);
    } catch (error) {
      setFeedError(userMessageForError(error));
    } finally {
      setIsAddingFeed(false);
    }
  }

  async function handleRefreshFeed(feed: Feed) {
    setRefreshingFeedId(feed.id);
    setFeedError(null);
    setArticleError(null);
    setNotice(null);

    try {
      await dibaoApi.refreshFeed(feed.id);
      setNotice(`已刷新：${feed.title}`);
      await Promise.all([loadFeeds(), loadArticles(selectedFeedId)]);
    } catch (error) {
      setFeedError(userMessageForError(error));
    } finally {
      setRefreshingFeedId(null);
    }
  }

  return (
    <main className={styles.shell}>
      <aside className={styles.sidebar} aria-label="主导航">
        <div className={styles.brand}>
          <span className={styles.brandMark}>邸</span>
          <span>
            <strong>邸报</strong>
            <small>Dibao</small>
          </span>
        </div>
        <nav className={styles.nav}>
          {navigationItems.map((item) => (
            <a
              className={item === "最新" ? styles.navItemActive : styles.navItem}
              href="#"
              key={item}
            >
              {item}
            </a>
          ))}
        </nav>
      </aside>

      <section className={styles.content} aria-labelledby="page-title">
        <header className={styles.topbar}>
          <div>
            <p className={styles.kicker}>RSS Ingestion</p>
            <h1 id="page-title">最新文章</h1>
          </div>
          <div className={styles.topbarMeta}>
            <span className={styles.statusText} aria-live="polite">
              {notice ?? (isArticlesLoading ? "正在加载文章" : "最新视图")}
            </span>
            <span className={styles.version}>v{dibaoVersion}</span>
          </div>
        </header>

        <div className={styles.workspace}>
          <FeedPanel
            feedError={feedError}
            feeds={feeds}
            feedUrl={feedUrl}
            isAddingFeed={isAddingFeed}
            isFeedsLoading={isFeedsLoading}
            onAddFeed={handleAddFeed}
            onRefreshFeed={handleRefreshFeed}
            onSelectFeed={setSelectedFeedId}
            onUpdateFeedUrl={setFeedUrl}
            refreshingFeedId={refreshingFeedId}
            selectedFeedId={selectedFeedId}
          />

          <ArticleListPanel
            articleError={articleError}
            articles={articles}
            feedCount={feeds.length}
            isArticlesLoading={isArticlesLoading}
            onSelectArticle={setSelectedArticleId}
            selectedArticleId={selectedArticleId}
            selectedFeed={selectedFeed}
          />

          <ArticleDetailPanel
            article={articleDetail}
            detailError={detailError}
            isDetailLoading={isDetailLoading}
          />
        </div>
      </section>
    </main>
  );
}

function FeedPanel(props: {
  feedError: string | null;
  feeds: Feed[];
  feedUrl: string;
  isAddingFeed: boolean;
  isFeedsLoading: boolean;
  onAddFeed: (event: FormEvent<HTMLFormElement>) => void;
  onRefreshFeed: (feed: Feed) => void;
  onSelectFeed: (feedId: string | null) => void;
  onUpdateFeedUrl: (value: string) => void;
  refreshingFeedId: string | null;
  selectedFeedId: string | null;
}) {
  return (
    <section className={styles.feedPanel} aria-labelledby="feeds-title">
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.kicker}>订阅源</p>
          <h2 id="feeds-title">Feeds</h2>
        </div>
        <span className={styles.count}>{props.feeds.length}</span>
      </div>

      <form className={styles.addFeedForm} onSubmit={props.onAddFeed}>
        <label htmlFor="feed-url">RSS / Atom URL</label>
        <div className={styles.addFeedRow}>
          <input
            id="feed-url"
            inputMode="url"
            onChange={(event) => props.onUpdateFeedUrl(event.target.value)}
            placeholder="https://example.com/feed.xml"
            type="url"
            value={props.feedUrl}
          />
          <button className={styles.primaryButton} disabled={props.isAddingFeed} type="submit">
            {props.isAddingFeed ? "添加中" : "添加"}
          </button>
        </div>
      </form>

      {props.feedError ? <p className={styles.errorText}>{props.feedError}</p> : null}

      <div className={styles.feedList}>
        <button
          className={props.selectedFeedId === null ? styles.feedItemActive : styles.feedItem}
          onClick={() => props.onSelectFeed(null)}
          type="button"
        >
          <span>全部订阅源</span>
          <small>{props.feeds.length} 个来源</small>
        </button>

        {props.isFeedsLoading ? <SkeletonRows count={5} /> : null}

        {!props.isFeedsLoading &&
          props.feeds.map((feed) => (
            <div className={styles.feedRow} key={feed.id}>
              <button
                className={props.selectedFeedId === feed.id ? styles.feedItemActive : styles.feedItem}
                onClick={() => props.onSelectFeed(feed.id)}
                type="button"
              >
                <span>{feed.title}</span>
                <small>{feed.lastSuccessAt ? `成功：${formatDate(feed.lastSuccessAt)}` : feed.feedUrl}</small>
              </button>
              <button
                className={styles.iconButton}
                disabled={props.refreshingFeedId === feed.id}
                onClick={() => props.onRefreshFeed(feed)}
                title={`刷新 ${feed.title}`}
                type="button"
              >
                {props.refreshingFeedId === feed.id ? "…" : "刷新"}
              </button>
            </div>
          ))}
      </div>
    </section>
  );
}

function ArticleListPanel(props: {
  articleError: string | null;
  articles: ArticleListItem[];
  feedCount: number;
  isArticlesLoading: boolean;
  onSelectArticle: (articleId: string) => void;
  selectedArticleId: string | null;
  selectedFeed: Feed | null;
}) {
  return (
    <section className={styles.articlePanel} aria-labelledby="articles-title">
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.kicker}>{props.selectedFeed?.title ?? "全部来源"}</p>
          <h2 id="articles-title">Latest</h2>
        </div>
        <span className={styles.count}>{props.articles.length}</span>
      </div>

      {props.articleError ? <p className={styles.errorText}>{props.articleError}</p> : null}

      <div className={styles.list} aria-live="polite">
        {props.isArticlesLoading ? <SkeletonRows count={10} /> : null}

        {!props.isArticlesLoading && props.articles.length === 0 ? (
          <EmptyState
            title={props.feedCount === 0 ? "还没有订阅源" : "暂时没有文章"}
            body={
              props.feedCount === 0
                ? "添加一个 RSS / Atom 源后，文章会出现在这里。"
                : "可以刷新订阅源，或切换到全部来源查看。"
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
                {formatDate(article.publishedAt ?? article.discoveredAt)} · {article.feedTitle}
              </span>
              <strong>{article.title}</strong>
              {article.summary ? <span className={styles.summary}>{article.summary}</span> : null}
            </button>
          ))}
      </div>
    </section>
  );
}

function ArticleDetailPanel(props: {
  article: ArticleDetail | null;
  detailError: string | null;
  isDetailLoading: boolean;
}) {
  const safeHtml = useMemo(
    () => (props.article?.contentHtml ? sanitizeArticleHtml(props.article.contentHtml) : null),
    [props.article?.contentHtml]
  );

  return (
    <section className={styles.readerPanel} aria-labelledby="reader-title">
      {props.isDetailLoading ? <ReaderSkeleton /> : null}

      {!props.isDetailLoading && props.detailError ? (
        <p className={styles.errorText}>{props.detailError}</p>
      ) : null}

      {!props.isDetailLoading && !props.detailError && !props.article ? (
        <EmptyState title="选择一篇文章" body="文章详情会在这里打开。" />
      ) : null}

      {!props.isDetailLoading && !props.detailError && props.article ? (
        <article className={styles.reader} data-reader-theme="paper">
          <header className={styles.readerHeader}>
            <a href={props.article.url} rel="noreferrer" target="_blank">
              原文
            </a>
            <h2 id="reader-title">{props.article.title}</h2>
            <p>
              {props.article.feedTitle}
              {props.article.publishedAt ? ` · ${formatDate(props.article.publishedAt)}` : ""}
              {props.article.author ? ` · ${props.article.author}` : ""}
            </p>
            {props.article.extractionStatus === "feed_only" ? (
              <span className={styles.inlineNotice}>当前仅有订阅源摘要。</span>
            ) : null}
          </header>

          {safeHtml ? (
            <div
              className={styles.readerBody}
              dangerouslySetInnerHTML={{ __html: safeHtml }}
            />
          ) : (
            <div className={styles.readerBody}>
              <p>{props.article.contentText ?? props.article.summary ?? "这篇文章暂无正文内容。"}</p>
            </div>
          )}
        </article>
      ) : null}
    </section>
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

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
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
