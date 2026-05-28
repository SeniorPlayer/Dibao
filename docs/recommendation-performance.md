# Recommendation Performance

Generated at: 2026-05-28T08:14:04.905Z

Dataset:

- Articles: 20000
- Feeds: 100
- Daily distribution: 300-400 new articles/day over recent history
- Behavior events: favorites, read later, read progress, hides, not interested, opens
- Embedding vectors: local deterministic 4-dimensional vectors in `article_embeddings` and sqlite-vec
- Database: `/Users/jeffreywang/dev/邸报/.tmp/perf/recommendation-20k.sqlite`

Results:

| Check | Result |
| --- | ---: |
| Dataset generation | 3503.1 ms |
| Ranking chunk job drain | 93.7 ms |
| Ranking jobs succeeded | 1 |
| Embedding candidate query | 15.2 ms |
| Recommended API | 48.0 ms |
| Diagnostics/index API | 131.2 ms |

Notes:

- This script is a manual release gate and is not part of `npm test`.
- Ranking runs through `ranking_recalculate` chunk jobs with the default 500 article chunk size.
- The embedding candidate query intentionally leaves a small stale set so missing/stale backfill paths are exercised.
