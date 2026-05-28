<p align="center">
  <img src="./apps/web/public/logo-192.png" width="96" height="96" alt="Dibao logo" />
</p>

<h1 align="center">邸报 Dibao</h1>

<p align="center">
  セルフホストできる、source-available / fair-code の個人向け RSS 推薦リーダー。
</p>

<p align="center">
  <a href="./README.md">中文</a> ·
  <a href="./README.ja.md">日本語</a> ·
  <a href="./README.en.md">English</a>
</p>

<p align="center">
  <a href="https://github.com/Pls-1q43/dibao"><img alt="GitHub repository" src="https://img.shields.io/badge/GitHub-Pls--1q43%2Fdibao-111827?logo=github" /></a>
  <a href="./compose.yaml"><img alt="Docker Compose" src="https://img.shields.io/badge/Docker_Compose-ready-2563eb?logo=docker&logoColor=white" /></a>
  <a href="./docs/release-notes-v0.1.0.md"><img alt="Release notes" src="https://img.shields.io/badge/release_notes-v0.1.0-2f6f5e" /></a>
</p>

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
- ローカル Mac / Windows では Ollama + `bge-m3` によるローカル embedding。
- 小さな VPS では Gemini の無料枠、または SiliconFlow / 硅基流动の `BAAI/bge-m3` を推奨。`BAAI/bge-m3` は無料で、日次上限ではなく RPM / TPM のレート制限で利用できます。
- Docker volume に SQLite データを保存。
- PWA としてホーム画面 / Dock に追加。

日本国内向けの無料 embedding provider も確認しましたが、README に安定して推奨できる「日本発・無料・OpenAI-compatible・embedding 対応」の選択肢は見つかりませんでした。日本語 RSS でも、まずはローカル Ollama、Gemini、または SiliconFlow の国際向け API を使う構成が現実的です。

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

詳細な製品説明と開発情報は [中文主页](./README.md) を参照してください。
