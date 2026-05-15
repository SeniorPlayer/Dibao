import { SqliteArticleFtsIndex } from "../fts/article-fts.js";
import type {
  ArticleDetailRow,
  ArticleEmbeddingCandidateRow,
  ArticleListInput,
  ArticleListItemRow,
  ArticleListResult,
  ArticleRetentionCandidateRow,
  ArticleRetentionCleanupResult,
  ArticleRow,
  DibaoDatabase,
  UpsertArticleContentInput,
  UpsertArticleInput
} from "../types.js";
import { BASE_RANK_CONTEXT } from "./ranking.js";

type ArticleDbRow = {
  id: string;
  feedId: string;
  guid: string | null;
  url: string;
  canonicalUrl: string | null;
  title: string;
  author: string | null;
  summary: string | null;
  publishedAt: number | null;
  discoveredAt: number;
  contentHash: string | null;
  dedupeKey: string;
  status: ArticleRow["status"];
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

type ArticleReadDbRow = ArticleDbRow & {
  feedTitle: string;
  read: 0 | 1;
  favorited: 0 | 1;
  readLater: 0 | 1;
  hidden: 0 | 1;
  notInterested: 0 | 1;
  readingProgress: number;
  rankScore: number | null;
  rankCalculatedAt: number | null;
};

type ArticleDetailDbRow = ArticleReadDbRow & {
  contentHtml: string | null;
  contentText: string | null;
  extractionStatus: ArticleDetailRow["extractionStatus"];
  extractionError: string | null;
};

export interface ArticleRepository {
  cleanupForRetention(articleIds: string[], now: number): ArticleRetentionCleanupResult;
  findById(id: string): ArticleRow | null;
  findDetailById(id: string, input?: { rankContext?: string }): ArticleDetailRow | null;
  listEmbeddingCandidates(input: {
    embeddingIndexId: string;
    articleIds?: string[];
    limit?: number;
  }): ArticleEmbeddingCandidateRow[];
  listRetentionCandidates(input: { cutoff: number; limit?: number }): ArticleRetentionCandidateRow[];
  list(input?: ArticleListInput): ArticleListResult;
  upsert(input: UpsertArticleInput): ArticleRow;
  upsertContent(input: UpsertArticleContentInput): void;
}

export class SqliteArticleRepository implements ArticleRepository {
  private readonly fts: SqliteArticleFtsIndex;

  constructor(private readonly db: DibaoDatabase) {
    this.fts = new SqliteArticleFtsIndex(db);
  }

  cleanupForRetention(articleIds: string[], now: number): ArticleRetentionCleanupResult {
    if (articleIds.length === 0) {
      return {
        articlesSoftDeleted: 0,
        contentsDeleted: 0,
        ftsRowsDeleted: 0,
        rankScoresDeleted: 0,
        rankExplanationsDeleted: 0
      };
    }

    const placeholders = articleIds.map(() => "?").join(", ");

    return this.db.transaction(() => {
      const contentsDeleted = this.db
        .prepare(`delete from article_contents where article_id in (${placeholders})`)
        .run(...articleIds).changes;
      const rankScoresDeleted = this.db
        .prepare(`delete from article_rank_scores where article_id in (${placeholders})`)
        .run(...articleIds).changes;
      const rankExplanationsDeleted = this.db
        .prepare(`delete from article_rank_explanations where article_id in (${placeholders})`)
        .run(...articleIds).changes;
      const articlesSoftDeleted = this.db
        .prepare(
          `
            update articles
            set
              status = 'deleted',
              deleted_at = ?,
              updated_at = ?
            where id in (${placeholders})
              and deleted_at is null
              and status != 'deleted'
          `
        )
        .run(now, now, ...articleIds).changes;

      for (const articleId of articleIds) {
        this.fts.delete(articleId);
      }

      return {
        articlesSoftDeleted,
        contentsDeleted,
        ftsRowsDeleted: articleIds.length,
        rankScoresDeleted,
        rankExplanationsDeleted
      };
    })();
  }

  findById(id: string): ArticleRow | null {
    const row = this.db
      .prepare(
        `
          ${baseArticleSelect()}
          where id = ?
        `
      )
      .get(id) as ArticleDbRow | undefined;
    return row ? mapArticle(row) : null;
  }

  findDetailById(id: string, input: { rankContext?: string } = {}): ArticleDetailRow | null {
    const rankContext = input.rankContext ?? BASE_RANK_CONTEXT;
    const row = this.db
      .prepare(
        `
          ${baseArticleReadSelect()},
          ac.content_html as contentHtml,
          ac.content_text as contentText,
          coalesce(ac.extraction_status, 'pending') as extractionStatus,
          ac.extraction_error as extractionError
          ${baseArticleReadFrom()}
          left join article_contents ac on ac.article_id = a.id
          where a.id = ?
            and a.deleted_at is null
            and a.status != 'deleted'
        `
      )
      .get(rankContext, BASE_RANK_CONTEXT, id) as ArticleDetailDbRow | undefined;

    return row ? mapArticleDetail(row) : null;
  }

  listEmbeddingCandidates(input: {
    embeddingIndexId: string;
    articleIds?: string[];
    limit?: number;
  }): ArticleEmbeddingCandidateRow[] {
    const limit = normalizeLimit(input.limit);
    const params: unknown[] = [input.embeddingIndexId];
    const articleFilter =
      input.articleIds && input.articleIds.length > 0
        ? `and a.id in (${input.articleIds.map(() => "?").join(", ")})`
        : "";

    if (input.articleIds && input.articleIds.length > 0) {
      params.push(...input.articleIds);
    }
    params.push(limit);

    return (
      this.db
        .prepare(
          `
            select
              a.id as articleId,
              a.title,
              a.summary,
              ac.content_text as contentText,
              coalesce(a.content_hash, a.id || ':' || a.updated_at) as contentHash
            from articles a
            join feeds f on f.id = a.feed_id
            left join article_contents ac on ac.article_id = a.id
            left join article_embeddings ae
              on ae.article_id = a.id
             and ae.embedding_index_id = ?
            where a.deleted_at is null
              and a.status != 'deleted'
              and f.deleted_at is null
              and f.enabled = 1
              and trim(coalesce(a.title, '') || ' ' || coalesce(a.summary, '') || ' ' || coalesce(ac.content_text, '')) != ''
              and (
                ae.article_id is null
                or ae.content_hash != coalesce(a.content_hash, a.id || ':' || a.updated_at)
              )
              ${articleFilter}
            order by a.discovered_at desc, a.id
            limit ?
          `
        )
        .all(...params) as ArticleEmbeddingCandidateRow[]
    );
  }

  listRetentionCandidates(input: {
    cutoff: number;
    limit?: number;
  }): ArticleRetentionCandidateRow[] {
    const limit = normalizeLimit(input.limit);

    return (
      this.db
        .prepare(
          `
            select
              a.id as articleId,
              coalesce(a.published_at, a.discovered_at) as retainedAt
            from articles a
            left join article_states s on s.article_id = a.id
            where a.deleted_at is null
              and a.status != 'deleted'
              and coalesce(a.published_at, a.discovered_at) < ?
              and s.favorited_at is null
              and s.read_later_at is null
            order by coalesce(a.published_at, a.discovered_at), a.id
            limit ?
          `
        )
        .all(input.cutoff, limit) as ArticleRetentionCandidateRow[]
    );
  }

  list(input: ArticleListInput = {}): ArticleListResult {
    const limit = normalizeLimit(input.limit);
    const offset = normalizeOffset(input.offset);
    const conditions = [
      "a.deleted_at is null",
      "a.status != 'deleted'",
      "s.hidden_at is null",
      "s.not_interested_at is null"
    ];
    const rankContext = input.rankContext ?? BASE_RANK_CONTEXT;
    const params: unknown[] = [rankContext, BASE_RANK_CONTEXT];

    if (input.feedId) {
      conditions.push("a.feed_id = ?");
      params.push(input.feedId);
    }

    if (input.folderId) {
      conditions.push("f.folder_id = ?");
      params.push(input.folderId);
    }

    if (input.status === "read") {
      conditions.push("s.read_at is not null");
    } else if (input.status === "unread") {
      conditions.push("s.read_at is null");
    }

    if (input.view === "favorites") {
      conditions.push("s.favorited_at is not null");
    } else if (input.view === "read_later") {
      conditions.push("s.read_later_at is not null");
    }

    const rows = this.db
      .prepare(
        `
          ${baseArticleReadSelect()}
          ${baseArticleReadFrom()}
          where ${conditions.join(" and ")}
          ${orderByForView(input.view)}
          limit ?
          offset ?
        `
      )
      .all(...params, limit + 1, offset) as ArticleReadDbRow[];

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map(mapArticleListItem);

    return {
      items,
      nextOffset: hasMore ? offset + limit : null
    };
  }

  upsert(input: UpsertArticleInput): ArticleRow {
    const now = input.now ?? Date.now();
    const discoveredAt = input.discoveredAt ?? now;

    this.db
      .prepare(
        `
          insert into articles (
            id,
            feed_id,
            guid,
            url,
            canonical_url,
            title,
            author,
            summary,
            published_at,
            discovered_at,
            content_hash,
            dedupe_key,
            status,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          on conflict(id) do update set
            feed_id = excluded.feed_id,
            guid = excluded.guid,
            url = excluded.url,
            canonical_url = excluded.canonical_url,
            title = excluded.title,
            author = excluded.author,
            summary = excluded.summary,
            published_at = excluded.published_at,
            content_hash = excluded.content_hash,
            dedupe_key = excluded.dedupe_key,
            status = case
              when articles.deleted_at is not null or articles.status = 'deleted' then 'deleted'
              else excluded.status
            end,
            updated_at = excluded.updated_at
        `
      )
      .run(
        input.id,
        input.feedId,
        input.guid ?? null,
        input.url,
        input.canonicalUrl ?? null,
        input.title,
        input.author ?? null,
        input.summary ?? null,
        input.publishedAt ?? null,
        discoveredAt,
        input.contentHash ?? null,
        input.dedupeKey,
        input.status ?? "active",
        now,
        now
      );

    this.syncFts(input.id);

    const row = this.findById(input.id);
    if (!row) {
      throw new Error(`Failed to upsert article: ${input.id}`);
    }
    return row;
  }

  upsertContent(input: UpsertArticleContentInput): void {
    const now = input.now ?? Date.now();
    this.db
      .prepare(
        `
          insert into article_contents (
            article_id,
            content_html,
            content_text,
            extraction_status,
            extraction_error,
            extracted_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?)
          on conflict(article_id) do update set
            content_html = excluded.content_html,
            content_text = excluded.content_text,
            extraction_status = excluded.extraction_status,
            extraction_error = excluded.extraction_error,
            extracted_at = excluded.extracted_at,
            updated_at = excluded.updated_at
        `
      )
      .run(
        input.articleId,
        input.contentHtml ?? null,
        input.contentText ?? null,
        input.extractionStatus ?? "pending",
        input.extractionError ?? null,
        input.extractedAt ?? null,
        now
      );

    this.syncFts(input.articleId);
  }

  private syncFts(articleId: string): void {
    const row = this.db
      .prepare(
        `
          select
            a.id as articleId,
            a.title,
            a.summary,
            ac.content_text as contentText
          from articles a
          left join article_contents ac on ac.article_id = a.id
          where a.id = ? and a.deleted_at is null
            and a.status != 'deleted'
        `
      )
      .get(articleId) as
      | {
          articleId: string;
          title: string;
          summary: string | null;
          contentText: string | null;
        }
      | undefined;

    if (!row) {
      this.fts.delete(articleId);
      return;
    }

    this.fts.upsert(row);
  }
}

function baseArticleSelect(): string {
  return `
    select
      id,
      feed_id as feedId,
      guid,
      url,
      canonical_url as canonicalUrl,
      title,
      author,
      summary,
      published_at as publishedAt,
      discovered_at as discoveredAt,
      content_hash as contentHash,
      dedupe_key as dedupeKey,
      status,
      created_at as createdAt,
      updated_at as updatedAt,
      deleted_at as deletedAt
    from articles
  `;
}

function baseArticleReadSelect(): string {
  return `
    select
      a.id,
      a.feed_id as feedId,
      a.guid,
      a.url,
      a.canonical_url as canonicalUrl,
      a.title,
      a.author,
      a.summary,
      a.published_at as publishedAt,
      a.discovered_at as discoveredAt,
      a.content_hash as contentHash,
      a.dedupe_key as dedupeKey,
      a.status,
      a.created_at as createdAt,
      a.updated_at as updatedAt,
      a.deleted_at as deletedAt,
      f.title as feedTitle,
      case when s.read_at is not null then 1 else 0 end as read,
      case when s.favorited_at is not null then 1 else 0 end as favorited,
      case when s.read_later_at is not null then 1 else 0 end as readLater,
      case when s.hidden_at is not null then 1 else 0 end as hidden,
      case when s.not_interested_at is not null then 1 else 0 end as notInterested,
      coalesce(s.reading_progress, 0) as readingProgress,
      coalesce(rs.score, base_rs.score) as rankScore,
      coalesce(rs.calculated_at, base_rs.calculated_at) as rankCalculatedAt
  `;
}

function baseArticleReadFrom(): string {
  return `
    from articles a
    join feeds f on f.id = a.feed_id and f.deleted_at is null
    left join article_states s on s.article_id = a.id
    left join article_rank_scores rs
      on rs.article_id = a.id
      and rs.rank_context = ?
    left join article_rank_scores base_rs
      on base_rs.article_id = a.id
      and base_rs.rank_context = ?
  `;
}

function orderByForView(view: ArticleListInput["view"]): string {
  if (view === "recommended") {
    return `
      order by
        case when coalesce(rs.score, base_rs.score) is null then 1 else 0 end,
        coalesce(rs.score, base_rs.score) desc,
        coalesce(a.published_at, a.discovered_at) desc,
        a.id desc
    `;
  }

  if (view === "favorites") {
    return `
      order by
        s.favorited_at desc,
        coalesce(a.published_at, a.discovered_at) desc,
        a.id desc
    `;
  }

  if (view === "read_later") {
    return `
      order by
        s.read_later_at desc,
        coalesce(a.published_at, a.discovered_at) desc,
        a.id desc
    `;
  }

  return `
    order by
      coalesce(a.published_at, a.discovered_at) desc,
      a.id desc
  `;
}

function mapArticle(row: ArticleDbRow): ArticleRow {
  return row;
}

function mapArticleListItem(row: ArticleReadDbRow): ArticleListItemRow {
  return {
    id: row.id,
    feedId: row.feedId,
    feedTitle: row.feedTitle,
    title: row.title,
    url: row.url,
    author: row.author,
    summary: row.summary,
    publishedAt: row.publishedAt,
    discoveredAt: row.discoveredAt,
    state: {
      read: row.read === 1,
      favorited: row.favorited === 1,
      readLater: row.readLater === 1,
      hidden: row.hidden === 1,
      notInterested: row.notInterested === 1,
      readingProgress: row.readingProgress
    },
    rank:
      row.rankScore === null || row.rankCalculatedAt === null
        ? null
        : {
            score: row.rankScore,
            calculatedAt: row.rankCalculatedAt
          }
  };
}

function mapArticleDetail(row: ArticleDetailDbRow): ArticleDetailRow {
  return {
    ...mapArticleListItem(row),
    contentHtml: row.contentHtml,
    contentText: row.contentText,
    extractionStatus: row.extractionStatus,
    extractionError: row.extractionError
  };
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return 50;
  }

  return Math.min(Math.max(Math.trunc(limit), 1), 100);
}

function normalizeOffset(offset: number | undefined): number {
  if (offset === undefined || !Number.isFinite(offset)) {
    return 0;
  }

  return Math.max(Math.trunc(offset), 0);
}
