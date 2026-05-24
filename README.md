<p align="center">
  <img src="./apps/web/public/logo-192.png" width="96" height="96" alt="Dibao logo" />
</p>

<h1 align="center">邸报 Dibao</h1>

<p align="center">
  把算法推荐放回你的 RSS 信源里。一个开源、自托管、个人可控的 RSS 推荐阅读器。
</p>

<p align="center">
  <a href="#中文">中文</a> ·
  <a href="#日本語">日本語</a> ·
  <a href="#english">English</a>
</p>

<p align="center">
  <a href="https://github.com/Pls-1q43/dibao"><img alt="GitHub repository" src="https://img.shields.io/badge/GitHub-Pls--1q43%2Fdibao-111827?logo=github" /></a>
  <a href="./compose.yaml"><img alt="Docker Compose" src="https://img.shields.io/badge/Docker_Compose-ready-2563eb?logo=docker&logoColor=white" /></a>
  <a href="./docs/release-notes-v0.1.0.md"><img alt="Release notes" src="https://img.shields.io/badge/release_notes-v0.1.0-2f6f5e" /></a>
</p>

---

## 中文

邸报 Dibao 是一个面向个人的 **自托管 RSS 阅读器、RSS 推荐系统、AI RSS reader、OPML 阅读器、PWA 阅读应用**。它不想再造一个内容平台，也不替你决定该订阅什么；你管理 RSS / Atom 信源，邸报只在这些信源内部帮你排序、去重、搜索、解释推荐原因。

如果你每天打开 RSS 都看到几百篇未读，时间线越来越像一堵墙；如果你不想把阅读历史交给广告平台，却又希望有“更懂我”的推荐；如果你希望推荐可以被追问、被调整、被迁移，邸报就是为这种阅读方式准备的。

快速入口：

