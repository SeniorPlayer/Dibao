# 邸报 Dibao Roadmap

Last updated: 2026-05-23

本文是邸报后续多窗口协作的任务来源。它描述当前进度、MVP 剩余事项、阶段拆分、任务优先级、任务类型和验收标准。

邸报的产品边界保持不变：

- 单用户。
- 自托管优先。
- RSS / Atom 信源内排序。
- 本地数据自控。
- 不做多用户、官方托管、社交分发或平台外内容推荐。

## Progress Estimate

### MVP Progress

当前 MVP 进度估算：100%。

估算依据：

- 已完成基础工程、数据库、单用户 setup/auth/session、首次设置向导、RSS 入库、OPML API、Web OPML UI、feed folder 展示筛选、feed 管理 UI、后台刷新 job、文章保留清理、设置页、OpenAI-compatible / Ollama embedding provider、embedding job pipeline、sqlite-vec 生产写入/重建、文章列表分页、基础 Web 阅读器、文章动作、Reader Command 清账、baseline ranking、推荐解释和 i18n foundation。
- 已完成让普通自托管用户可用的关键闭环：Docker 打包、Docker Compose 自托管路径、E2E smoke 和 README 用户文档。
- 当前系统已达到第一批自托管用户 MVP 发布标准；后续重点转向移动端打磨、推荐解释/迁移增强和更完整的应用打包路线。
- 后续执行节奏调整为更大的开发包，每轮目标推进约 15 个百分点；单轮任务会合并强相关的后端、前端、测试和文档工作。

### Vision Progress

完整愿景进度估算：约 10-15%。

估算依据：

- 产品核心差异化不是 RSS 阅读器本身，而是“只在我的关注源内，长期学习我的偏好并排序”。
- baseline ranking 已完成第一层排序，但 embedding、用户画像、兴趣簇、增量更新、解释 v1 和长期反馈闭环还未产品化。
- PWA foundation 已完成；离线全文阅读、桌面打包、原生壳、导入迁移、部署升级、备份恢复等长期可用性工作还未开始。

## Status Legend

- Done: 已完成并进入 main。
- In Progress: 已有部分实现，但还未达到该任务验收标准。
- Todo: 尚未开始。
- Blocked: 依赖其他任务或外部决策。

## Priority Legend

- P0: MVP 必须完成。
- P1: 强烈建议在第一批试用前完成，或 MVP 后紧接着做。
- P2: 可延后到后续版本。

## Type Legend

- product: 产品定义、范围、验收标准。
- design: 信息架构、交互、视觉、设计 token。
- frontend: Web / PWA / 客户端界面。
- backend: API、服务、业务逻辑。
- infra: 部署、打包、配置、运行环境。
- algorithm: 推荐、embedding、画像、排序、解释。
- test: 单元、集成、E2E、回归验证。
- docs: 用户文档、开发文档、运维文档。

## Current Completed Work

