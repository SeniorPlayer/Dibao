create table if not exists recommendation_maintenance_schedule_state (
  task_key text primary key,
  last_enqueued_at integer,
  last_completed_at integer,
  last_skipped_reason text,
  last_job_id text,
  updated_at integer not null
);
