delete from jobs
where type = 'topic_snapshot_rebuild';

drop table if exists corpus_topic_articles;
drop table if exists corpus_topics;
drop table if exists corpus_topic_runs;

create table if not exists interest_cluster_labels_011 (
  cluster_id text primary key references interest_clusters(id) on delete cascade,
  auto_label text,
  manual_label text,
  label_source text not null default 'fallback' check (
    label_source in ('manual', 'keywords', 'representative_titles', 'feeds', 'fallback')
  ),
  label_terms_json text,
  representative_articles_json text,
  feed_titles_json text,
  label_diagnostics_json text,
  confidence real not null default 0,
  generated_at integer,
  updated_at integer not null
);

insert or replace into interest_cluster_labels_011 (
  cluster_id,
  auto_label,
  manual_label,
  label_source,
  label_terms_json,
  representative_articles_json,
  feed_titles_json,
  label_diagnostics_json,
  confidence,
  generated_at,
  updated_at
)
select
  cluster_id,
  auto_label,
  manual_label,
  case
    when label_source = 'corpus_topic' then 'fallback'
    else label_source
  end,
  label_terms_json,
  representative_articles_json,
  feed_titles_json,
  label_diagnostics_json,
  confidence,
  generated_at,
  updated_at
from interest_cluster_labels;

drop table interest_cluster_labels;
alter table interest_cluster_labels_011 rename to interest_cluster_labels;

create index if not exists idx_interest_cluster_labels_source
  on interest_cluster_labels(label_source, updated_at);

create table jobs_011 (
  id text primary key,
  type text not null check (
    type in (
      'feed_refresh',
      'content_extract',
      'embedding_generate',
      'profile_event_process',
      'ranking_recalculate',
      'profile_decay',
      'retention_cleanup',
      'vector_index_rebuild',
      'article_fingerprint_backfill',
      'duplicate_group_rebuild',
      'keyword_profile_rebuild',
      'recent_intent_rebuild',
      'ftrl_train',
      'ranking_eval_run',
      'recommendation_backfill',
      'interest_cluster_label_rebuild',
      'interest_cluster_merge_diagnostics',
      'interest_cluster_auto_merge'
    )
  ),
  status text not null check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  payload_json text,
  error text,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  run_after integer not null,
  started_at integer,
  finished_at integer,
  created_at integer not null,
  updated_at integer not null
);

insert into jobs_011 (
  id,
  type,
  status,
  payload_json,
  error,
  attempts,
  max_attempts,
  run_after,
  started_at,
  finished_at,
  created_at,
  updated_at
)
select
  id,
  type,
  status,
  payload_json,
  error,
  attempts,
  max_attempts,
  run_after,
  started_at,
  finished_at,
  created_at,
  updated_at
from jobs
where type != 'topic_snapshot_rebuild';

drop table jobs;
alter table jobs_011 rename to jobs;

create index if not exists idx_jobs_status_run_after on jobs(status, run_after);
create index if not exists idx_jobs_type on jobs(type);
create index if not exists idx_jobs_created_at on jobs(created_at);
