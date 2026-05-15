import type {
  ArticleRankExplanationSourceRow,
  ArticleRankingCandidateRow,
  DibaoDatabase,
  UpsertArticleRankScoreInput
} from "../types.js";

export const BASE_RANK_CONTEXT = "base";

type ArticleRankingCandidateDbRow = {
  articleId: string;
  feedId: string;
  publishedAt: number | null;
  discoveredAt: number;
  sourceWeight: number;
  feedPositiveScore: number;
  feedNegativeScore: number;
  feedOpenRate: number;
  feedFavoriteRate: number;
  feedNotInterestedRate: number;
  read: 0 | 1;
  favorited: 0 | 1;
  readLater: 0 | 1;
  hidden: 0 | 1;
  notInterested: 0 | 1;
  readingProgress: number;
  behaviorEventWeightSum: number;
  behaviorEventCount: number;
  vectorBlob: Buffer | null;
  embeddingContentHash: string | null;
};

type ArticleRankExplanationSourceDbRow = {
  articleId: string;
  feedTitle: string;
  publishedAt: number | null;
  discoveredAt: number;
  read: 0 | 1;
  favorited: 0 | 1;
  readLater: 0 | 1;
  hidden: 0 | 1;
  notInterested: 0 | 1;
  readingProgress: number;
  score: number | null;
  interestScore: number | null;
  sourceScore: number | null;
  freshnessScore: number | null;
  stateScore: number | null;
  diversityScore: number | null;
  penaltyScore: number | null;
  calculatedAt: number | null;
};

export interface RankingRepository {
  findExplanationSource(input: {
    articleId: string;
    rankContext?: string;
  }): ArticleRankExplanationSourceRow | null;
  findBaseExplanationSource(articleId: string): ArticleRankExplanationSourceRow | null;
  listCandidates(input?: {
    articleIds?: string[];
    embeddingIndexId?: string | null;
  }): ArticleRankingCandidateRow[];
  listBaseCandidates(input?: { articleIds?: string[] }): ArticleRankingCandidateRow[];
  upsertScore(input: UpsertArticleRankScoreInput): void;
  upsertBaseScore(input: UpsertArticleRankScoreInput): void;
}

export class SqliteRankingRepository implements RankingRepository {
  constructor(private readonly db: DibaoDatabase) {}

  findExplanationSource(input: {
    articleId: string;
    rankContext?: string;
  }): ArticleRankExplanationSourceRow | null {
    const rankContext = input.rankContext ?? BASE_RANK_CONTEXT;
    const row = this.db
      .prepare(
        `
          select
            a.id as articleId,
            f.title as feedTitle,
            a.published_at as publishedAt,
            a.discovered_at as discoveredAt,
            case when s.read_at is not null then 1 else 0 end as read,
            case when s.favorited_at is not null then 1 else 0 end as favorited,
            case when s.read_later_at is not null then 1 else 0 end as readLater,
            case when s.hidden_at is not null then 1 else 0 end as hidden,
            case when s.not_interested_at is not null then 1 else 0 end as notInterested,
            coalesce(s.reading_progress, 0) as readingProgress,
            coalesce(rs.score, base_rs.score) as score,
            coalesce(rs.interest_score, base_rs.interest_score) as interestScore,
            coalesce(rs.source_score, base_rs.source_score) as sourceScore,
            coalesce(rs.freshness_score, base_rs.freshness_score) as freshnessScore,
            coalesce(rs.state_score, base_rs.state_score) as stateScore,
            coalesce(rs.diversity_score, base_rs.diversity_score) as diversityScore,
            coalesce(rs.penalty_score, base_rs.penalty_score) as penaltyScore,
            coalesce(rs.calculated_at, base_rs.calculated_at) as calculatedAt
          from articles a
          join feeds f on f.id = a.feed_id
          left join article_states s on s.article_id = a.id
          left join article_rank_scores rs
            on rs.article_id = a.id
            and rs.rank_context = ?
          left join article_rank_scores base_rs
            on base_rs.article_id = a.id
            and base_rs.rank_context = ?
          where a.id = ?
            and a.deleted_at is null
            and a.status != 'deleted'
            and f.deleted_at is null
        `
      )
      .get(rankContext, BASE_RANK_CONTEXT, input.articleId) as
      | ArticleRankExplanationSourceDbRow
      | undefined;

    return row ? mapExplanationSource(row) : null;
  }

  findBaseExplanationSource(articleId: string): ArticleRankExplanationSourceRow | null {
    return this.findExplanationSource({ articleId, rankContext: BASE_RANK_CONTEXT });
  }

