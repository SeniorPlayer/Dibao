# Dibao v0.1.3 Release Notes

Dibao v0.1.3 is a maintenance release for the v0.1 line. It focuses on feed-management usability, clearer reader metadata, and safer embedding provider behavior for Ollama and Gemini.

Release date: 2026-06-04

## 简体中文

### 主要变化

- 订阅源管理页进一步压缩垂直空间：添加订阅改为在订阅源行内打开弹窗，订阅源健康度归入列表筛选，减少大屏下仍然可见的布局拥挤。
- 来源筛选启用时，文章列表里的来源按钮现在会显示状态提示，避免用户无意打开来源筛选后误以为列表刷新异常。
- 推荐文章、最新文章、稍后读等页面在非英文界面下恢复英文副标题；英文界面继续保持无副标题。
- 文章列表、搜索结果和阅读界面现在会显示文章年份，跨年阅读时不必打开原文才能确认具体年份。
- Ollama provider 默认切片长度降为 4000 字符，并在设置界面增加中文长文/bge-m3 提示；遇到 Ollama 上下文过长错误时会自动用更短切片重试一次。
- Gemini embedding 维度请求更可靠：Google AI Studio 的 OpenAI-compatible 入口会发送 `dimensions`，原生 Gemini provider 会发送 `outputDimensionality`，支持按配置使用 768 / 1536 / 3072 维。

### 升级影响

从 v0.1.2 升级到 v0.1.3 不需要新的 SQL migration，也不会触发 recommendation derived-data upgrade。保留同一个 `/data` volume 后替换镜像并重启容器即可。

升级前仍建议备份 `/data/dibao.sqlite` 或整个 Docker volume。升级后打开健康检查接口确认：

```text
GET /api/system/health
```

返回 `version: "0.1.3"` 且 `ok: true` 即表示基础健康检查通过。

### Docker 安装与升级

推荐镜像：

```yaml
image: ghcr.io/pls-1q43/dibao:v0.1.3
```

如需回滚，请先停止 v0.1.3 容器，用升级前备份恢复 SQLite 数据库，再启动上一版镜像。

### 已知限制

- Ollama 不同模型和上下文配置仍可能需要手动调低切片长度；如果 bge-m3 仍提示上下文过长，建议降到 3000 字符。
- Gemini/OpenAI-compatible 的维度能力取决于上游 provider 是否支持对应参数；Dibao 会对 Google Gemini 路径发送维度请求并继续执行返回向量维度校验。

## English

### Highlights

- Feed management uses less vertical space: adding a feed now opens from the feed row, and feed health is folded into list filtering instead of occupying a full-width row.
- The source filter button now shows an active state when source filtering is enabled, making accidental source filters easier to notice.
- Localized reader pages such as For You, Latest, and Read Later restore their English subtitles outside the English UI; the English UI remains subtitle-free.
- Article lists, search results, and the reader header now include the publication year so cross-year articles are unambiguous without opening the source page.
- Ollama provider defaults to 4000-character slices and shows guidance for Chinese long-form content/bge-m3. Ollama context-length failures retry once with a shorter slice.
- Gemini embedding dimensions are requested explicitly. Google AI Studio through the OpenAI-compatible endpoint receives `dimensions`, and the native Gemini provider receives `outputDimensionality`, enabling configured 768 / 1536 / 3072-dimensional output.

### Upgrade Impact

Upgrading from v0.1.2 to v0.1.3 does not add SQL migrations and does not trigger a recommendation derived-data upgrade. Keep the same `/data` volume, replace the image, and restart the container.

Back up `/data/dibao.sqlite` or the whole Docker volume before upgrading. After the restart, verify:

```text
GET /api/system/health
```

The response should include `version: "0.1.3"` and `ok: true`.

### Docker Install And Upgrade

Recommended image:

```yaml
image: ghcr.io/pls-1q43/dibao:v0.1.3
```

To roll back, stop the v0.1.3 container, restore the pre-upgrade SQLite backup, and start the previous image.

### Known Limitations

- Ollama models and context settings may still require manual slice tuning. If bge-m3 still reports context length errors, try 3000 characters.
- Gemini/OpenAI-compatible dimensionality depends on upstream provider support. Dibao sends dimension requests for Google Gemini paths and still validates returned vector dimensions.

## 日本語

### 主な変更

- フィード管理画面の縦方向の余白を減らしました。フィード追加は行内のボタンからダイアログを開き、フィード健全性は一覧フィルターに統合しました。
- ソースフィルターが有効な場合、記事一覧のソースボタンに状態が表示されるようになり、意図せず絞り込んでいる状態に気づきやすくなりました。
- おすすめ、最新、あとで読むなどのページで、英語以外の UI では英語サブタイトルを復元しました。英語 UI では引き続きサブタイトルを表示しません。
- 記事一覧、検索結果、Reader のメタ情報に公開年を表示し、年をまたぐ記事でも元ページを開かずに年を確認できます。
- Ollama provider の既定切り出し長を 4000 文字に下げ、中国語長文 / bge-m3 向けの案内を追加しました。Ollama の文脈長エラーでは、より短い切り出しで 1 回だけ再試行します。
- Gemini embedding の次元数を明示的に要求します。Google AI Studio の OpenAI-compatible endpoint には `dimensions` を、native Gemini provider には `outputDimensionality` を送り、768 / 1536 / 3072 次元の設定を使えるようにしました。

### アップグレード影響

v0.1.2 から v0.1.3 へのアップグレードでは、新しい SQL migration はありません。recommendation derived-data upgrade も発生しません。同じ `/data` volume を使い、image tag を差し替えてコンテナを再起動してください。

アップグレード前に `/data/dibao.sqlite` または Docker volume 全体をバックアップすることを推奨します。再起動後、次の health check を確認してください。

```text
GET /api/system/health
```

レスポンスに `version: "0.1.3"` と `ok: true` が含まれていれば、基本的な確認は通っています。

### Docker インストールとアップグレード

推奨イメージ:

```yaml
image: ghcr.io/pls-1q43/dibao:v0.1.3
```

ロールバックする場合は、v0.1.3 コンテナを停止し、アップグレード前の SQLite バックアップを復元してから前バージョンのイメージを起動してください。

### 既知の制限

- Ollama のモデルや文脈長設定によっては、切り出し長を手動でさらに下げる必要があります。bge-m3 で文脈長エラーが続く場合は 3000 文字を試してください。
- Gemini / OpenAI-compatible の次元数指定は上流 provider の対応に依存します。Dibao は Google Gemini の経路で次元数を送信し、返ってきたベクトル次元も引き続き検証します。
