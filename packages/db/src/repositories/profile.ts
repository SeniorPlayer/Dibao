import type {
  DibaoDatabase,
  FeedBehaviorEventRow,
  FeedStatsInput,
  InterestClusterPolarity,
  InterestClusterRow,
  ProfileBehaviorEventRow,
  UpdateInterestClusterInput,
  UpsertInterestClusterInput
} from "../types.js";

type ProfileBehaviorEventDbRow = {
  id: string;
  articleId: string;
  feedId: string;
  eventType: ProfileBehaviorEventRow["eventType"];
  metadataJson: string | null;
  createdAt: number;
  articleUpdatedAt: number;
  readingProgress: number;
  contentHash: string;
  embeddingIndexId: string | null;
  embeddingContentHash: string | null;
  vectorBlob: Buffer | null;
};

type InterestClusterDbRow = {
  id: string;
  embeddingIndexId: string;
  polarity: InterestClusterPolarity;
  label: string | null;
  centroidVectorBlob: Buffer;
  weight: number;
  sampleCount: number;
  lastMatchedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export interface ProfileRepository {
  deleteCluster(id: string): boolean;
  findEventForIndex(eventId: string, embeddingIndexId: string | null): ProfileBehaviorEventRow | null;
  getTopicSnapshot(articleId: string): string | null;
  listClusters(input?: {
    embeddingIndexId?: string;
    polarity?: InterestClusterPolarity;
  }): InterestClusterRow[];
  listEventsForArticles(input: {
    articleIds: string[];
    embeddingIndexId: string;
  }): ProfileBehaviorEventRow[];
  listFeedBehaviorEvents(feedId: string): FeedBehaviorEventRow[];
  updateCluster(input: UpdateInterestClusterInput): InterestClusterRow | null;
  upsertCluster(input: UpsertInterestClusterInput): InterestClusterRow;
  upsertFeedStats(input: FeedStatsInput): void;
  upsertTopicSnapshot(input: {
    articleId: string;
    feedId: string;
    topicSnapshotJson: string;
    now?: number;
  }): void;
}

export class SqliteProfileRepository implements ProfileRepository {
  constructor(private readonly db: DibaoDatabase) {}

  findEventForIndex(
    eventId: string,
    embeddingIndexId: string | null
  ): ProfileBehaviorEventRow | null {
    const row = this.db
      .prepare(
        `
          ${profileEventSelect()}
          where be.id = ?
            and a.deleted_at is null
            and a.status != 'deleted'
            and f.deleted_at is null
            and f.enabled = 1
        `
      )
      .get(embeddingIndexId ?? "", eventId) as ProfileBehaviorEventDbRow | undefined;

    return row ? mapProfileEvent(row) : null;
  }

  listEventsForArticles(input: {
    articleIds: string[];
    embeddingIndexId: string;
  }): ProfileBehaviorEventRow[] {
    if (input.articleIds.length === 0) {
      return [];
    }

    const placeholders = input.articleIds.map(() => "?").join(", ");
    return (
      this.db
        .prepare(
          `
            ${profileEventSelect()}
            where a.id in (${placeholders})
              and a.deleted_at is null
              and a.status != 'deleted'
              and f.deleted_at is null
              and f.enabled = 1
            order by be.created_at, be.id
          `
        )
        .all(input.embeddingIndexId, ...input.articleIds) as ProfileBehaviorEventDbRow[]
    ).map(mapProfileEvent);
  }

  getTopicSnapshot(articleId: string): string | null {
    const row = this.db
      .prepare(
        `
          select topic_snapshot_json as topicSnapshotJson
          from article_behavior_summaries
          where article_id = ?
        `
      )
      .get(articleId) as { topicSnapshotJson: string | null } | undefined;

    return row?.topicSnapshotJson ?? null;
  }

  upsertTopicSnapshot(input: {
    articleId: string;
    feedId: string;
    topicSnapshotJson: string;
    now?: number;
  }): void {
    const now = input.now ?? Date.now();
    this.db
      .prepare(
        `
          insert into article_behavior_summaries (
            article_id,
            feed_id,
            first_event_at,
            last_event_at,
            topic_snapshot_json
          )
          values (?, ?, ?, ?, ?)
          on conflict(article_id) do update set
            feed_id = excluded.feed_id,
            last_event_at = excluded.last_event_at,
            topic_snapshot_json = excluded.topic_snapshot_json
        `
      )
      .run(input.articleId, input.feedId, now, now, input.topicSnapshotJson);
  }

  listClusters(input: {
    embeddingIndexId?: string;
    polarity?: InterestClusterPolarity;
  } = {}): InterestClusterRow[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (input.embeddingIndexId) {
      conditions.push("embedding_index_id = ?");
      params.push(input.embeddingIndexId);
    }
    if (input.polarity) {
      conditions.push("polarity = ?");
      params.push(input.polarity);
    }

    const where = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
    return (
      this.db
        .prepare(
          `
            ${clusterSelect()}
            ${where}
            order by weight desc, updated_at desc, id
          `
        )
        .all(...params) as InterestClusterDbRow[]
    ).map(mapCluster);
  }

  upsertCluster(input: UpsertInterestClusterInput): InterestClusterRow {
    const now = input.now ?? Date.now();
    this.db
      .prepare(
        `
          insert into interest_clusters (
            id,
            embedding_index_id,
            polarity,
            label,
            centroid_vector_blob,
            weight,
            sample_count,
            last_matched_at,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          on conflict(id) do update set
            label = excluded.label,
            centroid_vector_blob = excluded.centroid_vector_blob,
            weight = excluded.weight,
            sample_count = excluded.sample_count,
            last_matched_at = excluded.last_matched_at,
            updated_at = excluded.updated_at
        `
      )
      .run(
        input.id,
        input.embeddingIndexId,
        input.polarity,
        input.label ?? null,
        input.centroidVectorBlob,
        input.weight,
        input.sampleCount,
        input.lastMatchedAt ?? null,
        now,
        now
      );

    const cluster = this.findClusterById(input.id);
    if (!cluster) {
      throw new Error(`Failed to upsert interest cluster: ${input.id}`);
    }
    return cluster;
  }

  updateCluster(input: UpdateInterestClusterInput): InterestClusterRow | null {
    const existing = this.findClusterById(input.id);
    if (!existing) {
      return null;
    }

    const now = input.now ?? Date.now();
    this.db
      .prepare(
        `
          update interest_clusters
          set
            centroid_vector_blob = ?,
            weight = ?,
            sample_count = ?,
            last_matched_at = ?,
            updated_at = ?
          where id = ?
        `
      )
      .run(
        input.centroidVectorBlob ?? existing.centroidVectorBlob,
        input.weight ?? existing.weight,
        input.sampleCount ?? existing.sampleCount,
        input.lastMatchedAt === undefined ? existing.lastMatchedAt : input.lastMatchedAt,
        now,
        input.id
      );

    return this.findClusterById(input.id);
  }

  deleteCluster(id: string): boolean {
    return this.db.prepare("delete from interest_clusters where id = ?").run(id).changes > 0;
  }

  listFeedBehaviorEvents(feedId: string): FeedBehaviorEventRow[] {
    return this.db
      .prepare(
        `
          select
            be.event_type as eventType,
            be.metadata_json as metadataJson,
            coalesce(s.reading_progress, 0) as readingProgress
          from behavior_events be
          join articles a on a.id = be.article_id
          left join article_states s on s.article_id = a.id
          where a.feed_id = ?
          order by be.created_at, be.id
        `
      )
      .all(feedId) as FeedBehaviorEventRow[];
  }

  upsertFeedStats(input: FeedStatsInput): void {
    const now = input.now ?? Date.now();
    this.db
      .prepare(
        `
          insert into feed_stats (
            feed_id,
            positive_score,
            negative_score,
            open_rate,
            favorite_rate,
            not_interested_rate,
            last_calculated_at
          )
          values (?, ?, ?, ?, ?, ?, ?)
          on conflict(feed_id) do update set
            positive_score = excluded.positive_score,
            negative_score = excluded.negative_score,
            open_rate = excluded.open_rate,
            favorite_rate = excluded.favorite_rate,
            not_interested_rate = excluded.not_interested_rate,
            last_calculated_at = excluded.last_calculated_at
        `
      )
      .run(
        input.feedId,
        input.positiveScore,
        input.negativeScore,
        input.openRate,
        input.favoriteRate,
        input.notInterestedRate,
        now
      );
  }

  private findClusterById(id: string): InterestClusterRow | null {
    const row = this.db
      .prepare(
        `
          ${clusterSelect()}
          where id = ?
        `
      )
      .get(id) as InterestClusterDbRow | undefined;

    return row ? mapCluster(row) : null;
  }
}

function profileEventSelect(): string {
  return `
    select
      be.id,
      be.article_id as articleId,
      a.feed_id as feedId,
      be.event_type as eventType,
      be.metadata_json as metadataJson,
      be.created_at as createdAt,
      a.updated_at as articleUpdatedAt,
      coalesce(s.reading_progress, 0) as readingProgress,
      coalesce(a.content_hash, a.id || ':' || a.updated_at) as contentHash,
      ae.embedding_index_id as embeddingIndexId,
      ae.content_hash as embeddingContentHash,
      ae.vector_blob as vectorBlob
    from behavior_events be
    join articles a on a.id = be.article_id
    join feeds f on f.id = a.feed_id
    left join article_states s on s.article_id = a.id
    left join article_embeddings ae
      on ae.article_id = a.id
     and ae.embedding_index_id = ?
  `;
}

function clusterSelect(): string {
  return `
    select
      id,
      embedding_index_id as embeddingIndexId,
      polarity,
      label,
      centroid_vector_blob as centroidVectorBlob,
      weight,
      sample_count as sampleCount,
      last_matched_at as lastMatchedAt,
      created_at as createdAt,
      updated_at as updatedAt
    from interest_clusters
  `;
}

function mapProfileEvent(row: ProfileBehaviorEventDbRow): ProfileBehaviorEventRow {
  return row;
}

function mapCluster(row: InterestClusterDbRow): InterestClusterRow {
  return row;
}
