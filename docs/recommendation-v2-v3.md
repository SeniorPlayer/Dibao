# Dibao Recommendation V2/V3 Design

This document records the phased V2/V3 recommendation architecture and the current implementation status. The ranking core remains local-first:

- No remote LLM.
- No remote reranker.
- No remote classifier.
- No external search service.
- The only optional remote dependency is one embedding provider.
- Scores, explanations, local model data, profile data, and evaluation logs are stored in SQLite.

## Implementation Status

### Implemented and active by default

- `004_recommendation_v2`, append-only `005_recommendation_v2_completion`, append-only `006_recommendation_maintenance_schedule`, existing `007_embedding_usage_and_profile_evidence_snapshots`, append-only `008_interest_cluster_labels`, append-only `009_interest_cluster_merge_candidates`, and cleanup migration `011_remove_corpus_topic_snapshots`.
- Canonical rank context remains `article_rank_scores.rank_context`; there is no second `rank_context_id`.
- Ranking jobs persist `rerank_position`, and `view=recommended` reads that canonical order before falling back to score.
- Ranking setting changes enqueue a deduped `ranking_recalculate` job without enqueueing embedding, FTS, or vector rebuild jobs.
- Semantic ranking uses existing `interest_clusters`, recent intent vectors when present, and persisted score components.
- `profile_terms + FTS5 bm25()` participates in lexical candidate recall and `bm25_score`; token counts are not used as BM25.
- Candidate recall is bucketed in the full recalculation path: must-include, recency, semantic, lexical, and diversity buckets are unioned before scoring.
- `interest_cluster_evidence` is written for live cluster updates and read before dynamic diagnostics fallback.
- Duplicate rebuild includes exact keys and bounded simhash near-duplicate grouping; ranking reads persisted duplicate groups for penalties.
- Feed source normalization writes Bayesian smoothing fields and ranking prefers them when available.
- Recent intent rebuild uses existing embeddings only and does not call an embedding provider.
- Offline evaluation writes `lightweight_replay_diagnostic` metrics from sampled cutoffs and labels; it is not full strict replay and not causal A/B evidence.
- `RecommendationMaintenanceScheduler` organizes existing maintenance jobs with local due logic, SQLite schedule state, and queued/running dedupe.

### Implemented but shadow or disabled

- FTRL training generates examples and weights locally. Transparency distinguishes `disabled`, `shadow_no_samples`, `insufficient_samples`, `shadow_training`, `ready_to_promote`, `active_low_weight`, `active`, `auto_paused`, `retired`, and `failed`. It writes non-zero shadow `ftrl_score`, but final ranking uses it only after explicit local promotion or guarded auto-promotion, sufficient samples, `localLearningEnabled=true`, and `localLearningShadowMode=false`.
- Micro-exploration currently exposes bounded local exploration bonus/slot state. It must be shown as `enabled_bonus_only` until bucket alpha/beta statistics are used for slot selection.

### Planned / disabled

- Full strict replay remains planned. Current evaluation is `lightweight_replay_diagnostic`; it uses local bounded replay terms and may approximate historical table state.

## Rank Context

`article_rank_scores.rank_context` remains the canonical context id. There is no second `rank_context_id`.

V2 contexts use:

```text
rec_v2:<base|embedding>:cocoon_<level>:schema_2
```

`rank_contexts.id` is equal to `article_rank_scores.rank_context`. Legacy contexts such as `base` and older embedding-index ids remain readable and are used as fallback.

## Recommendation Automatic Maintenance Cycle

The automatic cycle is a lightweight scheduler. It only enqueues existing jobs and never performs heavy work inline. All state remains in SQLite, and every automatic enqueue checks queued/running jobs before creating a new row.

Real-time event-driven hooks:

- RSS refresh keeps the existing `embedding_generate` enqueue path. When new/updated article ids exist, it also enqueues fingerprint backfill and a delayed deduped `duplicate_group_rebuild`.
- Embedding completion keeps the existing profile/ranking hook.
- Strong user actions enqueue the existing article/profile/ranking hooks and add delayed maintenance: `recent_intent_rebuild` after 10 minutes and `ftrl_train` after 15 minutes. Strong actions are favorite, like, read_later, mark_read/read_complete, hide, not_interested, and `read_progress >= 0.75`. Open, impression, and lower progress do not trigger maintenance rebuilds.
- Profile decay and retention cleanup schedulers remain separate and unchanged.

Periodic maintenance:

- 15 minutes: if there are strong recent behaviors or untrained FTRL examples, enqueue deduped recent intent and FTRL train jobs.
- Hourly: enqueue deduped recent intent and duplicate rebuilds; run embedding coverage health only when an active index exists and no embedding job is already open. Hourly ranking recalculation is only queued when a maintenance output completed since the last hourly ranking enqueue.
- Daily: enqueue keyword profile rebuild, duplicate rebuild, recent intent rebuild, FTRL train, interest cluster label rebuild, interest cluster merge diagnostics, and ranking recalculation. Interest cluster auto merge is a separate daily task and is disabled by default.
- Weekly diagnostic: `ranking_eval_run` is disabled by default. When enabled, it runs no more often than `evaluationAutoRunIntervalDays`.

