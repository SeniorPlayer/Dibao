create table if not exists interest_cluster_calibrations (
  embedding_index_id text primary key references embedding_indexes(id) on delete cascade,
  algorithm_version text not null,
  provider_type text,
  provider_model text,
  embedding_dimension integer,
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  positive_sample_count integer not null default 0,
  negative_sample_count integer not null default 0,
  background_sample_count integer not null default 0,
  thresholds_json text not null,
  percentiles_json text not null,
  diagnostics_json text,
  created_at integer not null,
  updated_at integer not null
);

create index if not exists idx_interest_cluster_calibrations_algorithm
  on interest_cluster_calibrations(algorithm_version, confidence);
