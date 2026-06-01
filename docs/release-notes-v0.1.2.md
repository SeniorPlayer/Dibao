# Dibao v0.1.2 Release Notes

Dibao v0.1.2 is a maintenance release for the v0.1 line. It focuses on clearer embedding provider failures, safer reader media rendering, and more direct feed/folder navigation.

Release date: 2026-06-01

## 简体中文

### 主要变化

- Embedding provider 测试失败现在会返回更可操作的公开错误：鉴权失败、模型/endpoint 不存在、rate limit、provider 不可用、网络不可达、响应格式异常等会被明确分类。
- Provider 错误会保留可公开展示的上游信息，同时会过滤 API key、token、Authorization 等敏感字段。
- 设置页与后台状态不再把 provider 的测试错误泄漏到不该展示的索引列表里。
- 订阅源管理拆分为“订阅源管理”和“订阅源分组管理”两个视图，减少长页面里混在一起的操作。
- 订阅源和分组管理行新增“查看文章”，可直接跳到对应 feed 或 folder 的 latest 文章列表。
- 文章列表 URL 现在会保留 feed/folder 筛选参数，方便刷新、分享或返回时维持当前上下文。
- 阅读器里的文章图片加载失败后会停止反复重试，避免失败图片持续触发布局抖动或重复网络请求。

### 升级影响

从 v0.1.1 升级到 v0.1.2 不需要新的 SQL migration，也不会触发 recommendation derived-data upgrade。保留同一个 `/data` volume 后替换镜像并重启容器即可。

升级前仍建议备份 `/data/dibao.sqlite` 或整个 Docker volume。升级后打开健康检查接口确认：

```text
GET /api/system/health
```

返回 `version: "0.1.2"` 且 `ok: true` 即表示基础健康检查通过。

### Docker 安装与升级

推荐镜像：

```yaml
image: ghcr.io/pls-1q43/dibao:v0.1.2
```

如需回滚，请先停止 v0.1.2 容器，用升级前备份恢复 SQLite 数据库，再启动上一版镜像。

### 已知限制

- Embedding provider 的错误信息取决于上游服务实际返回的内容；Dibao 会尽量分类并清理敏感字段，但无法修复 provider 本身的不可用状态。
- 文章正文中的远程图片仍取决于原站点、网络和防盗链策略；本版本的修复是避免失败图片反复重试。

## English

### Highlights

- Embedding provider test failures now return more actionable public errors. Authentication failures, missing models/endpoints, rate limits, provider outages, network failures, and malformed responses are classified separately.
- Provider errors preserve safe upstream context while redacting API keys, tokens, Authorization headers, and similar sensitive fields.
- Settings and backend status responses avoid leaking provider test errors into index lists where they do not belong.
- Feed management is split into Feed management and Feed folder management views, reducing mixed long-page operations.
- Feed and folder rows now include View articles, jumping directly to the corresponding latest article list.
- Reader URLs preserve feed/folder filter parameters so refresh, sharing, and back navigation keep the current context.
- Failed article images in the reader stop retrying after load failure, avoiding repeated requests and layout churn.

### Upgrade Impact

Upgrading from v0.1.1 to v0.1.2 does not add SQL migrations and does not trigger a recommendation derived-data upgrade. Keep the same `/data` volume, replace the image, and restart the container.

Back up `/data/dibao.sqlite` or the whole Docker volume before upgrading. After the restart, verify:

```text
GET /api/system/health
```

The response should include `version: "0.1.2"` and `ok: true`.

### Docker Install And Upgrade

Recommended image:

```yaml
image: ghcr.io/pls-1q43/dibao:v0.1.2
```

To roll back, stop the v0.1.2 container, restore the pre-upgrade SQLite backup, and start the previous image.

### Known Limitations

- Embedding provider detail depends on the upstream service response. Dibao classifies and redacts what it can, but it cannot repair an unavailable provider.
- Remote article images still depend on the source site, network, and hotlinking rules. This release prevents failed images from retrying repeatedly.

## 日本語

### 主な変更

- Embedding provider のテスト失敗が、より対応しやすい公開エラーとして返るようになりました。認証失敗、model / endpoint 不存在、rate limit、provider 停止、ネットワーク不可達、不正なレスポンスを分類します。
- Provider のエラーでは、表示してよい上流メッセージを残しつつ、API key、token、Authorization などの機密情報を伏せます。
- 設定画面とバックエンド状態レスポンスで、provider のテストエラーが不要な index 一覧へ漏れないようにしました。
- フィード管理を「フィード管理」と「フィードフォルダー管理」の 2 つのビューに分け、長い画面で操作が混ざりにくくなりました。
- フィードとフォルダーの行に「記事を見る」を追加し、該当 feed / folder の latest 記事一覧へ直接移動できます。
- 記事一覧 URL が feed / folder の絞り込みパラメータを保持するため、更新、共有、戻る操作でも文脈を保ちやすくなりました。
- Reader 内の記事画像が読み込みに失敗した場合、繰り返し再試行しないようにしました。不要な通信とレイアウトの揺れを抑えます。

### アップグレード影響

v0.1.1 から v0.1.2 へのアップグレードでは、新しい SQL migration はありません。recommendation derived-data upgrade も発生しません。同じ `/data` volume を使い、image tag を差し替えてコンテナを再起動してください。

アップグレード前に `/data/dibao.sqlite` または Docker volume 全体をバックアップすることを推奨します。再起動後、次の health check を確認してください。

```text
GET /api/system/health
```

レスポンスに `version: "0.1.2"` と `ok: true` が含まれていれば、基本的な確認は通っています。

### Docker インストールとアップグレード

推奨イメージ:

```yaml
image: ghcr.io/pls-1q43/dibao:v0.1.2
```

ロールバックする場合は、v0.1.2 コンテナを停止し、アップグレード前の SQLite バックアップを復元してから前バージョンのイメージを起動してください。

### 既知の制限

- Embedding provider の詳細は上流サービスのレスポンスに依存します。Dibao は可能な範囲で分類と機密情報の除去を行いますが、provider 自体の停止は修復できません。
- 記事本文内のリモート画像は、元サイト、ネットワーク、防 hotlinking 設定に依存します。本リリースは、失敗した画像が繰り返し再試行されることを防ぎます。
