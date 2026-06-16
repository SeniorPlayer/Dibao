# Runtime Performance Guidelines

Last updated: 2026-06-16

本文记录邸报目前已经做过的运行时性能优化，以及后续开发后台任务、推荐算法、插件 Hook、诊断接口和 SQLite 写入路径时应优先参考的设计原则。目标不是追求单点极限吞吐，而是保证自托管小机器、NAS 和单 SQLite 数据库环境下，用户正在阅读、登录、点击文章或调整设置时，后台维护不会把前台体验拖成偶发 500、长时间等待或 UI 卡死。

## 基本原则

- 前台交互优先。文章打开、文章状态动作、登录、会话检查、阅读滚动、订阅源管理和设置保存都属于热路径。热路径只能同步完成当前请求必须的最小读写。
- 后台任务必须可暂停、可分块、可重试。推荐重算、embedding、向量索引、画像维护、诊断扫描、插件任务和清理任务都不能假设可以一次性跑完。
- SQLite 只有一个写入者。任何长事务、批量 upsert、全量扫描后写回，都会和登录/session、文章动作、job 状态更新竞争写锁。
- 诊断和解释性功能默认是冷路径。只有用户显式进入算法、维护或诊断页面时，才允许读取较重的数据；普通状态接口不能顺手重算透明度、聚类证据或全局相似度。
- 先记录证据，再调参数。优化前优先看 live logs、job duration、chunk duration、请求状态码和 SQLite busy 位置，区分真正慢的 endpoint 和被 Node event loop 或 SQLite 写锁连带拖慢的 endpoint。

## 当前已实现的保护

### 独立 worker 和启动静默期

Docker 默认由 Web 进程服务用户请求，独立 worker 进程执行后台任务。worker 启动时会等待 Core migration 就绪，并默认使用 `DIBAO_FOREGROUND_QUIET_WINDOW_MS` / `DIBAO_BACKGROUND_STARTUP_DELAY_MS` 延迟后台工作，避免容器刚启动、浏览器刚恢复会话时立刻抢 SQLite 写锁。

相关入口：

- `apps/server/src/container-entrypoint.ts`
- `apps/server/src/index.ts`
- `apps/server/src/worker.ts`
- `DIBAO_BACKGROUND_JOBS`
- `DIBAO_JOB_RUNNER_MAX_JOBS_PER_DRAIN`
- `DIBAO_FOREGROUND_QUIET_WINDOW_MS`
- `DIBAO_BACKGROUND_STARTUP_DELAY_MS`

### 前台活动信号和 quiet window

Web 进程会把用户前台活动写入 `foreground-activity.json`。活动包括静态应用资源、文章、reader、recommendation、feeds、plugins、settings，以及认证相关路径 `/api/auth/session`、`/api/auth/login`、`/api/auth/setup`、`/api/auth/password`。

worker 在运行可延后的任务前会读取该信号。如果仍在 quiet window 内，`JobRunner.beforeRun` 会把任务 defer 到窗口结束，而不是立刻执行。这样用户正在打开页面或登录时，feed refresh、embedding、profile event、ranking recalculation、retention cleanup、vector rebuild、推荐维护和相关插件任务不会抢占前台体验。

相关实现：

- `apps/server/src/foreground-activity.ts`
- `recordForegroundApiActivity` in `apps/server/src/app.ts`
- `isForegroundActivityRoute` in `apps/server/src/app.ts`
- `isForegroundDeferrableJobType` in `apps/server/src/app.ts`
- `JobRunner.beforeRun` in `apps/server/src/job-runner.ts`

### JobRunner drain 上限和事件循环让步

`JobRunner.drainDue()` 每轮最多处理 `maxJobsPerDrain` 个 due jobs，Docker worker 默认 `5`。每完成一个 job 会 `setImmediate` 让出事件循环，避免单轮 drain 无限吞掉 CPU 和 Node event loop。

如果插件 job handler 不可用，插件 job 会 defer，而不是永久失败；如果 job handler 抛出 `DeferredJobRun`，job 会按指定时间继续。普通临时错误走 retry delay，永久错误才终止。

相关实现：

- `apps/server/src/job-runner.ts`
- `DIBAO_JOB_RUNNER_MAX_JOBS_PER_DRAIN`

### 后台写入串行化和性能日志

