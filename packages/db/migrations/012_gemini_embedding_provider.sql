-- dibao: disable-foreign-keys

drop index if exists idx_embedding_providers_enabled;
drop index if exists idx_embedding_providers_type;
drop index if exists unique_embedding_providers_active;

create table embedding_providers_new (
  id text primary key,
  type text not null check (type in ('embedded_local', 'ollama', 'openai_compatible', 'gemini', 'custom_http')),
  name text not null,
  base_url text,
  model text not null,
  dimension integer not null check (dimension > 0),
  api_key_encrypted text,
  enabled integer not null default 0 check (enabled in (0, 1)),
  quality_tier text not null default 'basic' check (quality_tier in ('basic', 'recommended', 'best_quality')),
  last_test_status text,
  last_test_error text,
  last_test_at integer,
  created_at integer not null,
  updated_at integer not null
);

insert into embedding_providers_new (
  id,
  type,
  name,
  base_url,
  model,
  dimension,
  api_key_encrypted,
  enabled,
  quality_tier,
  last_test_status,
  last_test_error,
  last_test_at,
  created_at,
  updated_at
)
select
  id,
  type,
  name,
  base_url,
  model,
  dimension,
  api_key_encrypted,
  enabled,
  quality_tier,
  last_test_status,
  last_test_error,
  last_test_at,
  created_at,
  updated_at
from embedding_providers;

drop table embedding_providers;
alter table embedding_providers_new rename to embedding_providers;

create index if not exists idx_embedding_providers_enabled on embedding_providers(enabled);
create index if not exists idx_embedding_providers_type on embedding_providers(type);
create unique index if not exists unique_embedding_providers_active
  on embedding_providers(enabled)
  where enabled = 1;
