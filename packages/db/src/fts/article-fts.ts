import type { ArticleSearchResult, DibaoDatabase } from "../types.js";

export interface ArticleFtsIndex {
  upsert(input: {
    articleId: string;
    title: string;
    summary?: string | null;
    contentText?: string | null;
  }): void;
  delete(articleId: string): void;
  search(query: string, limit?: number): ArticleSearchResult[];
}

export class SqliteArticleFtsIndex implements ArticleFtsIndex {
  constructor(private readonly db: DibaoDatabase) {}

  upsert(input: {
    articleId: string;
    title: string;
    summary?: string | null;
    contentText?: string | null;
  }): void {
    this.db.transaction(() => {
      this.delete(input.articleId);
      this.db
        .prepare(
          `
            insert into article_fts (article_id, title, summary, content_text)
            values (?, ?, ?, ?)
          `
        )
        .run(
          input.articleId,
          input.title,
          input.summary ?? "",
          input.contentText ?? ""
        );
    })();
  }

  delete(articleId: string): void {
    this.db.prepare("delete from article_fts where article_id = ?").run(articleId);
  }

  search(query: string, limit: number = 50): ArticleSearchResult[] {
    const sanitized = sanitizeFtsQuery(query);
    if (!sanitized) {
      return [];
    }

    return this.db
      .prepare(
        `
          select
            article_id as articleId,
            title,
            nullif(summary, '') as summary,
            bm25(article_fts, 5.0, 2.0, 0.6) as rank
          from article_fts
          where article_fts match ?
          order by rank
          limit ?
        `
      )
      .all(sanitized, limit) as ArticleSearchResult[];
  }
}

export function sanitizeFtsQuery(query: string): string {
  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .slice(0, 32);

  return terms.map((term) => `"${term.replaceAll("\"", "\"\"")}"`).join(" OR ");
}
