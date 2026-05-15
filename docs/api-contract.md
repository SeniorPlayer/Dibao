# 邸报 Dibao API Contract v0

## 文档目的

本文定义邸报 MVP 的 HTTP API 合约，供前端、后端和测试用例共同使用。

MVP API 只服务单用户自托管实例，不提供多用户、组织、公开开放平台或第三方 OAuth。

## 通用约定

### Base URL

```text
/api
```

### 数据格式

请求和响应默认使用：

```text
Content-Type: application/json
```

OPML 导入使用：

```text
multipart/form-data
```

OPML 导出返回：

```text
application/xml
```

### 时间

API 中时间使用 ISO 8601 string。

数据库内部可以使用 epoch milliseconds，API 层负责转换。

示例：

```json
"2026-05-14T12:30:00.000Z"
```

### ID

所有业务 ID 使用 string。

### 成功响应

单对象：

```json
{
  "data": {}
}
```

列表：

```json
{
  "data": [],
  "page": {
    "nextCursor": "string-or-null"
  }
}
```

操作结果：

```json
{
  "data": {
    "ok": true
  }
}
```

### 错误响应

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human readable message",
    "details": {}
  }
}
```

常见错误码：

```text
UNAUTHORIZED
FORBIDDEN
NOT_FOUND
VALIDATION_ERROR
CONFLICT
PROVIDER_ERROR
JOB_FAILED
INTERNAL_ERROR
```

### 认证

登录后使用 httpOnly session cookie。

除以下接口外，其余 API 都需要 session：

```text
GET  /api/auth/session
POST /api/auth/setup
POST /api/auth/login
POST /api/auth/logout
GET  /api/system/health
```

说明：

- `POST /api/auth/logout` 允许匿名调用并保持幂等，用于清理可能存在的 session cookie。
- `GET /api/system/health` 是自托管部署和反向代理健康检查的匿名例外。

### Pagination

列表分页使用 cursor。

请求：

```text
?limit=50&cursor=...
```

响应：

```json
{
  "page": {
    "nextCursor": null
  }
}
```

默认 `limit = 50`，最大 `limit = 100`。

## 类型摘要

### Feed

```ts
type Feed = {
  id: string;
  folderId: string | null;
  title: string;
  siteUrl: string | null;
  feedUrl: string;
  description: string | null;
  enabled: boolean;
  sourceWeight: number;
  lastFetchedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};
