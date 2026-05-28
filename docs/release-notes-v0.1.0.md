# Dibao v0.1.0 Release Notes

Dibao v0.1.0 is the first public MVP release for a single-user, self-hosted, personalized RSS reader.

It is designed for people who want a local and controllable alternative to algorithmic feeds: recommendations happen only inside the user's own RSS/Atom subscriptions, with data stored in a self-hosted SQLite database.

Release Date: 2026-05-28

## 用户发布说明（简体中文）

邸报 v0.1.0 是首次公开发布版本。它提供一个可用 Docker 自托管的单用户 RSS 阅读器：你可以导入 OPML、管理订阅源和分组、阅读最新文章、使用收藏/稍后读/已读/不感兴趣等动作，并在自己的 RSS 信源内部获得可解释的个性化推荐。

本版本支持基础排序、OpenAI-compatible / Ollama embedding provider、sqlite-vec 向量索引、推荐状态诊断、后台刷新、搜索、PWA 应用壳、健康检查、备份和升级说明。首次安装不需要历史迁移；请使用 `ghcr.io/pls-1q43/dibao:v0.1.0`，并把 `/data` 挂载到持久化目录。升级前请备份 SQLite 数据库或 Docker volume。

已知限制：当前仅支持单用户自托管，没有官方托管服务、多用户协作、云同步、OAuth/密码找回、完整离线文章库或原生移动/桌面应用。推荐质量仍处于 MVP 阶段，效果取决于阅读反馈和 embedding 覆盖率。

## ユーザー向けリリースノート（日本語）

Dibao v0.1.0 は最初の公開 MVP リリースです。Docker でセルフホストできる単一ユーザー向け RSS リーダーとして、OPML のインポート、フィードとフォルダー管理、最新記事の閲覧、保存・あとで読む・既読・興味なしなどの操作、自分の RSS 購読内だけで動く説明可能なパーソナル推薦を提供します。

このリリースには、基本ランキング、OpenAI-compatible / Ollama embedding provider、sqlite-vec ベクターインデックス、推薦状態の診断、バックグラウンド更新、検索、PWA アプリシェル、ヘルスチェック、バックアップとアップグレード手順が含まれます。初回リリースのため、以前の公開版からの移行はありません。インストールには `ghcr.io/pls-1q43/dibao:v0.1.0` を使い、`/data` を永続ディレクトリにマウントしてください。アップグレード前には SQLite データベースまたは Docker volume をバックアップしてください。

既知の制限: 現在は単一ユーザーのセルフホストのみで、公式ホスティング、複数ユーザー、クラウド同期、OAuth / パスワード復旧、完全なオフライン記事保存、ネイティブアプリはありません。推薦品質は MVP 段階で、読書フィードバックと embedding カバレッジに依存します。

## User Release Notes (English)

Dibao v0.1.0 is the first public MVP release. It provides a Docker self-hostable, single-user RSS reader with OPML import, feed and folder management, latest article reading, article actions, and explainable personalized recommendations that only rank content from the user's own RSS subscriptions.

This release includes baseline ranking, OpenAI-compatible and Ollama embedding providers, sqlite-vec vector indexes, recommendation diagnostics, background refresh, search, a PWA app shell, health checks, and backup/upgrade documentation. Because this is the first public release, there is no previous public release migration path. Install with `ghcr.io/pls-1q43/dibao:v0.1.0` and mount `/data` to persistent storage. Back up the SQLite database or Docker volume before future upgrades.

Known limitations: Dibao is currently single-user and self-hosted only. There is no hosted service, multi-user collaboration, cloud sync, OAuth/password recovery, full offline article library, or native mobile/desktop app. Recommendation quality is MVP-stage and depends on user feedback and embedding coverage.

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
- Outbound RSS and full-content fetching now has request timeouts and response size limits. Local/private targets are logged as warnings but remain allowed for self-hosted LAN feeds.
- Login now rate-limits repeated failed attempts for the same username/IP combination.
- Bulk mark-read commands store sampled audit evidence instead of every affected article id, keeping large cleanup actions responsive.
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

The v0.1.0 release gate was validated on the release branch before tagging:

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

The E2E and Docker smoke suites use local RSS and embedding fixtures and do not call real external services. The optional Ollama probe is intended for a local Ollama service; for this release the expected local model is `bge-m3` with dimension `1024`.

## Migration List

This is the first public release, so there is no previous public tag to upgrade from. A fresh v0.1.0 database applies these migrations automatically on startup:

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

## Docker Image

The release image is `ghcr.io/pls-1q43/dibao:v0.1.0`. The release workflow also publishes `stable` and `latest` for this first public version.
