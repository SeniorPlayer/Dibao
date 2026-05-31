# 邸报 Dibao 数据库 Schema v0

## 文档目的

本文定义邸报 MVP 的 SQLite 数据库结构、索引、生命周期规则、FTS5 与 sqlite-vec 集成方式。

它是 schema 合约。当前 migration SQL 已落地在：

```text
packages/db/migrations/001_initial_schema.sql
packages/db/migrations/002_article_state_likes.sql
packages/db/migrations/003_profile_event_jobs.sql
packages/db/migrations/004_recommendation_v2.sql
packages/db/migrations/005_recommendation_v2_completion.sql
packages/db/migrations/006_recommendation_maintenance_schedule.sql
packages/db/migrations/007_embedding_usage_and_profile_evidence_snapshots.sql
packages/db/migrations/008_interest_cluster_labels.sql
packages/db/migrations/009_interest_cluster_merge_candidates.sql
packages/db/migrations/011_remove_corpus_topic_snapshots.sql
packages/db/migrations/012_gemini_embedding_provider.sql
packages/db/migrations/013_embedding_provider_limits.sql
packages/db/migrations/014_reader_command_events.sql
packages/db/migrations/015_feed_full_content_mode.sql
```

实现时可以根据具体库和 sqlite-vec 版本调整语法，但不得改变这里定义的数据边界和所有权原则。

## 总体原则

- 数据库默认使用 SQLite。
- 一个部署实例只服务一个用户。
- 数据库文件位于 `/data/dibao.sqlite`。
- 业务表是权威数据源。
- sqlite-vec 只作为可重建向量索引。
- FTS5 只作为可重建全文索引。
- OPML 是唯一承诺的通用迁移格式。
- 用户行为、画像、embedding、排序解释保存在本地数据库中，并通过文档化 schema 保持可读。

## 约定

### ID

业务主键使用 `TEXT`。

推荐生成方式：

```text
ULID / UUIDv7
```

原因：

- 便于调试和日志追踪。
- 不暴露自增规模。
- 适合未来导入、重建、合并数据。

### 时间

时间字段使用 `INTEGER`，存 Unix epoch milliseconds。

字段命名：

```text
created_at
updated_at
published_at
deleted_at
```

### Boolean

SQLite 中 boolean 使用 `INTEGER`：

```text
0 = false
1 = true
```

### JSON

JSON 字段使用 `TEXT` 保存 JSON string，由应用层校验。

字段命名：

```text
*_json
```

### Soft Delete

用户可见主体数据优先使用软删除：

```text
deleted_at INTEGER NULL
```

定期清理任务可以物理删除过期文章正文、embedding 和索引。

### 外键

必须启用：

```sql
PRAGMA foreign_keys = ON;
```

删除策略默认使用：

```text
ON DELETE CASCADE
```

只有需要保留历史摘要的表例外。

## 数据库设置

启动时建议执行：

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

## Schema 版本

### schema_migrations

记录 migration 状态。

```text
version TEXT PRIMARY KEY
name TEXT NOT NULL
applied_at INTEGER NOT NULL
checksum TEXT
```

## 应用设置

### app_settings

保存系统设置、阅读设置、保留策略和首次启动状态。

```text
key TEXT PRIMARY KEY
value_json TEXT NOT NULL
updated_at INTEGER NOT NULL
```

建议 key：

```text
setup.completed
ui.locale
reader.settings
retention.articleDays
retention.settings
ranking.settings
recommendation.clusterLabelLexicon
system.instance_id
```

`GET/PATCH /api/settings` 中的 API 字段 `retention.retentionDays` 映射到
`app_settings.retention.articleDays`。值为 `0` 时表示永久保留普通文章，后台
retention cleanup 会跳过清理。`retention.settings` 预留给后续更完整的保留策略对象。

`recommendation.clusterLabelLexicon` 存储兴趣簇标签词典覆盖项，不是排序设置。更新该 key 后可以 enqueue `interest_cluster_label_rebuild`，但不得触发 `ranking_recalculate`、`embedding_generate`、FTS rebuild 或 vector rebuild。

### auth_credentials

单用户访问凭证。

```text
id TEXT PRIMARY KEY
password_hash TEXT NOT NULL
password_algo TEXT NOT NULL
created_at INTEGER NOT NULL
updated_at INTEGER NOT NULL
```

约束：

- MVP 只允许一条有效记录。
- 不支持多账户。

### sessions

登录 session。

```text
id TEXT PRIMARY KEY
session_hash TEXT NOT NULL UNIQUE
created_at INTEGER NOT NULL
expires_at INTEGER NOT NULL
last_seen_at INTEGER
user_agent TEXT
ip_hash TEXT
```

说明：

- Cookie 中只保存随机 session token。
- 数据库中保存 token hash。
- 过期 session 由清理任务删除。

## 订阅源

### feed_folders

