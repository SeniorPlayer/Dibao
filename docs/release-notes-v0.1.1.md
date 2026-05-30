# Dibao v0.1.1 Release Notes

Dibao v0.1.1 is a corrective release for the personalized recommendation profile introduced after v0.1.0. It focuses on interest-cluster quality, topic-family boundaries, upgrade safety, and Docker release reliability.

Release date: 2026-05-30

## 简体中文

### 主要变化

- 修复兴趣簇过度合并：避免不同主题被吸进一个超大兴趣簇，例如测试数据中出现过的“AI / 不是 / 你自己”式巨簇。
- 修复兴趣簇过度碎片化：避免升级后大部分兴趣簇退化成只有 1 篇文章。
- 新增每个 embedding index 独立的 calibration。Dibao 会根据当前 provider、模型、dimension 和本库向量分布，在重建/升级时生成并冻结本 index 的合并阈值。
- 合并逻辑加入约束：centroid 相似度、pairwise guard、标题/来源证据、最大簇规模、最大吸收步长都会参与判断。
- 主题组现在也有上限设置。默认值为 positive clusters 48、negative clusters 32、positive families 16、negative families 12，设置入口与兴趣簇上限放在同一区域。
- 推荐排序收紧 topic family 的作用：cluster 仍是语义匹配主依据，family 主要用于解释和多样性，宽泛主题组不会直接放大推荐匹配分。
- 升级界面会说明本次阻塞迁移只重建 derived recommendation data，不重算 embeddings，不会产生新的 embedding API 费用。
- labels/升级相关界面保持分批处理和让出事件循环，降低低功耗 NAS 上 CPU 100% 时“界面像升级失败”的误判。
- 修复在文章列表点击“加载更多”后，滚过第二页未打开文章可能不再自动标记为已忽略的问题。
- Docker 发布流水线要求注入私有 Sentry build config，正式镜像会同时包含服务端和浏览器端的运行期 Sentry 配置。

### 升级影响

从 v0.1.0 升级到 v0.1.1 会自动执行新增数据库迁移 `018_interest_cluster_calibrations.sql`，并在首次启动后进入一次阻塞式 recommendation derived-data upgrade。该升级会重建兴趣簇、主题组、labels 和 ranking rows，但不会调用 embedding provider，也不会重算 embeddings。

升级前请备份 `/data/dibao.sqlite` 或整个 Docker volume。首次启动时，普通阅读界面会暂时被升级进度页阻塞；升级完成后自动恢复。

### Docker 安装与升级

推荐镜像：

```yaml
image: ghcr.io/pls-1q43/dibao:v0.1.1
```

保留同一个 `/data` volume 后替换镜像并重启容器即可。健康检查地址为：

```text
GET /api/system/health
```

如需回滚，请先停止 v0.1.1 容器，用升级前备份恢复 SQLite 数据库，再启动上一版镜像。

### 已知限制

- 低样本库会使用保守 fallback calibration；推荐质量仍需要用户行为与 embedding 覆盖逐步积累。
- 低功耗 NAS 上首次 derived-data upgrade 可能需要一些时间，但界面会显示具体进度。
- 如果用户主动更换 embedding 模型或 dimension，历史 embedding 仍不能跨模型混用，需要为新 index 生成新 embedding。

## English

### Highlights

- Fixes over-merged interest clusters so unrelated topics no longer collapse into one large cluster.
- Fixes over-fragmented profiles where most clusters degraded into single-article clusters after an upgrade.
- Adds per-index calibration. Dibao now estimates and freezes thresholds for each embedding index from the active provider, model, dimension, and local vector distribution during rebuild or upgrade.
- Adds constrained merging with centroid similarity, pairwise guards, title/source evidence, maximum cluster size, and bounded absorb steps.
- Adds topic-family caps beside the existing interest-cluster caps. Defaults are positive clusters 48, negative clusters 32, positive families 16, and negative families 12.
- Tightens ranking usage of topic families. Clusters remain the primary semantic match signal; families are used for explanation and diversity rather than broad score amplification.
- The blocking upgrade copy now states that the migration rebuilds derived recommendation data only. It does not recompute embeddings and will not create embedding API cost.
- Labels and upgrade screens keep batched/yielding behavior so low-power NAS devices remain visibly alive under high CPU load.
- Fixes scroll-past ignore telemetry after using Load more, so unopened appended articles can still be marked ignored when scrolled past.
- Docker publishing now requires private Sentry build config so release images include both server and browser runtime Sentry configuration.

