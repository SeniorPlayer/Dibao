import type {
  BehaviorEventCountRow,
  ClusterCountRow,
  DibaoDatabase,
  FeedBehaviorEventRow,
  FeedStatsInput,
  InterestClusterEvidenceRow,
  InterestClusterPolarity,
  InterestClusterRow,
  ProfileSignalCountRow,
  ProfileBehaviorEventRow,
  UpdateInterestClusterInput,
  UpsertInterestClusterInput
} from "../types.js";

type ProfileBehaviorEventDbRow = {
  id: string;
  articleId: string;
  feedId: string;
  eventType: ProfileBehaviorEventRow["eventType"];
  eventWeight: number;
  metadataJson: string | null;
  createdAt: number;
  articleUpdatedAt: number;
  readingProgress: number;
  contentHash: string;
  title: string;
  summary: string | null;
  contentText: string | null;
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
  countBehaviorEvents(): BehaviorEventCountRow[];
  countClusters(input?: { embeddingIndexId?: string }): ClusterCountRow;
  countProfileSignals(): ProfileSignalCountRow;
  deleteCluster(id: string): boolean;
  findEventForIndex(eventId: string, embeddingIndexId: string | null): ProfileBehaviorEventRow | null;
  getLastProfileUpdate(input?: { embeddingIndexId?: string }): number | null;
  getTopicSnapshot(articleId: string): string | null;
  listClusters(input?: {
    embeddingIndexId?: string;
    polarity?: InterestClusterPolarity;
  }): InterestClusterRow[];
  listClusterEvidence(input: { embeddingIndexId: string; limit?: number }): InterestClusterEvidenceRow[];
  listClusterEvidenceForCluster(input: {
    clusterId: string;
    limit?: number;
  }): InterestClusterEvidenceRow[];
  insertClusterEvidence(input: {
    id: string;
    clusterId: string;
    articleId: string;
    behaviorEventId?: string | null;
    evidenceSource: "live_event" | "reconstructed";
    confidence: number;
    similarity?: number | null;
    weightDelta: number;
    createdAt: number;
  }): void;
  listEventsForArticles(input: {
    articleIds: string[];
    embeddingIndexId: string;
  }): ProfileBehaviorEventRow[];
  moveClusterEvidence(input: { fromClusterId: string; toClusterId: string }): void;
  trimClusterEvidence(input: { clusterId: string; limit: number }): void;
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

  countBehaviorEvents(): BehaviorEventCountRow[] {
    return this.db
      .prepare(
        `
          select
            event_type as eventType,
            count(*) as count
          from behavior_events
          group by event_type
          order by event_type
        `
      )
      .all() as BehaviorEventCountRow[];
  }

  countProfileSignals(): ProfileSignalCountRow {
    const row = this.db
      .prepare(
        `
          select
            count(*) as signalCount,
            count(distinct be.article_id) as articleCount
          from behavior_events be
          left join article_states s on s.article_id = be.article_id
          where be.event_type in (
            'like',
            'favorite',
            'read_later',
            'hide',
            'not_interested',
            'unlike',
            'read_complete'
          )
            or (
              be.event_type = 'read_progress'
              and coalesce(
                case
                  when be.metadata_json is not null and json_valid(be.metadata_json)
                  then json_extract(be.metadata_json, '$.progress')
                end,
                s.reading_progress,
                0
              ) >= 0.5
            )
        `
      )
      .get() as ProfileSignalCountRow | undefined;

    return {
      signalCount: row?.signalCount ?? 0,
      articleCount: row?.articleCount ?? 0
    };
  }

  countClusters(input: { embeddingIndexId?: string } = {}): ClusterCountRow {
    const row = this.db
      .prepare(
        `
          select
            sum(case when polarity = 'positive' then 1 else 0 end) as positive,
            sum(case when polarity = 'negative' then 1 else 0 end) as negative
          from interest_clusters
          where (? is null or embedding_index_id = ?)
        `
      )
      .get(input.embeddingIndexId ?? null, input.embeddingIndexId ?? null) as
      | ClusterCountRow
      | undefined;

    return {
      positive: row?.positive ?? 0,
      negative: row?.negative ?? 0
    };
  }

  getLastProfileUpdate(input: { embeddingIndexId?: string } = {}): number | null {
    const row = this.db
      .prepare(
        `
          select max(updatedAt) as updatedAt
          from (
            select updated_at as updatedAt
            from interest_clusters
            where (? is null or embedding_index_id = ?)
            union all
            select last_calculated_at as updatedAt
            from feed_stats
            where last_calculated_at is not null
            union all
            select last_event_at as updatedAt
            from article_behavior_summaries
            where last_event_at is not null
          )
        `
      )
      .get(input.embeddingIndexId ?? null, input.embeddingIndexId ?? null) as
      | { updatedAt: number | null }
      | undefined;

    return row?.updatedAt ?? null;
  }

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

  listClusterEvidence(input: { embeddingIndexId: string; limit?: number }): InterestClusterEvidenceRow[] {
    const limit = Math.max(1, Math.min(5000, input.limit ?? 2000));
    const persisted = this.db
      .prepare(
        `
          select
            ice.id,
            ice.cluster_id as clusterId,
            ice.article_id as articleId,
            coalesce(a.feed_id, ice.feed_id_snapshot, '') as feedId,
            coalesce(f.title, ice.feed_title_snapshot, '') as feedTitle,
            ice.behavior_event_id as behaviorEventId,
            ice.evidence_source as evidenceSource,
            ice.confidence,
            ice.similarity,
            ice.weight_delta as weightDelta,
            coalesce(be.event_type, ice.event_type_snapshot, 'read_complete') as eventType,
            be.metadata_json as metadataJson,
            coalesce(s.reading_progress, ice.reading_progress_snapshot, 0) as readingProgress,
            coalesce(a.title, ice.article_title_snapshot, ice.article_id) as title,
            coalesce(ae.vector_blob, ice.vector_blob_snapshot) as vectorBlob,
            ice.created_at as createdAt
          from interest_cluster_evidence ice
          join interest_clusters ic on ic.id = ice.cluster_id
          left join articles a on a.id = ice.article_id
          left join feeds f on f.id = a.feed_id
          left join article_embeddings ae
            on ae.article_id = a.id
           and ae.embedding_index_id = ic.embedding_index_id
          left join article_states s on s.article_id = a.id
          left join behavior_events be on be.id = ice.behavior_event_id
          where coalesce(ae.vector_blob, ice.vector_blob_snapshot) is not null
            and ic.embedding_index_id = ?
          order by ice.evidence_source = 'live_event' desc, ice.confidence desc, ice.created_at desc
          limit ?
        `
      )
      .all(input.embeddingIndexId, limit) as InterestClusterEvidenceRow[];
    if (persisted.length > 0) {
      return persisted;
    }

    return this.db
      .prepare(
        `
          select
            a.id as articleId,
            a.feed_id as feedId,
            f.title as feedTitle,
            be.event_type as eventType,
            ${effectiveEventWeightSql()} as eventWeight,
            be.metadata_json as metadataJson,
            coalesce(s.reading_progress, 0) as readingProgress,
            a.title,
            ae.vector_blob as vectorBlob,
            be.created_at as createdAt
          from behavior_events be
          join articles a on a.id = be.article_id
          join feeds f on f.id = a.feed_id
          join article_embeddings ae
            on ae.article_id = a.id
           and ae.embedding_index_id = ?
          left join article_states s on s.article_id = a.id
          where a.deleted_at is null
            and a.status != 'deleted'
            and f.deleted_at is null
            and f.enabled = 1
            and ae.vector_blob is not null
            and be.event_type in (
              'favorite',
              'like',
              'read_later',
              'read_complete',
              'read_progress',
              'hide',
              'not_interested'
            )
          order by be.created_at desc, be.id
          limit ?
        `
      )
      .all(input.embeddingIndexId, limit) as InterestClusterEvidenceRow[];
  }

  listClusterEvidenceForCluster(input: {
    clusterId: string;
    limit?: number;
  }): InterestClusterEvidenceRow[] {
    const limit = Math.max(1, Math.min(100, input.limit ?? 16));
    return this.db
      .prepare(
        `
          select
            ice.id,
            ice.cluster_id as clusterId,
            ice.article_id as articleId,
            coalesce(a.feed_id, ice.feed_id_snapshot, '') as feedId,
            coalesce(f.title, ice.feed_title_snapshot, '') as feedTitle,
            ice.behavior_event_id as behaviorEventId,
            ice.evidence_source as evidenceSource,
            ice.confidence,
            ice.similarity,
            ice.weight_delta as weightDelta,
            coalesce(be.event_type, ice.event_type_snapshot, 'read_complete') as eventType,
            be.metadata_json as metadataJson,
            coalesce(s.reading_progress, ice.reading_progress_snapshot, 0) as readingProgress,
            coalesce(a.title, ice.article_title_snapshot, ice.article_id) as title,
            coalesce(ae.vector_blob, ice.vector_blob_snapshot) as vectorBlob,
            ice.created_at as createdAt
          from interest_cluster_evidence ice
          join interest_clusters ic on ic.id = ice.cluster_id
          left join articles a on a.id = ice.article_id
          left join feeds f on f.id = a.feed_id
          left join article_embeddings ae
            on ae.article_id = a.id
           and ae.embedding_index_id = ic.embedding_index_id
          left join article_states s on s.article_id = a.id
          left join behavior_events be on be.id = ice.behavior_event_id
          where ice.cluster_id = ?
            and coalesce(ae.vector_blob, ice.vector_blob_snapshot) is not null
          order by ice.confidence desc, abs(ice.weight_delta) desc, ice.created_at desc
          limit ?
        `
      )
      .all(input.clusterId, limit) as InterestClusterEvidenceRow[];
  }

  insertClusterEvidence(input: {
    id: string;
    clusterId: string;
    articleId: string;
    behaviorEventId?: string | null;
    evidenceSource: "live_event" | "reconstructed";
    confidence: number;
    similarity?: number | null;
    weightDelta: number;
    createdAt: number;
  }): void {
    const snapshot = this.evidenceSnapshot(input.clusterId, input.articleId, input.behaviorEventId ?? null);
    const existing = this.db
      .prepare(
        `
          select id
          from interest_cluster_evidence
          where cluster_id = ?
            and article_id = ?
            and coalesce(behavior_event_id, '') = coalesce(?, '')
            and evidence_source = ?
          limit 1
        `
      )
      .get(
        input.clusterId,
        input.articleId,
        input.behaviorEventId ?? null,
        input.evidenceSource
      ) as { id: string } | undefined;

    if (existing) {
      this.db
        .prepare(
          `
            update interest_cluster_evidence
            set
              confidence = max(confidence, ?),
              similarity = coalesce(?, similarity),
              weight_delta = max(weight_delta, ?),
              created_at = max(created_at, ?),
              article_title_snapshot = coalesce(article_title_snapshot, ?),
              feed_id_snapshot = coalesce(feed_id_snapshot, ?),
              feed_title_snapshot = coalesce(feed_title_snapshot, ?),
              event_type_snapshot = coalesce(event_type_snapshot, ?),
              reading_progress_snapshot = coalesce(reading_progress_snapshot, ?),
              vector_blob_snapshot = coalesce(vector_blob_snapshot, ?)
            where id = ?
          `
        )
        .run(
          input.confidence,
          input.similarity ?? null,
          input.weightDelta,
          input.createdAt,
          snapshot.articleTitle,
          snapshot.feedId,
          snapshot.feedTitle,
          snapshot.eventType,
          snapshot.readingProgress,
          snapshot.vectorBlob,
          existing.id
        );
      return;
    }

    this.db
      .prepare(
        `
          insert into interest_cluster_evidence (
            id,
            cluster_id,
            article_id,
            behavior_event_id,
            evidence_source,
            confidence,
            similarity,
            weight_delta,
            article_title_snapshot,
            feed_id_snapshot,
            feed_title_snapshot,
            event_type_snapshot,
            reading_progress_snapshot,
            vector_blob_snapshot,
            created_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        input.id,
        input.clusterId,
        input.articleId,
        input.behaviorEventId ?? null,
        input.evidenceSource,
        input.confidence,
        input.similarity ?? null,
        input.weightDelta,
        snapshot.articleTitle,
        snapshot.feedId,
        snapshot.feedTitle,
        snapshot.eventType,
        snapshot.readingProgress,
        snapshot.vectorBlob,
        input.createdAt
      );
  }

  private evidenceSnapshot(
    clusterId: string,
    articleId: string,
    behaviorEventId: string | null
  ): {
    articleTitle: string | null;
    feedId: string | null;
    feedTitle: string | null;
    eventType: string | null;
    readingProgress: number;
    vectorBlob: Buffer | null;
  } {
    const row = this.db
      .prepare(
        `
          select
            a.title as articleTitle,
            a.feed_id as feedId,
            f.title as feedTitle,
            be.event_type as eventType,
            coalesce(s.reading_progress, 0) as readingProgress,
            ae.vector_blob as vectorBlob
          from articles a
          left join feeds f on f.id = a.feed_id
          left join behavior_events be on be.id = ?
          left join article_states s on s.article_id = a.id
          left join interest_clusters ic on ic.id = ?
          left join article_embeddings ae
            on ae.article_id = a.id
           and ae.embedding_index_id = ic.embedding_index_id
          where a.id = ?
        `
      )
      .get(behaviorEventId, clusterId, articleId) as
      | {
          articleTitle: string | null;
          feedId: string | null;
          feedTitle: string | null;
          eventType: string | null;
          readingProgress: number;
          vectorBlob: Buffer | null;
        }
      | undefined;

    return {
      articleTitle: row?.articleTitle ?? null,
      feedId: row?.feedId ?? null,
      feedTitle: row?.feedTitle ?? null,
      eventType: row?.eventType ?? null,
      readingProgress: row?.readingProgress ?? 0,
      vectorBlob: row?.vectorBlob ?? null
    };
  }

  moveClusterEvidence(input: { fromClusterId: string; toClusterId: string }): void {
    this.db
      .prepare(
        `
          update interest_cluster_evidence
          set cluster_id = ?
          where cluster_id = ?
        `
      )
      .run(input.toClusterId, input.fromClusterId);
  }

  trimClusterEvidence(input: { clusterId: string; limit: number }): void {
    const limit = Math.max(1, Math.min(100, input.limit));
    this.db
      .prepare(
        `
          delete from interest_cluster_evidence
          where cluster_id = ?
            and id not in (
              select id
              from interest_cluster_evidence
              where cluster_id = ?
              order by confidence desc, abs(weight_delta) desc, created_at desc
              limit ?
            )
        `
      )
      .run(input.clusterId, input.clusterId, limit);
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
            label = coalesce(excluded.label, label),
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
            label = ?,
            centroid_vector_blob = ?,
            weight = ?,
            sample_count = ?,
            last_matched_at = ?,
            updated_at = ?
          where id = ?
        `
      )
      .run(
        input.label === undefined ? existing.label : input.label,
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
            coalesce(s.reading_progress, 0) as readingProgress,
            a.title,
            a.summary,
            ac.content_text as contentText
          from behavior_events be
          join articles a on a.id = be.article_id
          left join article_states s on s.article_id = a.id
          left join article_contents ac on ac.article_id = a.id
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
            clear_positive,
            clear_negative,
            clear_signal_count,
            smoothed_positive_rate,
            source_confidence,
            last_calculated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          on conflict(feed_id) do update set
            positive_score = excluded.positive_score,
            negative_score = excluded.negative_score,
            open_rate = excluded.open_rate,
            favorite_rate = excluded.favorite_rate,
            not_interested_rate = excluded.not_interested_rate,
            clear_positive = excluded.clear_positive,
            clear_negative = excluded.clear_negative,
            clear_signal_count = excluded.clear_signal_count,
            smoothed_positive_rate = excluded.smoothed_positive_rate,
            source_confidence = excluded.source_confidence,
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
        input.clearPositive ?? 0,
        input.clearNegative ?? 0,
        input.clearSignalCount ?? 0,
        input.smoothedPositiveRate ?? 0,
        input.sourceConfidence ?? 0,
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

function effectiveEventWeightSql(): string {
  return `
    case
      when be.event_type = 'impression'
        and (
          s.read_at is not null
          or coalesce(s.reading_progress, 0) > 0
          or s.last_opened_at is not null
          or s.favorited_at is not null
          or s.liked_at is not null
          or s.read_later_at is not null
        ) then 0
      else be.event_weight
    end
  `;
}

function profileEventSelect(): string {
  return `
    select
      be.id,
      be.article_id as articleId,
      a.feed_id as feedId,
      be.event_type as eventType,
      ${effectiveEventWeightSql()} as eventWeight,
      be.metadata_json as metadataJson,
      be.created_at as createdAt,
      a.updated_at as articleUpdatedAt,
      coalesce(s.reading_progress, 0) as readingProgress,
      coalesce(a.content_hash, a.id || ':' || a.updated_at) as contentHash,
      a.title,
      a.summary,
      ac.content_text as contentText,
      ae.embedding_index_id as embeddingIndexId,
      ae.content_hash as embeddingContentHash,
      ae.vector_blob as vectorBlob
    from behavior_events be
    join articles a on a.id = be.article_id
    join feeds f on f.id = a.feed_id
    left join article_states s on s.article_id = a.id
    left join article_contents ac on ac.article_id = a.id
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