RSS 分组。

```text
id TEXT PRIMARY KEY
title TEXT NOT NULL
sort_order INTEGER NOT NULL DEFAULT 0
created_at INTEGER NOT NULL
updated_at INTEGER NOT NULL
deleted_at INTEGER
```

索引：

```text
idx_feed_folders_sort_order(sort_order)
```

### feeds

RSS / Atom 订阅源。

```text
id TEXT PRIMARY KEY
folder_id TEXT REFERENCES feed_folders(id) ON DELETE SET NULL
title TEXT NOT NULL
site_url TEXT
feed_url TEXT NOT NULL UNIQUE
description TEXT
enabled INTEGER NOT NULL DEFAULT 1
full_content_mode TEXT NOT NULL DEFAULT 'feed_only'
etag TEXT
last_modified TEXT
last_fetched_at INTEGER
last_success_at INTEGER
last_error TEXT
fetch_interval_minutes INTEGER NOT NULL DEFAULT 60
source_weight REAL NOT NULL DEFAULT 0
created_at INTEGER NOT NULL
updated_at INTEGER NOT NULL
deleted_at INTEGER
```

索引：

```text
idx_feeds_folder_id(folder_id)
idx_feeds_enabled(enabled)
idx_feeds_last_fetched_at(last_fetched_at)
idx_feeds_deleted_at(deleted_at)
```

刷新调度约定：

- 不新增调度字段；`nextRefreshAt` 由 repository/API 从现有 `feeds.last_fetched_at`、`feeds.fetch_interval_minutes` 与该 feed 的 `articles.published_at/discovered_at` 推导。
- `fetch_interval_minutes = 60` 的默认 TTL feed 使用 AutoTTL：取最近文章出现间隔的平均值，并夹在默认 TTL 60 分钟与最大 TTL 24 小时之间。
- 非默认 `fetch_interval_minutes` 保持固定间隔，避免对已有显式 TTL 源自动调整。
- `refresh-all` 与后台 scheduler 只为到期 feed enqueue `feed_refresh` job；单 feed 手动刷新不受该推导限制。

说明：

- `source_weight` 是用户或系统沉淀出的来源权重。
- `feed_url` 规范化后唯一。
- `full_content_mode` 可为 `feed_only` 或 `fetch_full_content`。旧 feed 迁移后均为 `feed_only`。默认刷新只使用 RSS / Atom item 内容，不请求文章网页 URL；只有订阅源显式开启 `fetch_full_content` 后才抓取网页全文。

## 文章

### articles

文章元数据。

```text
id TEXT PRIMARY KEY
feed_id TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE
guid TEXT
url TEXT NOT NULL
canonical_url TEXT
title TEXT NOT NULL
author TEXT
summary TEXT
published_at INTEGER
discovered_at INTEGER NOT NULL
content_hash TEXT
dedupe_key TEXT NOT NULL
status TEXT NOT NULL DEFAULT 'active'
created_at INTEGER NOT NULL
updated_at INTEGER NOT NULL
deleted_at INTEGER
```

`status` 可选值：

```text
active
archived
deleted
```

索引：

```text
idx_articles_feed_id(feed_id)
idx_articles_published_at(published_at)
idx_articles_discovered_at(discovered_at)
idx_articles_status(status)
idx_articles_deleted_at(deleted_at)
idx_articles_dedupe_key(dedupe_key)
unique_articles_feed_guid(feed_id, guid)
unique_articles_feed_url(feed_id, canonical_url)
```

说明：

- `dedupe_key` 用于跨源近似去重的第一层规则。
- `canonical_url` 为空时不得触发唯一约束冲突，具体实现可用 partial unique index。
- `content_hash` 表示文章当前“有效正文” hash，不只是 RSS item 原始内容 hash。Feed 内容作为有效正文时 hash source 为 `feed`；网页全文抓取成功后 hash source 为 `full_content`。抓取失败/跳过时仍保留 Feed 内容 hash，错误信息不参与 hash。

### article_contents

文章正文。

```text
article_id TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE
content_html TEXT
content_text TEXT
extraction_status TEXT NOT NULL DEFAULT 'pending'
extraction_error TEXT
extracted_at INTEGER
updated_at INTEGER NOT NULL
```

`extraction_status` 可选值：

```text
pending
feed_only
success
failed
skipped
```

说明：

- 抽取失败时仍可保存 feed 中的摘要或正文片段。
- 旧文章清理时可删除 `content_html` 和 `content_text`。
- `extraction_status = feed_only` 是默认正常路径，不表示失败；`success` 表示正文来自网页全文抓取；`failed` / `skipped` 时当前仍显示 Feed 内容。
- 写入有效正文时同步 FTS。若 `articles.content_hash` 变化，embedding 候选会变为 stale，系统应 enqueue `embedding_generate`；embedding 写入后会触发 ranking recalculation。
- 全文抓取和当前 Feed 回溯属于 content maintenance / corpus update，不属于 Behavior Event、Reader Command 或 User Preference Signal；不得写入 `behavior_events`，不得调用 article action，不得伪造收藏/喜欢/已读/稍后读。