### Upgrade Impact

Upgrading from v0.1.0 to v0.1.1 automatically runs the new SQL migration `018_interest_cluster_calibrations.sql`, then performs one blocking recommendation derived-data upgrade on first start. The upgrade rebuilds clusters, families, labels, and ranking rows, but it does not call an embedding provider or recompute embeddings.

Back up `/data/dibao.sqlite` or the whole Docker volume before upgrading. During the first start, the normal reader UI is paused behind a progress screen until the derived-data upgrade finishes.

### Docker Install And Upgrade

Recommended image:

```yaml
image: ghcr.io/pls-1q43/dibao:v0.1.1
```

Keep the same `/data` volume, replace the image tag, and restart the container. Health check:

```text
GET /api/system/health
```

To roll back, stop the v0.1.1 container, restore the pre-upgrade SQLite backup, and start the previous image.

### Known Limitations

- Low-sample libraries use conservative fallback calibration; recommendation quality still improves with behavior history and embedding coverage.
- The first derived-data upgrade can take time on low-power NAS devices, but progress is shown.
- If the user changes embedding model or dimension, old embeddings still cannot be mixed into the new index; the new index needs its own embeddings.

## 日本語

### 主な変更

- 関係の薄い記事が 1 つの巨大な興味クラスタへ吸収される問題を修正しました。
- アップグレード後にほとんどのクラスタが 1 記事だけになる過度な断片化を修正しました。
- embedding index ごとの calibration を追加しました。Dibao は rebuild / upgrade 時に、現在の provider、model、dimension、ローカルのベクトル分布から閾値を推定し、その index 用に固定します。
- centroid 類似度、pairwise guard、タイトル/ソースの根拠、最大クラスタサイズ、吸収ステップ上限を使う制約付きマージを導入しました。
- 既存の興味クラスタ上限と同じ設定エリアに topic family 上限を追加しました。初期値は positive clusters 48、negative clusters 32、positive families 16、negative families 12 です。
- 推薦ランキングでの topic family の扱いを抑制しました。semantic match の主役は cluster のままで、family は主に説明と多様性に使われます。
- ブロッキング upgrade 画面に、この移行は derived recommendation data の再構築だけであり、embedding の再生成や API 費用は発生しないことを明記しました。
- labels / upgrade 画面は分割処理と yield を維持し、低消費電力 NAS で CPU が高くなっても進行中であることが見えるようにしました。
- 「さらに読み込む」を使った後も、追加された未読記事を開かずに通過した場合に無視済みへ自動反映されるよう修正しました。
- Docker publish workflow は private Sentry build config を必須にし、正式イメージに server/browser 両方の runtime Sentry 設定を含めます。

### アップグレード影響

v0.1.0 から v0.1.1 へアップグレードすると、新しい SQL migration `018_interest_cluster_calibrations.sql` が自動実行され、その後初回起動時に recommendation derived-data upgrade が 1 回ブロッキングで実行されます。この upgrade は clusters、families、labels、ranking rows を再構築しますが、embedding provider は呼び出さず、embedding の再生成も行いません。

アップグレード前に `/data/dibao.sqlite` または Docker volume 全体をバックアップしてください。初回起動時は進捗画面が通常の reader UI を一時的にブロックし、完了後に自動復帰します。

### Docker インストールとアップグレード

推奨イメージ:

```yaml
image: ghcr.io/pls-1q43/dibao:v0.1.1
```

同じ `/data` volume を使い、image tag を差し替えてコンテナを再起動してください。ヘルスチェック:

```text
GET /api/system/health
```

ロールバックする場合は、v0.1.1 コンテナを停止し、アップグレード前の SQLite バックアップを復元してから前バージョンのイメージを起動してください。

### 既知の制限

- サンプルが少ないライブラリでは保守的な fallback calibration を使います。推薦品質は行動履歴と embedding coverage に応じて改善します。
- 低消費電力 NAS では初回 derived-data upgrade に時間がかかる場合がありますが、進捗は画面に表示されます。
- embedding model や dimension を変更した場合、古い embedding は新しい index に混在できません。新しい index 用の embedding が必要です。

## Migration List From v0.1.0

SQL migration newly applied after v0.1.0:

- `018_interest_cluster_calibrations.sql`

Blocking derived-data upgrade:

- `v0.1.1-interest-profile-calibration-rebuild`

This derived-data upgrade reuses existing embeddings and does not recompute them.
