-- dibao: disable-foreign-keys

create table if not exists plugin_installs (
  id text primary key,
  version text not null,
  source_type text not null check (source_type in ('official', 'local_file', 'url', 'github_release', 'registry')),
  source_url text,
  update_url text,
  package_path text,
  data_path text,
  manifest_json text not null,
  status text not null check (status in ('installed', 'enabled', 'disabled', 'incompatible', 'failed')),
  official integer not null default 0 check (official in (0, 1)),
  bundled integer not null default 0 check (bundled in (0, 1)),
  trust_level text not null check (trust_level in ('official', 'trusted', 'untrusted')),
  installed_at integer not null,
  updated_at integer not null,
  enabled_at integer,
  disabled_at integer,
  last_error text
);

create table if not exists plugin_capability_grants (
  plugin_id text not null references plugin_installs(id) on delete cascade,
  capability text not null,
  granted_at integer not null,
  primary key (plugin_id, capability)
);

create table if not exists plugin_settings (
  plugin_id text not null references plugin_installs(id) on delete cascade,
  key text not null,
  value_json text not null,
  updated_at integer not null,
  primary key (plugin_id, key)
);

create table if not exists plugin_kv (
  plugin_id text not null references plugin_installs(id) on delete cascade,
  key text not null,
  value_json text not null,
  updated_at integer not null,
  primary key (plugin_id, key)
);

create table if not exists plugin_migrations (
  plugin_id text not null references plugin_installs(id) on delete cascade,
  version text not null,
  name text not null,
  checksum text,
  applied_at integer not null,
  primary key (plugin_id, version)
);

create table if not exists plugin_update_checks (
  plugin_id text primary key references plugin_installs(id) on delete cascade,
  latest_version text,
  update_url text,
  package_url text,
  checksum text,
  metadata_json text,
  checked_at integer not null,
  error text
);

create table jobs_019 (
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
      'interest_cluster_auto_merge',
      'interest_family_rebuild'
    )
    or type like 'plugin:%:%'
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

insert into jobs_019 (
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
alter table jobs_019 rename to jobs;

create index if not exists idx_jobs_status_run_after on jobs(status, run_after);
create index if not exists idx_jobs_type on jobs(type);
create index if not exists idx_jobs_created_at on jobs(created_at);
create index if not exists idx_plugin_installs_status on plugin_installs(status);
create index if not exists idx_plugin_installs_official on plugin_installs(official, bundled);
