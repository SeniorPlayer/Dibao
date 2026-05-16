import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  userMessageForError,
  type Feed,
  type FeedFolder,
  type OpmlImportResponse,
  type UpdateFeedInput,
  type UpdateFeedFolderInput
} from "./api.js";
import styles from "./design-system/AppShell/AppShell.module.css";
import { useI18n } from "./i18n.js";

const UNGROUPED_FOLDER_VALUE = "__ungrouped__";

type PendingManagementAction =
  | "createFolder"
  | "updateFolder"
  | "deleteFolder"
  | "updateFeed"
  | "deleteFeed";

type FeedDraft = {
  title: string;
  folderId: string;
  enabled: boolean;
  sourceWeight: string;
};

export type FeedManagementWorkspaceProps = {
  feedError: string | null;
  feedUrl: string;
  feedFolders: FeedFolder[];
  feeds: Feed[];
  isAddingFeed: boolean;
  isExportingOpml: boolean;
  isImportingOpml: boolean;
  isLoading: boolean;
  isRefreshingAllFeeds: boolean;
  onAddFeed: (event: FormEvent<HTMLFormElement>) => void;
  onCreateFolder: (title: string) => Promise<void>;
  onDeleteFeed: (feedId: string) => Promise<void>;
  onDeleteFolder: (folderId: string) => Promise<void>;
  onExportOpml: () => void;
  onImportOpml: (event: ChangeEvent<HTMLInputElement>) => void;
  onRefreshAllFeeds: () => void;
  onUpdateFeed: (feedId: string, input: UpdateFeedInput) => Promise<void>;
  onUpdateFeedUrl: (value: string) => void;
  onUpdateFolder: (folderId: string, input: UpdateFeedFolderInput) => Promise<void>;
  opmlSummary: OpmlImportResponse | null;
};