### article_states

用户对文章的当前状态。

```text
article_id TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE
read_at INTEGER
favorited_at INTEGER
liked_at INTEGER
read_later_at INTEGER
hidden_at INTEGER
not_interested_at INTEGER
reading_progress REAL NOT NULL DEFAULT 0
last_opened_at INTEGER
updated_at INTEGER NOT NULL
```

索引：

```text
idx_article_states_read_at(read_at)
idx_article_states_favorited_at(favorited_at)
idx_article_states_liked_at(liked_at)
idx_article_states_read_later_at(read_later_at)
idx_article_states_hidden_at(hidden_at)
idx_article_states_not_interested_at(not_interested_at)
```

说明：

- `reading_progress` 范围为 `0..1`。
- 不感兴趣和隐藏会影响推荐候选。

## 行为事件

### behavior_events

不可变行为日志。

```text
id TEXT PRIMARY KEY
article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE
event_type TEXT NOT NULL
event_weight REAL NOT NULL
metadata_json TEXT
created_at INTEGER NOT NULL
```

`event_type` 可选值：

```text
impression
open
read_progress
read_complete
favorite
unfavorite
like
unlike
read_later
remove_read_later
hide
not_interested
mark_read
mark_unread
quick_bounce
```

索引：

```text
idx_behavior_events_article_id(article_id)
idx_behavior_events_event_type(event_type)
idx_behavior_events_created_at(created_at)
```

说明：

- 行为日志用于更新画像，也用于生成长期行为摘要。
- 旧文章物理删除前，可先将关键统计沉淀到摘要表。

## Reader Commands

### reader_command_events

`014_reader_command_events` 新增。该表记录用户触发的阅读器状态管理命令，是 command audit，不是行为偏好日志。

```text
id TEXT PRIMARY KEY
command_type TEXT NOT NULL
scope_json TEXT NOT NULL
result_json TEXT
created_at INTEGER NOT NULL
```

索引：

```text
idx_reader_command_events_type(command_type)
idx_reader_command_events_created_at(created_at)
```

当前 `command_type`：

```text
mark_scope_read
```

语义：

- `mark_scope_read` 将一个 `article_list` 或 `search` scope 内的未读文章标记为已读；`article_list.clearWindow` 的 `24h` / `7d` / `30d` 表示清理对应时间点之前的未读债务，而不是最近时间窗。
- 它只更新 reader state：`article_states.read_at`、`reading_progress=1`、`updated_at`。
- 它不写入 `behavior_events`，不作为推荐正反馈。
- 它不被 `profile_event_process` 消费，不更新兴趣簇。
- 它可以触发 ranking recalculation，使已读状态影响后续列表排序。
- `scope_json` 保存命令 scope；`result_json` 保存 `markedReadCount` 和必要的 affected article ids。
- 当前批量命令只支持批量已读，不支持批量删除、批量收藏、批量不感兴趣。

### article_behavior_summaries

文章被清理后仍可保留的轻量行为摘要。

```text
article_id TEXT PRIMARY KEY
feed_id TEXT
positive_score REAL NOT NULL DEFAULT 0
negative_score REAL NOT NULL DEFAULT 0
opened_count INTEGER NOT NULL DEFAULT 0
read_complete_count INTEGER NOT NULL DEFAULT 0
favorite_count INTEGER NOT NULL DEFAULT 0
not_interested_count INTEGER NOT NULL DEFAULT 0
first_event_at INTEGER
last_event_at INTEGER
topic_snapshot_json TEXT
```

说明：

- 不强制永远保留。
- 用于解释长期画像来源和来源统计。

## Embedding Provider

### embedding_providers

用户配置的 embedding provider。

```text
id TEXT PRIMARY KEY
type TEXT NOT NULL
name TEXT NOT NULL
base_url TEXT
model TEXT NOT NULL
dimension INTEGER NOT NULL
api_key_encrypted TEXT
enabled INTEGER NOT NULL DEFAULT 0
quality_tier TEXT NOT NULL DEFAULT 'basic'
last_test_status TEXT
last_test_error TEXT
last_test_at INTEGER
created_at INTEGER NOT NULL
updated_at INTEGER NOT NULL
```

`type` 可选值：

```text
embedded_local
ollama
openai_compatible
custom_http
```

当前实现提供 `openai_compatible` 与 `ollama` adapter。`custom_http`、
`embedded_local` 是 schema 预留类型；如果请求启用这些类型，API 层返回
`VALIDATION_ERROR`。

`quality_tier` 可选值：

```text
basic
recommended
best_quality
```

索引：

```text
idx_embedding_providers_enabled(enabled)
idx_embedding_providers_type(type)
```