```

### FeedFolder

```ts
type FeedFolder = {
  id: string;
  title: string;
  sortOrder: number;
};
```

### ArticleListItem

```ts
type ArticleListItem = {
  id: string;
  feedId: string;
  feedTitle: string;
  title: string;
  url: string;
  author: string | null;
  summary: string | null;
  publishedAt: string | null;
  discoveredAt: string;
  state: {
    read: boolean;
    favorited: boolean;
    readLater: boolean;
    hidden: boolean;
    notInterested: boolean;
    readingProgress: number;
  };
  rank?: {
    score: number;
    calculatedAt: string;
  };
};
```

### ArticleDetail

```ts
type ArticleDetail = ArticleListItem & {
  contentHtml: string | null;
  contentText: string | null;
  extractionStatus: "pending" | "feed_only" | "success" | "failed" | "skipped";
  extractionError: string | null;
};
```

### RankExplanation

```ts
type RankExplanation = {
  articleId: string;
  reasons: Array<{
    type: "source" | "freshness" | "state" | "fallback" | "negative" | "penalty";
    label: string;
    impact: "positive" | "negative" | "neutral";
  }>;
  generatedAt: string;
};
```

说明：

- `label` 是后端提供的轻量调试/辅助文本，不作为最终 UI 文案。
- 前端应优先按 `type` 和 `impact` 使用本地化 dictionary 展示推荐理由。

## Auth

### GET /api/auth/session

查询当前 session 和首次设置状态。

响应：

```json
{
  "data": {
    "setupCompleted": true,
    "authenticated": true
  }
}
```

### POST /api/auth/setup

首次启动设置访问密码。

请求：

```json
{
  "password": "string"
}
```

响应：

```json
{
  "data": {
    "ok": true
  }
}
```

错误：

- `CONFLICT`: 已完成 setup。
- `VALIDATION_ERROR`: 密码不符合要求。

### POST /api/auth/login

登录。

请求：

```json
{
  "password": "string"
}
```

响应：

```json
{
  "data": {
    "ok": true
  }
}
```

### POST /api/auth/logout

退出登录。

响应：

```json
{
  "data": {
    "ok": true
  }
}
```

## Setup

### GET /api/setup/status

用于首次设置向导。

响应：

```json
{
  "data": {
    "setupCompleted": false,
    "hasFeeds": false,
    "hasEmbeddingProvider": false,
    "firstRefreshStatus": "idle"
  }
}
```

`firstRefreshStatus`：

- `hasEmbeddingProvider` 为真实状态：存在已启用 provider 且存在 active embedding index 时为 `true`。
- 有 active embedding index 时，`recommended` 可使用 Ranking v1；无 provider、无 embedding、无画像或 provider 失败时继续 fallback 到 baseline ranking。

```text
idle
running
succeeded
failed
```

## Feeds

### GET /api/feed-folders

获取订阅源分组。

响应：

```json
{
  "data": [
    {
      "id": "folder_01",
      "title": "科技",
      "sortOrder": 0
    }
  ]
}
```

### POST /api/feed-folders

创建分组。

请求：

```json
{
  "title": "科技"
}
```

响应：

```json
{
  "data": {
    "id": "folder_01",
    "title": "科技",
    "sortOrder": 0
  }
}
```

### PATCH /api/feed-folders/:id

更新分组。

请求：

```json
{
  "title": "设计",
  "sortOrder": 2
}
```

响应：

```json
{
  "data": {
    "id": "folder_01",
    "title": "设计",
    "sortOrder": 2
  }
}
```

### DELETE /api/feed-folders/:id

删除分组。

说明：

- 删除分组不会删除 feeds。
- feeds 的 `folderId` 置为 `null`。

响应：

```json
{
  "data": {
    "ok": true
  }
}
```

### GET /api/feeds

获取订阅源列表。

查询参数：

```text
folderId
enabled=true|false
```

响应：

```json
{
  "data": [
    {
      "id": "feed_01",
      "folderId": "folder_01",
      "title": "The Verge",
      "siteUrl": "https://www.theverge.com",
      "feedUrl": "https://www.theverge.com/rss/index.xml",
      "description": null,
      "enabled": true,
      "sourceWeight": 0,
      "lastFetchedAt": null,
      "lastSuccessAt": null,
      "lastError": null,
      "createdAt": "2026-05-14T12:00:00.000Z",
      "updatedAt": "2026-05-14T12:00:00.000Z"
    }
  ]
}
```

### POST /api/feeds

添加 RSS / Atom 订阅源。

请求：

```json
{
  "feedUrl": "https://example.com/feed.xml",
  "folderId": "folder_01"
}
```

`folderId` 可选。若传入非空值，目标 folder 必须存在，否则返回 `NOT_FOUND`。

响应：

```json
{
  "data": {
    "feed": {},
    "refreshJobId": "job_01"
  }
}
```

### PATCH /api/feeds/:id

更新订阅源。

请求：

```json
{
  "title": "Example",
  "folderId": null,
  "enabled": true,
  "sourceWeight": 0.2
}
```

`sourceWeight` 范围为 `-1..1`。

响应：

```json
{
  "data": {
    "id": "feed_01",
    "folderId": null,
    "title": "Example",
    "siteUrl": "https://example.com",
    "feedUrl": "https://example.com/feed.xml",
    "description": null,
    "enabled": true,
    "sourceWeight": 0.2,
    "lastFetchedAt": null,
    "lastSuccessAt": null,
    "lastError": null,
    "createdAt": "2026-05-14T12:00:00.000Z",
    "updatedAt": "2026-05-14T12:05:00.000Z"
  }
}
```

### DELETE /api/feeds/:id

删除订阅源。

说明：

- MVP 使用软删除。
- 默认不立即物理删除历史文章。

响应：

```json
{
  "data": {
    "ok": true
  }
}
```

### POST /api/feeds/:id/refresh

手动刷新订阅源。

响应：

```json
{
  "data": {
    "jobId": "job_01"
  }
}
```

### POST /api/feeds/refresh

手动刷新所有启用订阅源。

说明：

- 只为未删除且 `enabled = true` 的 feeds 创建 `feed_refresh` jobs。
- 已有 queued/running `feed_refresh` job 的 feed 不重复创建 job，返回既有 `jobId`。
- 接口返回表示已加入刷新队列，不表示所有抓取已经完成。
- 单个 feed 抓取失败不会阻塞其他 feeds；失败记录在 `jobs.error` 和 feed 的 `lastError`。
- 抓取成功会更新 feed 的 `lastFetchedAt`、`lastSuccessAt`，并清空 `lastError`。
- 抓取失败会更新 feed 的 `lastFetchedAt`、`lastError`，保留 `lastSuccessAt`。

响应：

```json
{
  "data": {
    "jobIds": ["job_01", "job_02"]
  }
}
```

## OPML

### POST /api/opml/import

导入 OPML。

请求：

```text
multipart/form-data
file=<opml file>
```

MVP 也接受 `application/xml` 请求体，便于本地自托管和自动化测试。

导入行为：

- 创建不存在的 feed folders。
- 创建不存在的 feeds。
- 已存在 `feedUrl` 的订阅源跳过，不重复创建。
- 不自动抓取 RSS 内容，不触发 feed refresh。
- 嵌套分组会扁平化为一层 folders，feed 归属最近的父分组。

响应：

```json
{
  "data": {
    "foldersCreated": 3,
    "feedsCreated": 42,
    "feedsSkipped": 5,
    "errors": []
  }
}
```

### GET /api/opml/export

导出 OPML。

响应：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">...</opml>
```

