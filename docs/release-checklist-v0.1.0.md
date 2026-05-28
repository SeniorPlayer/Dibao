# Dibao v0.1.0 Release Checklist

Last updated: 2026-05-28

Target tag: `v0.1.0`

Candidate branch: `release/v0.1.0`

## Release Decision

`release/v0.1.0` is the v0.1.0 release candidate. Do not tag until all pre-tag gates below are green on the exact commit that will be merged to `main` and tagged.

## Blocking Pre-Tag Items

| Status | Item | Acceptance |
| --- | --- | --- |
| Done | Version bump | Root/workspace package versions, internal workspace deps, `package-lock.json`, shared `dibaoVersion`, version tests, and API/docs examples are aligned to `0.1.0`. |
| Done | License metadata | `LICENSE.md` is frozen with Release Date `2026-05-28`; Change Date is `2030-05-28`; Docker license label carries the same Change Date. |
| Done | Docker build verification | `docker build -t dibao:local .` succeeds. If the shell lacks `docker`, use Docker Desktop bundled CLI with `/Applications/Docker.app/Contents/Resources/bin` on `PATH`. |
| Done | Compose verification | `docker compose config` succeeds. |
| Done | Docker recommendation smoke | `npm run smoke:docker-recommendation` reaches full embedding coverage and returns recommended articles. |
| Done | Browser RC smoke | First-run setup, RSS, Ollama/bge-m3 provider, backfill, recommended, explanation, actions, and settings diagnostics pass in a real browser session. |
| Done | Release gates | Every command in the pre-tag validation section passes on the RC closure working tree. |

## Pre-Tag Validation

Run from a clean checkout of the release candidate:

```bash
git checkout release/v0.1.0
git pull --ff-only
git status -sb
npm run typecheck
npm test
npm run build
npm run spike:sqlite-vec
npm run e2e
docker build -t dibao:local .
docker compose config
npm run smoke:docker-recommendation
npm run perf:recommendation
DIBAO_RUN_OLLAMA_TESTS=true npm run test:ollama:optional
git diff --check
```

Expected result:

- Git worktree is clean except for intentional release artifacts before the RC commit.
- All npm validation commands pass.
- E2E passes on desktop and mobile Chromium projects.
- `/site.webmanifest` returns 200 with `application/manifest+json`, `/sw.js` returns 200, desktop Chromium registers the service worker, and offline reload shows the app shell or offline banner.
- Docker image builds.
- Compose config is valid.
- `.github/workflows/publish-docker-image.yml` is tracked on the release branch before creating the release tag.
- `docs/release-notes-v0.1.0.md` includes Simplified Chinese, Japanese, and English user-facing release notes, install/upgrade notes, known limitations, and the first-release migration list.
- Docker recommendation smoke completes provider setup, backfill, diagnostics, and recommended list checks.
- Performance report is regenerated or confirmed in `docs/recommendation-performance.md`.
- Real Ollama probe passes with the user's local provider, currently `bge-m3` with dimension `1024`.

## Functional MVP Acceptance

| Area | Status | Acceptance |
| --- | --- | --- |
| Single-user setup/auth | Done | First-run password setup, login, logout, session cookie, and protected APIs work. |
| RSS reader | Done | User can add RSS/Atom feeds, refresh, list articles, and open article detail. |
| OPML | Done | User can import/export OPML through Web UI. |
| Feed management | Done | User can create/rename/delete folders, edit feeds, disable feeds, and soft-delete feeds. |
| Article actions | Done | Favorite, read later, read/unread, not interested, and read progress actions persist and update behavior data. |
| Background refresh | Done | Enabled feeds can be refreshed through jobs; failures are isolated and recorded. |
| Retention | Done | Article retention cleanup preserves behavior/profile data and clears serving indexes. |
| Settings | Done | Language, reader settings, retention days, and embedding provider settings persist. |
| Embedding providers | Done | OpenAI-compatible and Ollama providers can be saved, enabled, tested, and used for embedding jobs. |
| Embedding backfill | Done | Active indexes can enqueue missing/stale article embeddings without conflating with sqlite-vec rebuild. |
| sqlite-vec | Done | Vectors can be stored, rebuilt, and queried through sqlite-vec. |
| Profile/ranking | Done | Behavior events update profile clusters; recommended ranking uses active context with baseline and pending fallbacks. |
| Diagnostics | Done | Recommendation status, embedding index coverage, and safe jobs list APIs expose useful state without secrets or raw payloads. |
| Explanation | Done | Recommendation explanation displays baseline and interest-related reasons. |
| PWA foundation | Done | Manifest, service worker, app shell caching, update prompt, and offline banner are in place; `/api/*` responses are not cached. |
| Docker self-host path | Done | Dockerfile, Compose config, static Web serving, health check, and recommendation smoke are in place. |
| E2E smoke | Done | Local no-network desktop/mobile Playwright smoke passes. |
| User docs | Done | README and release docs cover deployment, setup, provider configuration, backfill/rebuild concepts, data persistence, backup, upgrade, FAQ, and dev commands. |

## Known v0.1.0 Boundaries

- Single-user only. No multi-user, OAuth, account management, or official hosted service.
- Self-hosted local SQLite only. No cloud sync.
- MVP supports OpenAI-compatible and Ollama embedding endpoints. Custom HTTP and embedded local models are future adapters.
- Provider API keys are stored in local SQLite using the current MVP local-storage strategy, not a full secret-management system.
- PWA foundation supports installability and offline app shell only. No offline full article reading, push notification, background sync, native mobile packaging, full mobile polish, diversity reranking, duplicate penalties, or full model migration UX yet.
- Recommendation quality is usable for trial but should keep improving through more behavior signals, diversity, duplicate handling, and better profile rebuild tooling.
- Performance benchmark is a manual release gate; it records local evidence but does not enforce hard pass/fail latency thresholds yet.

## Tagging Commands

Do not run these until all blocking pre-tag items are done and the user explicitly approves tagging or a release operation.

```bash
git checkout main
git pull --ff-only
git merge --no-ff release/v0.1.0
git push origin main
git tag -a v0.1.0 -m "Dibao v0.1.0"
git push origin v0.1.0
```

## Recommended GitHub Release Settings

- Release title: `Dibao v0.1.0`
- Mark as latest release: yes.
- Mark as prerelease: no.
- Attachments: none required for source release.
- Body: use `docs/release-notes-v0.1.0.md`.