约束：

- 同一时间只能有一个 active provider 用于新 embedding。
- provider 启用操作必须事务化：先停用其他 provider，再启用当前 provider。
- 当前 schema 通过 `unique_embedding_providers_active where enabled = 1` 固定该约束。
- `api_key_encrypted` 当前 MVP 使用 `plain:v1` 编码保存到本地 SQLite，不是安全加密；部署时需保护数据库文件。

### embedding_indexes

一套向量索引配置，对应 provider、模型、维度和距离函数。

```text
id TEXT PRIMARY KEY
provider_id TEXT NOT NULL REFERENCES embedding_providers(id) ON DELETE RESTRICT
model TEXT NOT NULL
dimension INTEGER NOT NULL
distance_metric TEXT NOT NULL DEFAULT 'cosine'
table_name TEXT NOT NULL UNIQUE
status TEXT NOT NULL DEFAULT 'active'
created_at INTEGER NOT NULL
updated_at INTEGER NOT NULL
```

`status` 可选值：

```text
active
building
disabled
failed
retired
```

索引：

```text
idx_embedding_indexes_provider_id(provider_id)
idx_embedding_indexes_status(status)
```

说明：

- 不同模型生成的向量不能混用。
- 换模型时创建新的 `embedding_index`。
- 本表没有 error 字段；index rebuild/generate 错误记录在 `jobs.error`，provider 连接测试错误记录在 `embedding_providers.last_test_error`。
- 因 `provider_id` 是 `ON DELETE RESTRICT`，provider 只要有关联 index 就不能物理删除；停用使用 `embedding_providers.enabled = 0`。

### article_embeddings

文章 embedding 的权威存储。

```text
article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE
embedding_index_id TEXT NOT NULL REFERENCES embedding_indexes(id) ON DELETE CASCADE
vector_blob BLOB NOT NULL
content_hash TEXT NOT NULL
created_at INTEGER NOT NULL
updated_at INTEGER NOT NULL
PRIMARY KEY(article_id, embedding_index_id)
```

索引：

```text
idx_article_embeddings_index_id(embedding_index_id)
idx_article_embeddings_content_hash(content_hash)
```

说明：

- `vector_blob` 存 float32 array。
- 这是向量的权威存储。
- sqlite-vec 索引损坏或升级时，从本表重建。

### article_vector_rows

业务文章 ID 与 sqlite-vec rowid 的映射。

```text
article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE
embedding_index_id TEXT NOT NULL REFERENCES embedding_indexes(id) ON DELETE CASCADE
vec_rowid INTEGER NOT NULL
created_at INTEGER NOT NULL
PRIMARY KEY(article_id, embedding_index_id)
UNIQUE(embedding_index_id, vec_rowid)
```

说明：

- sqlite-vec 虚拟表通常以整数 rowid 为核心。
- 业务层不直接依赖虚拟表是否支持文本主键。
- Node.js spike 中验证到当前 sqlite-vec `v0.1.9` 的 `vec0` 不适合手动插入 rowid；应插入 embedding 后读取自动生成的 `lastInsertRowid`，再写入本映射表。

### sqlite-vec 虚拟表

每个 `embedding_index` 对应一张 sqlite-vec 虚拟表。

命名：

```text
vec_articles_<embedding_index_id_safe>
```

概念结构：

```text
rowid INTEGER
embedding float[dimension]
```

说明：

- 虚拟表名存于 `embedding_indexes.table_name`。
- 本表是可重建索引，不是权威数据。
- 所有 sqlite-vec SQL 只能出现在 `SqliteVecVectorStore` adapter 中。
- 插入策略为：先插入向量，让 sqlite-vec 自动生成 rowid，再将 rowid 写入 `article_vector_rows`。

当前实现：

```text
packages/db/src/vector/sqlite-vec-vector-store.ts
```

已覆盖：

- 按 `embedding_indexes` 创建 `vec0` 表。
- 写入 `article_embeddings.vector_blob` 权威数据。
- 写入 `article_vector_rows` 映射。
- 相似文章 KNN 查询。
- 删除单篇文章向量。
- 从 `article_embeddings` 重建 vec0 索引。

### Embedding coverage diagnostics

`GET /api/embedding/indexes` 和 `GET /api/recommendation/status` 的 coverage 字段是
只读投影，不需要额外表或 migration。

`candidateCount` 定义为当前可生成 embedding 的文章数：

- feed `enabled = 1`。
- feed `deleted_at is null`。
- article `deleted_at is null` 且 `status != 'deleted'`。
- title、summary、content_text 拼接后至少有一个非空文本。

