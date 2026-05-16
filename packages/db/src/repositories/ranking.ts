import type {
  ArticleRankExplanationSourceRow,
  ArticleRankingCandidateRow,
  DibaoDatabase,
  RankedArticleCountsRow,
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
  behaviorProjectionScore: number;
  behaviorEventCount: number;
  vectorBlob: Buffer | null;
  embeddingContentHash: string | null;
  embeddingStatus: ArticleRankingCandidateRow["embeddingStatus"];
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
  rankingStatus: ArticleRankExplanationSourceRow["rankingStatus"];
};

export interface RankingRepository {
  countRankedArticles(input: { activeRankContext: string }): RankedArticleCountsRow;
  findExplanationSource(input: {
    articleId: string;
    rankContext?: string;
  }): ArticleRankExplanationSourceRow | null;
  findBaseExplanationSource(articleId: string): ArticleRankExplanationSourceRow | null;
  getLastRankingUpdate(input: { activeRankContext: string }): number | null;
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

  countRankedArticles(input: { activeRankContext: string }): RankedArticleCountsRow {
    const row = this.db
      .prepare(
        `
          select
            sum(case when rank_context = ? then 1 else 0 end) as base,
            sum(case when rank_context = ? then 1 else 0 end) as active
          from article_rank_scores
        `
      )
      .get(BASE_RANK_CONTEXT, input.activeRankContext) as RankedArticleCountsRow | undefined;

    return {
      base: row?.base ?? 0,
      active: input.activeRankContext === BASE_RANK_CONTEXT ? 0 : row?.active ?? 0
    };
  }

  getLastRankingUpdate(input: { activeRankContext: string }): number | null {
    const row = this.db
      .prepare(
        `
          select max(calculated_at) as calculatedAt
          from article_rank_scores
          where rank_context in (?, ?)
        `
      )
      .get(BASE_RANK_CONTEXT, input.activeRankContext) as
      | { calculatedAt: number | null }
      | undefined;

    return row?.calculatedAt ?? null;
  }

  findExplanationSource(input: {
    articleId: string;
    rankContext?: string;
  }): ArticleRankExplanationSourceRow | null {
    const rankContext = input.rankContext ?? BASE_RANK_CONTEXT;
    const activeEmbeddingIndexId = rankContext === BASE_RANK_CONTEXT ? null : rankContext;
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
            coalesce(rs.calculated_at, base_rs.calculated_at) as calculatedAt,
            case
              when ? is null then 'no_provider'
              when ae.vector_blob is null then 'embedding_pending'
              when coalesce(rs.score, base_rs.score) is null then 'learning'
              else 'ready'
            end as rankingStatus
          from articles a
          join feeds f on f.id = a.feed_id
          left join article_states s on s.article_id = a.id
          left join article_embeddings ae
            on ae.article_id = a.id
            and ae.embedding_index_id = ?
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
      .get(activeEmbeddingIndexId, activeEmbeddingIndexId ?? "", rankContext, BASE_RANK_CONTEXT, input.articleId) as
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
                coalesce(sum(
                  case
                    when event_type = 'open' then 0.005
                    when event_type = 'read_progress' then
                      case
                        when coalesce(json_extract(metadata_json, '$.progress'), 0) >= 0.9 then 0.10
                        when coalesce(json_extract(metadata_json, '$.progress'), 0) >= 0.75 then 0.06
                        when coalesce(json_extract(metadata_json, '$.progress'), 0) >= 0.5 then 0.04
                        when coalesce(json_extract(metadata_json, '$.progress'), 0) >= 0.25 then 0.01
                        else 0
                      end
                    when event_type = 'read_complete' then 0.10
                    when event_type = 'favorite' then 0.12
                    when event_type = 'read_later' then 0.08
                    when event_type = 'quick_bounce' then -0.04
                    else 0
                  end
                ), 0) as behaviorProjectionScore,
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
              coalesce(es.behaviorProjectionScore, 0) as behaviorProjectionScore,
              coalesce(es.behaviorEventCount, 0) as behaviorEventCount,
              ae.vector_blob as vectorBlob,
              ae.content_hash as embeddingContentHash,
              case
                when ? = '' then 'no_provider'
                when ae.vector_blob is null then 'embedding_pending'
                else 'ready'
              end as embeddingStatus
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
        .all(input.embeddingIndexId ?? "", ...params) as ArticleRankingCandidateDbRow[]
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
    rankingStatus: row.rankingStatus,
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
    behaviorProjectionScore: row.behaviorProjectionScore,
    behaviorEventCount: row.behaviorEventCount,
    vectorBlob: row.vectorBlob,
    embeddingContentHash: row.embeddingContentHash,
    embeddingStatus: row.embeddingStatus
  };
}