## Articles

### GET /api/articles

获取文章列表。

说明：

- `latest` 始终按发布时间/发现时间排序。
- `recommended` 在无 active embedding index 时使用 `rank_context = "base"`。
- 存在 active embedding index 时使用 `rank_context = embeddingIndexId`，并在 active context 缺分数时 fallback 到 base rank，避免推荐列表为空。

查询参数：

```text
view=recommended|latest|favorites|read_later
feedId
folderId
status=unread|read|all
limit
cursor
```

响应：

```json
{
  "data": [
    {
      "id": "article_01",
      "feedId": "feed_01",
      "feedTitle": "The Verge",
      "title": "Example article",
      "url": "https://example.com/a",
      "author": null,
      "summary": "Short summary",
      "publishedAt": "2026-05-14T08:00:00.000Z",
      "discoveredAt": "2026-05-14T08:05:00.000Z",
      "state": {
        "read": false,
        "favorited": false,
        "readLater": false,
        "hidden": false,
        "notInterested": false,
        "readingProgress": 0
      },
      "rank": {
        "score": 0.82,
        "calculatedAt": "2026-05-14T08:10:00.000Z"
      }
    }
  ],
  "page": {
    "nextCursor": null
  }
}
```

### GET /api/articles/:id

获取文章详情。

响应：

```json
{
  "data": {
    "id": "article_01",
    "feedId": "feed_01",
    "feedTitle": "The Verge",
    "title": "Example article",
    "url": "https://example.com/a",
    "author": null,
    "summary": "Short summary",
    "publishedAt": "2026-05-14T08:00:00.000Z",
    "discoveredAt": "2026-05-14T08:05:00.000Z",
    "contentHtml": "<p>...</p>",
    "contentText": "...",
    "extractionStatus": "success",
    "extractionError": null,
    "state": {
      "read": false,
      "favorited": false,
      "readLater": false,
      "hidden": false,
      "notInterested": false,
      "readingProgress": 0.35
    }
  }
}
```

### POST /api/articles/:id/actions

记录文章动作。

请求：

```json
{
  "type": "favorite",
  "value": true,
  "metadata": {}
}
```

`type` 可选值：

```text
open
mark_read
mark_unread
favorite
unfavorite
read_later
remove_read_later
hide
not_interested
read_progress
```

说明：

- `favorite`、`read_later`、`mark_read` 支持 `value: false`，服务端会分别规范化为 `unfavorite`、`remove_read_later`、`mark_unread`。
- 也可以直接发送 `unfavorite`、`remove_read_later`、`mark_unread`。
- `read_complete` 不作为 MVP 显式 API action；后续可由阅读进度或阅读时长派生。

`read_progress` 示例，`progress` 与 `value` 都可用，推荐新代码使用 `progress`：

```json
{
  "type": "read_progress",
  "progress": 0.72,
  "metadata": {
    "durationMs": 42000
  }
}
```

响应：

```json
{
  "data": {
    "state": {
      "read": true,
      "favorited": true,
      "readLater": false,
      "hidden": false,
      "notInterested": false,
      "readingProgress": 1
    }
  }
}
```

### GET /api/articles/:id/explanation

获取推荐解释。

响应：

```json
{
  "data": {
    "articleId": "article_01",
    "reasons": [
      {
        "type": "interest",
        "label": "Interest match",
        "impact": "positive"
      },
      {
        "type": "source",
        "label": "The Verge",
        "impact": "positive"
      },
      {
        "type": "freshness",
        "label": "Recent article",
        "impact": "positive"
      }
    ],
    "generatedAt": "2026-05-14T08:10:00.000Z"
  }
}
```