`candidateCount` 不排除 hidden/not_interested，因为它表示 embedding 生成候选，不是推荐列表候选。
`eligibleArticleCount` 当前与 `candidateCount` 同义；`missingEmbeddingCount` 和
`staleEmbeddingCount` 是 active/backfill 诊断用的只读投影。
`coveredArticleCount` 表示当前 eligible articles 中已有匹配当前 `content_hash` 的 embedding 的数量。
`embeddingCount` 表示当前 index 的 embedding authority table 总量，可能包含历史文章，因此可能大于
`candidateCount`。`coverageRatio = coveredArticleCount / candidateCount`；`candidateCount = 0`
时 API 返回 `0`。
pending 从当前 index 的 open `embedding_generate` jobs 聚合。failed/lastFailedAt/lastError 只统计
仍对应 missing/stale eligible article 的 actionable failed jobs；已被后续 backfill 修复的历史失败不再
使推荐状态降级。

## 用户画像

### interest_clusters

Profile Algorithm v0 的正向 / 负向兴趣簇。

```text
id TEXT PRIMARY KEY
embedding_index_id TEXT NOT NULL REFERENCES embedding_indexes(id) ON DELETE CASCADE
polarity TEXT NOT NULL
label TEXT
centroid_vector_blob BLOB NOT NULL
weight REAL NOT NULL DEFAULT 0
sample_count INTEGER NOT NULL DEFAULT 0
last_matched_at INTEGER
created_at INTEGER NOT NULL
updated_at INTEGER NOT NULL
```

`polarity` 可选值：

```text
positive
negative
```

索引：

```text
idx_interest_clusters_index_polarity(embedding_index_id, polarity)
idx_interest_clusters_weight(weight)
idx_interest_clusters_last_matched_at(last_matched_at)
```

说明：

- centroid 使用同一 `embedding_index` 的向量空间。
- `label` 保留兼容旧语义；当前对外展示优先使用 `interest_cluster_labels` 中的 `manual_label` / `auto_label`。

### interest_cluster_labels

`008_interest_cluster_labels` 新增。兴趣簇标签缓存表，只用于算法透明页和推荐解释，不参与排序、画像向量、cluster centroid、embedding 生成或用户反馈计算。

```text
cluster_id TEXT PRIMARY KEY REFERENCES interest_clusters(id) ON DELETE CASCADE
auto_label TEXT
manual_label TEXT
label_source TEXT NOT NULL DEFAULT 'fallback'
label_terms_json TEXT
representative_articles_json TEXT
feed_titles_json TEXT
confidence REAL NOT NULL DEFAULT 0
generated_at INTEGER
updated_at INTEGER NOT NULL
label_diagnostics_json TEXT
```

`label_source` 可选值：

```text
manual
keywords
representative_titles
feeds
fallback
```

索引：

```text
idx_interest_cluster_labels_source(label_source, updated_at)
```

说明：

- 自动标签由本地 evidence articles、`profile_terms`、article title/summary、feed title 生成。
- 不调用 LLM、外部分类/摘要服务、外部搜索服务或 embedding API。
- `manual_label` 优先级最高；清除后恢复 `auto_label`。
- 展示优先级：`manual_label > auto_label > interest_clusters.label > 兴趣簇 #N`。
- `confidence` 是 0..1 的解释置信度，只影响 UI 文案，不影响推荐分数。
- `representative_articles_json`、`feed_titles_json` 和 `label_terms_json` 是透明页解释数据。
- `label_diagnostics_json` 由 `009_interest_cluster_merge_candidates` 追加，存储 `{ collision, collisionGroupSize, lowConfidence }`，只用于透明页提示。

### interest_cluster_merge_candidates

`009_interest_cluster_merge_candidates` 新增。重复兴趣簇诊断与合并审计表，只存 SQLite。本表记录 active embedding index 下同 polarity cluster 的近重复候选，不存向量明文，不调用 embedding，不影响 latest 排序。

```text
id TEXT PRIMARY KEY
embedding_index_id TEXT NOT NULL
left_cluster_id TEXT NOT NULL
right_cluster_id TEXT NOT NULL
polarity TEXT NOT NULL
centroid_similarity REAL NOT NULL
label_jaccard REAL NOT NULL DEFAULT 0
evidence_overlap REAL NOT NULL DEFAULT 0
representative_overlap REAL NOT NULL DEFAULT 0
source_overlap REAL NOT NULL DEFAULT 0
merge_score REAL NOT NULL
recommendation TEXT NOT NULL
status TEXT NOT NULL DEFAULT 'open'
reason_json TEXT
created_at INTEGER NOT NULL
updated_at INTEGER NOT NULL
decided_at INTEGER
```

`polarity` 可选值：

```text
positive
negative
```

`recommendation` 可选值：

```text
auto_merge
review
ignore
```

`status` 可选值：

```text
open
merged
ignored
dismissed
```

索引：

```text
idx_interest_cluster_merge_pair(left_cluster_id, right_cluster_id)
idx_interest_cluster_merge_candidates_status(embedding_index_id, status, merge_score)
```

说明：