  listCandidates(
    input: { articleIds?: string[]; embeddingIndexId?: string | null } = {}
  ): ArticleRankingCandidateRow[] {
    const articleIds = input.articleIds;
    if (articleIds !== undefined && articleIds.length === 0) {
      return [];
    }

    const articleFilter =
      articleIds === undefined ? "" : `and a.id in (${articleIds.map(() => "?").join(", ")})`;
    const params: unknown[] = [input.embeddingIndexId ?? ""];
    if (articleIds) {
      params.push(...articleIds);
    }

    return (
      this.db
        .prepare(
          `
            with event_stats as (
              select
                article_id,
                coalesce(sum(event_weight), 0) as behaviorEventWeightSum,
                count(*) as behaviorEventCount
              from behavior_events
              group by article_id
            )
            select
              a.id as articleId,
              a.feed_id as feedId,
              a.published_at as publishedAt,
              a.discovered_at as discoveredAt,
              f.source_weight as sourceWeight,
              coalesce(fs.positive_score, 0) as feedPositiveScore,
              coalesce(fs.negative_score, 0) as feedNegativeScore,
              coalesce(fs.open_rate, 0) as feedOpenRate,
              coalesce(fs.favorite_rate, 0) as feedFavoriteRate,
              coalesce(fs.not_interested_rate, 0) as feedNotInterestedRate,
              case when s.read_at is not null then 1 else 0 end as read,
              case when s.favorited_at is not null then 1 else 0 end as favorited,
              case when s.read_later_at is not null then 1 else 0 end as readLater,
              case when s.hidden_at is not null then 1 else 0 end as hidden,
              case when s.not_interested_at is not null then 1 else 0 end as notInterested,
              coalesce(s.reading_progress, 0) as readingProgress,
              coalesce(es.behaviorEventWeightSum, 0) as behaviorEventWeightSum,
              coalesce(es.behaviorEventCount, 0) as behaviorEventCount,
              ae.vector_blob as vectorBlob,
              ae.content_hash as embeddingContentHash
            from articles a
            join feeds f on f.id = a.feed_id
            left join article_states s on s.article_id = a.id
            left join feed_stats fs on fs.feed_id = a.feed_id
            left join event_stats es on es.article_id = a.id
            left join article_embeddings ae
              on ae.article_id = a.id
             and ae.embedding_index_id = ?
            where a.deleted_at is null
              and a.status != 'deleted'
              and f.deleted_at is null
              and f.enabled = 1
              ${articleFilter}
            order by a.id
          `
        )
        .all(...params) as ArticleRankingCandidateDbRow[]
    ).map(mapCandidate);
  }

  listBaseCandidates(input: { articleIds?: string[] } = {}): ArticleRankingCandidateRow[] {
    return this.listCandidates(input);
  }

  upsertScore(input: UpsertArticleRankScoreInput): void {
    this.db
      .prepare(
        `
          insert into article_rank_scores (
            article_id,
            rank_context,
            embedding_index_id,
            score,
            interest_score,
            source_score,
            freshness_score,
            state_score,
            diversity_score,
            penalty_score,
            calculated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          on conflict(article_id, rank_context) do update set
            embedding_index_id = excluded.embedding_index_id,
            score = excluded.score,
            interest_score = excluded.interest_score,
            source_score = excluded.source_score,
            freshness_score = excluded.freshness_score,
            state_score = excluded.state_score,
            diversity_score = excluded.diversity_score,
            penalty_score = excluded.penalty_score,
            calculated_at = excluded.calculated_at
        `
      )
      .run(
        input.articleId,
        input.rankContext ?? BASE_RANK_CONTEXT,
        input.embeddingIndexId ?? null,
        input.score,
        input.interestScore,
        input.sourceScore,
        input.freshnessScore,
        input.stateScore,
        input.diversityScore,
        input.penaltyScore,
        input.calculatedAt
      );
  }

  upsertBaseScore(input: UpsertArticleRankScoreInput): void {
    this.upsertScore({
      ...input,
      rankContext: input.rankContext ?? BASE_RANK_CONTEXT,
      embeddingIndexId: null
    });
  }
}

function mapExplanationSource(
  row: ArticleRankExplanationSourceDbRow
): ArticleRankExplanationSourceRow {
  const state = {
    read: row.read === 1,
    favorited: row.favorited === 1,
    readLater: row.readLater === 1,
    hidden: row.hidden === 1,
    notInterested: row.notInterested === 1,
    readingProgress: row.readingProgress
  };

  return {
    articleId: row.articleId,
    feedTitle: row.feedTitle,
    publishedAt: row.publishedAt,
    discoveredAt: row.discoveredAt,
    state,
    rank:
      row.score === null ||
      row.interestScore === null ||
      row.sourceScore === null ||
      row.freshnessScore === null ||
      row.stateScore === null ||
      row.diversityScore === null ||
      row.penaltyScore === null ||
      row.calculatedAt === null
        ? null
        : {
            score: row.score,
            interestScore: row.interestScore,
            sourceScore: row.sourceScore,
            freshnessScore: row.freshnessScore,
            stateScore: row.stateScore,
            diversityScore: row.diversityScore,
            penaltyScore: row.penaltyScore,
            calculatedAt: row.calculatedAt
          }
  };
}

function mapCandidate(row: ArticleRankingCandidateDbRow): ArticleRankingCandidateRow {
  return {
    articleId: row.articleId,
    feedId: row.feedId,
    publishedAt: row.publishedAt,
    discoveredAt: row.discoveredAt,
    sourceWeight: row.sourceWeight,
    feedPositiveScore: row.feedPositiveScore,
    feedNegativeScore: row.feedNegativeScore,
    feedOpenRate: row.feedOpenRate,
    feedFavoriteRate: row.feedFavoriteRate,
    feedNotInterestedRate: row.feedNotInterestedRate,
    state: {
      read: row.read === 1,
      favorited: row.favorited === 1,
      readLater: row.readLater === 1,
      hidden: row.hidden === 1,
      notInterested: row.notInterested === 1,
      readingProgress: row.readingProgress
    },
    behaviorEventWeightSum: row.behaviorEventWeightSum,
    behaviorEventCount: row.behaviorEventCount,
    vectorBlob: row.vectorBlob,
    embeddingContentHash: row.embeddingContentHash
  };
}
