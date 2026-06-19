# Dibao v0.2.0 Release Notes

Dibao v0.2.0 brings the plugin system online. This release adds a trusted local plugin runtime, signed plugin package support, sandboxed plugin UI, plugin tasks and hooks, and two official plugins that show how the new extension surface works in practice.

Release date: 2026-06-19

## 简体中文

端午安康。Dibao v0.2.0 的重点是插件系统正式上线：邸报现在可以通过可信本地插件扩展设置页、导航入口、后台任务、事件 Hook、插件数据、Secrets 和出站投递。

### 主要变化

- 插件系统上线：支持 manifest v1、安装/启用/禁用/卸载、签名包校验、trusted keys、插件迁移、插件任务、事件 Hook、插件私有数据和设置项。
- 插件 UI 运行在 sandboxed iframe 中，并通过受控 bridge 调用宿主能力；服务端插件运行在独立 Node host 子进程中，通过白名单 Host API 与邸报交互。
- 官方 Daily Brief 插件随镜像提供：每天从过去 24 小时的个性化推荐中生成按兴趣主题分组的每日简报，并提供独立导航页和设置页。
- 官方 Webhook 插件随镜像提供：可根据文章动作、订阅源刷新、排序完成、设置更新、插件任务结果和 Daily Brief 生成事件，向外部 HTTP 服务发送可配置的 webhook。
- 插件开发工具链上线：新增 `@dibao/plugin-sdk` 和 `@dibao/plugin-cli`，支持插件校验、打包和签名。
- 0.2 还包含推荐列表、前台读取、后台任务、迁移等待、健康检查和插件宿主稳定性的性能/可靠性修复。

### 升级影响

从 v0.1.x 升级到 v0.2.0 包含一次阻塞式数据库迁移，用于创建插件系统所需的核心表和索引。首次启动时，邸报会先完成 core blocking migration gate，再对外提供正常服务；数据量较大或磁盘较慢时可能需要等待一段时间。

升级前请先备份 `/data/dibao.sqlite` 或整个 Docker volume。备份完成后，保留同一个 `/data` volume，替换镜像并重启容器即可。升级后打开健康检查接口确认：

```text
GET /api/system/health
```

返回 `version: "0.2.0"` 且 `ok: true` 即表示基础健康检查通过。

### Docker 安装与升级

推荐镜像：

```yaml
image: ghcr.io/pls-1q43/dibao:v0.2.0
```

如需回滚，请先停止 v0.2.0 容器，用升级前备份恢复 SQLite 数据库和 `/data` volume，再启动上一版镜像。

### Sentry 发布校验

v0.2.0 正式 Docker 镜像通过 GitHub Actions 使用 BuildKit secret `dibao_sentry_config` 注入私有 Sentry 构建配置。发布验证只报告 `hasDsn`、`hasOrg` 和 `hasProject` 等布尔值，不会在源码、日志或 Release Note 中公开 DSN、org、project 或 token。

### 有用链接

- Webhook 使用说明：https://docs.dibao.app/zh/plugins/webhook/
- 插件开发说明：https://docs.dibao.app/zh/plugins/development/
- 插件安装说明：[`docs/plugin-installation.zh-CN.md`](./plugin-installation.zh-CN.md)
- 插件开发指南：[`docs/plugin-development.zh-CN.md`](./plugin-development.zh-CN.md)

### 已知限制

- 第三方服务端插件仍是可信本地代码，不是任意恶意代码沙箱；只安装你信任的来源，并检查签名、公钥、capabilities 和服务端代码风险。
- 部分 Host API 标记为 Beta，可能在 0.2.x 中调整字段或语义；长期插件应优先使用 Stable API 和 manifest migrations。

## English

Dibao v0.2.0 launches the plugin system. Plugins can now extend settings, navigation, background tasks, hooks, plugin-owned data, secrets, and outbound deliveries while running through a trusted local runtime.

### Highlights