Sorting impact:

- Recent intent, keyword profile, duplicate groups, and FTRL train can affect `view=recommended` after a deduped `ranking_recalculate`.
- Evaluation is diagnostic only. It does not update profile, FTRL, or ranking scores.
- Interest cluster label rebuild is explainability metadata only. It does not update ranking, embeddings, centroids, or profile vectors.
- Interest cluster merge diagnostics is read-only. It writes SQLite diagnostics rows and does not update ranking, embeddings, centroids, or profile vectors.
- Interest cluster merge changes the user profile and therefore recalculates ranking. Auto merge is disabled by default.
- Embedding health may enqueue small active-index embedding backfill when coverage is missing/stale; it does not run on settings changes.
- `view=latest` remains ordered by latest article time and is not affected by recommendation maintenance.

FTRL lifecycle:

- `< 50` high-quality samples: shadow/insufficient; no final score impact.
- `50..99`: shadow training; still no final score impact.
- `>= 100`: ready to promote; transparency says local learning can be enabled at 5%.
- Active starts at `alpha = 0.05`, increases at most `0.05` every 7 days, and is capped at `0.20` (`0.25` remains the absolute historical safety ceiling).
- Elevated hide/not_interested feedback lowers alpha; repeated deterioration can auto-pause by returning the model to shadow.
- FTRL may train daily, but it is not automatically promoted daily. Auto-promotion is disabled by default and requires a successful local lightweight diagnostic.

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

Target V2 is structured around bucketed recall, not one global pre-union cap:

- must-include: favorite, read-later, recently opened unfinished, fresh pending embeddings, high source-weight feeds
- recency: fresh articles and recent hot-window articles
- semantic: active embedding profile and cluster matches
- lexical: local FTS/BM25 and keyword profile signals
- diversity: low-exposure feeds and underrepresented duplicate groups

The full recalculation path uses independent bucket queries and stores candidate origins in the explanation payload. Cursor chunk recalculation may still use the compatibility candidate query for resumability.

## Hybrid Scoring

V2 score combines:

- long-term semantic interest from `interest_clusters`
- top-k weighted positive and negative cluster matching instead of single max cosine
- local keyword/BM25 score from active `profile_terms + FTS5 bm25()`
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

### Interest Cluster Labels

Interest cluster labels are explainability metadata only. They do not change ranking, profile vectors, embedding, or user feedback.

Implemented V1/V2 behavior:

- automatic labels are generated locally from `interest_cluster_evidence`, article titles/summaries, representative article titles, feed titles, and same-polarity `profile_terms`;
- generation does not call an LLM, reranker, classifier, external search service, or embedding API;
- labels are stored in SQLite table `interest_cluster_labels`;
- display priority is `manual_label > auto_label > interest_clusters.label > 兴趣簇 #N`;
- manual labels only affect display and explanations, never cluster centroids or rank scores;
- clearing a manual label restores the current automatic label fallback.
- the default label lexicon lives in `apps/server/src/recommendation-label-lexicon.default.json`;
- user overrides live in app setting key `recommendation.clusterLabelLexicon`;
- effective lexicon is default plus `*Add` minus `*Remove`, with invalid stored overrides falling back to the default lexicon and surfacing as a warning instead of preventing startup.

Label generation rules:

- URL, domain, HTML, tracking, and metadata residue such as `article`, `affiliation`, `strong`, `https`, `www`, `com`, `html`, `utm`, `href`, and `src` is filtered by the effective lexicon and bad-term patterns.
- Protected technical terms such as `AI`, `LLM`, `API`, `RSS`, `SQLite`, and `FTRL` can remain labels when they appear as semantic terms; domain fragments such as `.ai` are filtered by context and pattern.
- Cluster-local evidence dominates label scoring. Title terms, evidence event terms, representative titles, and summaries carry higher weight than same-polarity global `profile_terms`; feed titles are fallback evidence.
- A cluster-level IDF pass penalizes terms that appear in many clusters and drops terms appearing in more than half of active-index clusters unless they are protected or the only valid option.
- Chinese candidate terms dedupe obvious substring chains, so short fragments such as `两市` / `两市成` are removed when a fuller phrase such as `两市成交` is available.
- Duplicate `auto_label` strings are disambiguated with extra terms, representative article terms, feed title fallback, or a short `#N` suffix. Collision diagnostics are stored in `label_diagnostics_json`.

`label_source` values:

```text
manual
keywords
representative_titles
feeds
fallback
```

The automatic label rebuild job is `interest_cluster_label_rebuild`. It updates `interest_cluster_labels` for the active embedding index, preserves `manual_label`, and does not enqueue `embedding_generate` or `ranking_recalculate`.

### Interest Cluster Label Quality and Merge Diagnostics