如果文章尚未精排：

```json
{
  "data": {
    "articleId": "article_01",
    "reasons": [
      {
        "type": "fallback",
        "label": "Ranking has not been calculated yet",
        "impact": "neutral"
      }
    ],
    "generatedAt": "2026-05-14T08:10:00.000Z"
  }
}
```

`reason.type` 当前可选：

```text
interest
source
freshness
state
fallback
negative
penalty
```

前端 UI 应按 `type` 和 `impact` 本地化展示文案；`label` 只作为可读提示或来源名，不应作为最终 UI 文案。

## Search

### GET /api/search

关键词搜索。

查询参数：

```text
q
feedId
folderId
from
to
state=all|unread|read|favorites|read_later
limit
cursor
```

响应同 `GET /api/articles`。

## Settings

### GET /api/settings

获取设置。

响应：

```json
{
  "data": {
    "ui": {
      "locale": "zh-CN"
    },
    "reader": {
      "fontSize": 18,
      "lineHeight": 1.75,
      "paragraphGap": 1.1,
      "readerWidth": 720,
      "theme": "paper"
    },
    "retention": {
      "retentionDays": 60,
      "keepFavorites": true,
      "keepReadLater": true
    },
    "ranking": {
      "preferFreshness": 0.5,
      "preferSource": 0.5,
      "preferDiversity": 0.5
    }
  }
}
```

### PATCH /api/settings

更新设置。

请求是严格 partial merge：

- 只更新请求中出现的字段。
- 未出现字段保持原值；如果原值缺失或非法，使用默认值。
- 任意未知字段、不可写字段、类型错误或越界值返回 `VALIDATION_ERROR`。
- API 字段 `retention.retentionDays` 持久化到 storage key `retention.articleDays`。

请求：

```json
{
  "ui": {
    "locale": "en-US"
  },
  "reader": {
    "fontSize": 19,
    "lineHeight": 1.8
  },
  "retention": {
    "retentionDays": 90
  }
}
```

响应：

```json
{
  "data": {
    "ok": true,
    "settings": {
      "ui": {
        "locale": "en-US"
      },
      "reader": {
        "fontSize": 19,
        "lineHeight": 1.8,
        "paragraphGap": 1.1,
        "readerWidth": 720,
        "theme": "paper"
      },
      "retention": {
        "retentionDays": 90,
        "keepFavorites": true,
        "keepReadLater": true
      },
      "ranking": {
        "preferFreshness": 0.5,
        "preferSource": 0.5,
        "preferDiversity": 0.5
      }
    }
  }
}
```

## Embedding

当前 MVP 只实现 `openai_compatible` provider。`ollama`、`custom_http`、`embedded_local`
保留为后续 adapter 扩展；本轮如果请求启用这些类型，API 返回
contract-shaped `VALIDATION_ERROR`。Web Settings 也只开放 OpenAI-compatible。

API key 存储说明：MVP 单用户本地/自托管版本会把 key 保存在本机 SQLite
`embedding_providers.api_key_encrypted`，当前实现只是 `plain:v1` 编码，不是安全加密。
部署者应保护数据库文件和数据卷；后续如需要可引入外部密钥或系统 keychain。

### GET /api/embedding/providers

获取 provider 列表。

响应：

```json
{
  "data": [
    {
      "id": "provider_01",
      "type": "openai_compatible",
      "name": "OpenAI Compatible",
      "baseUrl": "https://api.example.com/v1",
      "model": "text-embedding-3-small",
      "dimension": 1536,
      "enabled": true,
      "qualityTier": "best_quality",
      "hasApiKey": true,
      "lastTestStatus": "success",
      "lastTestError": null,
      "lastTestAt": "2026-05-14T08:00:00.000Z",
      "createdAt": "2026-05-14T08:00:00.000Z",
      "updatedAt": "2026-05-14T08:00:00.000Z"
    }
  ]
}
```

### POST /api/embedding/providers

创建 provider。

请求：

```json
{
  "type": "openai_compatible",
  "name": "My Provider",
  "baseUrl": "https://api.example.com/v1",
  "model": "text-embedding-3-small",
  "dimension": 1536,
  "apiKey": "secret",
  "enabled": true
}
```

约束：

- `type` 必须是 `openai_compatible` 才能启用。
- `baseUrl` 应填写 API root，例如 `https://api.example.com/v1`；可以带 `/v1/` 尾斜杠。
- `baseUrl` 不应填写到 `/embeddings`，否则返回 `VALIDATION_ERROR`。
- 创建或更新为 `enabled:true` 时，服务端会事务化停用其他 provider，并为当前模型/维度创建 active index。

