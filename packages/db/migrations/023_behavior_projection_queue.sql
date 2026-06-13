create table if not exists behavior_projection_cursors (
  projector_id text primary key,
  last_created_at integer not null default 0,
  last_event_id text not null default '',
  updated_at integer not null
);

create index if not exists idx_behavior_events_projection_order
  on behavior_events(created_at, id);

create table jobs_023 (
  id text primary key,
  type text not null check (
    type in (
      'feed_refresh',
      'content_extract',
      'embedding_generate',
      'profile_event_process',
      'behavior_event_project',
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
  priority integer not null default 0,
  run_after integer not null,
  started_at integer,
  finished_at integer,
  created_at integer not null,
  updated_at integer not null
);

insert into jobs_023 (
  id,
  type,
  status,
  payload_json,
  error,
  attempts,
  max_attempts,
  priority,
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
  case
    when type = 'profile_event_process' then 40
    when type = 'ranking_recalculate' then -20
    when type in ('retention_cleanup') then -50
    else 0
  end as priority,
  run_after,
  started_at,
  finished_at,
  created_at,
  updated_at
from jobs;

drop table jobs;
alter table jobs_023 rename to jobs;

create index if not exists idx_jobs_status_priority_run_after
  on jobs(status, priority desc, run_after);
create index if not exists idx_jobs_status_run_after on jobs(status, run_after);
create index if not exists idx_jobs_type on jobs(type);
create index if not exists idx_jobs_created_at on jobs(created_at);

update jobs
set
  status = 'cancelled',
  error = 'Legacy high-volume profile projection skipped; behavior_event_project will batch future projections',
  finished_at = coalesce(finished_at, updated_at),
  updated_at = updated_at
where type = 'profile_event_process'
  and status in ('queued', 'running')
  and json_valid(payload_json)
  and json_extract(payload_json, '$.actionType') in ('impression', 'open', 'read_progress');

insert into behavior_projection_cursors (
  projector_id,
  last_created_at,
  last_event_id,
  updated_at
)
values (
  'profile',
  coalesce(
    (
      select min(be.created_at) - 1
      from jobs j
      join behavior_events be
        on be.id = json_extract(j.payload_json, '$.eventId')
      where j.type = 'profile_event_process'
        and j.status = 'cancelled'
        and j.error = 'Legacy high-volume profile projection skipped; behavior_event_project will batch future projections'
        and json_valid(j.payload_json)
        and json_extract(j.payload_json, '$.actionType') in ('impression', 'open', 'read_progress')
    ),
    (
      select coalesce(max(created_at), 0)
      from behavior_events
    )
  ),
  '',
  cast(strftime('%s','now') as integer) * 1000
)
on conflict(projector_id) do nothing;
