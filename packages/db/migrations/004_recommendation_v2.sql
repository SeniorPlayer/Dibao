create table rank_contexts (
  id text primary key,
  algorithm_version text not null,
  feature_schema_version integer not null,
  embedding_index_id text references embedding_indexes(id) on delete set null,
  cocoon_level integer not null default 5 check (cocoon_level between 1 and 10),
  status text not null default 'active' check (status in ('active', 'retired', 'failed')),
  metadata_json text,
  created_at integer not null,
  updated_at integer not null
);

alter table article_rank_scores add column base_score real;
alter table article_rank_scores add column ftrl_score real;
alter table article_rank_scores add column semantic_score real;
alter table article_rank_scores add column bm25_score real;
alter table article_rank_scores add column negative_penalty real;
alter table article_rank_scores add column duplicate_penalty real;
alter table article_rank_scores add column diversity_penalty real;
alter table article_rank_scores add column exploration_bonus real;
alter table article_rank_scores add column pending_embedding_score real;
alter table article_rank_scores add column exposure_penalty real;
alter table article_rank_scores add column pre_rerank_score real;
alter table article_rank_scores add column rerank_score real;
alter table article_rank_scores add column rerank_position integer;
alter table article_rank_scores add column rerank_window_id text;
alter table article_rank_scores add column algorithm_version text;
alter table article_rank_scores add column feature_schema_version integer;
alter table article_rank_scores add column cocoon_level integer;

create index idx_article_rank_scores_context_position
  on article_rank_scores(rank_context, rerank_position);
create index idx_article_rank_scores_context_calculated
  on article_rank_scores(rank_context, calculated_at);

create table interest_cluster_evidence (
  id text primary key,
  cluster_id text not null references interest_clusters(id) on delete cascade,
  article_id text not null references articles(id) on delete cascade,
  behavior_event_id text references behavior_events(id) on delete set null,
  evidence_source text not null check (evidence_source in ('live_event', 'reconstructed')),
  confidence real not null default 1 check (confidence >= 0 and confidence <= 1),
  similarity real,
  weight_delta real not null default 0,
  created_at integer not null
);
create index idx_interest_cluster_evidence_cluster
  on interest_cluster_evidence(cluster_id, created_at);
create index idx_interest_cluster_evidence_article
  on interest_cluster_evidence(article_id);

create table profile_terms (
  term text not null,
  polarity text not null check (polarity in ('positive', 'negative')),
  scope text not null default 'long' check (scope in ('long', 'recent')),
  weight real not null,
  evidence_count integer not null default 0,
  last_event_at integer,
  updated_at integer not null,
  primary key (term, polarity, scope)
);
create index idx_profile_terms_scope_weight on profile_terms(scope, polarity, weight);

create table recent_intent_profiles (
  id text primary key,
  embedding_index_id text references embedding_indexes(id) on delete cascade,
  polarity text not null check (polarity in ('positive', 'negative')),
  centroid_vector_blob blob,
  weight real not null default 0,
  event_count integer not null default 0,
  half_life_hours real not null default 12,
  updated_at integer not null
);
create index idx_recent_intent_profiles_index_polarity
  on recent_intent_profiles(embedding_index_id, polarity);

create table article_fingerprints (
  article_id text primary key references articles(id) on delete cascade,
  dedupe_key text,
  content_hash text,
  canonical_url text,
  normalized_url text,
  normalized_title text,
  title_hash text,
  title_simhash text,
  summary_simhash text,
  calculated_at integer not null
);
create index idx_article_fingerprints_dedupe_key on article_fingerprints(dedupe_key);
create index idx_article_fingerprints_content_hash on article_fingerprints(content_hash);
create index idx_article_fingerprints_normalized_url on article_fingerprints(normalized_url);
create index idx_article_fingerprints_title_hash on article_fingerprints(title_hash);

create table duplicate_groups (
  id text primary key,
  representative_article_id text references articles(id) on delete set null,
  duplicate_reason text not null,
  confidence real not null check (confidence >= 0 and confidence <= 1),
  article_count integer not null default 0,
  created_at integer not null,
  updated_at integer not null
);

create table duplicate_group_members (
  duplicate_group_id text not null references duplicate_groups(id) on delete cascade,
  article_id text not null references articles(id) on delete cascade,
  confidence real not null check (confidence >= 0 and confidence <= 1),
  reason text not null,
  is_representative integer not null default 0 check (is_representative in (0, 1)),
  created_at integer not null,
  primary key (duplicate_group_id, article_id)
);
create index idx_duplicate_group_members_article on duplicate_group_members(article_id);

create table rank_model_versions (
  id text primary key,
  algorithm_version text not null,
  feature_schema_version integer not null,
  status text not null check (status in ('shadow', 'active', 'retired', 'failed')),
  sample_count integer not null default 0,
  blend_alpha real not null default 0,
  metrics_json text,
  created_at integer not null,
  updated_at integer not null
);

create table rank_model_weights (
  model_version_id text not null references rank_model_versions(id) on delete cascade,
  feature_name text not null,
  weight real not null,
  accumulator real not null default 0,
  updated_at integer not null,
  primary key (model_version_id, feature_name)
);

create table rank_training_examples (
  id text primary key,
  model_version_id text references rank_model_versions(id) on delete set null,
  article_id text not null references articles(id) on delete cascade,
  behavior_event_id text references behavior_events(id) on delete set null,
  label real not null check (label >= 0 and label <= 1),
  sample_weight real not null default 1 check (sample_weight >= 0),
  event_type text not null,
  exposure_context text,
  rank_position_when_exposed integer,
  was_exploration integer not null default 0 check (was_exploration in (0, 1)),
  created_from text not null default 'behavior_event',
  feature_values_json text not null,
  created_at integer not null
);
create index idx_rank_training_examples_model_created
  on rank_training_examples(model_version_id, created_at);
create index idx_rank_training_examples_event on rank_training_examples(behavior_event_id);

create table exploration_buckets (
  bucket_key text primary key,
  bucket_type text not null,
  impressions integer not null default 0,
  positive_events integer not null default 0,
  negative_events integer not null default 0,
  alpha real not null default 1,
  beta real not null default 1,
  updated_at integer not null
);

create table ranking_eval_runs (
  id text primary key,
  algorithm_version text not null,
  rank_context text not null,
  status text not null check (status in ('queued', 'running', 'succeeded', 'failed')),
  metrics_json text,
  error text,
  created_at integer not null,
  started_at integer,
  finished_at integer
);

create table ranking_eval_items (
  id text primary key,
  run_id text not null references ranking_eval_runs(id) on delete cascade,
  article_id text not null references articles(id) on delete cascade,
  cutoff_at integer not null,
  observed_event_type text,
  rank_position integer,
  score real,
  metrics_json text,
  created_at integer not null
);
create index idx_ranking_eval_items_run on ranking_eval_items(run_id);

create table recommendation_backfill_state (
  task_key text primary key,
  status text not null check (status in ('idle', 'running', 'succeeded', 'failed')),
  cursor text,
  processed_count integer not null default 0,
  error text,
  started_at integer,
  updated_at integer not null,
  finished_at integer
);

create table jobs_new (
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
      'recommendation_backfill'
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

insert into jobs_new (
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
from jobs;

drop table jobs;
alter table jobs_new rename to jobs;

create index if not exists idx_jobs_status_run_after on jobs(status, run_after);
create index if not exists idx_jobs_type on jobs(type);
create index if not exists idx_jobs_created_at on jobs(created_at);