- `interest_cluster_merge_diagnostics` 只比较 active index、同 polarity、bounded top-N clusters，并写入 `open` candidates。
- `interest_cluster_merge_diagnostics` 是只读诊断：不修改 `interest_clusters`，不触发 ranking，不触发 embedding。
- 手动 merge 和显式启用后的 auto merge 会修改画像，因此会 enqueue `interest_cluster_label_rebuild` 和 `ranking_recalculate`。
- auto merge 默认关闭，单次最多处理少量 `recommendation = 'auto_merge'` 的 open candidates。
- 本表不使用 cluster 外键 cascade，因为 merged-away cluster 会被删除，而合并审计行必须保留。
- 合并不删除用户行为，不删除文章，不清空 `interest_clusters`。

### feed_stats

来源偏好统计。

```text
feed_id TEXT PRIMARY KEY REFERENCES feeds(id) ON DELETE CASCADE
positive_score REAL NOT NULL DEFAULT 0
negative_score REAL NOT NULL DEFAULT 0
open_rate REAL NOT NULL DEFAULT 0
favorite_rate REAL NOT NULL DEFAULT 0
not_interested_rate REAL NOT NULL DEFAULT 0
clear_positive INTEGER NOT NULL DEFAULT 0
clear_negative INTEGER NOT NULL DEFAULT 0
clear_signal_count INTEGER NOT NULL DEFAULT 0
smoothed_positive_rate REAL NOT NULL DEFAULT 0
source_confidence REAL NOT NULL DEFAULT 0
last_calculated_at INTEGER
```

说明：

- `positive_score` / `negative_score` / rate 字段保留兼容。
- `clear_*`、`smoothed_positive_rate` 和 `source_confidence` 是 005 新增的 source normalization authority 字段；P1 ranking 应优先使用它们。
- open-only 行为只能产生极低 confidence，impression 不应因为高频源被放大成强负反馈。

## 排序结果

### article_rank_scores

预计算排序分。

```text
article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE
rank_context TEXT NOT NULL
embedding_index_id TEXT REFERENCES embedding_indexes(id) ON DELETE SET NULL
score REAL NOT NULL
interest_score REAL NOT NULL DEFAULT 0
base_score REAL
ftrl_score REAL
semantic_score REAL
bm25_score REAL
source_score REAL NOT NULL DEFAULT 0
freshness_score REAL NOT NULL DEFAULT 0
state_score REAL NOT NULL DEFAULT 0
diversity_score REAL NOT NULL DEFAULT 0
penalty_score REAL NOT NULL DEFAULT 0
negative_penalty REAL
duplicate_penalty REAL
diversity_penalty REAL
exploration_bonus REAL
pending_embedding_score REAL
exposure_penalty REAL
pre_rerank_score REAL
rerank_score REAL
rerank_position INTEGER
rerank_window_id TEXT
algorithm_version TEXT
feature_schema_version INTEGER
cocoon_level INTEGER
calculated_at INTEGER NOT NULL
PRIMARY KEY(article_id, rank_context)
```

索引：

```text
idx_article_rank_scores_context_score(rank_context, score)
idx_article_rank_scores_score(score)
idx_article_rank_scores_calculated_at(calculated_at)
```

说明：

- `rank_context = 'base'` 表示没有 embedding provider 时的基础排序结果。
- V2 context 形如 `rec_v2:embedding:cocoon_<level>:schema_2`。
- `rerank_position` 是 recommended canonical order；`latest` 不使用该字段排序。
- `bm25_score` 只能表示真实 `profile_terms + FTS5 bm25()` 分数；P0 阶段未激活时应为 0/null。
- `ftrl_score` 可在 shadow 模式下写入，但只有本地模型已 promote 为 `active`、样本数足够且 settings 允许 active learning 时才参与 `score`。
- `exploration_bonus` 目前表示本地探索加分/槽位诊断；在 bucket alpha/beta 参与 selection 前，透明页不得把它描述成完整 bucket bandit。

### article_rank_explanations

推荐解释 payload。

```text
article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE
rank_context TEXT NOT NULL
embedding_index_id TEXT REFERENCES embedding_indexes(id) ON DELETE SET NULL
payload_json TEXT NOT NULL
created_at INTEGER NOT NULL
PRIMARY KEY(article_id, rank_context)
```

payload 示例：

```json
{
  "reasons": [
    { "type": "positive_cluster", "label": "AI 工具", "impact": "positive" },
    { "type": "source", "label": "The Verge", "impact": "positive" },
    { "type": "freshness", "label": "2 小时前", "impact": "positive" },
    { "type": "duplicate", "label": "与 3 篇已读文章主题接近", "impact": "negative" }
  ]
}
```

## 搜索

### article_fts

FTS5 虚拟表。

概念结构：

```text
article_id UNINDEXED
title
summary
content_text
```

说明：