`BackgroundWriteCoordinator` 把后台写入串成 promise chain，并记录 `job.performance` 日志。它不能消除 SQLite 单写入者限制，但可以避免多个后台写任务在同一进程里并发争锁，并给后续调参留下 duration 证据。

相关实现：

- `apps/server/src/background-write-coordinator.ts`
- `jobs.backgroundWrite` log route

### 推荐重算分块、自适应和暂停

全量 `ranking_recalculate` 不再一次性扫完整库。当前机制是：

- 默认 chunk size 为 `10`，最大 `200`，每个全量 chunk 之间默认延迟 `5s`。
- 目标 chunk 时间预算为 `500ms`。
- 如果 chunk 明显超过预算，下一个 chunk limit 会缩小；如果远低于预算，会逐步放大。
- ranking service 在候选查询、聚类向量、recent intent、lexical/duplicate/source features 和逐篇打分阶段检查时间预算。
- 如果前台活动恢复，或者时间预算耗尽，chunk 会在安全 cursor 处暂停，返回 `pauseReason: "foreground"` 或 `"time_budget"`，再由 job service 重新入队。
- 如果 foreground 在写回前出现，已有测试覆盖“不提交、不推进 cursor”的场景，避免半批数据落库后和旧 rank context 混用。

相关实现：

- `apps/server/src/ranking-job-service.ts`
- `apps/server/src/ranking-service.ts`
- `RANKING_RECALCULATE_TARGET_CHUNK_MS`
- `DIBAO_RANKING_TARGET_CHUNK_MS`

### 登录和 session 对 SQLite busy 的降级

2026-06-16 的 Synology 测试实例问题显示：后台 `ranking_recalculate` 长时间写锁会让 `POST /api/auth/login` 在 `SessionRepository.createSession` 上抛 `SQLITE_BUSY`，最终表现为 Internal server error。修复后的策略：

- `authenticate()` 不再每次 session check 都写 `last_seen_at`，默认 5 分钟内只读不写。
- `touchSession()` 遇到 `SQLITE_BUSY` 时记录 warn，但不让已有有效 session 认证失败。
- `createSession()` 遇到短暂 `SQLITE_BUSY` 会按 `[50, 150, 350]ms` 重试。
- 重试后仍 busy 时，认证服务返回 `503 DATABASE_BUSY`，带 `Retry-After: 5` 和 `{ retryAfterMs: 5000 }`，前端显示“系统正在处理后台维护，请稍后重试”，而不是泛化为 500。
- 全局 error handler 也会把未捕获的 `SQLITE_BUSY` 映射为同样的 `503 DATABASE_BUSY`。

相关实现：

- `apps/server/src/auth-service.ts`
- `apps/server/src/sqlite-errors.ts`
- `sendDatabaseBusyError` in `apps/server/src/app.ts`
- `apps/web/src/api.ts`
- `apps/web/src/i18n.tsx`

### 热路径只写最小事实

文章动作、reader 状态和登录/session 类路径应只同步写入“事实”：当前 action/event/session 状态。画像处理、推荐排序、embedding、解释生成、诊断扫描和插件后续工作必须入队或延后。

已有插件 Hook 规则也遵守这个边界：热路径只允许 `observe` 或 post-commit `effect`，插件不得在 article open/action/scroll 路径同步跑 ranking recalculation、embedding generation、index rebuild、网络调用、广域诊断或长任务。

相关文档：

- `docs/plugin-system-design.md`

### 解释和诊断走显式冷路径

推荐解释、聚类标签证据、merge diagnostics、full cluster diagnostics 和向量相似度扫描不属于普通 reader/status 请求。普通页面应读取已持久化、范围有界、cluster-local 的证据；全量诊断放在算法/维护页面，并且要有分页、limit 或 job 化。

`app.ts` 里已有 article explanation cache，用 active rank context + article id 做短期缓存，减少重复 explain 的同步成本。

### SQL/schema 层的读路径优化

推荐排序和解释的权威数据已经落在 SQLite 表里，而不是每次列表请求临时重算：

