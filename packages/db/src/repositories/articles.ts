import { SqliteArticleFtsIndex, sanitizeFtsQuery } from "../fts/article-fts.js";
import type {
  ArticleDetailRow,
  ArticleEmbeddingCandidateRow,
  ArticleInteractionStatus,
  ArticleListInput,
  ArticleListItemRow,
  ArticleListResult,
  ArticleRetentionCandidateRow,
  ArticleRetentionCleanupResult,
  ArticleRow,
  ArticleScope,
  ArticleSearchInput,
  ArticleSearchResult,
  DibaoDatabase,
  MarkScopeReadAuditResult,
  UpsertArticleContentInput,
  UpsertArticleContentResult,
  UpsertArticleInput
} from "../types.js";
import { BASE_RANK_CONTEXT } from "./ranking.js";

const EMBEDDING_ELIGIBLE_TEXT_PREDICATE = `
  (
    trim(coalesce(a.title, '')) != ''
    or trim(coalesce(a.summary, '')) != ''
    or trim(substr(coalesce(ac.content_text, ''), 1, 256)) != ''
  )
`;

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
  liked: 0 | 1;
  readLater: 0 | 1;
  hidden: 0 | 1;
  notInterested: 0 | 1;
  readingProgress: number;
  lastOpenedAt: number | null;
  lastIgnoredAt: number | null;
  lastActionAt: number | null;
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
  countUnreadForScope(scope: ArticleScope): number;
  findById(id: string): ArticleRow | null;
  findDetailById(id: string, input?: { rankContext?: string }): ArticleDetailRow | null;
  listUnreadArticleIdsForScope(scope: ArticleScope, limit?: number): string[];
  markScopeRead(scope: ArticleScope, now: number, auditSampleLimit?: number): MarkScopeReadAuditResult;
  listEmbeddingCandidates(input: {
    embeddingIndexId: string;
    articleIds?: string[];
    limit?: number;
  }): ArticleEmbeddingCandidateRow[];
  listRetentionCandidates(input: {
    cutoff: number;
    keepFavorites?: boolean;
    keepReadLater?: boolean;
    limit?: number;
  }): ArticleRetentionCandidateRow[];
  list(input?: ArticleListInput): ArticleListResult;
  markArticleIdsRead(articleIds: string[], now: number): number;
  search(input: ArticleSearchInput): ArticleSearchResult;
  upsert(input: UpsertArticleInput): ArticleRow;
  upsertContent(input: UpsertArticleContentInput): UpsertArticleContentResult;
}

export class SqliteArticleRepository implements ArticleRepository {
  private readonly fts: SqliteArticleFtsIndex;

  constructor(private readonly db: DibaoDatabase) {
    this.fts = new SqliteArticleFtsIndex(db);
  }

  countUnreadForScope(scope: ArticleScope): number {
    const candidates = buildArticleScopeUnreadCandidates(scope);
    const row = this.db
      .prepare(
        `
          ${candidates.sql}
          select count(*) as count
          from candidates
        `
      )
      .get(...candidates.params) as { count: number } | undefined;

    return row?.count ?? 0;
  }

  listUnreadArticleIdsForScope(scope: ArticleScope, limit?: number): string[] {
    const candidates = buildArticleScopeUnreadCandidates(scope);
    const limitClause =
      typeof limit === "number" && Number.isInteger(limit) && limit > 0 ? "limit ?" : "";
    const params = limitClause ? [...candidates.params, limit] : candidates.params;
    const rows = this.db
      .prepare(
        `
          ${candidates.sql}
          select article_id as articleId
          from candidates
          order by article_id
          ${limitClause}
        `
      )
      .all(...params) as Array<{ articleId: string }>;

    return rows.map((row) => row.articleId);
  }

