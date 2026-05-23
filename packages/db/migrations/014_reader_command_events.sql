create table if not exists reader_command_events (
  id text primary key,
  command_type text not null,
  scope_json text not null,
  result_json text,
  created_at integer not null
);

create index if not exists idx_reader_command_events_type
  on reader_command_events(command_type);

create index if not exists idx_reader_command_events_created_at
  on reader_command_events(created_at);
