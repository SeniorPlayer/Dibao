# 邸报 Dibao

邸报 Dibao 是一个开源、可自托管、单用户的个人化 RSS 信息流系统。它只在你订阅的 RSS / Atom 信源范围内做排序，尽量让信息来源、阅读数据和推荐逻辑留在你自己的实例里。

当前 MVP 边界：

- 单用户、自托管、本地 SQLite 数据库。
- 支持首次设置密码、OPML 导入/导出、手动添加 RSS、后台刷新、文章动作、基础排序、OpenAI-compatible 和 Ollama embedding provider。
- 不提供多用户、官方托管、OAuth、云同步、PWA、全文搜索 UI 或移动端 App 打包。

## Docker Compose 快速启动

```bash
git clone <your-dibao-repo-url>
cd dibao
docker compose up --build -d
```

打开 `http://localhost:8080`，按页面提示设置访问密码，然后导入 OPML 或手动添加一个 RSS / Atom 地址。

默认 Compose 会创建 named volume `dibao-data`，并把 SQLite 数据库放在容器内 `/data/dibao.sqlite`。

常用环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DIBAO_HOST` | `0.0.0.0` | Server 监听地址。 |
| `DIBAO_PORT` | `8080` | Server 监听端口。 |
| `DIBAO_DATABASE_PATH` | `/data/dibao.sqlite` | SQLite 数据库路径。 |
| `DIBAO_COOKIE_SECURE` | `false` | HTTP/LAN 自托管可保持 `false`；HTTPS 反向代理后建议设为 `true`。 |
| `DIBAO_WEB_DIST_DIR` | `apps/web/dist` | 可选，覆盖 Web 静态资源目录。 |
| `DIBAO_BACKGROUND_JOBS` | `true` | 可设为 `false` 关闭后台 job runner，主要用于测试。 |

健康检查使用匿名接口：

```bash
curl http://localhost:8080/api/system/health
```

Dockerfile 内置 HEALTHCHECK 不依赖 `curl`/`wget`，而是用 Node `fetch()` 检查 `/api/system/health`。

## 首次设置

1. 打开 Web 页面。
2. 设置单用户访问密码。
3. 导入 OPML，或手动添加一个 RSS / Atom feed。
4. Embedding provider 可以稍后配置；未配置时邸报继续使用基础排序。
5. 进入阅读器后，可以刷新订阅源、打开文章、收藏、稍后读或标记不感兴趣。

## OPML、RSS 和刷新

- OPML 导入：阅读器左侧点击“导入 OPML”，选择 `.opml` 或 `.xml` 文件。
- OPML 导出：点击“导出 OPML”，下载 `dibao-subscriptions.opml`。
- 手动添加：在 RSS / Atom URL 输入框里粘贴 feed 地址并添加。
- 刷新：单个 feed 可点“刷新”；“刷新全部”会把启用的 feeds 加入刷新队列，不表示已经全部抓取完成。

导入 OPML 不会自动抓取所有文章；添加单个 feed 会同步做一次最小刷新。

## Embedding Provider

MVP 支持 OpenAI-compatible 和 Ollama 两类 embedding provider。你可以在“设置”里选择类型后填写：

- Base URL，例如 `https://api.example.com/v1`
- Model，例如 `text-embedding-3-small`
- Dimension，例如 `1536`
- API Key，按你的 endpoint 要求填写

Ollama 本地测试示例：

```bash
ollama pull nomic-embed-text
```

设置页选择 `Ollama`，填写：

- Base URL：`http://127.0.0.1:11434`
- Model：`nomic-embed-text`
- Dimension：`768`

如果邸报运行在 Docker 容器里，而 Ollama 运行在宿主机上，Docker Desktop 通常需要把 Base URL 写成 `http://host.docker.internal:11434`；Linux 服务器可使用宿主机 LAN IP 或把 Ollama 作为同一 Compose 网络里的服务暴露。

配置后可以点击“测试连接”。未配置、停用或测试失败时，阅读和基础推荐仍然可用。

Backfill 和 rebuild 是两个不同操作：