- FTS5 是可重建索引。
- 标题、摘要、正文的权重由查询时设置。
- 文章删除或正文清理时同步删除 FTS row。

## 本地学习与评估派生表

`rank_model_versions` / `rank_model_weights` / `rank_training_examples` 存储本地 FTRL shadow/active 模型、低维特征权重和训练样本。默认模型是 shadow；`POST /api/recommendation/ftrl/promote` 只在高质量样本足够时把模型标记为 active。active alpha 起步 `0.05`，每 7 天最多调整 `0.05`，默认上限 `0.20`；FTRL 训练可以每日运行，但不会每日自动上线。

`ranking_eval_runs.metrics_json` 当前存储 `lightweight_replay_diagnostic` 指标，例如 `cutoffCount`、`labelCount`、`hitAt10`、`ndcgAt10`、`mrr`。该表不是因果 A/B 结果；在没有完整 strict time-travel profile 前，文档和透明页都不得称为 full strict replay。

## 推荐自动维护调度状态

### recommendation_maintenance_schedule_state

`006_recommendation_maintenance_schedule` 新增。该表只记录 scheduler 的 enqueue/skip 状态，不替代 `jobs`，也不存放外部服务状态。

```text
task_key TEXT PRIMARY KEY
last_enqueued_at INTEGER
last_completed_at INTEGER
last_skipped_reason TEXT
last_job_id TEXT
updated_at INTEGER NOT NULL
```

常见 `task_key`：

```text
recent_intent_periodic
recent_intent_hourly
recent_intent_daily
keyword_profile_daily
duplicate_hourly
duplicate_daily
ftrl_train_periodic
ftrl_train_daily
ranking_recalculate_hourly
ranking_recalculate_daily
evaluation_weekly
embedding_health_hourly
```

`last_skipped_reason` 可为 `disabled`、`existing_job`、`no_active_index`、`no_missing_or_stale_embeddings` 等。透明页读取该表展示 recent intent、keyword profile、duplicate、FTRL、evaluation、embedding health 的最近调度状态。

## 任务系统

### jobs

进程内任务队列的持久化表。

```text
id TEXT PRIMARY KEY
type TEXT NOT NULL
status TEXT NOT NULL
payload_json TEXT
error TEXT
attempts INTEGER NOT NULL DEFAULT 0
max_attempts INTEGER NOT NULL DEFAULT 3
run_after INTEGER NOT NULL
started_at INTEGER
finished_at INTEGER
created_at INTEGER NOT NULL
updated_at INTEGER NOT NULL
```

`type` 可选值：

```text
feed_refresh
content_extract
embedding_generate
profile_event_process
ranking_recalculate
profile_decay
retention_cleanup
vector_index_rebuild
article_fingerprint_backfill
duplicate_group_rebuild
keyword_profile_rebuild
recent_intent_rebuild
ftrl_train
ranking_eval_run
recommendation_backfill
interest_cluster_label_rebuild
interest_cluster_merge_diagnostics
interest_cluster_auto_merge
```

`status` 可选值：

```text
queued
running
succeeded
failed
cancelled
```

MVP runner 约定：

- claim job 时将 `attempts + 1`，并把状态置为 `running`。
- job 失败且 `attempts < maxAttempts` 时回到 `queued`，并延后 `run_after`。
- job 失败且 `attempts >= maxAttempts` 时置为 `failed`。
- runner 启动时会把崩溃遗留的 `running` jobs 重置，避免永久卡住。
- `feed_refresh` payload 目前只接受 `{ "feedId": "string" }`。
- `retention_cleanup` payload 目前只接受 `null` 或 `{}`。
- `embedding_generate` payload 目前只接受 `{ "embeddingIndexId": "string", "articleIds": ["string"] }`，`articleIds` 长度限制 `1..16`；OpenAI-compatible 默认 16，Ollama 默认 4。
- `embedding_generate` 只对 queued/running open jobs 去重，历史 succeeded job 不会阻止内容变更后的重新 embedding。
- `ranking_recalculate` 全量重算通过 cursor chunk payload 续跑，默认 chunk size 为 500；指定 `articleIds` 重算仍应用可见性过滤。
- `vector_index_rebuild` payload 目前只接受 `{ "embeddingIndexId": "string" }`。
- 推荐维护 job payload 目前只接受 `null` 或 `{}`；automatic maintenance 只负责入队，执行逻辑仍在对应 job handler。
- `interest_cluster_label_rebuild` 只写 `interest_cluster_labels`，不写 `article_rank_scores`，不创建 `embedding_generate` 或 `ranking_recalculate` job。
- `interest_cluster_merge_diagnostics` 只写 `interest_cluster_merge_candidates`，不改 `interest_clusters`，不创建 `embedding_generate` 或 `ranking_recalculate` job。
- `interest_cluster_auto_merge` 默认由设置关闭；开启后只合并高置信 open candidates。成功合并后会创建 `interest_cluster_label_rebuild` 和 `ranking_recalculate` job。
- `ranking_eval_run` 是诊断 job，成功或失败都不触发 ranking/profile/FTRL 更新。