| ID | Status | Priority | Type | Task | Acceptance Criteria |
| --- | --- | --- | --- | --- | --- |
| C-01 | Done | P0 | product/docs | MVP PRD | `docs/mvp-prd.md` 描述目标用户、非目标、核心流程、页面清单和成功标准。 |
| C-02 | Done | P0 | backend/infra/docs | Engineering blueprint | `docs/engineering-blueprint.md` 描述 monorepo、server、web、db、jobs、provider 和测试策略。 |
| C-03 | Done | P0 | backend/docs | Database schema | `docs/database-schema.md` 覆盖 feeds、articles、states、rank scores、embeddings、settings 等核心表。 |
| C-04 | Done | P0 | backend/frontend/docs | API contract | `docs/api-contract.md` 定义 MVP HTTP API 合约和通用错误格式。 |
| C-05 | Done | P0 | design/docs | Low-fidelity wireframes | `docs/wireframes.md` 覆盖核心页面和信息布局。 |
| C-06 | Done | P0 | design/frontend/docs | Design tokens v0 | `docs/design-tokens.md` 定义基础颜色、字体、间距、控件、阅读参数。 |
| C-07 | Done | P0 | algorithm/docs | Profile Algorithm v0 参数表 | `docs/profile-algorithm-v0.md` 定义画像、兴趣簇、行为权重和更新参数。 |
| C-08 | Done | P0 | infra | npm workspaces scaffold | repo 使用 npm workspaces 管理 `apps/*` 和 `packages/*`，基础 scripts 可运行。 |
| C-09 | Done | P0 | backend/infra/test | SQLite + sqlite-vec Node.js spike | `npm run spike:sqlite-vec` 可加载 sqlite-vec、写入向量、执行 KNN、重建 vec0 index。 |
| C-10 | Done | P0 | backend/frontend/test | Feed/article API vertical slice | 可添加 feed、刷新 feed、写入文章、读取 latest articles 和 article detail。 |
| C-11 | Done | P0 | frontend/design | Web three-column reader shell | Web 端具备订阅源区、文章列表区、文章详情区，并有 loading、empty、error 状态。 |
| C-12 | Done | P0 | frontend/backend/test | Article actions | 收藏、稍后读、已读/未读、不感兴趣动作可写入后端并同步 Web 状态。 |
| C-13 | Done | P0 | algorithm/backend/test | Baseline ranking | `recommended` 可按 `article_rank_scores(base)` 排序，action 后可重算当前文章。 |
| C-14 | Done | P1 | algorithm/frontend/backend/test | Recommendation explanations baseline | 后端提供 `GET /api/articles/:id/explanation`，Web 展示“为什么推荐”。 |
| C-15 | Done | P0 | frontend/test | Web i18n foundation | Web 用户可见主要文案接入 typed dictionary，默认 `zh-CN`，补 `en-US`。 |
| C-16 | Done | P0 | backend/test/docs | OPML import/export API | 后端可导入 OPML、导出 OPML、跳过重复 feedUrl，不触发 RSS refresh。 |
| C-17 | Done | P0 | frontend/backend/test | Web OPML, folders, and pagination | Web 端可导入/导出 OPML、按 folder/feed 筛选、使用 cursor 加载更多。 |
| C-18 | Done | P0 | backend/frontend/test | Single-user auth foundation | 首次 setup、login、logout、session cookie 和受保护 API 可用，Web 有最小 auth gate。 |
| C-19 | Done | P0 | frontend/backend/test | First-run setup wizard | 空库可完成欢迎、设置密码、导入/添加订阅源、provider 占位跳过并进入 reader。 |
| C-20 | Done | P0 | frontend/backend/test | Feed management UI | Web 端可创建/重命名/删除 folders，编辑/软删除 feeds，调整分组、启用状态和 `sourceWeight`，并在操作后刷新 source/article 状态。 |
| C-21 | Done | P0 | backend/infra/frontend/test | Background feed refresh jobs | `POST /api/feeds/refresh` 可为 enabled feeds 入队刷新；内部 job runner 支持重试、stale recovery、失败隔离和 Web “刷新全部”入口。 |
| C-22 | Done | P0 | backend/infra/algorithm/test/docs | Article retention cleanup | 默认永久保留，文章保留策略可通过 setting/env 配置；旧文章 soft delete 并清理正文、FTS、rank 和 vector serving index，同时保留行为与状态数据。 |
| C-23 | Done | P0 | frontend/backend/design/test/docs | Settings page v0 | Web 设置页可配置语言、阅读参数和文章保留天数；Settings API 严格校验并持久化到 `app_settings`；阅读 CSS variables 即时生效。 |
| C-24 | Done | P0 | backend/frontend/algorithm/infra/test/docs | Embedding provider pipeline | OpenAI-compatible 与 Ollama provider 可配置和测试；新文章可入队生成 embedding；向量写入 authority table 和 sqlite-vec index；支持 index rebuild。 |
| C-25 | Done | P0 | algorithm/backend/frontend/test/docs | Profile Algorithm v0 and Ranking v1 | 行为事件可幂等更新兴趣簇和来源统计；`recommended` 可使用 active embedding rank context，并在无 provider/embedding/profile 时 fallback 到 baseline；推荐解释包含兴趣匹配。 |
| C-26 | Done | P0 | infra/docs/test | MVP release hardening | Dockerfile、Compose 自托管路径、匿名 health check、无外网 E2E smoke 和 README 用户文档已完成。 |
| C-27 | Done | P1 | frontend/backend/test/docs | Reader Command bulk read cleanup | `POST /api/reader/commands/mark-scope-read` 可按 latest/recommended 的全部、24h 前、7d 前、30d 前未读债务或 search 当前结果批量标记未读为已读；写入 `reader_command_events`，不写入 `behavior_events`，不进入兴趣画像学习；Web 合并未读 toggle、计数和清账确认控件。 |
| C-28 | Done | P1 | backend/frontend/test/docs | Feed discovery and diagnostics | `POST /api/feeds/discover` 可从网站首页或直接 feed URL 预检候选；Web 添加前展示 title、URL、最近文章和重复状态；`GET /api/feeds/diagnostics` 和订阅源管理页展示健康状态、异常筛选和失败重试。 |
| C-29 | Done | P1 | backend/frontend/algorithm/test/docs | Feed full content control | Feed 默认继续使用 RSS / Atom 内容；订阅源可显式开启网页全文抓取、预览不写库、当前 RSS 回溯只处理当前响应前 50 篇。成功更新有效正文和 `content_hash` 并触发 embedding/ranking；失败保留 Feed 内容；回溯不写 `behavior_events`，不作为用户偏好信号。 |