- Backfill 会为 active embedding index 中缺失或内容 hash 变旧的文章重新加入 `embedding_generate` 队列，可能调用 provider。
- Rebuild 只从本地 `article_embeddings` authority table 重建 sqlite-vec index，不重新请求 provider。

安全说明：当前 MVP 会把 provider 配置和 API key 存在本地 SQLite 中。请只在你信任的机器或受控自托管环境运行；如果通过公网访问，建议放在 HTTPS 反向代理之后，并设置 `DIBAO_COOKIE_SECURE=true`。

## 数据持久化

默认 Docker Compose 数据位置：

```text
dibao-data:/data
/data/dibao.sqlite
```

SQLite WAL/SHM 文件可能和主库同目录出现，也应一起保留。

## 备份与恢复

推荐备份流程：

```bash
docker compose stop
docker run --rm -v dibao_dibao-data:/data -v "$PWD:/backup" busybox \
  sh -c 'tar czf /backup/dibao-data-backup.tgz -C /data .'
docker compose up -d
```

恢复到空 volume：

```bash
docker compose down
docker volume rm dibao_dibao-data
docker volume create dibao_dibao-data
docker run --rm -v dibao_dibao-data:/data -v "$PWD:/backup" busybox \
  sh -c 'tar xzf /backup/dibao-data-backup.tgz -C /data'
docker compose up -d
```

本仓库的 `compose.yaml` 固定 project name 为 `dibao`，因此默认 volume 名是 `dibao_dibao-data`。如你修改了 Compose 文件，请用 `docker volume ls` 确认实际名称。

## 升级

```bash
git pull
docker compose up --build -d
docker compose ps
```

升级前建议先备份 volume。数据库迁移会在 server 启动时自动执行；如果健康检查失败，先查看：

```bash
docker compose logs -f dibao
```

## 常见问题

**局域网 HTTP 访问登录后没有保持会话？**
确认 `DIBAO_COOKIE_SECURE=false`。只有 HTTPS 反向代理后才建议设为 `true`。

**Feed 刷新失败怎么办？**
进入订阅源管理查看 `lastError`。常见原因包括 feed URL 失效、目标站点拒绝访问、XML 格式不合法。

**没有 Embedding provider 能用吗？**
可以。邸报会使用基础排序和用户行为信号；provider 只是增强推荐排序。

**Provider 测试连接失败怎么办？**
检查 Base URL 是否指向 `/v1` 风格 endpoint、模型名和维度是否匹配，以及 API key 是否有效。MVP 不会调用真实云服务做自动兜底。

**如何确认服务健康？**
访问 `/api/system/health`。返回 200 且 `ok: true` 表示数据库、FTS 和 sqlite-vec 基础检查通过。

## 开发

```bash
npm install
npm run typecheck
npm test
npm run build
npm run spike:sqlite-vec
npm run dev:server
npm run dev:web
```

E2E smoke：

```bash
npm run e2e:install
npm run e2e
```

`npm run e2e` 会先构建生产产物，再使用独立临时数据库启动 server。E2E 内部使用本地 fixture RSS 和本地 OpenAI-compatible mock，不访问真实外网。

推荐链发布门禁：

```bash
npm run perf:recommendation
docker build -t dibao:local .
docker compose config
npm run smoke:docker-recommendation
```

真实 Ollama 为可选测试，默认不会在 CI 或 `npm test` 中运行：

```bash
DIBAO_RUN_OLLAMA_TESTS=true npm run test:ollama:optional
```

本机推荐优先测试 `bge-m3`，脚本会先 probe `/api/embed` 并打印实际 dimension。详见 [Ollama 测试指南](./docs/user-testing-ollama.md)。

## 参考文档

- [MVP PRD](./docs/mvp-prd.md)
- [工程蓝图](./docs/engineering-blueprint.md)
- [数据库 Schema](./docs/database-schema.md)
- [API Contract](./docs/api-contract.md)
- [Roadmap](./docs/roadmap.md)
- [Profile Algorithm v0 参数表](./docs/profile-algorithm-v0.md)
- [sqlite-vec Node.js 集成验证](./docs/spikes/sqlite-vec-node.md)
