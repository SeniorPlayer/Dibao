import type { FormEvent, RefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ArticleDetail, ArticleListItem, ArticleSearchSort, ArticleSearchState, ArticleState, ArticleTimeWindow, ArticleView, FavoriteArticleSort, Feed, FeedDiagnosticItem, FeedFolder, RankExplanation, RankExplanationReason, ReaderCommandMarkScopeReadPreviewResponse, ReaderSettings, ReadLaterArticleSort, RecommendationStatus } from "../api.js";
import { useI18n, type Dictionary, type NavigationItemKey } from "../i18n.js";
import styles from "../design-system/AppShell/AppShell.module.css";
import { articleInteractionStatusForState } from "../articleListState.js";
import { articleSortForView, canLoadRankExplanation, classNames, clusterDisplayName, confidenceBucket, countFeedsByFolder, explanationReasonText, formatCompactNumber, formatPercent, pageForNavigationItem, plainTextSummary, readerStyleFor, recommendationStatusMetrics, safeArticleUrl, sanitizeArticleHtml, shouldLetBrowserHandleLinkClick, shouldLoadRankExplanation, sortExplanationForView, supportsQuickFilters, supportsUnreadOnly, urlForAppPage, urlForArticle, urlForSearchPage, clampNumber, type ArticleActionIntent, type ArticleActionTarget, type AppPage, type FeedDiagnosticsByFeedId, type PendingArticleAction, type ReadProgressMetadata, type ReadProgressPostOptions, type SearchFormState, type SourceSelection } from "../app/shared.js";

export function FeedPanel(props: {
  diagnosticsByFeedId: FeedDiagnosticsByFeedId;
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
      aria-label={t.feeds.title}
    >
      {props.feedError ? <p className={styles.errorText}>{props.feedError}</p> : null}

      <div className={styles.feedList}>
        <button
          className={styles.mobileSourceCloseButton}
          onClick={props.onCloseSources}
          type="button"
        >
          {t.feeds.closeSources}
        </button>
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
          props.feeds.map((feed) => {
            const diagnostic = props.diagnosticsByFeedId[feed.id] ?? null;
            return (
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
                <span className={styles.feedTitleLine}>
                  <span>{feed.title}</span>
                  {diagnostic?.severity === "error" ? (
                    <span className={styles.feedFailureDot}>{t.feedDiagnostics.statuses.failing}</span>
                  ) : null}
                </span>
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
            );
          })}
      </div>
    </section>
  );
}