## MVP Remaining Work

MVP 剩余事项按交付优先级排序。P0 是发布第一批自托管试用前必须补齐的闭环。

| ID | Status | Priority | Type | Task | Acceptance Criteria |
| --- | --- | --- | --- | --- | --- |
| R-01 | Done | P0 | frontend/backend/test | Web OPML import/export UI | Web 端可选择 `.opml` / `.xml` 文件导入；导入成功后刷新 feed list；展示 created/skipped/errors；可导出 `dibao-subscriptions.opml`；文案接入 i18n；测试覆盖 API client 和关键 UI。 |
| R-02 | Done | P0 | backend/frontend/test | Single-user setup/auth/session | 首次启动可设置访问密码；登录后使用 httpOnly session cookie；未登录不能访问受保护 API；测试覆盖 setup/login/logout/session。 |
| R-03 | Done | P0 | frontend/design/test | First-run setup wizard | 首次访问进入设置向导；完成密码设置、OPML 导入或手动添加 feed、provider 选择或跳过；完成后进入阅读器；移动端可用。 |
| R-04 | Done | P0 | backend/frontend/test | Feed management minimal UI | 用户可查看 feeds/folders、添加 feed、编辑名称、移动分组、启用/禁用、软删除、查看 lastError；操作后列表一致刷新。 |
| R-05 | Done | P0 | backend/infra/test | Refresh all and background refresh | 提供手动刷新全部 API；支持定时刷新启用 feeds；记录抓取成功/失败状态；失败不会阻塞其他 feed；测试使用 fixture fetcher，不依赖外网。 |
| R-06 | Done | P0 | backend/infra/test | Job runner foundation | 后台任务具备可启动、可停止、可串行执行、可记录错误的最小框架；可承载 feed refresh 和 embedding jobs；测试覆盖任务失败和重试边界。 |
| R-07 | Done | P0 | backend/test | Article retention policy | 可配置保留天数，默认可设为 60 天；清理过期文章时保留必要行为/画像统计；软删和硬删规则写入文档并有测试。 |
| R-08 | Done | P0 | backend/frontend/algorithm/test | Embedding provider configuration | 本轮支持 OpenAI-compatible endpoint 与 Ollama；可保存、启用/停用、测试连接、展示最近错误；custom HTTP/embedded local 是后续 adapter 扩展。 |
| R-09 | Done | P0 | algorithm/backend/infra/test | Embedding job pipeline | 新文章进入待 embedding 队列；worker 每批最多 16 篇调用 provider；失败可重试；结果写入 authority table；不阻塞 RSS refresh 和阅读。 |
| R-10 | Done | P0 | algorithm/backend/test | sqlite-vec production adapter | 文章向量可写入、查询、重建；维度不匹配会返回明确错误；支持从 BLOB authority table 重建 vec0 index；ranking fusion 留到 R-12/M3-06。 |
| R-11 | Done | P0 | algorithm/backend/test | Profile Algorithm v0 implementation | 行为事件按参数表更新用户画像/兴趣簇；支持幂等事件处理；文章删除不破坏画像统计；测试覆盖正向、负向、衰减和边界行为。 |
| R-12 | Done | P0 | algorithm/backend/test | Recommendation ranking v1 | 推荐分融合 baseline、embedding similarity、source weight、state、freshness、penalty；无 embedding 时 fallback 到 baseline；排序稳定且可解释。 |
| R-13 | Done | P0 | frontend/backend/test | Settings page v0 | 用户可配置语言、阅读字号、行高、段距、阅读宽度、数据保留天数、embedding provider；设置持久化并即时影响 UI。 |
| R-14 | Done | P0 | infra/docs/test | Docker packaging | 提供 Dockerfile / compose 示例；数据目录可挂载；健康检查可用；README 描述部署、升级、备份、恢复；本地构建验证通过。 |
| R-15 | Done | P0 | test | MVP E2E smoke suite | 覆盖首次设置、OPML 导入、手动刷新、打开文章、收藏/稍后读/不感兴趣、推荐解释、provider 跳过或测试连接；桌面和移动视口至少各一条主流程。 |
| R-16 | Done | P1 | frontend/backend/test | Search UI with FTS | 用户可搜索文章标题/摘要/正文；支持 feed/folder/state/time 筛选；支持相关性、推荐优先、最新排序；空状态和错误状态可用；搜索不影响推荐流状态。 |
| R-17 | Todo | P1 | frontend/design/test | Mobile web layout hardening | 手机浏览器中订阅源、列表、阅读器、设置页可完成主流程；按钮和状态文案不溢出；关键视口截图验证。 |
| R-18 | Done | P1 | frontend/infra/test | PWA foundation | 提供 manifest、图标、基础 service worker 和离线 app shell；可添加到主屏；不承诺离线全文阅读。 |
| R-19 | Done | P1 | backend/frontend/test/docs | Feed refresh diagnostics and add preflight | 每个 feed 展示 lastFetchedAt、lastSuccessAt、lastError、健康状态和手动重试入口；添加前可从网站首页发现候选 RSS / Atom，预览最近文章，识别重复订阅；测试和 API 文档覆盖。 |
| R-20 | Done | P1 | docs | User documentation v0 | README 覆盖安装、首次设置、OPML、provider、备份、升级、常见问题；非开发者可按步骤完成部署。 |
| R-21 | Done | P1 | frontend/backend/test/docs | Unread debt cleanup | latest/recommended 支持全部、24h 前、7d 前、30d 前清账，search 支持当前结果清账；清账是 Reader Command，不是 Behavior Event，不作为推荐正反馈；只支持批量已读，不支持批量删除/收藏/不感兴趣。 |

