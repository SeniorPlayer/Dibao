# sqlite-vec Node.js 集成验证

## 目的

验证邸报 MVP 计划中的 SQLite + FTS5 + sqlite-vec Node.js 路线是否能在本地最小环境中跑通。

本 spike 不接入真实 embedding provider，而是使用确定性的 4 维 fixture 向量模拟 embedding 输出。目标是验证数据库集成链路，不验证模型质量。

## 官方依据

sqlite-vec 官方文档说明 Node.js / Deno / Bun 可通过 `sqlite-vec` NPM 包使用，并通过 `sqliteVec.load(db)` 将 sqlite-vec SQL 函数加载到 SQLite 连接。官方示例使用 `better-sqlite3` 创建连接后执行 `sqliteVec.load(db)`。

参考：

- [Using sqlite-vec in Node.js, Deno, and Bun](https://alexgarcia.xyz/sqlite-vec/js.html)
- [sqlite-vec API Reference](https://alexgarcia.xyz/sqlite-vec/api-reference.html)
- [sqlite-vec Versioning](https://alexgarcia.xyz/sqlite-vec/versioning.html)

## 验证范围

本 spike 覆盖：

- Node.js 运行 sqlite-vec 官方 NPM binding。
- `better-sqlite3` 连接 SQLite。
- `sqliteVec.load(db)` 加载 sqlite-vec。
- `vec_version()` 可查询。
- FTS5 虚拟表可创建和查询。
- `article_embeddings` BLOB 表作为权威向量存储。
- sqlite-vec `vec0` 虚拟表作为可重建向量索引。
- `article_vector_rows` 维护业务 ID 与 vec rowid 映射。
- KNN 查询能返回预期最近邻。
- 删除 vec0 索引后可从 BLOB 表重建。

## 文件

```text
package.json
scripts/spikes/sqlite-vec-node.mjs
```

运行命令：

```bash
npm run spike:sqlite-vec
```

## 依赖

```text
better-sqlite3
sqlite-vec
```

说明：

- `better-sqlite3` 用作 MVP Node SQLite driver 验证对象。
- `sqlite-vec` 使用官方 Node binding。
- 项目仍保留“sqlite-vec 只在 adapter 内使用”的架构原则。

## Schema 摘要

spike 中创建：

```text
articles
article_fts
embedding_indexes
article_embeddings
article_vector_rows
vec_articles_spike
```

关键设计：

```text
article_embeddings.vector_blob 是权威数据。
vec_articles_spike 是可重建索引。
article_vector_rows 负责 article_id <-> vec rowid 映射。
```

## fixture 数据

spike 使用 4 篇文章：

```text
article_ai_local
article_ai_agents
article_design
article_finance
```

查询向量靠近 AI 主题，预期最近邻为：

```text
article_ai_local
```

## 当前验证结果

在本机环境：

```text
Node.js v22.17.0
npm 10.9.2
```

执行：

```bash
npm run spike:sqlite-vec
```

验证通过：

```text
sqlite-vec load()
vec_version()
SQLite WAL pragmas
FTS5 query
article_embeddings BLOB authority table
sqlite-vec vec0 KNN query
article_vector_rows rowid mapping
rebuild vec0 index from BLOB
```

实际输出摘要：

```json
{
  "sqliteVecVersion": "v0.1.9",
  "ftsTopHit": {
    "articleId": "article_ai_local",
    "title": "Local embedding for personal RSS ranking"
  },
  "vectorTopHit": {
    "articleId": "article_ai_local",
    "distance": 0.03162276744842529
  },
  "rebuiltTopHit": {
    "articleId": "article_ai_local",
    "distance": 0.03162276744842529
  }
}
```

## 实现发现

当前验证环境中的 sqlite-vec `v0.1.9` 暴露了一个重要细节：

```text
vec0 不适合由业务层手动插入 rowid。
```

尝试执行：

```sql
insert into vec_articles_spike (rowid, embedding) values (?, ?)
```

会报错：

```text
Only integers are allows for primary key values on vec_articles_spike
```

可行做法是：

```text
1. insert into vec_articles_spike (embedding) values (?)
2. 从 better-sqlite3 Statement.run() 结果中读取 lastInsertRowid
3. 写入 article_vector_rows(article_id, embedding_index_id, vec_rowid)
```

这进一步确认了我们需要保留 `article_vector_rows` 映射表，并把所有 sqlite-vec 细节限制在 `SqliteVecVectorStore` adapter 内。

## 结论

当前 Node.js + better-sqlite3 + sqlite-vec 的集成路径可行。

这支持 MVP 继续采用：

```text
SQLite + FTS5 + sqlite-vec
better-sqlite3
VectorStore adapter
article_embeddings BLOB 权威存储
sqlite-vec vec0 可重建索引
```

## 风险

### sqlite-vec 版本风险

sqlite-vec 官方文档说明 bindings 不在严格语义化版本保证范围内，因此仍需：

- 锁定版本。
- 将 sqlite-vec SQL 限制在 adapter 内。
- 保留 BLOB 权威存储。
- 提供索引重建命令。

### 平台兼容风险

本 spike 只验证当前 macOS / Node.js 环境。后续还需要验证：

- Docker Linux image
- linux/amd64
- linux/arm64
- 群晖 Container Manager

### 性能风险

本 spike 只验证功能，不验证 2 万文章和每日 300～400 新增文章下的性能。

后续需要增加：

- 2 万向量 fixture
- 400 新文章批量写入
- 重建索引耗时
- KNN 查询耗时

## 后续动作

- 将 spike 的成功路径沉淀为 `packages/db` 和 `VectorStore` adapter。
- 增加 Docker 环境 sqlite-vec 验证。
- 增加批量性能 spike。
- 在 CI 中加入最小 sqlite-vec load smoke test。