  markScopeRead(
    scope: ArticleScope,
    now: number,
    auditSampleLimit = 200
  ): MarkScopeReadAuditResult {
    const candidates = buildArticleScopeUnreadCandidates(scope);
    const sampleLimit = Math.max(Math.trunc(auditSampleLimit), 0);

    return this.db.transaction(() => {
      const sampleArticleIds =
        sampleLimit > 0 ? this.listUnreadArticleIdsForScope(scope, sampleLimit + 1) : [];
      const markedReadCount = this.db
        .prepare(
          `
            ${candidates.sql}
            insert or ignore into article_states (
              article_id,
              read_at,
              favorited_at,
              liked_at,
              read_later_at,
              hidden_at,
              not_interested_at,
              reading_progress,
              last_opened_at,
              updated_at
            )
            select article_id, ?, null, null, null, null, null, 1, null, ?
            from candidates
          `
        )
        .run(...candidates.params, now, now).changes;

      return {
        markedReadCount,
        sampleArticleIds: sampleArticleIds.slice(0, sampleLimit),
        limitedAudit: sampleArticleIds.length > sampleLimit || markedReadCount > sampleLimit
      };
    })();
  }

  markArticleIdsRead(articleIds: string[], now: number): number {
    const uniqueArticleIds = uniqueStrings(articleIds);
    if (uniqueArticleIds.length === 0) {
      return 0;
    }

    const insertState = this.db.prepare(
      `
        insert into article_states (
          article_id,
          read_at,
          favorited_at,
          liked_at,
          read_later_at,
          hidden_at,
          not_interested_at,
          reading_progress,
          last_opened_at,
          updated_at
        )
        values (?, null, null, null, null, null, null, 0, null, ?)
        on conflict(article_id) do nothing
      `
    );

    for (const articleId of uniqueArticleIds) {
      insertState.run(articleId, now);
    }

    let changed = 0;
    for (const chunk of chunkStrings(uniqueArticleIds, 400)) {
      const placeholders = chunk.map(() => "?").join(", ");
      changed += this.db
        .prepare(
          `
            update article_states
            set
              read_at = ?,
              reading_progress = 1,
              updated_at = ?
            where article_id in (${placeholders})
          `
        )
        .run(now, now, ...chunk).changes;
    }

    return changed;
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
    const limit = normalizeEmbeddingCandidateLimit(input.limit);
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
              and ${EMBEDDING_ELIGIBLE_TEXT_PREDICATE}
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
    keepFavorites?: boolean;
    keepReadLater?: boolean;
    limit?: number;
  }): ArticleRetentionCandidateRow[] {
    const limit = normalizeLimit(input.limit);
    const conditions = [
      "a.deleted_at is null",
      "a.status != 'deleted'",
      "coalesce(a.published_at, a.discovered_at) < ?"
    ];
    const params: unknown[] = [input.cutoff];

    if (input.keepFavorites ?? true) {
      conditions.push("s.favorited_at is null");
    }

    if (input.keepReadLater ?? true) {
      conditions.push("s.read_later_at is null");
    }
    params.push(limit);

    return (
      this.db
        .prepare(
          `
            select
              a.id as articleId,
              coalesce(a.published_at, a.discovered_at) as retainedAt
            from articles a
            left join article_states s on s.article_id = a.id
            where ${conditions.join("\n              and ")}
            order by coalesce(a.published_at, a.discovered_at), a.id
            limit ?
          `
        )
        .all(...params) as ArticleRetentionCandidateRow[]
    );
  }

  list(input: ArticleListInput = {}): ArticleListResult {
    const limit = normalizeLimit(input.limit);
    const offset = normalizeOffset(input.offset);
    const baseConditions = [
      "a.deleted_at is null",
      "a.status != 'deleted'",
      "s.hidden_at is null",
      "s.not_interested_at is null"
    ];
    const rankContext = input.rankContext ?? BASE_RANK_CONTEXT;
    const rankParams: unknown[] = [rankContext, BASE_RANK_CONTEXT];
    const filterParams: unknown[] = [];

    if (input.feedId) {
      baseConditions.push("a.feed_id = ?");
      filterParams.push(input.feedId);
    }

    if (input.folderId) {
      baseConditions.push("f.folder_id = ?");
      filterParams.push(input.folderId);
    }

    if (typeof input.todayStartAt === "number" && typeof input.todayEndAt === "number") {
      baseConditions.push("coalesce(a.published_at, a.discovered_at) >= ?");
      filterParams.push(input.todayStartAt);
      baseConditions.push("coalesce(a.published_at, a.discovered_at) < ?");
      filterParams.push(input.todayEndAt);
    }

    if (input.view === "favorites") {
      baseConditions.push("s.favorited_at is not null");
    } else if (input.view === "read_later") {
      baseConditions.push("s.read_later_at is not null");
    }

    const unreadCount = this.countForConditions(
      [...baseConditions, unreadArticleCondition()],
      filterParams
    );

    const conditions = [...baseConditions];

    if (input.status === "read") {
      conditions.push("(s.read_at is not null or coalesce(s.reading_progress, 0) >= 0.9)");
    } else if (input.status === "unread") {
      conditions.push(unreadArticleCondition());
    }

    if (input.unreadOnly && input.status !== "unread") {
      conditions.push(unreadArticleCondition());
    }

    const rows = this.db
      .prepare(
        `
          ${baseArticleReadSelect()}
          ${baseArticleReadFrom()}
          where ${conditions.join(" and ")}
          ${orderByForView(input.view, input.sort)}
          limit ?
          offset ?
        `
      )
      .all(...rankParams, ...filterParams, limit + 1, offset) as ArticleReadDbRow[];

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map(mapArticleListItem);

    return {
      items,
      nextOffset: hasMore ? offset + limit : null,
      unreadCount
    };
  }

  search(input: ArticleSearchInput): ArticleSearchResult {
    const query = input.query.trim();
    if (!query) {
      return {
        items: [],
        nextOffset: null,
        unreadCount: 0
      };
    }

    const limit = normalizeLimit(input.limit);
    const offset = normalizeOffset(input.offset);
    const rankContext = input.rankContext ?? BASE_RANK_CONTEXT;
    const search = buildSearchHitsCte(query);
    const baseConditions = [
      "a.deleted_at is null",
      "a.status != 'deleted'",
      "f.deleted_at is null",
      "s.hidden_at is null",
      "s.not_interested_at is null"
    ];
    const filterParams: unknown[] = [];

    if (input.feedId) {
      baseConditions.push("a.feed_id = ?");
      filterParams.push(input.feedId);
    }

    if (input.folderId) {
      baseConditions.push("f.folder_id = ?");
      filterParams.push(input.folderId);
    }

    if (typeof input.from === "number") {
      baseConditions.push("coalesce(a.published_at, a.discovered_at) >= ?");
      filterParams.push(input.from);
    }

    if (typeof input.to === "number") {
      baseConditions.push("coalesce(a.published_at, a.discovered_at) <= ?");
      filterParams.push(input.to);
    }

    const unreadCount = this.countForSearchConditions(
      search,
      [...baseConditions, unreadArticleCondition()],
      filterParams
    );

    const conditions = [...baseConditions];
    switch (input.state ?? "all") {
      case "unread":
        conditions.push(unreadArticleCondition());
        break;
      case "read":
        conditions.push("(s.read_at is not null or coalesce(s.reading_progress, 0) >= 0.9)");
        break;
      case "favorites":
        conditions.push("s.favorited_at is not null");
        break;
      case "read_later":
        conditions.push("s.read_later_at is not null");
        break;
      case "all":
        break;
    }

    const rows = this.db
      .prepare(
        `
          ${search.sql}
          ${baseArticleReadSelect()}
          ${baseArticleReadFrom()}
          join search_hits on search_hits.article_id = a.id
          where ${conditions.join(" and ")}
          ${orderByForSearch(input.sort ?? "relevance")}
          limit ?
          offset ?
        `
      )
      .all(
        ...search.params,
        rankContext,
        BASE_RANK_CONTEXT,
        ...filterParams,
        limit + 1,
        offset
      ) as ArticleReadDbRow[];

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map(mapArticleListItem);

    return {
      items,
      nextOffset: hasMore ? offset + limit : null,
      unreadCount
    };
  }

  private countForConditions(conditions: string[], params: unknown[]): number {
    const row = this.db
      .prepare(
        `
          select count(*) as count
          ${baseArticleFilterFrom()}
          where ${conditions.join(" and ")}
        `
      )
      .get(...params) as { count: number } | undefined;

    return row?.count ?? 0;
  }

  private countForSearchConditions(
    search: SearchHitsCte,
    conditions: string[],
    filterParams: unknown[]
  ): number {
    const row = this.db
      .prepare(
        `
          ${search.sql}
          select count(*) as count
          ${baseArticleFilterFrom()}
          join search_hits on search_hits.article_id = a.id
          where ${conditions.join(" and ")}
        `
      )
      .get(...search.params, ...filterParams) as { count: number } | undefined;

    return row?.count ?? 0;
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

  upsertContent(input: UpsertArticleContentInput): UpsertArticleContentResult {
    const now = input.now ?? Date.now();
    const result = this.db.transaction((): UpsertArticleContentResult => {
      const current = this.db
        .prepare("select content_hash as contentHash from articles where id = ?")
        .get(input.articleId) as { contentHash: string | null } | undefined;
      const nextHash = input.contentHash ?? null;
      const shouldUpdateHash = input.contentHash !== undefined;
      const contentHashChanged = shouldUpdateHash && (current?.contentHash ?? null) !== nextHash;

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

      if (shouldUpdateHash && contentHashChanged) {
        this.db
          .prepare(
            `
              update articles
              set content_hash = ?, updated_at = ?
              where id = ?
            `
          )
          .run(nextHash, now, input.articleId);
      }

      this.syncFts(input.articleId);
      return { contentHashChanged };
    })();

    return result;
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

type ArticleScopeUnreadCandidates = {
  sql: string;
  params: unknown[];
};

function buildArticleScopeUnreadCandidates(scope: ArticleScope): ArticleScopeUnreadCandidates {
  if (scope.type === "search") {
    return buildSearchUnreadCandidates(scope);
  }

  return buildArticleListUnreadCandidates(scope);
}

function buildArticleListUnreadCandidates(
  scope: Extract<ArticleScope, { type: "article_list" }>
): ArticleScopeUnreadCandidates {
  const conditions = [
    "a.deleted_at is null",
    "a.status != 'deleted'",
    "f.deleted_at is null",
    "s.hidden_at is null",
    "s.not_interested_at is null",
    unreadArticleCondition()
  ];
  const params: unknown[] = [];

  if (scope.feedId) {
    conditions.push("a.feed_id = ?");
    params.push(scope.feedId);
  }

  if (scope.folderId) {
    conditions.push("f.folder_id = ?");
    params.push(scope.folderId);
  }

  if (typeof scope.beforeAt === "number") {
    conditions.push("coalesce(a.published_at, a.discovered_at) < ?");
    params.push(scope.beforeAt);
  } else if (typeof scope.todayStartAt === "number" && typeof scope.todayEndAt === "number") {
    conditions.push("coalesce(a.published_at, a.discovered_at) >= ?");
    params.push(scope.todayStartAt);
    conditions.push("coalesce(a.published_at, a.discovered_at) < ?");
    params.push(scope.todayEndAt);
  }

  return {
    sql: `
      with candidates as (
        select a.id as article_id
        from articles a
        join feeds f on f.id = a.feed_id
        left join article_states s on s.article_id = a.id
        where ${conditions.join("\n          and ")}
      )
    `,
    params
  };
}

function buildSearchUnreadCandidates(
  scope: Extract<ArticleScope, { type: "search" }>
): ArticleScopeUnreadCandidates {
  const query = scope.query.trim();
  if (!query || (scope.state ?? "all") === "read") {
    return {
      sql: `
        with candidates as (
          select a.id as article_id
          from articles a
          where 1 = 0
        )
      `,
      params: []
    };
  }

  const search = buildSearchHitsCte(query);
  const conditions = [
    "a.deleted_at is null",
    "a.status != 'deleted'",
    "f.deleted_at is null",
    "s.hidden_at is null",
    "s.not_interested_at is null",
    unreadArticleCondition()
  ];
  const filterParams: unknown[] = [];

  if (scope.feedId) {
    conditions.push("a.feed_id = ?");
    filterParams.push(scope.feedId);
  }

  if (scope.folderId) {
    conditions.push("f.folder_id = ?");
    filterParams.push(scope.folderId);
  }

  if (typeof scope.from === "number") {
    conditions.push("coalesce(a.published_at, a.discovered_at) >= ?");
    filterParams.push(scope.from);
  }

  if (typeof scope.to === "number") {
    conditions.push("coalesce(a.published_at, a.discovered_at) <= ?");
    filterParams.push(scope.to);
  }

  switch (scope.state ?? "all") {
    case "favorites":
      conditions.push("s.favorited_at is not null");
      break;
    case "read_later":
      conditions.push("s.read_later_at is not null");
      break;
    case "unread":
    case "all":
      break;
    case "read":
      break;
  }

  return {
    sql: `
      ${search.sql},
      candidates as (
        select a.id as article_id
        from articles a
        join feeds f on f.id = a.feed_id
        left join article_states s on s.article_id = a.id
        join search_hits on search_hits.article_id = a.id
        where ${conditions.join("\n          and ")}
      )
    `,
    params: [...search.params, ...filterParams]
  };
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

function unreadArticleCondition(): string {
  return `
    s.article_id is null
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
      case when s.liked_at is not null then 1 else 0 end as liked,
      case when s.read_later_at is not null then 1 else 0 end as readLater,
      case when s.hidden_at is not null then 1 else 0 end as hidden,
      case when s.not_interested_at is not null then 1 else 0 end as notInterested,
      coalesce(s.reading_progress, 0) as readingProgress,
      s.last_opened_at as lastOpenedAt,
      (
        select max(be.created_at)
        from behavior_events be
        where be.article_id = a.id
          and be.event_type = 'impression'
          and be.event_weight < 0
      ) as lastIgnoredAt,
      (
        select max(be.created_at)
        from behavior_events be
        where be.article_id = a.id
      ) as lastActionAt,
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

function baseArticleFilterFrom(): string {
  return `
    from articles a
    join feeds f on f.id = a.feed_id and f.deleted_at is null
    left join article_states s on s.article_id = a.id
  `;
}

function orderByForView(
  view: ArticleListInput["view"],
  sort: ArticleListInput["sort"]
): string {
  if (view === "recommended") {
    return `
      order by
        case when rs.rerank_position is null then 1 else 0 end,
        rs.rerank_position asc,
        coalesce(rs.score, base_rs.score) desc,
        coalesce(a.published_at, a.discovered_at) desc,
        a.id desc
    `;
  }

  if (view === "favorites") {
    switch (sort ?? "favorited_desc") {
      case "favorited_asc":
        return `
          order by
            s.favorited_at asc,
            coalesce(a.published_at, a.discovered_at) desc,
            a.id desc
        `;
      case "published_desc":
        return `
          order by
            coalesce(a.published_at, a.discovered_at) desc,
            s.favorited_at desc,
            a.id desc
        `;
      case "published_asc":
        return `
          order by
            coalesce(a.published_at, a.discovered_at) asc,
            s.favorited_at desc,
            a.id desc
        `;
      case "favorited_desc":
      default:
        return `
          order by
            s.favorited_at desc,
            coalesce(a.published_at, a.discovered_at) desc,
            a.id desc
        `;
    }
  }

  if (view === "read_later") {
    switch (sort ?? "ranked") {
      case "read_later_desc":
        return `
          order by
            s.read_later_at desc,
            coalesce(a.published_at, a.discovered_at) desc,
            a.id desc
        `;
      case "read_later_asc":
        return `
          order by
            s.read_later_at asc,
            coalesce(a.published_at, a.discovered_at) asc,
            a.id desc
        `;
      case "published_desc":
        return `
          order by
            coalesce(a.published_at, a.discovered_at) desc,
            s.read_later_at desc,
            a.id desc
        `;
      case "published_asc":
        return `
          order by
            coalesce(a.published_at, a.discovered_at) asc,
            s.read_later_at desc,
            a.id desc
        `;
      case "ranked":
      case "favorited_desc":
      case "favorited_asc":
        break;
    }

    return `
      order by
        case when rs.rerank_position is null then 1 else 0 end,
        rs.rerank_position asc,
        coalesce(rs.score, base_rs.score) desc,
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

type SearchHitsCte = {
  sql: string;
  params: unknown[];
};

function buildSearchHitsCte(query: string): SearchHitsCte {
  const sanitizedFtsQuery = sanitizeFtsQuery(query);
  const useLikeFallback = sanitizedFtsQuery.length === 0 || containsHanScript(query);
  const ctes: string[] = [];
  const hitSources: string[] = [];
  const params: unknown[] = [];

  if (sanitizedFtsQuery) {
    ctes.push(`
      fts_hits as materialized (
      select
        article_id,
        bm25(article_fts, 5.0, 2.0, 0.6) as search_rank
      from article_fts
      where article_fts match ?
      )
    `);
    hitSources.push("select article_id, search_rank from fts_hits");
    params.push(sanitizedFtsQuery);
  }

  if (useLikeFallback) {
    const likeQuery = `%${escapeLikePattern(query)}%`;
    ctes.push(`
      like_hits as (
      select
        article_id,
        case
          when title like ? escape '\\' then 8.0
          when summary like ? escape '\\' then 14.0
          else 20.0
        end as search_rank
      from article_fts
      where title like ? escape '\\'
         or summary like ? escape '\\'
         or content_text like ? escape '\\'
      )
    `);
    hitSources.push("select article_id, search_rank from like_hits");
    params.push(likeQuery, likeQuery, likeQuery, likeQuery, likeQuery);
  }

  return {
    sql: `
      with
      ${ctes.join(",\n      ")},
      search_hits as (
        select
          article_id,
          min(search_rank) as search_rank
        from (
          ${hitSources.join("\n          union all\n")}
        )
        group by article_id
      )
    `,
    params
  };
}

function containsHanScript(value: string): boolean {
  return /\p{Script=Han}/u.test(value);
}

function escapeLikePattern(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function chunkStrings(values: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function orderByForSearch(sort: ArticleSearchInput["sort"]): string {
  switch (sort) {
    case "recommended":
      return `
        order by
          case when rs.rerank_position is null then 1 else 0 end,
          rs.rerank_position asc,
          coalesce(rs.score, base_rs.score) desc,
          search_hits.search_rank asc,
          coalesce(a.published_at, a.discovered_at) desc,
          a.id desc
      `;
    case "latest":
      return `
        order by
          coalesce(a.published_at, a.discovered_at) desc,
          search_hits.search_rank asc,
          coalesce(rs.score, base_rs.score) desc,
          a.id desc
      `;
    case "relevance":
    default:
      return `
        order by
          search_hits.search_rank asc,
          case when rs.rerank_position is null then 1 else 0 end,
          rs.rerank_position asc,
          coalesce(rs.score, base_rs.score) desc,
          coalesce(a.published_at, a.discovered_at) desc,
          a.id desc
      `;
  }
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
      liked: row.liked === 1,
      readLater: row.readLater === 1,
      hidden: row.hidden === 1,
      notInterested: row.notInterested === 1,
      readingProgress: row.readingProgress,
      interactionStatus: interactionStatusForArticle(row),
      openedAt: row.lastOpenedAt,
      ignoredAt: ignoredAtForArticle(row)
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

function interactionStatusForArticle(row: ArticleReadDbRow): ArticleInteractionStatus {
  if (row.read === 1 || row.readingProgress >= 0.9) {
    return "read";
  }
  if (row.readingProgress >= 0.25) {
    return "reading";
  }
  if (row.lastOpenedAt !== null) {
    return "opened";
  }
  if (row.favorited === 1 || row.liked === 1 || row.readLater === 1) {
    return "saved";
  }
  if (row.lastIgnoredAt !== null) {
    return "ignored";
  }
  if (row.lastActionAt !== null) {
    return "seen";
  }
  return "unseen";
}

function ignoredAtForArticle(row: ArticleReadDbRow): number | null {
  if (
    row.read === 1 ||
    row.readingProgress > 0 ||
    row.lastOpenedAt !== null ||
    row.favorited === 1 ||
    row.liked === 1 ||
    row.readLater === 1
  ) {
    return null;
  }

  return row.lastIgnoredAt;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return 50;
  }

  return Math.min(Math.max(Math.trunc(limit), 1), 100);
}

function normalizeEmbeddingCandidateLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return 50;
  }

  return Math.min(Math.max(Math.trunc(limit), 1), 1_000);
}

function normalizeOffset(offset: number | undefined): number {
  if (offset === undefined || !Number.isFinite(offset)) {
    return 0;
  }

  return Math.max(Math.trunc(offset), 0);
}
