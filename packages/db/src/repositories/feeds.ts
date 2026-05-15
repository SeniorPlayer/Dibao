import type {
  DibaoDatabase,
  FeedListInput,
  FeedRow,
  UpdateFeedInput,
  UpsertFeedInput
} from "../types.js";

type FeedDbRow = {
  id: string;
  folderId: string | null;
  title: string;
  siteUrl: string | null;
  feedUrl: string;
  description: string | null;
  enabled: 0 | 1;
  sourceWeight: number;
  lastFetchedAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
};

export interface FeedRepository {
  clearFolder(folderId: string, now: number): void;
  findById(id: string): FeedRow | null;
  findByFeedUrl(feedUrl: string): FeedRow | null;
  list(input?: FeedListInput): FeedRow[];
  listActive(): FeedRow[];
  recordFetchFailure(id: string, error: string, fetchedAt: number): void;
  recordFetchSuccess(id: string, fetchedAt: number): void;
  softDelete(id: string, now: number): boolean;
  update(input: UpdateFeedInput): FeedRow | null;
  upsert(input: UpsertFeedInput): FeedRow;
}

export class SqliteFeedRepository implements FeedRepository {
  constructor(private readonly db: DibaoDatabase) {}

  clearFolder(folderId: string, now: number): void {
    this.db
      .prepare(
        `
          update feeds
          set
            folder_id = null,
            updated_at = ?
          where folder_id = ? and deleted_at is null
        `
      )
      .run(now, folderId);
  }

  findById(id: string): FeedRow | null {
    const row = this.selectBase().get(id) as FeedDbRow | undefined;
    return row ? mapFeed(row) : null;
  }

  findByFeedUrl(feedUrl: string): FeedRow | null {
    const row = this.db
      .prepare(`${baseFeedSelect()} where feed_url = ? and deleted_at is null`)
      .get(feedUrl) as FeedDbRow | undefined;
    return row ? mapFeed(row) : null;
  }

  list(input: FeedListInput = {}): FeedRow[] {
    const conditions = ["deleted_at is null"];
    const params: unknown[] = [];

    if (input.folderId !== undefined) {
      if (input.folderId === null) {
        conditions.push("folder_id is null");
      } else {
        conditions.push("folder_id = ?");
        params.push(input.folderId);
      }
    }

    if (input.enabled !== undefined) {
      conditions.push("enabled = ?");
      params.push(input.enabled ? 1 : 0);
    }

    return (
      this.db
        .prepare(
          `
            ${baseFeedSelect()}
            where ${conditions.join(" and ")}
            order by title collate nocase, id
          `
        )
        .all(...params) as FeedDbRow[]
    ).map(mapFeed);
  }

  listActive(): FeedRow[] {
    return this.list({ enabled: true });
  }

  recordFetchFailure(id: string, error: string, fetchedAt: number): void {
    this.db
      .prepare(
        `
          update feeds
          set
            last_fetched_at = ?,
            last_error = ?,
            updated_at = ?
          where id = ? and deleted_at is null
        `
      )
      .run(fetchedAt, error, fetchedAt, id);
  }

  recordFetchSuccess(id: string, fetchedAt: number): void {
    this.db
      .prepare(
        `
          update feeds
          set
            last_fetched_at = ?,
            last_success_at = ?,
            last_error = null,
            updated_at = ?
          where id = ? and deleted_at is null
        `
      )
      .run(fetchedAt, fetchedAt, fetchedAt, id);
  }

  softDelete(id: string, now: number): boolean {
    const result = this.db
      .prepare(
        `
          update feeds
          set
            deleted_at = ?,
            updated_at = ?
          where id = ? and deleted_at is null
        `
      )
      .run(now, now, id);

    return result.changes > 0;
  }

  update(input: UpdateFeedInput): FeedRow | null {
    const existing = this.findById(input.id);
    if (!existing) {
      return null;
    }

    const now = input.now ?? Date.now();
    this.db
      .prepare(
        `
          update feeds
          set
            title = ?,
            folder_id = ?,
            enabled = ?,
            source_weight = ?,
            updated_at = ?
          where id = ? and deleted_at is null
        `
      )
      .run(
        input.title ?? existing.title,
        input.folderId === undefined ? existing.folderId : input.folderId,
        input.enabled === undefined ? (existing.enabled ? 1 : 0) : input.enabled ? 1 : 0,
        input.sourceWeight ?? existing.sourceWeight,
        now,
        input.id
      );

    return this.findById(input.id);
  }

  upsert(input: UpsertFeedInput): FeedRow {
    const now = input.now ?? Date.now();
    this.db
      .prepare(
        `
          insert into feeds (
            id,
            folder_id,
            title,
            site_url,
            feed_url,
            description,
            enabled,
            source_weight,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          on conflict(feed_url) do update set
            folder_id = excluded.folder_id,
            title = excluded.title,
            site_url = excluded.site_url,
            description = excluded.description,
            enabled = excluded.enabled,
            source_weight = excluded.source_weight,
            updated_at = excluded.updated_at,
            deleted_at = null
        `
      )
      .run(
        input.id,
        input.folderId ?? null,
        input.title,
        input.siteUrl ?? null,
        input.feedUrl,
        input.description ?? null,
        input.enabled === false ? 0 : 1,
        input.sourceWeight ?? 0,
        now,
        now
      );

    const row = this.findByFeedUrl(input.feedUrl);
    if (!row) {
      throw new Error(`Failed to upsert feed: ${input.feedUrl}`);
    }
    return row;
  }

  private selectBase() {
    return this.db.prepare(`${baseFeedSelect()} where id = ? and deleted_at is null`);
  }
}

function baseFeedSelect(): string {
  return `
    select
      id,
      folder_id as folderId,
      title,
      site_url as siteUrl,
      feed_url as feedUrl,
      description,
      enabled,
      source_weight as sourceWeight,
      last_fetched_at as lastFetchedAt,
      last_success_at as lastSuccessAt,
      last_error as lastError,
      created_at as createdAt,
      updated_at as updatedAt
    from feeds
  `;
}

function mapFeed(row: FeedDbRow): FeedRow {
  return {
    ...row,
    enabled: row.enabled === 1
  };
}
