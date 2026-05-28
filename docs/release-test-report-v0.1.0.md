# Dibao v0.1.0 Release Test Report

Test window: 2026-05-28 16:05-16:20 CST

Branch: `release/v0.1.0`

Workspace: `/Users/jeffreywang/dev/邸报`

Target tag: `v0.1.0`

## Release Decision

`release/v0.1.0` is suitable to merge to `main` and tag as the first public release after the GitHub Actions Docker publication workflow succeeds for `v0.1.0`.

This is the first public release, so there is no previous public version to upgrade from. Fresh-database migration and runtime startup are covered by unit tests, E2E, local server startup, and container smoke.

## Gate Results

| Check | Result | Notes |
| --- | --- | --- |
| `npm run typecheck` | Pass | Server, Web, DB, ranking, RSS, and shared workspaces passed. |
| `npm test` | Pass | 18 test files and 303 tests passed. |
| `npm run build` | Pass | Production Web bundle and all workspace builds passed; Vite reported the existing chunk-size warning. |
| `npm run spike:sqlite-vec` | Pass | sqlite-vec `v0.1.9`, FTS, KNN, row mapping, and rebuild checks passed. |
| `npm run e2e` | Pass | 16/16 Playwright desktop/mobile tests passed. |
| `docker compose config` | Pass | Single `dibao` service and persistent `/data` bind mount resolved. |
| Docker health smoke | Pass | Cached image started through Compose and returned `/api/system/health` with version `0.1.0`. |
| Docker recommendation smoke | Pass | No-build smoke against the cached release-runtime image reached `coverageRatio: 1`, `embeddingCount: 2`, `pendingJobs: 0`, `failedJobs: 0`, and `recommendedCount: 2`. |
| `npm run perf:recommendation` | Pass | Regenerated `docs/recommendation-performance.md` with a 20k-article local benchmark. |
| `DIBAO_RUN_OLLAMA_TESTS=true npm run test:ollama:optional` | Pass | Local Ollama `bge-m3` returned dimension `1024`. |
| `git diff --check` | Pass | No whitespace errors. |

## Docker Build Note

Local `docker buildx build --platform linux/amd64 -t dibao:0.1.0-release --load .` and local `docker build -t dibao:local .` both stalled at Docker Hub metadata resolution for `node:22-bookworm-slim` on this machine. The product build and container runtime were still validated locally through npm gates and no-build Compose smoke.

The release Docker build is therefore verified by the tracked GitHub Actions workflow `.github/workflows/publish-docker-image.yml`, which builds and pushes the immutable `ghcr.io/pls-1q43/dibao:v0.1.0` image on the release tag.

## Performance Snapshot

From `docs/recommendation-performance.md` generated on 2026-05-28:

| Check | Result |
| --- | ---: |
| Dataset generation | 3503.1 ms |
| Ranking chunk job drain | 93.7 ms |
| Ranking jobs succeeded | 1 |
| Embedding candidate query | 15.2 ms |
| Recommended API | 48.0 ms |
| Diagnostics/index API | 131.2 ms |

Dataset: 20,000 articles, 100 feeds, deterministic local vectors, and realistic behavior events.

## Migration List

Fresh v0.1.0 installs apply migrations `001` through `017`, skipping no shipped public migration because this is the first public release. There is no previous public release database to upgrade from.

Migrations included:

- `001_initial_schema`
- `002_article_state_likes`
- `003_profile_event_jobs`
- `004_recommendation_v2`
- `005_recommendation_v2_completion`
- `006_recommendation_maintenance_schedule`
- `007_embedding_usage_and_profile_evidence_snapshots`
- `008_interest_cluster_labels`
- `009_interest_cluster_merge_candidates`
- `011_remove_corpus_topic_snapshots`
- `012_gemini_embedding_provider`
- `013_embedding_provider_limits`
- `014_reader_command_events`
- `015_feed_full_content_mode`
- `016_auth_username`
- `017_interest_families`

## Known v0.1.0 Boundaries

- Single-user only.
- No hosted service, cloud sync, OAuth, or password recovery.
- Provider API key storage remains the MVP local SQLite strategy.
- PWA support covers installability foundation and offline app shell, not a full offline article library.
- No native mobile or desktop app packaging yet.
- Recommendation quality is early and should continue improving through more behavior, diversity, duplicate handling, and profile rebuild tooling.
