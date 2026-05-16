# Dibao v0.1.0 RC Test Report

Test window: 2026-05-16 10:08-10:18 CST

Branch: `main`

Workspace: `/Users/jeffreywang/dev/邸报`

RC browser database: `.tmp/rc-v0.1.0/browser-smoke.sqlite`

Browser target: `http://127.0.0.1:8080`

## Release Decision

Current `main` plus the v0.1.0 RC closure changes is suitable to tag as `v0.1.0` after the closure commit is reviewed and pushed.

No P0 blocker remains from the previous release-readiness report:

- Version metadata now reports `0.1.0` in package metadata, Web UI, and health response.
- Docker build and Compose config were verified with Docker Desktop bundled CLI.
- Reader desktop columns scroll independently and the mobile smoke has no horizontal overflow.
- `GET /api/jobs` is implemented and returns safe payload summaries.

## Gate Results

| Check | Result | Notes |
| --- | --- | --- |
| `npm run typecheck` | Pass | All workspaces show `0.1.0` in npm output. |
| `npm test` | Pass | 8 test files, 145 tests passed across workspaces. |
| `npm run build` | Pass | Web production bundle built; server/workspace TS builds passed. |
| `npm run spike:sqlite-vec` | Pass | sqlite-vec `v0.1.9`, FTS, KNN, row mapping, and rebuild checks passed. |
| `npm run e2e` | Pass | Rerun outside sandbox passed, 2/2 Playwright tests. |
| `docker build -t dibao:local .` | Pass | Passed with Docker Desktop bundled CLI and `PATH=/Applications/Docker.app/Contents/Resources/bin:$PATH`. |
| `docker compose config` | Pass | Single `dibao` service and persistent `dibao-data` volume resolved. |
| `npm run smoke:docker-recommendation` | Pass | Container smoke reached `coverageRatio: 1`, `embeddingCount: 2`, `recommendedCount: 2`. |
| `npm run perf:recommendation` | Pass | Regenerated `docs/recommendation-performance.md`. |
| `DIBAO_RUN_OLLAMA_TESTS=true npm run test:ollama:optional` | Pass | Local Ollama `bge-m3` returned dimension `1024`, latency `2713 ms`. |
| `git diff --check` | Pass | No whitespace errors after RC docs and report updates. |

## Performance Snapshot

From `docs/recommendation-performance.md`:

| Check | Result |
| --- | ---: |
| Dataset generation | 2829.9 ms |
| Ranking chunk job drain | 4694.6 ms |
| Ranking jobs succeeded | 40 |
| Embedding candidate query | 19.7 ms |
| Recommended API | 42.2 ms |
| Diagnostics/index API | 94.3 ms |

Dataset: 20,000 articles, 100 feeds, deterministic local vectors, and realistic behavior events.

## Browser RC Smoke

Browser automation used a clean temporary SQLite database and a local RSS fixture server.

### Follow-Up E2E Coverage Added

The Playwright suite now includes additional mobile QA coverage using only the local fixture server
and local application server:

- Recommended list first screen density on a 390px mobile viewport: at least 5 article rows are
  visible and the document has no horizontal overflow.
- Mobile recommended article detail opens and renders the `为什么推荐` algorithm transparency panel
  with explanation content.
- Mobile reader action state remains visible after toggling favorite and read-later buttons through
  their pressed aria state.

Pending Playwright `fixme` cases were added for product surfaces that are present in navigation or
release scope but not yet wired in the current frontend:

- Browser history back from mobile article detail to list.
- Favorites page sort dropdown switching.
- Read-later page opening a saved article.
- Like/upvote action visible pressed state.

Current QA sub-agent verification on 2026-05-16:

- `npm run e2e` did not reach Playwright because the in-progress frontend worktree failed
  TypeScript build on reader view keys and the new `liked` article state.
- `node scripts/e2e/prepare.mjs && npx playwright test` was rerun outside the sandbox to allow
  localhost binding, but without a fresh build it used stale dist output and failed in the existing
  desktop seed flow while waiting for `E2E Article Beta`.