## M0: Foundation And Decisions

目标：完成产品、工程、设计、算法的基础决策，并建立可持续开发的 monorepo。

当前状态：Done。

| ID | Status | Priority | Type | Task | Acceptance Criteria |
| --- | --- | --- | --- | --- | --- |
| M0-01 | Done | P0 | product/docs | Product scope freeze for MVP | 明确单用户、自托管、RSS 信源内排序、无官方托管、无多用户。 |
| M0-02 | Done | P0 | product/docs | MVP PRD | PRD 覆盖用户、流程、页面、成功标准和非目标。 |
| M0-03 | Done | P0 | backend/infra/docs | Engineering blueprint | 技术栈、模块边界、部署方向、测试策略清晰。 |
| M0-04 | Done | P0 | backend/docs | Database schema v0 | SQLite schema 能支持 feeds、articles、states、rank scores、embeddings 和 settings。 |
| M0-05 | Done | P0 | backend/frontend/docs | API contract v0 | HTTP API 合约可指导前后端并行开发。 |
| M0-06 | Done | P0 | design/docs | Wireframes v0 | 低保真线框覆盖主要阅读和管理页面。 |
| M0-07 | Done | P0 | design/frontend/docs | Design tokens v0 | 视觉、阅读参数和控件基础 token 可指导 Web 实现。 |
| M0-08 | Done | P0 | algorithm/docs | Profile Algorithm v0 parameters | 行为权重、兴趣簇、衰减、更新边界有参数依据。 |
| M0-09 | Done | P0 | infra/test | Monorepo scaffold | `npm run typecheck`、`npm test`、`npm run build` 可按 workspace 执行。 |
| M0-10 | Done | P0 | backend/infra/test | sqlite-vec feasibility | 本地 Node.js 可加载 sqlite-vec 并完成最小向量查询。 |

## M1: Baseline Reader Vertical Slice

目标：在没有 embedding 的情况下，形成一个可运行的 RSS 阅读器纵切，证明数据流、阅读流、行为流和基础排序流成立。

当前状态：In Progress，核心后端和基础 Web 已完成，用户可用性 UI 还不足。

