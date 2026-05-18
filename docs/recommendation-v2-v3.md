# Dibao Recommendation V2/V3 Design

This document records the implemented V2/V3 recommendation architecture. The ranking core remains local-first:

- No remote LLM.
- No remote reranker.
- No remote classifier.
- No external search service.
- The only optional remote dependency is one embedding provider.
- Scores, explanations, local model data, profile data, and evaluation logs are stored in SQLite.

## Rank Context

`article_rank_scores.rank_context` remains the canonical context id. There is no second `rank_context_id`.

V2 contexts use:

```text
rec_v2:<base|embedding>:cocoon_<level>:schema_2
```

`rank_contexts.id` is equal to `article_rank_scores.rank_context`. Legacy contexts such as `base` and older embedding-index ids remain readable and are used as fallback.

## Score And Explanation Storage

`article_rank_scores` stores numeric score fields only:

- final score
- pre-rerank score
- base score
- FTRL shadow score
- semantic score
- BM25/keyword score
- source score
- freshness score
- state score
- negative, duplicate, diversity, exposure penalties
- exploration and pending-embedding bonuses
- canonical `rerank_position`
- algorithm version, feature schema version, and cocoon level

`article_rank_explanations` is the authoritative explanation payload store. Explanations are deterministic templates generated from persisted score components and evidence refs.

## Candidate Generation

The implementation is structured around bucketed recall, not one global pre-union cap:

- must-include: favorite, read-later, recently opened unfinished, fresh pending embeddings, high source-weight feeds
- recency: fresh articles and recent hot-window articles
- semantic: active embedding profile and cluster matches
- lexical: local FTS/BM25 and keyword profile signals
- diversity: low-exposure feeds and underrepresented duplicate groups

The current implementation computes the hot window through the existing ranking candidates query and stores enough schema to expand each bucket independently without changing the public API.

## Hybrid Scoring

V2 score combines:

- long-term semantic interest from `interest_clusters`
- top-k weighted positive and negative cluster matching instead of single max cosine
- local keyword/BM25-style score
- freshness
- source normalization
- article state
- pending embedding floor
- duplicate, negative, exposure, and diversity penalties
- optional exploration bonus

`latest` sorting is not affected.

## Interest Clusters

`interest_clusters` remains the long-term semantic profile store.

Implemented behavior:

- positive clusters use top-k weighted average, default k = 4
- negative clusters use top-k weighted average, default k = 3
- cluster weights use log normalization and caps
- negative signals are used for similar-content penalties and explicit filters
- `open` and single impressions are not strong long-term preference signals

`interest_cluster_evidence` stores future cluster evidence. Reconstructed evidence must set `evidence_source = "reconstructed"` and a confidence value; live event evidence uses `live_event`.

## FTS / BM25

`article_fts` remains the local FTS5 index. Queries are sanitized before `MATCH`.

Search uses:

```sql
bm25(article_fts, 5.0, 2.0, 0.6)
```

The direction is SQLite FTS5 native: lower BM25 rank is more relevant. The ranking pipeline normalizes local lexical signals before mixing them with semantic and source features.

## Source Normalization

Source influence combines:

- user `sourceWeight`
- exposure-normalized positive/negative feed stats
- low-confidence open-only behavior with very small weight

High-frequency feeds should not dominate only because they publish more. Source contribution remains bounded below content-interest features.

## Cocoon Level

Setting key: `recommendation.settings.cocoonLevel`

Range: `1..10`

Default: `5`, to avoid surprising migration behavior.

Neutral interpretation:

- lower: more open, distributed, and exploratory
- higher: more personalized, stable, and less disruptive

Hard constraints:

- level 1 never recommends outside subscribed feeds
- level 10 never bypasses explicit hide/not-interested filters
- level 10 never bypasses dedupe or freshness floor
- duplicate groups cannot flood the list at any level

Changing cocoon level triggers ranking recalculation only. It does not require new embeddings or FTS rebuild.

## Canonical Rerank

MMR is list-level. Dibao uses a background canonical order approach:

- ranking jobs calculate a hot window
- source and duplicate diversity penalties are applied while selecting the canonical order
- `rerank_position`, `rerank_score`, and `rerank_window_id` are persisted in `article_rank_scores`
- recommended pages read persisted rank scores/order and fall back to legacy/base scores if needed

## V3 Local Learning, Exploration, Evaluation

V3 features are local and feature-flagged:

- `recommendation.localLearning.enabled`
- `recommendation.localLearning.shadowMode`
- `recommendation.exploration.enabled`
- `recommendation.evaluation.enabled`

FTRL is shadow-mode by default. Training examples include `sample_weight`, `event_type`, `exposure_context`, `rank_position_when_exposed`, `was_exploration`, and `created_from` to reduce exposure bias.

Offline replay evaluation is diagnostic unless a strict time-travel profile is used. It must not be described as causal A/B proof.

## Migration And Backfill

Migration `004_recommendation_v2`:

- preserves existing tables and primary keys
- appends nullable score columns to `article_rank_scores`
- adds derived-data tables for rank contexts, evidence, fingerprints, duplicates, local learning, exploration, evaluation, and backfill state
- expands job types with a recreate-copy-rename migration

Live migration is gated. Use:

```bash
DIBAO_ALLOW_LIVE_MIGRATION=1 \
DIBAO_DB_BACKUP_CONFIRMED=1 \
DIBAO_DATABASE_PATH=/path/to/dibao.sqlite \
npm run ops:migrate:recommendation-v2
```

The script creates a timestamped backup, prints backup size and SHA-256, records pre/post table counts, and verifies legacy data counts are unchanged.

## Maintenance APIs

All endpoints require authentication and dedupe queued/running work:

- `POST /api/recommendation/recalculate`
- `POST /api/recommendation/backfill/fingerprints`
- `POST /api/recommendation/rebuild-duplicates`
- `POST /api/recommendation/rebuild-keywords`
- `POST /api/recommendation/evaluate`
- `POST /api/recommendation/ftrl/reset`

The first five return a job id. FTRL reset is immediate and local.
