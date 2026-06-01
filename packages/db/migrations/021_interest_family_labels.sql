create table if not exists interest_family_labels (
  family_id text primary key,
  manual_label text,
  created_at integer not null,
  updated_at integer not null
);