| ID | Status | Priority | Type | Task | Acceptance Criteria |
| --- | --- | --- | --- | --- | --- |
| M1-01 | Done | P0 | backend/test | SQLite migrations and repositories | 数据库可迁移；核心 repository 有测试；schema 与文档基本一致。 |
| M1-02 | Done | P0 | backend/test | RSS / Atom parser and feed refresh | 可添加 feed、抓取 fixture RSS/Atom、写入 articles、避免重复文章。 |
| M1-03 | Done | P0 | backend/frontend/test | Feed and article API | Web 可通过 API 读取 feeds、latest articles、article detail。 |
| M1-04 | Done | P0 | frontend/design | Three-column reader UI | 基础阅读界面可添加 feed、刷新、选文章、读详情。 |
| M1-05 | Done | P0 | backend/frontend/test | Article actions | 用户行为可写入 DB，并影响列表和详情状态。 |
| M1-06 | Done | P0 | algorithm/backend/test | Baseline ranking | 推荐列表可使用基础分排序，action 后重算当前文章。 |
| M1-07 | Done | P1 | algorithm/frontend/backend/test | Baseline recommendation explanation | 推荐解释 API 和 Web 展示可用，fallback 合理。 |
| M1-08 | Done | P0 | backend/test/docs | OPML API | 后端支持 OPML 导入/导出，导入不触发 refresh。 |
| M1-09 | Done | P0 | frontend/backend/test | OPML Web UI | 用户可在 Web 中导入/导出 OPML，不需要 API 工具。 |
| M1-10 | Done | P1 | frontend/backend/test | Feed folders visible in reader | 已导入分组可在 Web 中显示；可按 folder 筛选 articles。 |
| M1-11 | Done | P1 | frontend/test | Article list pagination UI | latest/recommended 列表可加载更多；cursor 状态稳定；空状态和错误状态清晰。 |
| M1-12 | Todo | P1 | frontend/test | Read progress capture | 阅读页滚动进度可节流记录为 `read_progress`；不会频繁写入。 |

## M2: Self-Hosted MVP Usability

目标：把当前纵切补成第一批自托管用户可以部署、配置、迁移和日常阅读的 MVP。

当前状态：Done。单用户 auth、首次设置向导、feed 管理闭环、后台刷新、数据保留、设置页、Docker、E2E 和用户文档均已完成。

| ID | Status | Priority | Type | Task | Acceptance Criteria |
| --- | --- | --- | --- | --- | --- |
| M2-01 | Done | P0 | backend/frontend/test | Single-user auth | 首次设置密码；登录/退出/session 可用；受保护 API 未登录返回 `UNAUTHORIZED`。 |
| M2-02 | Done | P0 | frontend/design/test | First-run setup wizard | 用户从空库启动能完成密码、订阅源、provider 跳过或配置，并进入主界面。 |
| M2-03 | Done | P0 | frontend/backend/test | Feed management UI | feed/folder 的新增、编辑、禁用、删除、移动分组和错误查看可用。 |
| M2-04 | Done | P0 | backend/infra/test | Background refresh | 启用 feeds 可定时刷新；手动刷新全部可用；失败隔离并记录错误。 |
| M2-05 | Done | P0 | backend/test/docs | Data retention | 默认保留策略可配置；清理文章时行为数据和画像统计处理规则明确。 |
| M2-06 | Done | P0 | frontend/design/test | Settings page v0 | 阅读设置、语言、数据保留、provider 设置集中管理。 |
| M2-07 | Done | P0 | infra/docs/test | Docker release path | 用户能用 Docker Compose 启动；数据卷、端口、环境变量、健康检查明确。 |
| M2-08 | Done | P0 | test | E2E MVP smoke | 自动化覆盖部署后主要 Web 流程，不依赖外网。 |
| M2-09 | Done | P1 | frontend/backend/test | Search v0 | SQLite FTS + CJK LIKE fallback 可通过 UI 使用，支持来源、分组、状态、时间筛选，以及相关性、推荐优先、最新排序。 |
| M2-10 | Todo | P1 | frontend/design/test | Mobile browser polish | 手机宽度下主阅读流程可用，布局无明显溢出。 |
| M2-11 | Done | P1 | frontend/infra/test | PWA foundation | 可安装到主屏，有基础 manifest、图标、service worker、离线 app shell 和更新提示；不缓存 `/api/*` 私人数据。 |
| M2-12 | Done | P1 | docs | User docs v0 | README 让目标用户可以部署、导入 OPML、配置 provider、备份和升级。 |

## M3: Personalization MVP

目标：实现邸报与传统 RSS 阅读器的核心差异：基于本地行为和 embedding 的个人化排序。

