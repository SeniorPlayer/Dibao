import type {
  DibaoDatabase,
  FeedFolderRow,
  UpdateFeedFolderInput,
  UpsertFeedFolderInput
} from "../types.js";

type FeedFolderDbRow = {
  id: string;
  title: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
};

export interface FeedFolderRepository {
  findById(id: string): FeedFolderRow | null;
  findByTitle(title: string): FeedFolderRow | null;
  list(): FeedFolderRow[];
  nextSortOrder(): number;
  softDelete(id: string, now: number): boolean;
  update(input: UpdateFeedFolderInput): FeedFolderRow | null;
  upsert(input: UpsertFeedFolderInput): FeedFolderRow;
}

export class SqliteFeedFolderRepository implements FeedFolderRepository {
  constructor(private readonly db: DibaoDatabase) {}

  findById(id: string): FeedFolderRow | null {
    const row = this.db
      .prepare(`${baseFeedFolderSelect()} where id = ? and deleted_at is null`)
      .get(id) as FeedFolderDbRow | undefined;

    return row ? mapFeedFolder(row) : null;
  }

  findByTitle(title: string): FeedFolderRow | null {
    const row = this.db
      .prepare(
        `${baseFeedFolderSelect()} where title = ? collate nocase and deleted_at is null`
      )
      .get(title) as FeedFolderDbRow | undefined;

    return row ? mapFeedFolder(row) : null;
  }

  list(): FeedFolderRow[] {
    return (
      this.db
        .prepare(
          `
            ${baseFeedFolderSelect()}
            where deleted_at is null
            order by sort_order, title collate nocase, id
          `
        )
        .all() as FeedFolderDbRow[]
    ).map(mapFeedFolder);
  }

  nextSortOrder(): number {
    const row = this.db
      .prepare(
        `
          select coalesce(max(sort_order), -1) + 1 as sortOrder
          from feed_folders
          where deleted_at is null
        `
      )
      .get() as { sortOrder: number };

    return row.sortOrder;
  }

  softDelete(id: string, now: number): boolean {
    const result = this.db
      .prepare(
        `
          update feed_folders
          set
            deleted_at = ?,
            updated_at = ?
          where id = ? and deleted_at is null
        `
      )
      .run(now, now, id);

    return result.changes > 0;
  }

  update(input: UpdateFeedFolderInput): FeedFolderRow | null {
    const existing = this.findById(input.id);
    if (!existing) {
      return null;
    }

    const now = input.now ?? Date.now();
    this.db
      .prepare(
        `
          update feed_folders
          set
            title = ?,
            sort_order = ?,
            updated_at = ?
          where id = ? and deleted_at is null
        `
      )
      .run(
        input.title ?? existing.title,
        input.sortOrder ?? existing.sortOrder,
        now,
        input.id
      );

    return this.findById(input.id);
  }

  upsert(input: UpsertFeedFolderInput): FeedFolderRow {
    const now = input.now ?? Date.now();

    this.db
      .prepare(
        `
          insert into feed_folders (
            id,
            title,
            sort_order,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?)
          on conflict(id) do update set
            title = excluded.title,
            sort_order = excluded.sort_order,
            updated_at = excluded.updated_at,
            deleted_at = null
        `
      )
      .run(input.id, input.title, input.sortOrder ?? 0, now, now);

    const row = this.findById(input.id);
    if (!row) {
      throw new Error(`Failed to upsert feed folder: ${input.id}`);
    }
    return row;
  }
}

function baseFeedFolderSelect(): string {
  return `
    select
      id,
      title,
      sort_order as sortOrder,
      created_at as createdAt,
      updated_at as updatedAt
    from feed_folders
  `;
}

function mapFeedFolder(row: FeedFolderDbRow): FeedFolderRow {
  return row;
}