- `article_rank_scores` 保存 base score、semantic score、BM25、penalty、rerank score、rerank position、rank context 等排序结果。
- `article_rank_explanations` 保存对应的解释 payload，解释接口优先读持久化证据。
- migration `025_recommended_rank_sort_index` 增加 `idx_article_rank_scores_context_recommended_order`，按 `rank_context`、`score desc`、`rerank_position` 和 `article_id` 支撑推荐列表排序。
- 早期 migration 已有 `idx_article_rank_scores_context_score`、`idx_article_rank_scores_context_position`、`idx_article_rank_scores_context_calculated` 等索引，避免推荐列表、诊断和过期判断走全表扫描。

查询设计原则：

- 热列表读取应该 join 已持久化的 score/explanation/status，不在请求时跑完整 ranking pipeline。
- 搜索和文本存在性检查优先使用 FTS、title、summary 或已计算字段。只有兜底时才用有界 `substr(content_text, 1, N)`，不要在热路径拼接或扫描全文。
- 新增排序/筛选维度时，如果会进入首页、推荐列表或 reader 邻近查询，需要同时检查 query plan 和索引设计。

## 设计新功能时的 checklist

新功能只要满足任一条件，就必须按后台/冷路径设计：

- 可能扫描大量 articles、feeds、embeddings、rank scores、article bodies 或 plugin records。
- 可能写入多行、多表、rank context、embedding/vector index、profile、diagnostics 或 job 状态。
- 可能调用外部网络、LLM、embedding provider、RSS 抓取、插件 webhook 或本地 Ollama。
- 可能在 Synology/NAS/低配 VPS 上持续超过 100-300ms。
- 可能被文章打开、文章动作、登录、session check、reader scroll 或首页加载触发。

推荐做法：

- 同步请求只验证输入、写入最小事实、返回新状态或 job id。
- 后续计算用 `jobs` 表入队，支持 retry、defer、permanent failure。
- 全量任务按 cursor 分块，保存进度，设置时间预算和 resume delay。
- 进入写回前再次检查 foreground quiet window；如果前台活动恢复，暂停而不是硬写。
- 每个 chunk 记录 duration、processed、limit、nextLimit、pauseReason 和 resumeAfter。
- 不在热路径里拼接或扫描全文。先查 title/summary，需要兜底时用有界 `substr(content_text, 1, N)`。
- 冷路径接口必须有 limit、pagination 或 job 化；不要把“诊断详情”塞进普通状态接口。
- 对 SQLite busy 做语义化处理：短重试可以接受；仍失败时返回可重试错误和 `Retry-After`，不要让用户看到 Internal server error。

## Live-log 诊断方法

遇到“偶尔慢”“偶尔 500”“登录失败”“点文章卡住”时，优先看这些证据：

- 失败请求的 route、statusCode、responseTime。
- 是否有 `SQLITE_BUSY` / `database is locked`。
- 同一时间是否有 `jobs.rankingRecalculate.chunk`、`job.performance`、embedding、feed refresh、diagnostics 或 plugin job。
- ranking chunk 的 `durationMs`、`processed`、`limit`、`nextLimit`、`paused`、`pauseReason`。
- worker 是否刚启动，是否仍在 startup delay 或 foreground quiet window。
- Node event loop 是否被长同步 CPU 阻塞：多个无关 endpoint 同时变慢，通常不是单个 SQL 慢，而是同步计算或长事务拖住了进程。

判断顺序：

1. 先确认直接报错点，是请求自己的 SQL，还是被后台写锁连带影响。
2. 再确认后台任务是否应该被 deferrable job gate 拦住。
3. 如果是全量任务，把它拆成 cursor chunk，并加时间预算和 pause/resume。
4. 如果是 session、状态、reader 这类热路径，优先减少同步写入或把写入变成可跳过/可重试。
5. 最后才调大 timeout。timeout 只能掩盖症状，不能解决 SQLite 单写入者和 event loop 阻塞。

## 不要做的事

- 不要在登录、session check、文章打开、文章动作或 reader scroll 中同步触发推荐重算、embedding、向量索引重建、聚类诊断或插件长任务。
- 不要为了展示一个状态 badge 而拉取完整解释、全量 diagnostics 或全文扫描。
- 不要在后台 job 里一次性处理全库并持有长事务。
- 不要让多个后台写任务并发争同一个 SQLite。
- 不要把 SQLite busy 包装成 `INTERNAL_ERROR`。
- 不要在普通升级或后台维护里隐式重算 embedding。embedding 重算涉及成本、quota 和长时间资源占用，必须走用户明确可见的数据升级或可选重建流程。