当前状态：In Progress。OpenAI-compatible / Ollama provider、embedding queue、sqlite-vec 写入/重建、Profile Algorithm v0 和 Ranking v1 已完成；Explanation v1 的更完整解释、重建迁移和多样性仍待后续。

| ID | Status | Priority | Type | Task | Acceptance Criteria |
| --- | --- | --- | --- | --- | --- |
| M3-01 | Done | P0 | backend/frontend/algorithm/test | Embedding provider settings | OpenAI-compatible 与 Ollama provider 可端到端配置和连接测试；custom HTTP/embedded local 后续扩展。 |
| M3-02 | Done | P0 | algorithm/backend/test | Provider adapter interface | provider 统一输入输出、错误格式、维度校验、批量限制 16 和超时策略；OpenAI-compatible 与 Ollama 已启用。 |
| M3-03 | Done | P0 | algorithm/backend/infra/test | Embedding queue and worker | 新文章进入队列；worker 串行批处理；失败重试；index 列表可观察 pending/failed 计数。 |
| M3-04 | Done | P0 | algorithm/backend/test | sqlite-vec index integration | embedding 写入 authority table 和 vec0 index；支持 rebuild；KNN 查询能力可用，接入推荐排序留到 M3-06。 |
| M3-05 | Done | P0 | algorithm/backend/test | User profile clusters v0 | 用户行为按兴趣簇模型形成画像；正负反馈、幂等处理和衰减有测试。 |
| M3-06 | Done | P0 | algorithm/backend/test | Ranking v1 fusion | baseline + vector similarity + profile + penalties 融合排序；无 embedding 时 graceful fallback。 |
| M3-07 | Todo | P1 | algorithm/frontend/backend/test | Explanation v1 | 推荐解释能展示兴趣匹配、来源、新鲜度、负反馈、fallback，不暴露内部难懂参数。 |
| M3-08 | Todo | P1 | algorithm/backend/test | Reindex and model migration | 更换模型或维度时提示重建；旧 index 不污染新 index；失败可恢复。 |
| M3-09 | Todo | P1 | test/algorithm | Recommendation evaluation fixtures | 用固定 fixture 验证排序变化，避免算法改动无意回退。 |
| M3-10 | Todo | P2 | algorithm/backend/test | Diversity and duplicate penalties | 同源、近重复、主题过密有惩罚或多样性控制。 |
| M3-11 | Todo | P2 | frontend/infra/test | Desktop/mobile app packaging research | 比较 PWA、Capacitor、Tauri/Electron 路线，形成决策文档和最小 spike。 |

## Suggested Execution Order

短期建议不要并行太多核心写入任务。推荐顺序如下：

1. `R-17`: Mobile browser polish。
2. `M3-07 / M3-08 / M3-10`: Explanation v1, reindex/model migration, and diversity/duplicate penalties。
3. `M3-11`: Desktop/mobile app packaging research。

## Multi-Window Collaboration Guide

使用多窗口时，建议固定以下角色：

- 总控窗口：维护 roadmap、验收提交、决定下一步任务、合并和推送 main。
- 开发窗口：实现 backend/frontend/infra/algorithm 任务。
- 设计窗口：实现或细化 design/frontend 交互和视觉任务。
- 测试窗口：补 E2E、回归测试、移动端截图和验收脚本。

派发任务时，应包含：

- 当前 main commit。
- Roadmap task ID。
- 任务范围。
- 明确不做的事项。
- 验收标准。
- 必跑验证命令。
- 汇报格式。

标准汇报格式：

```text
已完成并提交。

Commit:
<hash>
<subject>

改动摘要:
- ...

验证结果:
- npm run typecheck 通过
- npm test 通过
- npm run build 通过
- npm run spike:sqlite-vec 通过
- git diff --check 通过

已知边界:
- ...
```

## Definition Of MVP Done

MVP 完成必须同时满足：

- P0 tasks in `MVP Remaining Work` 全部 Done。
- Docker 部署路径可由目标用户按 README 完成。
- 空库首次设置流程完整。
- OPML 导入后可刷新并阅读文章。
- 至少一种 embedding provider 可端到端工作。
- 无 provider 时系统仍可用 baseline ranking。
- 推荐排序会随用户行为产生可感知变化。
- 推荐解释不依赖英文后端 label 作为最终 UI 文案。
- 桌面和手机浏览器主流程通过 E2E smoke。
- 用户可导出 OPML。
