create table if not exists plugin_schedules (
  plugin_id text not null references plugin_installs(id) on delete cascade,
  task_id text not null,
  enabled integer not null default 0 check (enabled in (0, 1)),
  schedule text not null check (schedule in ('manual', 'interval', 'daily', 'weekly')),
  interval_ms integer,
  local_time text,
  timezone text,
  next_run_at integer,
  last_run_at integer,
  last_job_id text,
  updated_at integer not null,
  primary key (plugin_id, task_id)
);

create index if not exists idx_plugin_schedules_due
  on plugin_schedules(enabled, next_run_at);
