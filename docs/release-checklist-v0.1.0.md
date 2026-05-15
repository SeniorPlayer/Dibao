# Dibao v0.1.0 Release Checklist

Last updated: 2026-05-15

Target tag: `v0.1.0`

Current candidate commit:

```text
8b82238 Harden MVP release path
```

## Release Decision

Current `main` is functionally suitable as the v0.1.0 MVP release candidate, but it should not be tagged yet.

Two items should be completed before creating the tag:

1. Bump project-visible version metadata from `0.0.0` to `0.1.0`.
2. Run Docker build / Compose smoke in an environment with Docker CLI.

## Blocking Pre-Tag Items

| Status | Item | Acceptance |
| --- | --- | --- |
| Todo | Version bump | `package.json`, workspace package versions, `package-lock.json`, `packages/shared/src/index.ts`, version tests, and API/docs examples are aligned to `0.1.0`. |
| Todo | Docker build verification | `docker build -t dibao:0.1.0 .` succeeds on a machine with Docker. |
| Todo | Compose verification | `docker compose config` succeeds; `docker compose up --build -d` starts the app; `GET /api/system/health` returns 200. |
| Todo | Docker Web entry verification | `http://localhost:8080` serves the Web app before login; protected `/api/*` routes still require auth except allowlisted endpoints. |

## Pre-Tag Validation

Run from a clean checkout of `main`:

```bash
git checkout main
git pull --ff-only
git status -sb
npm run typecheck
npm test
npm run build
npm run spike:sqlite-vec
npm run e2e
docker build -t dibao:0.1.0 .
docker compose config
docker compose up --build -d
curl -fsS http://localhost:8080/api/system/health
docker compose down
git diff --check
```

Expected result:

- Git worktree is clean.
- All npm validation commands pass.
- E2E passes on desktop and mobile Chromium projects.
- Docker image builds.
- Compose starts one `dibao` service with persistent `dibao-data` volume.
- Health endpoint returns 200 with `data.ok = true`.

## Functional MVP Acceptance

| Area | Status | Acceptance |
| --- | --- | --- |
| Single-user setup/auth | Done | First-run password setup, login, logout, session cookie, and protected APIs work. |
| RSS reader | Done | User can add RSS/Atom feeds, refresh, list articles, and open article detail. |
| OPML | Done | User can import/export OPML through Web UI. |
| Feed management | Done | User can create/rename/delete folders, edit feeds, disable feeds, and soft-delete feeds. |
| Article actions | Done | Favorite, read later, read/unread, and not interested actions persist and update UI. |
| Background refresh | Done | Enabled feeds can be refreshed through jobs; failures are isolated and recorded. |
| Retention | Done | Article retention cleanup preserves behavior/profile data and clears serving indexes. |
| Settings | Done | Language, reader settings, retention days, and OpenAI-compatible provider settings persist. |
| Embedding provider | Done | OpenAI-compatible provider can be saved, enabled, tested, and used for embedding jobs. |
| sqlite-vec | Done | Vectors can be stored, rebuilt, and queried through sqlite-vec. |
| Profile/ranking | Done | Behavior events update profile clusters; recommended ranking uses active context with fallback. |
| Explanation | Done | Recommendation explanation displays baseline and interest-related reasons. |
| Docker self-host path | Release candidate | Dockerfile and Compose exist; still needs external Docker CLI verification. |
| E2E smoke | Done | Local no-network desktop/mobile Playwright smoke passes in this repo environment. |
| User docs | Done | README covers deployment, setup, OPML, provider, data persistence, backup, upgrade, FAQ, and dev commands. |

## Known v0.1.0 Boundaries

- Single-user only. No multi-user, OAuth, account management, or official hosted service.
- Self-hosted local SQLite only. No cloud sync.
- MVP only supports OpenAI-compatible embedding endpoints. Ollama, custom HTTP, and embedded local models are future adapters.
- Provider API keys are stored in local SQLite using the current MVP local-storage strategy, not a full secret-management system.
- Search UI, PWA installability, native mobile packaging, full mobile polish, diversity reranking, duplicate penalties, and reindex migration UX are post-MVP work.
- Docker build has not been verified in the current local environment because Docker CLI is unavailable.

## Tagging Commands

Do not run these until all blocking pre-tag items are done.

```bash
git checkout main
git pull --ff-only
git tag -a v0.1.0 -m "Dibao v0.1.0"
git push origin v0.1.0
```

## Recommended GitHub Release Settings

- Release title: `Dibao v0.1.0`
- Mark as latest release: yes.
- Mark as prerelease: optional. Recommended `yes` if Docker build has not been independently verified; otherwise `no`.
- Attachments: none required for source release.
- Body: use `docs/release-notes-v0.1.0.md`.

