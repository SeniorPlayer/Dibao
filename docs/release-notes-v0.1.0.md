# Dibao v0.1.0 Release Notes

Dibao v0.1.0 is the first MVP release candidate for a single-user, self-hosted, personalized RSS reader.

It is designed for users who want a local and controllable alternative to algorithmic feeds: all ranking happens inside the user's own subscribed RSS / Atom sources, with data stored in a self-hosted SQLite database.

## Highlights

- Self-hosted single-user RSS reader.
- Docker / Docker Compose deployment path.
- First-run setup with password-based single-user auth.
- OPML import/export.
- Feed and folder management.
- Article actions: favorite, read later, read/unread, not interested.
- Background feed refresh jobs.
- Article retention cleanup.
- Settings page for language, reader typography, retention, and embedding provider.
- OpenAI-compatible embedding provider pipeline.
- sqlite-vec vector storage and rebuild support.
- Profile Algorithm v0 and Ranking v1 fusion.
- Recommendation explanation UI.
- Desktop and mobile E2E smoke coverage.

## What's Included

### Reader

- Add RSS / Atom feeds manually.
- Refresh a single feed or enqueue refresh for all enabled feeds.
- Browse latest and recommended article lists.
- Open article detail.
- Use article actions to shape future recommendations.
- Load more article list pages through cursor pagination.

### Subscriptions

- Import OPML files.
- Export current subscriptions as `dibao-subscriptions.opml`.
- Create, rename, and delete folders.
- Edit feed title, folder, enabled state, and source weight.
- Soft-delete feeds without physically deleting historical article rows.

### Recommendation

- Baseline ranking works without any embedding provider.
- OpenAI-compatible embedding providers can be configured and tested.
- New articles can be embedded through background jobs.
- Article vectors are stored in SQLite authority tables and sqlite-vec indexes.
- User behavior can update positive and negative interest clusters.
- Recommended ranking can combine interest match, source preference, freshness, state, and penalties.
- The system falls back gracefully when provider, embedding, or profile data is unavailable.

### Operations

- Single-container Dockerfile.
- `compose.yaml` with persistent `/data/dibao.sqlite` volume.
- Anonymous health check endpoint at `/api/system/health`.
- Server can serve the built Web app and API from one Fastify process.
- README documents deployment, setup, backup, restore, upgrade, provider configuration, and common troubleshooting.

## Validation Status

Validated in the local development environment:

- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run spike:sqlite-vec`
- `npm run e2e`

The E2E smoke suite uses local RSS and OpenAI-compatible embedding fixtures and does not call real external services.

Not yet validated in the current local environment:

- `docker build -t dibao:0.1.0 .`
- `docker compose config`
- `docker compose up --build -d`

Reason: Docker CLI is not available in the current environment.

## Known Limitations

- Single-user only.
- No official hosted service.
- No multi-device cloud sync.
- No OAuth or password recovery.
- No PWA installability yet.
- No native iOS / Android / desktop app packaging yet.
- No Search UI yet, although SQLite FTS infrastructure exists.
- No full mobile layout hardening beyond MVP smoke coverage.
- No Ollama/custom HTTP/embedded local provider adapter yet.
- No provider API key encryption beyond current MVP local SQLite storage.
- No advanced diversity reranking or duplicate penalties yet.
- No full model migration UX for changing embedding dimensions/models.

## Upgrade Notes

This is the first MVP release, so there is no previous release migration path.

For future upgrades:

1. Back up the Docker volume or SQLite database before upgrading.
2. Pull/build the new image.
3. Keep the same `/data` volume.
4. Start the container and check `/api/system/health`.

## Recommended Before Tagging

Before creating `v0.1.0`, complete:

- Version bump from `0.0.0` to `0.1.0`.
- Docker build and Compose smoke on a machine with Docker.

See `docs/release-checklist-v0.1.0.md`.