export function ArticleListPanel(props: {
  articleError: string | null;
  articleView: ArticleView;
  articles: ArticleListItem[];
  favoriteSort: FavoriteArticleSort;
  readLaterSort: ReadLaterArticleSort;
  feedCount: number;
  isIgnoreTelemetryEnabled: boolean;
  isArticlesLoading: boolean;
  isLoadingMore: boolean;
  isMarkingScopeRead: boolean;
  isRecommendationStatusLoading: boolean;
  listScrollKey?: string;
  loadMoreError: string | null;
  nextCursor: string | null;
  onArticleAction?: (article: ArticleActionTarget, intent: ArticleActionIntent) => void;
  onFavoriteSortChange: (sort: FavoriteArticleSort) => void;
  onReadLaterSortChange: (sort: ReadLaterArticleSort) => void;
  onIgnoreArticle: (articleId: string) => void;
  onLoadMore: () => void;
  onMarkScopeRead: () => void;
  onPreviewMarkScopeRead: () => Promise<number>;
  onOpenSources: () => void;
  onExplainArticle: (articleId: string) => void;
  onSelectArticle: (articleId: string) => void;
  onTimeWindowChange: (timeWindow: ArticleTimeWindow) => void;
  onUnreadOnlyChange: (unreadOnly: boolean) => void;
  pendingAction?: PendingArticleAction | null;
  recommendationStatus: RecommendationStatus | null;
  recommendationStatusError: string | null;
  readerCommandError: string | null;
  selectedArticleId: string | null;
  selectedFeed: Feed | null;
  selectedFolder: FeedFolder | null;
  showRecommendationStatus: boolean;
  showQuickFilters: boolean;
  timeWindow: ArticleTimeWindow;
  unreadCount: number;
  unreadOnly: boolean;
}) {
  const { t, formatDate } = useI18n();
  const scrollContainerRef = useRef<HTMLElement>(null);
  const listScrollKey = props.listScrollKey ?? `dibao:list-scroll:${props.articleView}`;
  const sourceTitle =
    props.selectedFeed?.title ?? props.selectedFolder?.title ?? t.articles.allSources;

  useArticleListIgnoreTelemetry({
    articles: props.articles,
    enabled: props.isIgnoreTelemetryEnabled,
    onIgnoreArticle: props.onIgnoreArticle,
    rootRef: scrollContainerRef,
    selectedArticleId: props.selectedArticleId
  });

  usePersistedArticleListScroll({
    enabled: !props.selectedArticleId,
    storageKey: listScrollKey,
    rootRef: scrollContainerRef
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
          {props.articleView === "favorites" || props.articleView === "read_later" ? (
            <label
              className={styles.articleSortControl}
              htmlFor={`${props.articleView}-article-sort`}
            >
              <span>{t.articles.sort.label}</span>
              <select
                id={`${props.articleView}-article-sort`}
                onChange={(event) => {
                  if (props.articleView === "favorites") {
                    props.onFavoriteSortChange(event.target.value as FavoriteArticleSort);
                    return;
                  }
                  props.onReadLaterSortChange(event.target.value as ReadLaterArticleSort);
                }}
                value={
                  props.articleView === "favorites" ? props.favoriteSort : props.readLaterSort
                }
              >
                {props.articleView === "favorites" ? (
                  <>
                    <option value="favorited_desc">{t.articles.sort.favorited_desc}</option>
                    <option value="favorited_asc">{t.articles.sort.favorited_asc}</option>
                  </>
                ) : (
                  <>
                    <option value="ranked">{t.articles.sort.ranked}</option>
                    <option value="read_later_desc">{t.articles.sort.read_later_desc}</option>
                    <option value="read_later_asc">{t.articles.sort.read_later_asc}</option>
                  </>
                )}
                <option value="published_desc">{t.articles.sort.published_desc}</option>
                <option value="published_asc">{t.articles.sort.published_asc}</option>
              </select>
            </label>
          ) : null}
          {props.showQuickFilters ? (
            <div className={styles.articleFilterBar} aria-label={t.articles.filters.label}>
              <TimeWindowFilter
                onChange={props.onTimeWindowChange}
                timeWindow={props.timeWindow}
              />
              <UnreadDebtControl
                clearWindow={props.timeWindow}
                isClearing={props.isMarkingScopeRead}
                onConfirmClear={props.onMarkScopeRead}
                onPreviewClear={props.onPreviewMarkScopeRead}
                onToggleUnreadOnly={() => props.onUnreadOnlyChange(!props.unreadOnly)}
                unreadCount={props.unreadCount}
                unreadOnly={props.unreadOnly}
              />
            </div>
          ) : null}
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
      {props.readerCommandError ? (
        <p className={styles.errorText}>{props.readerCommandError}</p>
      ) : null}

      <div className={styles.list} aria-live="polite">
        {props.isArticlesLoading ? <SkeletonRows count={10} /> : null}

        {!props.isArticlesLoading && props.articles.length === 0 ? (
          <EmptyState
            title={
              props.feedCount === 0
                ? t.articles.emptyNoFeedsTitle
                : props.showQuickFilters && props.unreadOnly
                  ? t.articles.emptyNoUnreadTitle
                : t.articles.emptyNoArticlesTitle
            }
            body={
              props.feedCount === 0
                ? t.articles.emptyNoFeedsBody
                : props.showQuickFilters && props.unreadOnly
                  ? t.articles.emptyNoUnreadBody
                : t.articles.emptyNoArticlesBody
            }
          />
        ) : null}

        {!props.isArticlesLoading &&
          props.articles.map((article) => (
            <article
              className={articleItemClassName(article, props.selectedArticleId)}
              data-article-id={article.id}
              data-interaction-status={articleInteractionStatusForState(article.state)}
              data-favorited={article.state.favorited ? "true" : undefined}
              data-liked={article.state.liked ? "true" : undefined}
              data-read-later={article.state.readLater ? "true" : undefined}
              key={article.id}
            >
              <a
                className={styles.articleMain}
                href={urlForArticle(props.articleView, article.id, {
                  favoriteSort: props.favoriteSort,
                  readLaterSort: props.readLaterSort,
                  timeWindow: props.timeWindow,
                  unreadOnly: props.unreadOnly
                })}
                onClick={(event) => {
                  if (shouldLetBrowserHandleLinkClick(event)) {
                    return;
                  }
                  event.preventDefault();
                  props.onSelectArticle(article.id);
                }}
              >
                <span className={styles.meta}>
                  {t.articles.itemMeta(
                    formatDate(article.publishedAt ?? article.discoveredAt),
                    article.feedTitle
                  )}
                </span>
                <strong>{article.title}</strong>
                {article.summary ? (
                  <span className={styles.summary}>{plainTextSummary(article.summary)}</span>
                ) : null}
              </a>
              <ArticleRowActions
                article={article}
                onAction={(intent) => props.onArticleAction?.(article, intent)}
                canExplain={shouldLoadRankExplanation(props.articleView)}
                onExplain={() => props.onExplainArticle(article.id)}
                pendingAction={
                  props.pendingAction?.articleId === article.id
                    ? props.pendingAction.intent
                    : null
                }
              />
            </article>
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

function UnreadDebtControl(props: {
  clearWindow: ArticleTimeWindow;
  unreadCount: number;
  unreadOnly: boolean;
  isClearing: boolean;
  onToggleUnreadOnly: () => void;
  onPreviewClear: () => Promise<number>;
  onConfirmClear: () => void;
}) {
  const { t } = useI18n();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const canOpenClear = props.clearWindow !== "all" || props.unreadCount > 0;

  async function openConfirm() {
    setIsConfirmOpen(true);
    setPreviewCount(null);
    setPreviewError(null);
    setIsPreviewLoading(true);

    try {
      setPreviewCount(await props.onPreviewClear());
    } catch {
      setPreviewError(t.readerCommands.markScopeRead.error);
    } finally {
      setIsPreviewLoading(false);
    }
  }

  return (
    <div className={styles.unreadDebtControl}>
      <button
        aria-pressed={props.unreadOnly}
        className={props.unreadOnly ? styles.unreadDebtToggleActive : styles.unreadDebtToggle}
        onClick={props.onToggleUnreadOnly}
        title={t.readerCommands.markScopeRead.toggleUnread}
        type="button"
      >
        {t.readerCommands.markScopeRead.unreadWithCount(props.unreadCount)}
      </button>
      <button
        className={styles.unreadDebtClear}
        disabled={!canOpenClear || props.isClearing}
        onClick={openConfirm}
        title={t.readerCommands.markScopeRead.clearTitleForWindow(props.clearWindow)}
        type="button"
      >
        <span className={styles.unreadDebtClearLabel}>
          {props.isClearing
            ? t.readerCommands.markScopeRead.clearing
            : t.readerCommands.markScopeRead.clearForWindow(props.clearWindow)}
        </span>
        <span className={styles.unreadDebtClearShort}>
          {t.readerCommands.markScopeRead.clearShort}
        </span>
      </button>
      <MarkScopeReadConfirmDialog
        isOpen={isConfirmOpen}
        onCancel={() => setIsConfirmOpen(false)}
        onConfirm={() => {
          setIsConfirmOpen(false);
          props.onConfirmClear();
        }}
        clearWindow={props.clearWindow}
        isLoading={isPreviewLoading}
        error={previewError}
        unreadCount={previewCount}
      />
    </div>
  );
}

function SearchUnreadDebtControl(props: {
  unreadCount: number;
  isClearing: boolean;
  onConfirmClear: () => void;
}) {
  const { t } = useI18n();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  return (
    <span className={styles.searchUnreadDebtControl}>
      <button
        className={styles.searchUnreadDebtButton}
        disabled={props.unreadCount === 0 || props.isClearing}
        onClick={() => setIsConfirmOpen(true)}
        title={t.readerCommands.markScopeRead.clearTitle}
        type="button"
      >
        {t.readerCommands.markScopeRead.unreadWithCount(props.unreadCount)}
      </button>
      <MarkScopeReadConfirmDialog
        isOpen={isConfirmOpen}
        onCancel={() => setIsConfirmOpen(false)}
        onConfirm={() => {
          setIsConfirmOpen(false);
          props.onConfirmClear();
        }}
        unreadCount={props.unreadCount}
      />
    </span>
  );
}

function MarkScopeReadConfirmDialog(props: {
  isOpen: boolean;
  unreadCount: number | null;
  clearWindow?: ArticleTimeWindow;
  isLoading?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();

  if (!props.isOpen) {
    return null;
  }

  return (
    <div className={styles.readerCommandDialogBackdrop}>
      <div
        aria-modal="true"
        className={styles.readerCommandDialog}
        role="dialog"
        aria-labelledby="reader-command-dialog-title"
      >
        <h3 id="reader-command-dialog-title">
          {t.readerCommands.markScopeRead.confirmTitle}
        </h3>
        <p>
          {props.isLoading
            ? t.readerCommands.markScopeRead.confirmBodyLoading
            : props.unreadCount === null
              ? t.readerCommands.markScopeRead.confirmBodyUnknown
              : props.clearWindow
                ? t.readerCommands.markScopeRead.confirmBodyForWindow(
                    props.unreadCount,
                    props.clearWindow
                  )
                : t.readerCommands.markScopeRead.confirmBody(props.unreadCount)}
        </p>
        <p className={styles.readerCommandDialogHint}>
          {t.readerCommands.markScopeRead.confirmHint}
        </p>
        {props.error ? <p className={styles.errorText}>{props.error}</p> : null}
        <div className={styles.readerCommandDialogActions}>
          <button className={styles.secondaryButton} onClick={props.onCancel} type="button">
            {t.readerCommands.markScopeRead.cancel}
          </button>
          <button
            className={styles.primaryButton}
            disabled={props.isLoading || Boolean(props.error) || props.unreadCount === 0}
            onClick={props.onConfirm}
            type="button"
          >
            {t.readerCommands.markScopeRead.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SearchResultsPanel(props: {
  articleError: string | null;
  articles: ArticleListItem[];
  feedFolders: FeedFolder[];
  feeds: Feed[];
  form: SearchFormState;
  hasSubmitted: boolean;
  isArticlesLoading: boolean;
  isLoadingMore: boolean;
  isMarkingScopeRead: boolean;
  loadMoreError: string | null;
  nextCursor: string | null;
  onArticleAction?: (article: ArticleActionTarget, intent: ArticleActionIntent) => void;
  onChange: (form: SearchFormState) => void;
  onExplainArticle: (articleId: string) => void;
  onLoadMore: () => void;
  onMarkScopeRead: () => void;
  onSelectArticle: (articleId: string) => void;
  onSubmit: (form: SearchFormState) => void;
  pendingAction?: PendingArticleAction | null;
  readerCommandError: string | null;
  resultUrlForm: SearchFormState;
  selectedArticleId: string | null;
  unreadCount: number;
}) {
  const { t, formatDate } = useI18n();
  const [isAdvancedSearchOpen, setIsAdvancedSearchOpen] = useState(false);

  function update(patch: Partial<SearchFormState>) {
    props.onChange({
      ...props.form,
      ...patch
    });
  }

  return (
    <section className={styles.articlePanel} aria-labelledby="search-title">
      <form
        className={styles.searchForm}
        onSubmit={(event) => {
          event.preventDefault();
          props.onSubmit(props.form);
        }}
      >
        <div className={styles.searchIntro}>
          <p className={styles.kicker}>{t.search.pageTitle}</p>
          <h2 id="search-title">{t.search.title}</h2>
          <p>{t.search.body}</p>
        </div>
        <label className={styles.searchField}>
          <span>{t.search.inputLabel}</span>
          <input
            autoComplete="off"
            onChange={(event) => update({ q: event.target.value })}
            placeholder={t.search.inputPlaceholder}
            type="search"
            value={props.form.q}
          />
        </label>
        <div className={styles.searchActions}>
          <label className={styles.searchField}>
            <span>{t.search.sortLabel}</span>
            <select
              onChange={(event) => update({ sort: event.target.value as ArticleSearchSort })}
              value={props.form.sort}
            >
              <option value="relevance">{t.search.sorts.relevance}</option>
              <option value="recommended">{t.search.sorts.recommended}</option>
              <option value="latest">{t.search.sorts.latest}</option>
            </select>
          </label>
          <label className={styles.searchField}>
            <span>{t.search.stateLabel}</span>
            <select
              onChange={(event) => update({ state: event.target.value as ArticleSearchState })}
              value={props.form.state}
            >
              <option value="all">{t.search.states.all}</option>
              <option value="unread">{t.search.states.unread}</option>
              <option value="read">{t.search.states.read}</option>
              <option value="favorites">{t.search.states.favorites}</option>
              <option value="read_later">{t.search.states.read_later}</option>
            </select>
          </label>
          <button
            className={styles.primaryButton}
            disabled={props.isArticlesLoading || props.form.q.trim().length === 0}
            type="submit"
          >
            {props.isArticlesLoading ? t.search.submitting : t.search.submit}
          </button>
        </div>
        {props.form.sort === "recommended" ? (
          <p className={styles.searchHint}>{t.search.recommendedSortHint}</p>
        ) : null}
        <button
          aria-controls="search-advanced-filters"
          aria-expanded={isAdvancedSearchOpen}
          className={styles.searchAdvancedToggle}
          onClick={() => setIsAdvancedSearchOpen((value) => !value)}
          type="button"
        >
          <ActionIcon name="more" />
          <span>
            {isAdvancedSearchOpen ? t.search.hideAdvancedSearch : t.search.advancedSearch}
          </span>
        </button>
        <div
          className={`${styles.searchAdvanced} ${
            isAdvancedSearchOpen ? styles.searchAdvancedOpen : ""
          }`}
          id="search-advanced-filters"
        >
          <div className={styles.searchFilters} aria-label={t.search.sourceLabel}>
            <label className={styles.searchField}>
              <span>{t.search.folderLabel}</span>
              <select
                onChange={(event) =>
                  update({
                    sourceSelection: event.target.value
                      ? { type: "folder", folderId: event.target.value }
                      : { type: "all" }
                  })
                }
                value={
                  props.form.sourceSelection.type === "folder"
                    ? props.form.sourceSelection.folderId
                    : ""
                }
              >
                <option value="">{t.search.allFolders}</option>
                {props.feedFolders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.title}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.searchField}>
              <span>{t.search.feedLabel}</span>
              <select
                onChange={(event) =>
                  update({
                    sourceSelection: event.target.value
                      ? { type: "feed", feedId: event.target.value }
                      : { type: "all" }
                  })
                }
                value={
                  props.form.sourceSelection.type === "feed" ? props.form.sourceSelection.feedId : ""
                }
              >
                <option value="">{t.search.allFeeds}</option>
                {props.feeds.map((feed) => (
                  <option key={feed.id} value={feed.id}>
                    {feed.title}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.searchField}>
              <span>{t.search.dateFromLabel}</span>
              <input
                onChange={(event) => update({ from: event.target.value })}
                type="date"
                value={props.form.from}
              />
            </label>
            <label className={styles.searchField}>
              <span>{t.search.dateToLabel}</span>
              <input
                onChange={(event) => update({ to: event.target.value })}
                type="date"
                value={props.form.to}
              />
            </label>
          </div>
        </div>
      </form>

      {props.articleError ? <p className={styles.errorText}>{props.articleError}</p> : null}
      {props.readerCommandError ? (
        <p className={styles.errorText}>{props.readerCommandError}</p>
      ) : null}

      <div className={styles.list} aria-live="polite">
        {props.isArticlesLoading ? <SkeletonRows count={10} /> : null}

        {!props.isArticlesLoading && !props.hasSubmitted ? (
          <EmptyState title={t.search.initialTitle} body={t.search.initialBody} />
        ) : null}

        {!props.isArticlesLoading && props.hasSubmitted && props.articles.length === 0 ? (
          <EmptyState title={t.search.emptyTitle} body={t.search.emptyBody} />
        ) : null}

        {!props.isArticlesLoading && props.articles.length > 0 ? (
          <div className={styles.searchResultCount}>
            <span>{t.search.resultsCount(props.articles.length)}</span>
            <span aria-hidden="true">·</span>
            <SearchUnreadDebtControl
              isClearing={props.isMarkingScopeRead}
              onConfirmClear={props.onMarkScopeRead}
              unreadCount={props.unreadCount}
            />
          </div>
        ) : null}

        {!props.isArticlesLoading &&
          props.articles.map((article) => (
            <article
              className={articleItemClassName(article, props.selectedArticleId)}
              data-article-id={article.id}
              data-interaction-status={articleInteractionStatusForState(article.state)}
              data-favorited={article.state.favorited ? "true" : undefined}
              data-liked={article.state.liked ? "true" : undefined}
              data-read-later={article.state.readLater ? "true" : undefined}
              key={article.id}
            >
              <a
                className={styles.articleMain}
                href={urlForSearchPage(props.resultUrlForm, article.id)}
                onClick={(event) => {
                  if (shouldLetBrowserHandleLinkClick(event)) {
                    return;
                  }
                  event.preventDefault();
                  props.onSelectArticle(article.id);
                }}
              >
                <span className={styles.meta}>
                  {t.articles.itemMeta(
                    formatDate(article.publishedAt ?? article.discoveredAt),
                    article.feedTitle
                  )}
                </span>
                <strong>{article.title}</strong>
                {article.summary ? (
                  <span className={styles.summary}>{plainTextSummary(article.summary)}</span>
                ) : null}
              </a>
              <ArticleRowActions
                article={article}
                canExplain={true}
                onAction={(intent) => props.onArticleAction?.(article, intent)}
                onExplain={() => props.onExplainArticle(article.id)}
                pendingAction={
                  props.pendingAction?.articleId === article.id
                    ? props.pendingAction.intent
                    : null
                }
              />
            </article>
          ))}

        {!props.isArticlesLoading && props.nextCursor ? (
          <div className={styles.loadMoreBar}>
            <button
              className={styles.secondaryButton}
              disabled={props.isLoadingMore}
              onClick={props.onLoadMore}
              type="button"
            >
              {props.isLoadingMore ? t.articles.loadingMore : t.search.loadMore}
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

function TimeWindowFilter(props: {
  onChange: (timeWindow: ArticleTimeWindow) => void;
  timeWindow: ArticleTimeWindow;
}) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const active = props.timeWindow !== "all";
  const label = t.articles.filters.timeWindows[props.timeWindow];

  return (
    <div className={styles.timeFilterMenu}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-pressed={active}
        className={active ? styles.articleFilterActive : styles.articleFilter}
        onClick={() => setIsOpen((open) => !open)}
        title={t.articles.filters.timeWindowTitle}
        type="button"
      >
        {label}
      </button>
      {isOpen ? (
        <div className={styles.timeFilterMenuItems} role="menu">
          {(["all", "24h", "7d", "30d"] as const).map((windowKey) => (
            <button
              aria-checked={props.timeWindow === windowKey}
              className={
                props.timeWindow === windowKey
                  ? styles.timeFilterMenuItemActive
                  : styles.timeFilterMenuItem
              }
              key={windowKey}
              onClick={() => {
                props.onChange(windowKey);
                setIsOpen(false);
              }}
              role="menuitemradio"
              type="button"
            >
              {t.articles.filters.timeWindows[windowKey]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
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
  const showWarmupNotice = props.status ? hasProfileWarmupWarning(props.status) : false;

  return (
    <section className={styles.recommendationStatusBar} aria-live="polite">
      <div>
        <span className={styles.recommendationStatusLabel}>{t.recommendationStatus.title}</span>
        <strong>{statusText}</strong>
      </div>
      {showWarmupNotice ? (
        <p className={styles.recommendationStatusNotice}>
          {t.recommendationStatus.warmupNotice}
        </p>
      ) : null}
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

function hasProfileWarmupWarning(status: RecommendationStatus): boolean {
  return status.warnings.some((warning) => warning.code === "PROFILE_WARMUP");
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
    if (props.selectedArticleId) {
      seenVisibleIds.current.clear();
    }
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

function usePersistedArticleListScroll(props: {
  enabled: boolean;
  rootRef: RefObject<HTMLElement | null>;
  storageKey: string;
}) {
  useEffect(() => {
    const root = props.rootRef.current;
    if (!root || typeof window === "undefined") {
      return;
    }
    const scrollRoot = root;

    if (props.enabled) {
      const stored = window.sessionStorage.getItem(props.storageKey);
      const scrollTop = stored ? Number(stored) : NaN;
      if (Number.isFinite(scrollTop) && scrollTop > 0) {
        window.requestAnimationFrame(() => {
          scrollRoot.scrollTop = scrollTop;
        });
      }
    }

    function handleScroll() {
      window.sessionStorage.setItem(props.storageKey, String(scrollRoot.scrollTop));
    }

    scrollRoot.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      scrollRoot.removeEventListener("scroll", handleScroll);
    };
  }, [props.enabled, props.rootRef, props.storageKey]);
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

export function ArticleDetailPanel(props: {
  actionError: string | null;
  article: ArticleDetail | null;
  articleView: ArticleView;
  detailError: string | null;
  explanation: RankExplanation | null;
  explanationError: string | null;
  isExplanationOpen: boolean;
  isDetailLoading: boolean;
  isExplanationLoading: boolean;
  onArticleAction: (article: ArticleDetail, intent: ArticleActionIntent) => void;
  onBackToList: () => void;
  onCloseExplanation: () => void;
  onOpenExplanation: () => void;
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
    () =>
      props.article?.contentHtml
        ? sanitizeArticleHtml(props.article.contentHtml, props.article.url)
        : null,
    [props.article?.contentHtml, props.article?.url]
  );
  const sourceNotice = props.article ? contentSourceNotice(props.article, t) : null;
  const showReaderActions = useReaderActionVisibility(readerPanelRef, props.article?.id ?? null);
  const canExplainDetail = shouldLoadRankExplanation(props.articleView);

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
            {sourceNotice ? (
              <span className={styles.inlineNotice}>{sourceNotice}</span>
            ) : null}
            <ArticleActionControls
              actionError={props.actionError}
              article={props.article}
              canExplain={canExplainDetail}
              onExplain={props.onOpenExplanation}
              onAction={(intent) => props.onArticleAction(props.article as ArticleDetail, intent)}
              pendingAction={props.pendingAction}
              placement="top"
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
          <ArticleActionControls
            actionError={null}
            article={props.article}
            hidden={!showReaderActions}
            onAction={(intent) => props.onArticleAction(props.article as ArticleDetail, intent)}
            pendingAction={props.pendingAction}
            placement="bottom"
          />
          <ArticleExplanationEntry
            articleView={props.articleView}
            error={props.explanationError}
            explanation={props.explanation}
            isOpen={props.isExplanationOpen}
            isLoading={props.isExplanationLoading}
            onClose={props.onCloseExplanation}
            onOpen={props.onOpenExplanation}
          />
        </article>
      ) : null}
    </section>
  );
}

function ArticleRowActions(props: {
  article: ArticleActionTarget;
  canExplain: boolean;
  onAction: (intent: ArticleActionIntent) => void;
  onExplain: () => void;
  pendingAction: ArticleActionIntent | null;
}) {
  const { t } = useI18n();
  const { state } = props.article;
  const isBusy = props.pendingAction !== null;

  return (
    <div className={classNames(styles.actionButtonRow, styles.articleRowActions)} aria-live="polite">
      <ActionButton
        ariaLabel={state.favorited ? t.actions.aria.unfavorite : t.actions.aria.favorite}
        busy={props.pendingAction === "favorite"}
        disabled={isBusy}
        icon={state.favorited ? "starFilled" : "star"}
        label={state.favorited ? t.actions.unfavorite : t.actions.favorite}
        onClick={() => props.onAction("favorite")}
        selected={state.favorited}
      />
      <ActionButton
        ariaLabel={state.liked ? t.actions.aria.unlike : t.actions.aria.like}
        busy={props.pendingAction === "like"}
        disabled={isBusy}
        icon="like"
        label={state.liked ? t.actions.unlike : t.actions.like}
        onClick={() => props.onAction("like")}
        selected={state.liked}
      />
      <ActionButton
        ariaLabel={state.readLater ? t.actions.aria.removeReadLater : t.actions.aria.readLater}
        busy={props.pendingAction === "readLater"}
        disabled={isBusy}
        icon="bookmark"
        label={state.readLater ? t.actions.removeReadLater : t.actions.readLater}
        onClick={() => props.onAction("readLater")}
        selected={state.readLater}
      />
      <ActionButton
        ariaLabel={
          state.notInterested ? t.actions.aria.notInterestedActive : t.actions.aria.notInterested
        }
        busy={props.pendingAction === "notInterested"}
        danger
        disabled={isBusy || state.notInterested}
        icon="dismiss"
        label={state.notInterested ? t.actions.notInterestedActive : t.actions.notInterested}
        onClick={() => props.onAction("notInterested")}
        selected={state.notInterested}
      />
      {props.canExplain ? (
        <button
          aria-label={t.explanation.title}
          className={classNames(styles.actionButton, styles.actionExplain)}
          onClick={props.onExplain}
          title={t.explanation.title}
          type="button"
        >
          <ActionIcon name="sparkle" />
        </button>
      ) : null}
    </div>
  );
}

function contentSourceNotice(article: ArticleDetail, t: Dictionary): string {
  if (!article.contentHtml && !article.contentText) {
    return t.reader.contentSource.noContent;
  }
  switch (article.extractionStatus) {
    case "success":
      return t.reader.contentSource.success;
    case "feed_only":
      return t.reader.contentSource.feed_only;
    case "failed":
      return article.extractionError
        ? t.reader.contentSource.failedWithError(shortError(article.extractionError))
        : t.reader.contentSource.failed;
    case "skipped":
      return t.reader.contentSource.skipped;
    case "pending":
      return t.reader.contentSource.pending;
  }
}

function shortError(value: string): string {
  return value.length > 120 ? `${value.slice(0, 120)}...` : value;
}

export function ArticleActionControls(props: {
  actionError: string | null;
  article: Pick<ArticleDetail, "id" | "state">;
  canExplain?: boolean;
  hidden?: boolean;
  onAction: (intent: ArticleActionIntent) => void;
  onExplain?: () => void;
  pendingAction: ArticleActionIntent | null;
  placement?: "top" | "bottom";
}) {
  const { t } = useI18n();
  const { state } = props.article;
  const isBusy = props.pendingAction !== null;

  return (
    <div
      className={classNames(
        styles.readerActions,
        props.placement === "top" ? styles.readerActionsTop : null,
        props.placement === "bottom" ? styles.readerActionsBottom : null,
        props.hidden ? styles.readerActionsHidden : null
      )}
      aria-label={t.actions.aria.group}
      aria-live="polite"
    >
      <div className={styles.actionButtonRow}>
        <ActionButton
          ariaLabel={state.favorited ? t.actions.aria.unfavorite : t.actions.aria.favorite}
          busy={props.pendingAction === "favorite"}
          disabled={isBusy}
          icon={state.favorited ? "starFilled" : "star"}
          label={state.favorited ? t.actions.unfavorite : t.actions.favorite}
          onClick={() => props.onAction("favorite")}
          selected={state.favorited}
        />
        <ActionButton
          ariaLabel={state.liked ? t.actions.aria.unlike : t.actions.aria.like}
          busy={props.pendingAction === "like"}
          disabled={isBusy}
          icon="like"
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
          icon="bookmark"
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
          icon="dismiss"
          label={
            state.notInterested ? t.actions.notInterestedActive : t.actions.notInterested
          }
          onClick={() => props.onAction("notInterested")}
          selected={state.notInterested}
        />
        {props.canExplain && props.onExplain ? (
          <button
            aria-label={t.explanation.title}
            className={classNames(styles.actionButton, styles.actionExplain)}
            onClick={props.onExplain}
            title={t.explanation.title}
            type="button"
          >
            <ActionIcon name="sparkle" />
          </button>
        ) : null}
      </div>
      {props.actionError ? <p className={styles.actionError}>{props.actionError}</p> : null}
    </div>
  );
}

export function RankExplanationPanel(props: {
  error: string | null;
  explanation: RankExplanation | null;
  idleMessage?: string | null;
  isLoading: boolean;
}) {
  const { t, formatDate } = useI18n();

  return (
    <section
      className={classNames(styles.explanationBox, styles.explanationInlineCard)}
      aria-labelledby="rank-explanation-title"
    >
      <div className={styles.explanationHeader}>
        <h3 id="rank-explanation-title">
          <ActionIcon name="sparkle" /> {t.explanation.title}
        </h3>
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
      {!props.isLoading && !props.error && !props.explanation && props.idleMessage ? (
        <p className={styles.explanationMeta}>{props.idleMessage}</p>
      ) : null}
    </section>
  );
}

export function ArticleExplanationEntry(props: {
  articleView: ArticleView;
  error: string | null;
  explanation: RankExplanation | null;
  isOpen: boolean;
  isLoading: boolean;
  onClose: () => void;
  onOpen: () => void;
}) {
  const { t } = useI18n();

  if (!shouldLoadRankExplanation(props.articleView)) {
    return (
      <section className={styles.sortExplanationCard} aria-label={t.explanation.sortLabel}>
        <div>
          <h3>{t.explanation.sortTitle}</h3>
          <p>{sortExplanationForView(props.articleView, t)}</p>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className={styles.reasonInline} aria-label={t.explanation.title}>
        <RankExplanationPanel
          error={props.error}
          explanation={props.explanation}
          idleMessage={t.explanation.lazy}
          isLoading={props.isLoading}
        />
      </section>

      <button
        className={styles.mobileExplainAnchor}
        onClick={props.onOpen}
        type="button"
        aria-label={t.explanation.open}
        title={t.explanation.open}
      >
        <ActionIcon name="sparkle" />
        <span>{t.explanation.title}</span>
      </button>

      <ArticleExplanationDialog
        error={props.error}
        explanation={props.explanation}
        isLoading={props.isLoading}
        isOpen={props.isOpen}
        onClose={props.onClose}
      />
    </>
  );
}

export function ArticleExplanationDialog(props: {
  error: string | null;
  explanation: RankExplanation | null;
  isLoading: boolean;
  isOpen: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();

  if (!props.isOpen) {
    return null;
  }

  return (
    <div
      className={styles.explanationOverlay}
      onClick={props.onClose}
      role="presentation"
    >
      <div
        className={styles.explanationPopover}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rank-explanation-title"
      >
        <div className={styles.sheetHandle} aria-hidden="true" />
        <RankExplanationPanel
          error={props.error}
          explanation={props.explanation}
          isLoading={props.isLoading}
        />
        <div className={styles.overlayActions}>
          <button className={styles.secondaryButton} onClick={props.onClose} type="button">
            {t.common.close}
          </button>
        </div>
      </div>
    </div>
  );
}

function ActionButton(props: {
  ariaLabel: string;
  busy: boolean;
  danger?: boolean;
  disabled: boolean;
  icon: ActionIconName;
  label: string;
  onClick: () => void;
  selected: boolean;
}) {
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
      title={props.label}
      type="button"
    >
      {props.busy ? <span aria-hidden="true">...</span> : <ActionIcon name={props.icon} />}
    </button>
  );
}

type ActionIconName =
  | "bookmark"
  | "dismiss"
  | "feed"
  | "gear"
  | "like"
  | "more"
  | "search"
  | "sparkle"
  | "star"
  | "starFilled";

export function NavigationIcon(props: { item: NavigationItemKey }) {
  const iconByItem: Record<NavigationItemKey, ActionIconName> = {
    latest: "feed",
    recommended: "sparkle",
    favorites: "star",
    read_later: "bookmark",
    search: "search",
    feeds: "feed",
    settings: "gear"
  };

  return <ActionIcon name={iconByItem[props.item]} />;
}

export function ActionIcon(props: { name: ActionIconName }) {
  if (props.name === "sparkle") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="18" height="18">
        <path d="m12 3 1.6 5.2L19 10l-5.4 1.8L12 17l-1.6-5.2L5 10l5.4-1.8L12 3Z" fill="currentColor" />
        <path d="m19 15 .7 2.1 2.1.7-2.1.7L19 21l-.7-2.5-2.1-.7 2.1-.7L19 15Z" fill="currentColor" />
      </svg>
    );
  }

  if (props.name === "star" || props.name === "starFilled") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="18" height="18">
        <path
          d="m12 4 2.35 4.76 5.25.76-3.8 3.7.9 5.23L12 16l-4.7 2.45.9-5.23-3.8-3.7 5.25-.76L12 4Z"
          fill={props.name === "starFilled" ? "currentColor" : "none"}
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.7"
        />
      </svg>
    );
  }

  if (props.name === "like") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="18" height="18">
        <path d="M7 10v10H4V10h3Zm4.2-6L9 10v10h8.8l2.2-8.2A2 2 0 0 0 18.1 9H14l.6-3.4A1.7 1.7 0 0 0 11.2 4Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
      </svg>
    );
  }

  if (props.name === "bookmark") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="18" height="18">
        <path d="M7 4h10v16l-5-3-5 3V4Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
      </svg>
    );
  }

  if (props.name === "dismiss") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="18" height="18">
        <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      </svg>
    );
  }

  if (props.name === "search") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="18" height="18">
        <path d="M10.8 17.2a6.4 6.4 0 1 1 0-12.8 6.4 6.4 0 0 1 0 12.8Zm4.7-1.7L20 20" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      </svg>
    );
  }

  if (props.name === "gear") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="18" height="18">
        <path d="M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Z" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <path d="M4.8 13.4v-2.8l2-.7.7-1.6-.9-1.9 2-2 1.9.9 1.5-.6.8-2h2.8l.8 2 1.5.6 1.9-.9 2 2-.9 1.9.7 1.6 2 .7v2.8l-2 .7-.7 1.6.9 1.9-2 2-1.9-.9-1.5.6-.8 2h-2.8l-.8-2-1.5-.6-1.9.9-2-2 .9-1.9-.7-1.6-2-.7Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.2" />
      </svg>
    );
  }

  if (props.name === "more") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="18" height="18">
        <path d="M5 12h.01M12 12h.01M19 12h.01" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="3" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="18" height="18">
      <path d="M5 5h10a4 4 0 0 1 4 4v10H9a4 4 0 0 1-4-4V5Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
      <path d="M8 9h7M8 13h5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </svg>
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

function useReaderActionVisibility(
  scrollContainerRef: RefObject<HTMLElement | null>,
  articleId: string | null
): boolean {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setVisible(true);
    const element = scrollContainerRef.current;
    if (!element || !articleId) {
      return;
    }
    const scrollElement: HTMLElement = element;

    let lastScrollTop = scrollElement.scrollTop;
    function handleScroll() {
      const nextScrollTop = scrollElement.scrollTop;
      const delta = nextScrollTop - lastScrollTop;
      const nearTop = nextScrollTop < 72;
      const nearBottom =
        scrollElement.scrollHeight - scrollElement.clientHeight - nextScrollTop < 160;

      if (nearTop || nearBottom || delta < -8) {
        setVisible(true);
      } else if (delta > 12 && nextScrollTop > 96) {
        setVisible(false);
      }

      lastScrollTop = nextScrollTop;
    }

    scrollElement.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      scrollElement.removeEventListener("scroll", handleScroll);
    };
  }, [articleId, scrollContainerRef]);

  return visible;
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