export function FeedManagementWorkspace(props: FeedManagementWorkspaceProps) {
  const { t, formatDate } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFeedId, setSelectedFeedId] = useState<string | null>(
    props.feeds[0]?.id ?? null
  );
  const selectedFeed = useMemo(
    () => props.feeds.find((feed) => feed.id === selectedFeedId) ?? null,
    [props.feeds, selectedFeedId]
  );
  const folderById = useMemo(
    () => new Map(props.feedFolders.map((folder) => [folder.id, folder])),
    [props.feedFolders]
  );
  const feedCountByFolder = useMemo(() => countFeedsByFolder(props.feeds), [props.feeds]);
  const [feedDraft, setFeedDraft] = useState<FeedDraft>(() =>
    selectedFeed ? draftForFeed(selectedFeed) : emptyFeedDraft()
  );
  const [newFolderTitle, setNewFolderTitle] = useState("");
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [folderDraftTitle, setFolderDraftTitle] = useState("");
  const [confirmDeleteFeedId, setConfirmDeleteFeedId] = useState<string | null>(null);
  const [confirmDeleteFolderId, setConfirmDeleteFolderId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingManagementAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (props.feeds.length === 0) {
      setSelectedFeedId(null);
      return;
    }

    if (!selectedFeed) {
      setSelectedFeedId(props.feeds[0].id);
    }
  }, [props.feeds, selectedFeed]);

  useEffect(() => {
    setFeedDraft(selectedFeed ? draftForFeed(selectedFeed) : emptyFeedDraft());
    setConfirmDeleteFeedId(null);
  }, [selectedFeed]);

  async function runManagementAction(action: PendingManagementAction, fn: () => Promise<void>) {
    setPendingAction(action);
    setError(null);

    try {
      await fn();
    } catch (caught) {
      setError(userMessageForError(caught, t.errors.api));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleCreateFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newFolderTitle.trim();
    if (!title) {
      setError(t.feedManagement.errors.folderTitleRequired);
      return;
    }

    await runManagementAction("createFolder", async () => {
      await props.onCreateFolder(title);
      setNewFolderTitle("");
    });
  }

  function startEditingFolder(folder: FeedFolder) {
    setEditingFolderId(folder.id);
    setFolderDraftTitle(folder.title);
    setConfirmDeleteFolderId(null);
    setError(null);
  }

  async function handleUpdateFolder(folder: FeedFolder) {
    const title = folderDraftTitle.trim();
    if (!title) {
      setError(t.feedManagement.errors.folderTitleRequired);
      return;
    }

    await runManagementAction("updateFolder", async () => {
      await props.onUpdateFolder(folder.id, { title });
      setEditingFolderId(null);
      setFolderDraftTitle("");
    });
  }

  async function handleDeleteFolder(folder: FeedFolder) {
    if (confirmDeleteFolderId !== folder.id) {
      setConfirmDeleteFolderId(folder.id);
      setError(null);
      return;
    }

    await runManagementAction("deleteFolder", async () => {
      await props.onDeleteFolder(folder.id);
      setConfirmDeleteFolderId(null);
      if (editingFolderId === folder.id) {
        setEditingFolderId(null);
        setFolderDraftTitle("");
      }
    });
  }

  async function handleUpdateFeed(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFeed) {
      return;
    }

    const title = feedDraft.title.trim();
    if (!title) {
      setError(t.feedManagement.errors.feedTitleRequired);
      return;
    }

    const sourceWeight = Number(feedDraft.sourceWeight);
    if (!Number.isFinite(sourceWeight) || sourceWeight < -1 || sourceWeight > 1) {
      setError(t.feedManagement.errors.sourceWeight);
      return;
    }

    await runManagementAction("updateFeed", async () => {
      await props.onUpdateFeed(selectedFeed.id, {
        title,
        folderId:
          feedDraft.folderId === UNGROUPED_FOLDER_VALUE ? null : feedDraft.folderId,
        enabled: feedDraft.enabled,
        sourceWeight
      });
    });
  }

  async function handleDeleteFeed(feed: Feed) {
    if (confirmDeleteFeedId !== feed.id) {
      setConfirmDeleteFeedId(feed.id);
      setError(null);
      return;
    }

    await runManagementAction("deleteFeed", async () => {
      await props.onDeleteFeed(feed.id);
      setConfirmDeleteFeedId(null);
    });
  }

  return (
    <div className={styles.managementWorkspace}>
      <section className={styles.managementTopSection} aria-labelledby="feed-operations-title">
        <div className={styles.managementHeader}>
          <div>
            <p className={styles.kicker}>{t.feedManagement.operations.kicker}</p>
            <h2 id="feed-operations-title">{t.feedManagement.operations.title}</h2>
          </div>
        </div>

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
                  {props.opmlSummary.errors.map((summaryError, index) => (
                    <li key={`${summaryError}-${index}`}>{summaryError}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className={styles.managementSection} aria-labelledby="folder-management-title">
        <div className={styles.managementHeader}>
          <div>
            <p className={styles.kicker}>{t.feedManagement.folders.kicker}</p>
            <h2 id="folder-management-title">{t.feedManagement.folders.title}</h2>
          </div>
          <span className={styles.count}>{props.feedFolders.length}</span>
        </div>

        <form className={styles.managementForm} onSubmit={handleCreateFolder}>
          <label htmlFor="new-folder-title">{t.feedManagement.folders.newLabel}</label>
          <div className={styles.managementInlineForm}>
            <input
              id="new-folder-title"
              onChange={(event) => setNewFolderTitle(event.target.value)}
              placeholder={t.feedManagement.folders.newPlaceholder}
              value={newFolderTitle}
            />
            <button
              className={styles.primaryButton}
              disabled={pendingAction === "createFolder"}
              type="submit"
            >
              {pendingAction === "createFolder"
                ? t.feedManagement.actions.saving
                : t.feedManagement.folders.create}
            </button>
          </div>
        </form>

        <div className={styles.managementList}>
          {props.isLoading ? <SkeletonRows count={4} /> : null}
          {!props.isLoading && props.feedFolders.length === 0 ? (
            <ManagementEmptyState
              title={t.feedManagement.folders.emptyTitle}
              body={t.feedManagement.folders.emptyBody}
            />
          ) : null}
          {!props.isLoading &&
            props.feedFolders.map((folder) => (
              <div className={styles.managementFolderRow} key={folder.id}>
                {editingFolderId === folder.id ? (
                  <input
                    aria-label={t.feedManagement.folders.renameLabel(folder.title)}
                    onChange={(event) => setFolderDraftTitle(event.target.value)}
                    value={folderDraftTitle}
                  />
                ) : (
                  <div>
                    <strong>{folder.title}</strong>
                    <small>
                      {t.folders.feedCount(feedCountByFolder.get(folder.id) ?? 0)}
                    </small>
                  </div>
                )}
                <div className={styles.managementActions}>
                  {editingFolderId === folder.id ? (
                    <>
                      <button
                        className={styles.primaryButton}
                        disabled={pendingAction === "updateFolder"}
                        onClick={() => void handleUpdateFolder(folder)}
                        type="button"
                      >
                        {pendingAction === "updateFolder"
                          ? t.feedManagement.actions.saving
                          : t.feedManagement.actions.save}
                      </button>
                      <button
                        className={styles.secondaryButton}
                        onClick={() => setEditingFolderId(null)}
                        type="button"
                      >
                        {t.feedManagement.actions.cancel}
                      </button>
                    </>
                  ) : (
                    <button
                      className={styles.secondaryButton}
                      onClick={() => startEditingFolder(folder)}
                      type="button"
                    >
                      {t.feedManagement.actions.rename}
                    </button>
                  )}
                  <button
                    className={styles.dangerButton}
                    disabled={pendingAction === "deleteFolder"}
                    onClick={() => void handleDeleteFolder(folder)}
                    type="button"
                  >
                    {confirmDeleteFolderId === folder.id
                      ? t.feedManagement.folders.confirmDelete
                      : t.feedManagement.actions.delete}
                  </button>
                </div>
                {confirmDeleteFolderId === folder.id ? (
                  <p className={styles.managementHint}>
                    {t.feedManagement.folders.deleteHint}
                  </p>
                ) : null}
              </div>
            ))}
        </div>
      </section>

      <section className={styles.managementSection} aria-labelledby="feed-management-title">
        <div className={styles.managementHeader}>
          <div>
            <p className={styles.kicker}>{t.feedManagement.feeds.kicker}</p>
            <h2 id="feed-management-title">{t.feedManagement.feeds.title}</h2>
          </div>
          <span className={styles.count}>{props.feeds.length}</span>
        </div>

        <form className={styles.managementForm} onSubmit={props.onAddFeed}>
          <label htmlFor="managed-new-feed-url">{t.feeds.inputLabel}</label>
          <div className={styles.managementInlineForm}>
            <input
              id="managed-new-feed-url"
              inputMode="url"
              onChange={(event) => props.onUpdateFeedUrl(event.target.value)}
              placeholder={t.feeds.inputPlaceholder}
              type="url"
              value={props.feedUrl}
            />
            <button
              className={styles.primaryButton}
              disabled={props.isAddingFeed}
              type="submit"
            >
              {props.isAddingFeed ? t.feeds.adding : t.setup.sources.addFeed}
            </button>
          </div>
        </form>

        {props.feedError ? <p className={styles.errorText}>{props.feedError}</p> : null}
        {error ? <p className={styles.errorText}>{error}</p> : null}

        <div className={styles.feedManagementGrid}>
          <div className={styles.managementList}>
            {props.isLoading ? <SkeletonRows count={6} /> : null}
            {!props.isLoading && props.feeds.length === 0 ? (
              <ManagementEmptyState
                title={t.feedManagement.feeds.emptyTitle}
                body={t.feedManagement.feeds.emptyBody}
              />
            ) : null}
            {!props.isLoading &&
              props.feeds.map((feed) => (
                <button
                  className={
                    selectedFeed?.id === feed.id
                      ? styles.managementFeedItemActive
                      : styles.managementFeedItem
                  }
                  key={feed.id}
                  onClick={() => setSelectedFeedId(feed.id)}
                  type="button"
                >
                  <span className={styles.managementFeedTitle}>{feed.title}</span>
                  <span className={styles.managementFeedUrl}>{feed.feedUrl}</span>
                  <span className={styles.managementFeedMeta}>
                    {folderLabel(feed, folderById, t.feedManagement.feeds.ungrouped)} ·{" "}
                    {feed.enabled
                      ? t.feedManagement.feeds.enabled
                      : t.feedManagement.feeds.disabled}{" "}
                    · {t.feedManagement.feeds.weight(feed.sourceWeight)}
                  </span>
                  <span className={styles.managementFeedMeta}>
                    {t.feedManagement.feeds.lastSuccess(
                      feed.lastSuccessAt ? formatDate(feed.lastSuccessAt) : t.feedManagement.na
                    )}
                  </span>
                  <span className={styles.managementFeedMeta}>
                    {t.feedManagement.feeds.nextRefresh(
                      feed.nextRefreshAt ? formatDate(feed.nextRefreshAt) : t.feedManagement.na
                    )}
                  </span>
                  {feed.lastError ? (
                    <span className={styles.managementFeedError}>{feed.lastError}</span>
                  ) : null}
                </button>
              ))}
          </div>

          <section className={styles.managementEditor} aria-labelledby="feed-editor-title">
            {selectedFeed ? (
              <>
                <div className={styles.managementHeader}>
                  <div>
                    <p className={styles.kicker}>{t.feedManagement.editor.kicker}</p>
                    <h3 id="feed-editor-title">{selectedFeed.title}</h3>
                  </div>
                </div>
                <form className={styles.managementForm} onSubmit={handleUpdateFeed}>
                  <label htmlFor="managed-feed-title">
                    {t.feedManagement.editor.titleLabel}
                  </label>
                  <input
                    id="managed-feed-title"
                    onChange={(event) =>
                      setFeedDraft((current) => ({
                        ...current,
                        title: event.target.value
                      }))
                    }
                    value={feedDraft.title}
                  />

                  <label htmlFor="managed-feed-url">
                    {t.feedManagement.editor.feedUrlLabel}
                  </label>
                  <input id="managed-feed-url" readOnly value={selectedFeed.feedUrl} />

                  <label htmlFor="managed-feed-folder">
                    {t.feedManagement.editor.folderLabel}
                  </label>
                  <select
                    id="managed-feed-folder"
                    onChange={(event) =>
                      setFeedDraft((current) => ({
                        ...current,
                        folderId: event.target.value
                      }))
                    }
                    value={feedDraft.folderId}
                  >
                    <option value={UNGROUPED_FOLDER_VALUE}>
                      {t.feedManagement.feeds.ungrouped}
                    </option>
                    {props.feedFolders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.title}
                      </option>
                    ))}
                  </select>

                  <label className={styles.managementCheckbox} htmlFor="managed-feed-enabled">
                    <input
                      checked={feedDraft.enabled}
                      id="managed-feed-enabled"
                      onChange={(event) =>
                        setFeedDraft((current) => ({
                          ...current,
                          enabled: event.target.checked
                        }))
                      }
                      type="checkbox"
                    />
                    <span>{t.feedManagement.editor.enabledLabel}</span>
                  </label>

                  <label htmlFor="managed-feed-source-weight">
                    {t.feedManagement.editor.sourceWeightLabel}
                  </label>
                  <input
                    id="managed-feed-source-weight"
                    max={1}
                    min={-1}
                    onChange={(event) =>
                      setFeedDraft((current) => ({
                        ...current,
                        sourceWeight: event.target.value
                      }))
                    }
                    step={0.1}
                    type="number"
                    value={feedDraft.sourceWeight}
                  />

                  <dl className={styles.managementStatusRows}>
                    <div>
                      <dt>{t.feedManagement.editor.lastFetchedAt}</dt>
                      <dd>
                        {selectedFeed.lastFetchedAt
                          ? formatDate(selectedFeed.lastFetchedAt)
                          : t.feedManagement.na}
                      </dd>
                    </div>
                    <div>
                      <dt>{t.feedManagement.editor.lastSuccessAt}</dt>
                      <dd>
                        {selectedFeed.lastSuccessAt
                          ? formatDate(selectedFeed.lastSuccessAt)
                          : t.feedManagement.na}
                      </dd>
                    </div>
                    <div>
                      <dt>{t.feedManagement.editor.nextRefreshAt}</dt>
                      <dd>
                        {selectedFeed.nextRefreshAt
                          ? formatDate(selectedFeed.nextRefreshAt)
                          : t.feedManagement.na}
                      </dd>
                    </div>
                    <div>
                      <dt>{t.feedManagement.editor.lastError}</dt>
                      <dd>{selectedFeed.lastError ?? t.feedManagement.na}</dd>
                    </div>
                  </dl>

                  <div className={styles.managementActions}>
                    <button
                      className={styles.primaryButton}
                      disabled={pendingAction === "updateFeed"}
                      type="submit"
                    >
                      {pendingAction === "updateFeed"
                        ? t.feedManagement.actions.saving
                        : t.feedManagement.actions.save}
                    </button>
                    <button
                      className={styles.dangerButton}
                      disabled={pendingAction === "deleteFeed"}
                      onClick={() => void handleDeleteFeed(selectedFeed)}
                      type="button"
                    >
                      {confirmDeleteFeedId === selectedFeed.id
                        ? t.feedManagement.feeds.confirmDelete
                        : t.feedManagement.actions.delete}
                    </button>
                  </div>
                  {confirmDeleteFeedId === selectedFeed.id ? (
                    <p className={styles.managementHint}>
                      {t.feedManagement.feeds.deleteHint}
                    </p>
                  ) : null}
                </form>
              </>
            ) : (
              <ManagementEmptyState
                title={t.feedManagement.editor.emptyTitle}
                body={t.feedManagement.editor.emptyBody}
              />
            )}
          </section>
        </div>
      </section>
    </div>
  );
}

function draftForFeed(feed: Feed): FeedDraft {
  return {
    title: feed.title,
    folderId: feed.folderId ?? UNGROUPED_FOLDER_VALUE,
    enabled: feed.enabled,
    sourceWeight: String(feed.sourceWeight)
  };
}

function emptyFeedDraft(): FeedDraft {
  return {
    title: "",
    folderId: UNGROUPED_FOLDER_VALUE,
    enabled: true,
    sourceWeight: "0"
  };
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

function folderLabel(
  feed: Feed,
  folderById: Map<string, FeedFolder>,
  ungroupedLabel: string
): string {
  return feed.folderId ? folderById.get(feed.folderId)?.title ?? ungroupedLabel : ungroupedLabel;
}

function ManagementEmptyState(props: { title: string; body: string }) {
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
