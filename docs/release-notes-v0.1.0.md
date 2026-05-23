# Dibao v0.1.0 Release Notes

Dibao v0.1.0 is the first MVP release candidate for a single-user, self-hosted, personalized RSS reader.

It is designed for people who want a local and controllable alternative to algorithmic feeds: recommendations happen only inside the user's own RSS/Atom subscriptions, with data stored in a self-hosted SQLite database.

## Highlights

- Single-user self-hosted RSS reader.
- Docker / Docker Compose deployment path.
- First-run setup with password-based auth.
- OPML import/export.
- Feed and folder management.
- Per-feed full content control with preview and current-RSS-only backfill.
- Search UI for local title, summary, and full-text article search.
- Article actions: favorite, read later, read/unread, not interested, and read progress.
- Reader Command cleanup for marking unread debt as read without recommendation feedback pollution.
- Background feed refresh, retention cleanup, embedding, ranking, and profile jobs.
- Settings for language, reader typography, retention, and embedding providers.
- OpenAI-compatible and Ollama embedding provider support.
- sqlite-vec vector storage, rebuild, and active-index backfill.
- Profile Algorithm v0 and Ranking v1 fusion.
- Recommendation diagnostics, safe jobs list, and explanation UI.
- PWA installability foundation with manifest, service worker, update prompt, and offline app shell.
- Desktop and mobile E2E smoke coverage.

## What's Included

### Reader

- Add RSS/Atom feeds manually.
- Discover RSS/Atom feeds from website homepages before adding.
- Preview feed title, URL, description, recent items, and duplicate status before confirming an add.
- Refresh a single feed or enqueue refresh for all enabled feeds.
- Browse latest and recommended article lists.
- Open article detail.
- Use article actions and reader scroll progress to shape future recommendations.
- Load more article list pages through cursor pagination.
- Search the local article library by keyword, filter by feed/folder/state/date, and open results in the existing reader.
- Clear unread debt in latest/recommended by all, older than 24h, older than 7d, or older than 30d; submitted search scopes can also be cleared through a confirmed Reader Command.
- Desktop feed/list/reader columns scroll independently.

### Subscriptions

- Import OPML files.
- Export current subscriptions as `dibao-subscriptions.opml`.
- Create, rename, and delete folders.
- Edit feed title, folder, enabled state, and source weight.
- View feed health diagnostics, filter to unhealthy/disabled/never-successful feeds, and retry failing feeds.
- Keep Feed content as the default body source, or explicitly enable web full-content fetching per feed. Preview does not write the database; backfill only touches items in the current RSS response and is limited to 50 items.
- Soft-delete feeds without physically deleting historical article rows.

### Recommendation

- Baseline ranking works without any embedding provider.
- OpenAI-compatible and Ollama embedding providers can be configured and tested.
- New articles can be embedded through background jobs.
- Active embedding indexes can be backfilled for missing/stale vectors.
- Full-content success updates the article effective `content_hash`, making stale embeddings eligible for regeneration and subsequent ranking recalculation.
- sqlite-vec indexes can be rebuilt from the SQLite authority table without calling the provider.
- User behavior updates positive and negative interest clusters.
- Reader Command `mark_scope_read` is audited separately from behavior events and does not train the interest profile.
- Full-content backfill is corpus maintenance, not user behavior: it does not write `behavior_events`, does not mark articles read/favorited/read-later, and does not directly train the user profile.
- Full-content refresh/backfill side effects are centralized in the server coordinator: content services return changed article IDs, then embedding, ranking, and recommendation maintenance are enqueued once.
- Recommended ranking combines interest match, source preference, freshness, state, and penalties.
- Search v0 supports relevance, latest, and recommendation-aware ordering inside matched results.
- The system falls back gracefully when provider, embedding, or profile data is unavailable.
- Diagnostics show mode, coverage, behavior counts, clusters, rank context, pending/failed jobs, and warnings without exposing API keys or vectors.

### Operations

- Single-container Dockerfile.
- `compose.yaml` with persistent `/data/dibao.sqlite` volume.
- Anonymous health check endpoint at `/api/system/health`.
- Server can serve the built Web app and API from one Fastify process.
- Static PWA assets are served with installability-friendly content types, including `/site.webmanifest` and `/sw.js`.
- Docker recommendation smoke covers setup, provider, backfill, diagnostics, and recommended articles.
- Performance script generates a 20k-article local benchmark and updates `docs/recommendation-performance.md`.
- README documents deployment, setup, backup, restore, upgrade, provider configuration, and troubleshooting.

## Validation Status

The v0.1.0 RC gate is expected to pass:

- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run spike:sqlite-vec`
- `npm run e2e`
- `docker build -t dibao:local .`
- `docker compose config`
- `npm run smoke:docker-recommendation`
- `npm run perf:recommendation`
- `DIBAO_RUN_OLLAMA_TESTS=true npm run test:ollama:optional`
- `git diff --check`

The E2E and Docker smoke suites use local RSS and embedding fixtures and do not call real external services. The optional Ollama probe is intended for a local Ollama service; for this RC the expected local model is `bge-m3` with dimension `1024`.

## Known Limitations

- Single-user only.
- No official hosted service.
- No multi-device cloud sync.
- No OAuth or password recovery.
- No offline full article reading or IndexedDB article cache.
- No native iOS / Android / desktop app packaging yet.
- No full mobile layout hardening beyond MVP smoke coverage.
- No custom HTTP or embedded-local provider adapter yet.
- No provider API key encryption beyond current MVP local SQLite storage.
- No advanced diversity reranking or duplicate penalties yet.
- No full model migration UX for changing embedding dimensions/models.
- Search v0 does not support semantic search, complex search syntax, or external search services.
- Bulk reader cleanup only supports marking unread articles as read; it does not support bulk delete, bulk favorite, bulk read-later, or bulk not-interested.
- Reader Command cleanup has no complex undo history.
- Feed discovery depends on declared `<link rel="alternate">` metadata or a small set of common feed paths; it does not do complex webpage scraping.
- Feed discovery does not perform full-text fetching and does not automatically repair already-invalid feed URLs.
- Full-content fetching does not execute JavaScript, use a headless browser, bypass paywalls, download images, or guarantee success for every website. Failure keeps the existing Feed content readable.
- Recommendation quality is still early and benefits from explicit user behavior and complete embedding coverage.

## Upgrade Notes

This is the first MVP release, so there is no previous release migration path.

For future upgrades:

1. Back up the Docker volume or SQLite database before upgrading.
2. Pull/build the new image.
3. Keep the same `/data` volume.
4. Start the container and check `/api/system/health`.

## Tagging Note

Do not create `v0.1.0` until the final RC checklist and browser smoke are complete. See `docs/release-checklist-v0.1.0.md`.