Label rebuild is explainability metadata only.
Merge diagnostics is read-only.
Cluster merge changes user profile and therefore recalculates ranking.

Duplicate-interest diagnostics compare only active-index clusters with the same polarity. The diagnostic pass is bounded to the highest-weight clusters (`positive` top 64, `negative` top 32) and writes candidates to SQLite table `interest_cluster_merge_candidates`.

Signals:

- `centroid_similarity`: cosine similarity between cluster centroids.
- `label_jaccard`: overlap of generated/manual label terms.
- `evidence_overlap`: overlap of evidence article ids divided by the smaller support set.
- `representative_overlap`: overlap of representative articles.
- `source_overlap`: overlap of feed ids/titles.
- `merge_score`: `0.45 * centroid_similarity + 0.20 * label_jaccard + 0.25 * evidence_overlap + 0.10 * representative_overlap`.

Recommendation thresholds are conservative. Negative clusters require higher centroid, label, evidence, and score thresholds than positive clusters. Diagnostics never compares different polarity clusters.

Maintenance jobs:

```text
interest_cluster_merge_diagnostics
interest_cluster_auto_merge
```

`interest_cluster_merge_diagnostics` clears stale open candidates for the active index, generates fresh `open` candidates, and preserves existing `ignored` / `merged` audit rows. It does not modify `interest_clusters`, does not trigger ranking, and does not call embedding.

`interest_cluster_auto_merge` is controlled by `recommendationMaintenance.clusterAutoMergeEnabled`, default `false`. When explicitly enabled, it only processes `recommendation = "auto_merge"` and `status = "open"`, with a per-run cap of 5 pairs. A merge:

- chooses the survivor by manual label, then higher weight, sample count, and newer update time;
- moves `interest_cluster_evidence` from the merged-away cluster to the survivor;
- combines weight/sample count and computes a weighted normalized centroid;
- preserves the survivor manual label, or migrates the merged-away manual label if the survivor has none;
- deletes only the merged-away cluster, not articles or behavior events;
- records survivor, merged-away cluster, and metrics in `reason_json`;
- enqueues label rebuild and ranking recalculation.

Manual merge APIs use the same merge logic for `review` and `auto_merge` candidates. Ignore only changes the candidate status and does not touch cluster data.

## FTS / BM25

`article_fts` remains the local FTS5 index. Queries are sanitized before `MATCH`.

Search uses:

```sql
bm25(article_fts, 5.0, 2.0, 0.6)
```

The direction is SQLite FTS5 native: lower BM25 rank is more relevant. `article_rank_scores.bm25_score` must only be populated from `profile_terms + FTS5 bm25()` after P1. It must not be populated from token counts, title length, summary length, or text density.

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

Changing cocoon level triggers a deduped ranking recalculation only. It does not require new embeddings, FTS rebuild, or vector rebuild.

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

FTRL is shadow-mode by default. It is trained locally from low-dimensional normalized ranking features, not raw embedding dimensions.

Offline evaluation is currently `lightweight_replay_diagnostic`. It stores subset metrics such as cutoff count, label count, hit@10, nDCG@10, and MRR, but it is not full strict replay and must not be described as causal A/B proof.

## Migration And Backfill

Migration `004_recommendation_v2`:

- preserves existing tables and primary keys
- appends nullable score columns to `article_rank_scores`
- adds derived-data tables for rank contexts, evidence, fingerprints, duplicates, local learning, exploration, evaluation, and backfill state
- expands job types with a recreate-copy-rename migration

Migration `005_recommendation_v2_completion` is append-only and safe for databases that already applied `004`. It adds FTRL state columns (`z`, `n`), source normalization derived fields on `feed_stats`, and non-unique indexes for P1/P2 work. It intentionally avoids unique indexes that could fail on dirty derived rows.

Migration `006_recommendation_maintenance_schedule` is append-only. It adds only `recommendation_maintenance_schedule_state` for scheduler observability and does not rewrite derived recommendation data.

Migration `008_interest_cluster_labels` is append-only. The repository already has an existing `007_embedding_usage_and_profile_evidence_snapshots`; `008` adds `interest_cluster_labels` and extends the `jobs.type` CHECK constraint with `interest_cluster_label_rebuild` without modifying migrations `001` through `007`.

Migration `011_remove_corpus_topic_snapshots` removes the retired Corpus Topic Snapshot experiment from databases that applied it during testing. It drops the corpus topic tables, removes `topic_snapshot_rebuild` jobs, and restores label/job CHECK constraints so the main recommendation path has no topic snapshot dependency.

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
- `POST /api/recommendation/rebuild-cluster-labels`
- `POST /api/recommendation/evaluate`
- `POST /api/recommendation/ftrl/reset`
- `POST /api/recommendation/ftrl/promote`

The background maintenance endpoints return a job id and dedupe queued/running work. FTRL reset is immediate and local. FTRL promote is immediate, local, and returns `409` until the shadow model has at least 50 high-quality samples and a positive blend alpha.