响应：

```json
{
  "data": {
    "id": "provider_01"
  }
}
```

### PATCH /api/embedding/providers/:id

更新 provider。

请求：

```json
{
  "name": "OpenAI Compatible",
  "enabled": true
}
```

响应为更新后的 provider，不返回 `apiKey` 明文。

### DELETE /api/embedding/providers/:id

删除 provider。

约束：

- 如果 provider 仍有关联任何 embedding index，返回 `CONFLICT`。
- 无 index 时才物理删除。
- 用户需要停用 provider 时使用 `PATCH enabled=false`。

### POST /api/embedding/providers/:id/test

测试 provider。

响应成功：

```json
{
  "data": {
    "status": "success",
    "dimension": 1536,
    "latencyMs": 320
  }
}
```

响应失败：

```json
{
  "error": {
    "code": "PROVIDER_ERROR",
    "message": "Provider request failed",
    "details": {
      "status": 401
    }
  }
}
```

### GET /api/embedding/indexes

获取 embedding index 列表。

响应：

```json
{
  "data": [
    {
      "id": "index_01",
      "providerId": "provider_01",
      "model": "text-embedding-3-small",
      "dimension": 1536,
      "distanceMetric": "cosine",
      "status": "active",
      "embeddingCount": 42,
      "pendingJobs": 2,
      "failedJobs": 1,
      "createdAt": "2026-05-14T08:00:00.000Z",
      "updatedAt": "2026-05-14T08:00:00.000Z"
    }
  ]
}
```

`embedding_indexes` 不保存错误字段；具体错误记录在 `jobs.error` 或 provider
`lastTestError`。

### POST /api/embedding/indexes/:id/rebuild

重建 sqlite-vec 索引。

响应：

```json
{
  "data": {
    "jobId": "job_01"
  }
}
```

### embedding_generate job payload

内部 job payload：

```json
{
  "embeddingIndexId": "index_01",
  "articleIds": ["article_01"]
}
```

约束：

- `articleIds` 长度为 `1..16`。
- payload 运行时严格校验，非法 payload 直接 failed，不重试。
- 只处理未删除文章、未删除且启用的 feed、有可 embedding 文本的文章。
- 当前 index 已有 embedding 且 `content_hash` 未变化时跳过。
- retention-deleted article 即使出现在 payload 中也会被过滤。
- 只对 queued/running open jobs 做去重；历史 succeeded job 不阻止内容变化后的重新 embedding。

## Jobs

### GET /api/jobs

获取任务列表。

查询参数：

```text
status=queued|running|succeeded|failed
type
limit
cursor
```

响应：

```json
{
  "data": [
    {
      "id": "job_01",
      "type": "feed_refresh",
      "status": "running",
      "attempts": 1,
      "maxAttempts": 3,
      "runAfter": "2026-05-14T08:00:00.000Z",
      "startedAt": "2026-05-14T08:00:05.000Z",
      "finishedAt": null,
      "error": null,
      "createdAt": "2026-05-14T08:00:00.000Z",
      "updatedAt": "2026-05-14T08:00:05.000Z"
    }
  ],
  "page": {
    "nextCursor": null
  }
}
```

### POST /api/jobs/:id/retry

重试失败任务。

响应：

```json
{
  "data": {
    "jobId": "job_02"
  }
}
```

## System

### GET /api/system/health

健康检查。

响应：

```json
{
  "data": {
    "ok": true,
    "database": "ok",
    "fts": "ok",
    "vectorStore": "ok",
    "version": "0.0.0"
  }
}
```

### GET /api/system/info

系统信息。

响应：

```json
{
  "data": {
    "version": "0.0.0",
    "dataDir": "/data",
    "databasePath": "/data/dibao.sqlite",
    "activeEmbeddingProvider": "provider_01",
    "activeEmbeddingIndex": "index_01"
  }
}
```

## API 验收标准

API 实现完成后，至少应通过：

- 未登录访问受保护接口返回 `UNAUTHORIZED`。
- 首次 setup 后不能重复 setup。
- OPML 导入和导出保持分组结构。
- 添加 feed 后创建刷新任务。
- 文章列表支持 recommended 和 latest。
- 文章 action 会同时写行为事件和当前状态。
- 推荐解释在未精排时返回 fallback reason。
- provider test 能明确返回成功或失败细节。
- index rebuild 返回任务 ID。
- 所有列表接口支持 limit 和 cursor。