- `npx playwright test tests/e2e/mobile.spec.ts --list` passed and listed 9 tests total: 1 desktop
  dependency, 4 executable mobile tests, and 4 pending mobile product-surface tests.

### First-Run Setup

- First visit showed the welcome/setup flow.
- Password setup completed.
- Added local RSS fixture feed: `http://127.0.0.1:19191/feeds/rc.xml`.
- Continued through provider placeholder into the reader.
- Web UI displayed `v0.1.0`.

### Reader And Actions

- Latest article list loaded 8 local fixture articles.
- Article detail opened automatically.
- Favorite, read later, mark read, and not interested buttons were clickable.
- After actions, the selected article showed:
  - `取消收藏`
  - `移出稍后读`
  - `标记未读`
  - disabled pressed `已不感兴趣`
- Recommendation explanation displayed interest, freshness, state, and source reasons.

### Ollama / bge-m3 Provider

Configured through the Settings UI:

```text
type: Ollama
name: RC Ollama bge-m3
baseUrl: http://127.0.0.1:11434
model: bge-m3
dimension: 1024
enabled: true
```

Result:

- Provider saved.
- Connection test passed.
- Settings diagnostics showed active index:
  - `bge-m3 · active · 8 条 embedding`
  - `8 / 8 · 100%`
  - pending jobs `0`
  - failed jobs `0`

### Backfill And Diagnostics

Authenticated API check against the same RC server:

```json
{
  "indexCoverage": 1,
  "backfill": {
    "jobIds": [],
    "candidateCount": 0,
    "enqueuedArticleCount": 0,
    "dedupedArticleCount": 0
  },
  "recommendationMode": "personalized",
  "coverage": {
    "candidateCount": 8,
    "eligibleArticleCount": 8,
    "missingEmbeddingCount": 0,
    "staleEmbeddingCount": 0,
    "embeddingCount": 8,
    "coverageRatio": 1,
    "pendingJobs": 0,
    "failedJobs": 0
  }
}
```

The backfill response has no jobs because provider enablement had already embedded all 8 eligible articles.

### Recommended View

- Recommended view loaded.
- Recommendation status bar showed:
  - mode: `个性化推荐中`
  - behavior count: `6`
  - coverage: `100%`
  - interest clusters: `+1 / -1`
- Recommended list returned 7 visible articles after the not-interested article was filtered.
- Top recommended article: `RC Article Extra 4`.
- Explanation panel included interest-match reasons.

### System Health And Jobs

Health response:

```json
{
  "ok": true,
  "database": "ok",
  "fts": "ok",
  "vectorStore": "ok",
  "version": "0.1.0"
}
```

Jobs API returned succeeded `embedding_generate` jobs with safe payload summaries:

```json
{
  "type": "embedding_generate",
  "status": "succeeded",
  "payloadSummary": {
    "embeddingIndexId": "index_...",
    "articleCount": 4
  }
}
```

No raw job payload, API key, session token, article body, or vector data was exposed.

## Environment Notes

- Bare `docker` is not on this shell `PATH`.
- Docker gates pass with Docker Desktop bundled CLI:

```bash
PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH" docker ...
```

- In sandboxed command mode, localhost binding/connection and `tsx` local IPC can fail with `EPERM`. The relevant gates were rerun outside the sandbox and passed.
- Browser screenshots were captured to `.tmp/rc-v0.1.0/recommended.png` and `.tmp/rc-v0.1.0/settings.png`.

## Known v0.1.0 Boundaries

- Single-user only.
- No hosted service or cloud sync.
- No native mobile app or PWA installability yet.
- No Search UI yet.
- Custom HTTP and embedded-local embedding providers are not implemented.
- API key storage remains the MVP local SQLite strategy.
- Recommendation quality is early and should continue improving through more behavior, diversity, duplicate handling, and profile rebuild tooling.

## Recommendation

I recommend tagging `v0.1.0` after the RC closure commit is reviewed and pushed.