- Plugin platform: manifest v1, install/enable/disable/uninstall flows, signed package verification, trusted keys, plugin migrations, tasks, hooks, private plugin data, and plugin settings.
- Safer runtime boundaries: plugin web UI runs inside a sandboxed iframe with a host bridge, while server plugins run in a separate Node host process with a whitelisted Host API.
- Official Daily Brief plugin: generates a daily, topic-grouped brief from the last 24 hours of personalized recommendations and adds its own page and settings.
- Official Webhook plugin: sends configurable HTTP webhooks for article actions, feed refreshes, ranking completion, settings updates, plugin task results, and Daily Brief generation.
- Plugin tooling: `@dibao/plugin-sdk` and `@dibao/plugin-cli` support validation, packaging, and signing.
- Reliability work across recommendation reads, foreground performance, background jobs, migrations, health checks, and plugin host behavior.

### Upgrade Impact

Upgrading from v0.1.x to v0.2.0 includes a blocking database migration that creates the core tables and indexes required by the plugin system. On first startup, Dibao completes the core blocking migration gate before serving normal traffic; larger databases or slower disks may take some time.

Back up `/data/dibao.sqlite` or the whole Docker volume before upgrading. After the backup, keep the same `/data` volume, replace the image, and restart the container. Then verify:

```text
GET /api/system/health
```

The response should include `version: "0.2.0"` and `ok: true`.

### Docker Install And Upgrade

Recommended image:

```yaml
image: ghcr.io/pls-1q43/dibao:v0.2.0
```

To roll back, stop the v0.2.0 container, restore the pre-upgrade SQLite database and `/data` volume backup, then start the previous image.

### Useful Links

- Webhook guide: https://docs.dibao.app/zh/plugins/webhook/
- Plugin development guide: https://docs.dibao.app/zh/plugins/development/
- Plugin installation docs: [`docs/plugin-installation.en-US.md`](./plugin-installation.en-US.md)
- Plugin development docs: [`docs/plugin-development.en-US.md`](./plugin-development.en-US.md)

### Known Limitations

- Third-party server plugins are trusted local code, not an arbitrary malicious-code sandbox. Install only trusted packages and review signatures, trusted keys, capabilities, and server-code risk.
- Some Host APIs are Beta and may change during 0.2.x. Long-lived plugins should prefer Stable APIs and manifest migrations.

## 日本語

Dibao v0.2.0 ではプラグインシステムが利用できるようになりました。プラグインは、設定画面、ナビゲーション、バックグラウンドタスク、Hook、プラグイン専用データ、Secrets、外部配信を拡張できます。

### 主な変更

- manifest v1、インストール / 有効化 / 無効化 / アンインストール、署名パッケージ検証、trusted keys、プラグイン migration、tasks、hooks、設定、プライベートデータに対応しました。
- Web UI は sandboxed iframe 内で動作し、host bridge 経由で宿主機能にアクセスします。サーバープラグインは独立した Node host 子プロセスで実行されます。
- 公式 Daily Brief プラグインを同梱しました。過去 24 時間のパーソナライズ推薦から、興味トピックごとの日次ブリーフを生成します。
- 公式 Webhook プラグインを同梱しました。記事操作、フィード更新、ランキング完了、設定更新、プラグインタスク結果、Daily Brief 生成イベントを外部 HTTP サービスへ送信できます。
- `@dibao/plugin-sdk` と `@dibao/plugin-cli` により、プラグインの検証、パッケージ化、署名を行えます。

### アップグレード影響

v0.1.x から v0.2.0 へのアップグレードでは、プラグインシステムに必要なコアテーブルとインデックスを作成する blocking database migration が 1 回実行されます。初回起動時は core blocking migration gate が完了するまで通常のサービス提供を開始しません。データ量が多い場合やディスクが遅い場合は、少し時間がかかることがあります。

アップグレード前に `/data/dibao.sqlite` または Docker volume 全体をバックアップしてください。バックアップ後、同じ `/data` volume を使い、image tag を差し替えてコンテナを再起動してください。再起動後、次の health check を確認してください。

```text
GET /api/system/health
```

レスポンスに `version: "0.2.0"` と `ok: true` が含まれていれば、基本的な確認は通っています。