API 诊断约定：

- `GET /api/jobs` 是只读列表，不实现 retry。
- API 不返回 `payload_json` 原文。
- `embedding_generate` job 只暴露脱敏摘要 `{ "embeddingIndexId": "string", "articleCount": number }`。
- 其他 job 的 `payloadSummary` 当前返回 `null`。
- `POST /api/jobs/:id/retry` 是 planned / not implemented。

索引：

```text
idx_jobs_status_run_after(status, run_after)
idx_jobs_type(type)
idx_jobs_created_at(created_at)
```

## 数据保留

### 默认策略

默认文章保留 0 天，即永久保留。

保留天数配置来源：

```text
app_settings.retention.articleDays > DIBAO_ARTICLE_RETENTION_DAYS > 0
```

合法范围为 `0..3650`，其中 `0` 表示永久保留。非法 setting/env 会回退到默认值 `0`。

过期判断使用：

```text
coalesce(published_at, discovered_at) < now - retentionDays
```

删除旧文章时采用 soft delete article row + hard cleanup 派生数据：

- 将 `articles.status` 设为 `deleted`。
- 将 `articles.deleted_at` 和 `articles.updated_at` 设为清理时间。
- 保留 `articles` 基础元数据，避免破坏行为日志外键。
- 删除 `article_contents` row。
- 删除 `article_fts` row。
- 删除 `article_rank_scores` 和 `article_rank_explanations`。
- 删除 `article_embeddings`。
- 删除 `article_vector_rows` 和 sqlite-vec row。
- 保留 `behavior_events`。
- 保留 `article_states`。
- 保留已沉淀到 `interest_clusters` 和 `feed_stats` 的长期影响。

默认不清理：

- 收藏文章。
- 稍后读文章。

说明：

- `behavior_events.article_id` 当前使用 FK 关联 `articles(id)`，所以 retention 不 hard delete article row。
- RSS refresh 遇到 retention-deleted article 时不得恢复正文、FTS、rank 或 vector。
- 用户可在后续设置页中调整保留天数；本轮先提供内部 setting/env foundation。

## Rebuild 策略

### FTS rebuild

可从：

- `articles.title`
- `articles.summary`
- `article_contents.content_text`

重建。

### sqlite-vec rebuild

可从：

- `article_embeddings.vector_blob`
- `article_vector_rows`
- `embedding_indexes.table_name`

重建。

若 rowid 映射丢失，系统可以重新分配 rowid 并重建 `article_vector_rows`。

## Plugin Tables

`019_plugin_system.sql` 增加插件系统基础表：

- `plugin_installs`: 插件安装记录、manifest、状态、来源、包路径和数据路径。
- `plugin_capability_grants`: 启用插件时授予的 capability 快照。
- `plugin_settings`: 插件命名空间设置，按 `plugin_id + key` 存储 JSON。
- `plugin_kv`: 插件运行时 KV，按 `plugin_id + key` 存储 JSON。
- `plugin_migrations`: 插件自有 migration 应用记录。
- `plugin_update_checks`: 最近一次 update metadata 检查结果。

插件包目录和插件数据目录必须在 Docker 重建后通过 `/data` 卷持久化：

```text
/data/plugins/installed
/data/plugins/data/<plugin-id>
```

`jobs.type` 从固定 enum 扩展为 core job union 加插件任务格式：

```text
plugin:<pluginId>:<taskId>
```

缺失插件 handler 的插件任务不应破坏核心 job runner；任务会保留给插件管理页展示和后续恢复。

## Migration 实现

MVP 当前以一个初始 migration 建立完整 v0 schema：

```text
packages/db/migrations/001_initial_schema.sql
```

迁移执行器位于：

```text
packages/db/src/migration-runner.ts
```

执行器负责：

- 创建和维护 `schema_migrations`。
- 记录 migration `version`、`name`、`applied_at` 和 SHA-256 checksum。
- 重复启动时跳过已应用 migration。
- 已应用 migration 内容或名称变化时拒绝继续执行。

后续 schema 变更继续追加：

```text
002_*
003_*
...
008_*
009_*
011_*
...
019_plugin_system.sql
```

## Schema 验收标准

数据库实现完成后，至少应通过：

- 空库启动并执行全部 migration。
- 重复启动不会重复创建或破坏数据。
- OPML 导入可创建 folders 和 feeds。
- RSS 抓取可写入 articles 和 article_contents。
- 行为事件可更新 article_states。
- FTS5 可索引并搜索文章。
- embedding 可写入 `article_embeddings`。
- sqlite-vec 索引可由 BLOB 重建。
- 排序结果可按 score 查询推荐列表。
- 旧文章清理不破坏兴趣簇。