- [它解决什么问题](#它解决什么问题)
- [你会得到什么](#你会得到什么)
- [快速安装](#快速安装)
- [推荐 Provider](#推荐-provider)
- [备份与升级](#备份与升级)
- [常见问题](#常见问题)
- [发布说明](./docs/release-notes-v0.1.0.md)
- [Roadmap](./docs/roadmap.md)

### 它解决什么问题

传统 RSS 把所有文章按时间堆在一起。平台推荐会替你扩大信息来源，也会把阅读数据留在平台里。邸报选择中间路线：

- **信源归你**：只整理你订阅的 RSS / Atom，不引入陌生信息流。
- **排序帮你**：从“最新”里筛出更值得先看的文章，让未读列表更像一张可复核的日报。
- **解释给你**：每篇推荐都能看到原因，例如主题相近、来源稳定、时间新鲜、与你最近的阅读反馈有关。
- **数据留给你**：数据库在你的 Docker volume、NAS、家用服务器或 VPS 上。
- **失败可恢复**：订阅源抓取失败、provider 不可用、索引需要重建时，界面会给出状态和恢复入口。

### 你会得到什么

| 场景 | 邸报怎么帮你 |
| --- | --- |
| 每天未读太多 | 首页按推荐理由排序，也保留传统 latest 时间线。 |
| 不想错过重要来源 | 订阅源健康诊断会显示失败、停用、长时间未成功的 feed。 |
| 想整理旧订阅 | OPML 导入导出、分组、手动添加 RSS / Atom 地址。 |
| 想稍后再看 | 收藏、稍后读、已读、未读筛选和清账。 |
| 想知道为什么推荐 | 每篇推荐文章都有解释入口，不只是一个黑盒分数。 |
| 想用免费或低成本模型 | 可接入硅基流动、Gemini、Ollama 或其他 OpenAI-compatible embedding provider。 |
| 想在手机上用 | 支持 PWA 安装到主屏幕；离线时能打开应用壳。 |

当前不做：多用户团队协作、官方托管、社交关注、评论转发、平台外内容推荐、云同步、离线全文文章库。

### 快速安装

推荐用 Docker Compose 运行。把下面内容保存为 `compose.yaml`：

```yaml
name: dibao

services:
  dibao:
    image: ghcr.io/pls-1q43/dibao:v0.1.0
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      DIBAO_HOST: 0.0.0.0
      DIBAO_PORT: "8080"
      DIBAO_DATABASE_PATH: /data/dibao.sqlite
      DIBAO_COOKIE_SECURE: "false"
    volumes:
      - dibao-data:/data

volumes:
  dibao-data:
```

启动：

```bash
docker compose up -d
```

打开 `http://localhost:8080`，创建用户名和密码，然后导入 OPML 或添加第一个 RSS / Atom 地址。

如果你从源码构建当前仓库：

```bash
git clone https://github.com/Pls-1q43/dibao.git
cd dibao
docker compose up --build -d
```

### 推荐 Provider

邸报没有强制绑定任何 AI 服务。你可以先跳过 provider，只用基础排序；也可以接入免费额度或免费层的 embedding provider，让推荐更像“按你的兴趣整理过的 RSS”。

推荐先试这两个：

| Provider | 适合谁 | 邸报里怎么填 |
| --- | --- | --- |
| 硅基流动 SiliconFlow | 国内访问更方便，支持 OpenAI-compatible API，适合中文 / 多语言 RSS。 | 类型：`OpenAI-compatible`<br>Base URL：`https://api.siliconflow.cn/v1`<br>Model：`Qwen/Qwen3-Embedding-0.6B`<br>Dimension：`1024`<br>API Key：硅基流动控制台创建 |
| Gemini | 有 Google AI Studio / Gemini API key，想用 Google 免费层或低成本文本 embedding。 | 类型：`OpenAI-compatible`<br>Base URL：`https://generativelanguage.googleapis.com/v1beta/openai/`<br>Model：`gemini-embedding-001`<br>Dimension：`768`<br>API Key：Google AI Studio 创建 |

配置入口：`设置` -> `推荐 provider` -> 选择 `OpenAI-compatible` -> 填入 Base URL、Model、Dimension、API Key -> `测试连接`。

注意：

- 免费额度、免费层和可用地区会变化，请以 [硅基流动模型与文档](https://docs.siliconflow.cn/cn/api-reference/embeddings/create-embeddings) 和 [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) 当前页面为准。
- 更换模型或维度后，需要重新生成 embedding。邸报会保留旧阅读数据，但不同模型的向量不能直接混用。
- Provider 不可用时，邸报仍可阅读 RSS，只是推荐会退回基础排序。

### 日常使用

1. 导入 OPML 或添加 RSS / Atom 地址。
2. 在 `推荐` 看今天优先阅读的文章，在 `最新` 保留传统时间线。
3. 用收藏、稍后读、已读、不感兴趣来调整后续排序。
4. 对未读债务执行清账：全部、24 小时前、7 天前或 30 天前。
5. 在订阅源管理里查看失败源、重试刷新、调整分组或导出 OPML。

清账是阅读命令，不会被当成喜欢或推荐正反馈；收藏和稍后读也不会被清掉。

### PWA 安装

- Android Chrome / Edge：浏览器菜单 -> 安装应用 / 添加到主屏幕。
- iOS Safari：分享 -> 添加到主屏幕。
- Desktop Chrome / Edge：地址栏安装按钮，或浏览器菜单 -> 安装。

`localhost` / `127.0.0.1` 通常可直接安装。局域网 IP 或公网域名建议使用 HTTPS；如果放在 HTTPS 反向代理后，把 `DIBAO_COOKIE_SECURE` 设为 `true`。

### 备份与升级

邸报默认把数据放在 Docker volume：

```text
dibao-data:/data
/data/dibao.sqlite
```

升级前建议备份：

```bash
docker compose stop
docker run --rm -v dibao_dibao-data:/data -v "$PWD:/backup" busybox \
  sh -c 'tar czf /backup/dibao-data-backup.tgz -C /data .'
docker compose up -d
```

升级发布镜像时，修改 `compose.yaml` 里的 image tag，然后运行：

```bash
docker compose pull
docker compose up -d
docker compose ps
```

数据库迁移会在启动时自动执行。升级后打开 `http://localhost:8080/api/system/health`，返回 `ok: true` 即表示基础健康检查通过。

### 常见问题

**没有 Provider 可以用吗？**

可以。邸报仍然是一个自托管 RSS 阅读器，可以导入 OPML、刷新 feed、阅读、收藏、搜索和清账。Provider 只是让推荐更聪明。

**Provider 测试失败怎么办？**

检查 Base URL、模型名、维度、API Key 是否匹配。硅基流动建议先用 `Qwen/Qwen3-Embedding-0.6B` 和 `1024` 维；Gemini 建议先用 `gemini-embedding-001` 和 `768` 维。

**局域网 HTTP 登录后没有保持会话？**

确认 `DIBAO_COOKIE_SECURE=false`。只有 HTTPS 反向代理后才建议设为 `true`。

**Feed 刷新失败怎么办？**

进入订阅源管理查看错误原因。常见原因包括 feed 地址失效、目标站点拒绝访问、XML 格式异常、网络超时。

**邸报会推荐我没订阅的内容吗？**

不会。邸报只在你明确添加的 RSS / Atom 信源中排序和推荐。

<details>
<summary>维护者与开发者信息</summary>

常用环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DIBAO_HOST` | `0.0.0.0` | Server 监听地址。 |
| `DIBAO_PORT` | `8080` | Server 监听端口。 |
| `DIBAO_DATABASE_PATH` | `/data/dibao.sqlite` | SQLite 数据库路径。 |
| `DIBAO_COOKIE_SECURE` | `false` | HTTP/LAN 自托管可保持 `false`；HTTPS 反向代理后建议设为 `true`。 |
| `DIBAO_BACKGROUND_JOBS` | `true` | 可设为 `false` 关闭后台 job runner，主要用于测试。 |
| `DIBAO_FETCH_TIMEOUT_MS` | `15000` | RSS、发现、全文抓取的单次请求超时。 |
| `DIBAO_FETCH_FEED_MAX_BYTES` | `5242880` | RSS/发现响应最大读取字节数。 |
| `DIBAO_FETCH_FULL_CONTENT_MAX_BYTES` | `3145728` | 全文抓取响应最大读取字节数。 |
| `DIBAO_AUTH_MAX_FAILED_ATTEMPTS` | `5` | 同一用户名/IP 组合允许的连续登录失败次数；设为 `0` 可关闭限速。 |
| `DIBAO_AUTH_LOCKOUT_MS` | `900000` | 登录失败达到阈值后的冷却时间；设为 `0` 可关闭限速。 |
| `DIBAO_SENTRY_CONFIG` | 未设置 | 可选，指向私有 Sentry 构建配置 JSON。默认读取被忽略的 `config/sentry.json`；示例见 [config/sentry.example.json](./config/sentry.example.json)。 |
| `DIBAO_SENTRY_DSN` | 未设置 | 可选，覆盖私有 Sentry 配置中的 DSN。未设置 DSN 时，遥测开关仍显示，但 Sentry SDK 不会初始化。 |
| `SENTRY_AUTH_TOKEN` | 未设置 | 可选，仅用于前端生产构建上传 source maps。 |

开发命令：

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

推荐链和 Docker 验证：

```bash
npm run perf:recommendation
docker build -t dibao:local .
docker compose config
npm run smoke:docker-recommendation
```

参考文档：

- [工程蓝图](./docs/engineering-blueprint.md)
- [数据库 Schema](./docs/database-schema.md)
- [API Contract](./docs/api-contract.md)
- [Profile Algorithm v0 参数表](./docs/profile-algorithm-v0.md)
- [sqlite-vec Node.js 集成验证](./docs/spikes/sqlite-vec-node.md)
- [Ollama 测试指南](./docs/user-testing-ollama.md)

</details>

---

## 日本語

邸报 Dibao は、セルフホストできる個人向け RSS 推薦リーダーです。購読した RSS / Atom フィードだけを対象に、記事を並べ替え、検索し、推薦理由を表示します。知らないコンテンツを勝手に広げるサービスではなく、自分で選んだ情報源を読みやすくするためのツールです。

向いている人：

- RSS の未読が多すぎて、時間順だけでは読み切れない。
- 読書履歴や購読リストを広告プラットフォームに渡したくない。
- OPML、RSS、セルフホスト、Docker Compose、PWA を使って自分の読書環境を持ちたい。
- AI による並び替えは欲しいが、推薦理由も確認したい。

できること：

- OPML インポート / エクスポート。
- RSS / Atom フィード追加、更新、健康診断。
- Recommended、Latest、Favorites、Read Later、Search。
- 保存、あとで読む、既読、興味なし、未読整理。
- SiliconFlow、Gemini、Ollama、OpenAI-compatible provider による embedding 推薦。
- Docker volume に SQLite データを保存。
- PWA としてホーム画面 / Dock に追加。

Docker Compose：

```yaml
name: dibao

services:
  dibao:
    image: ghcr.io/pls-1q43/dibao:v0.1.0
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      DIBAO_HOST: 0.0.0.0
      DIBAO_PORT: "8080"
      DIBAO_DATABASE_PATH: /data/dibao.sqlite
      DIBAO_COOKIE_SECURE: "false"
    volumes:
      - dibao-data:/data

volumes:
  dibao-data:
```

```bash
docker compose up -d
```

`http://localhost:8080` を開き、初回セットアップでユーザー名とパスワードを作成します。Provider は後から設定できます。データは `/data/dibao.sqlite` に保存されるため、アップグレード前に Docker volume をバックアップしてください。

---

## English

Dibao is a **self-hosted RSS reader, AI RSS reader, personal news reader, OPML reader, local-first recommendation system, and PWA reading app** for people who still want to own their sources.

You choose the RSS / Atom feeds. Dibao ranks, deduplicates, searches, and explains articles only inside those feeds. It does not become another content platform, social network, or cloud reading service.

Quick links:

- [Why Dibao](#why-dibao)
- [What You Get](#what-you-get)
- [Quick Install](#quick-install)
- [Recommended Providers](#recommended-providers)
- [Backup And Upgrade](#backup-and-upgrade)
- [FAQ](#faq)
- [Release notes](./docs/release-notes-v0.1.0.md)
- [Roadmap](./docs/roadmap.md)

### Why Dibao

Chronological RSS is honest, but it can become impossible to scan. Platform feeds are convenient, but they move your reading data and discovery logic into someone else's system. Dibao keeps the good part of RSS while adding a recommendation layer you can inspect.

- Your subscriptions stay under your control.
- Recommendations only happen inside your own feeds.
- Each recommendation can show human-readable reasons.
- The SQLite database stays in your Docker volume, NAS, home server, or VPS.
- Provider failures, feed errors, and indexing work are visible and recoverable.

### What You Get

| Need | Dibao |
| --- | --- |
| Too many unread articles | Recommended view ranks today's queue; Latest remains available. |
| Keep RSS portable | OPML import and export. |
| Understand recommendations | Article-level explanation for topic, source, freshness, and feedback signals. |
| Avoid platform lock-in | Self-hosted Docker deployment with local SQLite storage. |
| Use low-cost AI | Works with SiliconFlow, Gemini, Ollama, and OpenAI-compatible embedding providers. |
| Read on mobile | Installable PWA with app-shell caching. |

Dibao does not provide multi-user teams, hosted sync, social following, comments, platform-wide recommendations, or offline full-article storage.

### Quick Install

Create `compose.yaml`:

```yaml
name: dibao

services:
  dibao:
    image: ghcr.io/pls-1q43/dibao:v0.1.0
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      DIBAO_HOST: 0.0.0.0
      DIBAO_PORT: "8080"
      DIBAO_DATABASE_PATH: /data/dibao.sqlite
      DIBAO_COOKIE_SECURE: "false"
    volumes:
      - dibao-data:/data

volumes:
  dibao-data:
```

Start Dibao:

```bash
docker compose up -d
```

Open `http://localhost:8080`, create the owner login, then import OPML or add your first RSS / Atom feed.

To build from source:

```bash
git clone https://github.com/Pls-1q43/dibao.git
cd dibao
docker compose up --build -d
```

### Recommended Providers

Dibao works without an AI provider, but embeddings make recommendations more personal. Good first choices:

| Provider | Settings |
| --- | --- |
| SiliconFlow | Type: `OpenAI-compatible`<br>Base URL: `https://api.siliconflow.cn/v1`<br>Model: `Qwen/Qwen3-Embedding-0.6B`<br>Dimension: `1024` |
| Gemini | Type: `OpenAI-compatible`<br>Base URL: `https://generativelanguage.googleapis.com/v1beta/openai/`<br>Model: `gemini-embedding-001`<br>Dimension: `768` |

Free tiers and regional availability can change. Check the current [SiliconFlow embeddings docs](https://docs.siliconflow.cn/cn/api-reference/embeddings/create-embeddings) and [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) before depending on either provider for heavy use.

### Backup And Upgrade

Default data path:

```text
dibao-data:/data
/data/dibao.sqlite
```

Back up before upgrading:

```bash
docker compose stop
docker run --rm -v dibao_dibao-data:/data -v "$PWD:/backup" busybox \
  sh -c 'tar czf /backup/dibao-data-backup.tgz -C /data .'
docker compose up -d
```

Upgrade:

```bash
docker compose pull
docker compose up -d
docker compose ps
```

Health check: `http://localhost:8080/api/system/health`.

### FAQ

**Can I use Dibao without an AI provider?**

Yes. You still get RSS reading, OPML, search, saved articles, read-later, feed management, and baseline sorting.

**Will Dibao recommend content outside my subscriptions?**

No. Recommendations stay inside your RSS / Atom feeds.

**Where is my data stored?**

In your SQLite database under the Docker volume mounted at `/data`.

**Can I install it on my phone?**

Yes, as a PWA from Safari, Chrome, or Edge. HTTPS is recommended outside localhost.
