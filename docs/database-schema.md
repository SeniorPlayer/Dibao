# 邸报 Dibao 数据库 Schema v0

## 文档目的

本文定义邸报 MVP 的 SQLite 数据库结构、索引、生命周期规则、FTS5 与 sqlite-vec 集成方式。

它是开发前的 schema 合约，不是最终 migration SQL。实现时可以根据具体库和 sqlite-vec 版本调整语法，但不得改变这里定义的数据边界和所有权原则。

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
reader.settings
retention.settings
ranking.settings
system.instance_id
```

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

说明：

- `source_weight` 是用户或系统沉淀出的来源权重。
- `feed_url` 规范化后唯一。

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

### article_states

用户对文章的当前状态。

```text
article_id TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE
read_at INTEGER
favorited_at INTEGER
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
- 可通过应用层保证，也可用 partial unique index 实现。

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
- label 初期可为空，由用户或后续模型生成。

### feed_stats

来源偏好统计。

```text
feed_id TEXT PRIMARY KEY REFERENCES feeds(id) ON DELETE CASCADE
positive_score REAL NOT NULL DEFAULT 0
negative_score REAL NOT NULL DEFAULT 0
open_rate REAL NOT NULL DEFAULT 0
favorite_rate REAL NOT NULL DEFAULT 0
not_interested_rate REAL NOT NULL DEFAULT 0
last_calculated_at INTEGER
```

## 排序结果

### article_rank_scores

预计算排序分。

```text
article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE
rank_context TEXT NOT NULL
embedding_index_id TEXT REFERENCES embedding_indexes(id) ON DELETE SET NULL
score REAL NOT NULL
interest_score REAL NOT NULL DEFAULT 0
source_score REAL NOT NULL DEFAULT 0
freshness_score REAL NOT NULL DEFAULT 0
state_score REAL NOT NULL DEFAULT 0
diversity_score REAL NOT NULL DEFAULT 0
penalty_score REAL NOT NULL DEFAULT 0
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
- 使用 embedding provider 时，`rank_context` 等于 `embedding_index_id`。

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
ranking_recalculate
profile_decay
retention_cleanup
vector_index_rebuild
```

`status` 可选值：

```text
queued
running
succeeded
failed
cancelled
```

索引：

```text
idx_jobs_status_run_after(status, run_after)
idx_jobs_type(type)
idx_jobs_created_at(created_at)
```

## 数据保留

### 默认策略

默认文章保留 60 天。

删除旧文章时：

- 删除 `article_contents.content_html`。
- 删除 `article_contents.content_text`。
- 删除 `article_embeddings`。
- 删除 sqlite-vec row。
- 删除 FTS row。
- 保留已沉淀到 `interest_clusters` 和 `feed_stats` 的长期影响。
- 可保留 `article_behavior_summaries`。

### 收藏和稍后读

默认不清理：

- 收藏文章
- 稍后读文章

用户可在设置中调整。

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

## 最小 migration 顺序

建议 MVP migration 顺序：

```text
001_core_settings_auth
002_feeds_articles
003_behavior_states
004_search_fts
005_embedding_providers
006_vector_indexes
007_profile_clusters
008_ranking_scores
009_jobs
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
