# 邸报开发者指南

Last updated: 2026-05-31

本文是从 `0.2.0` 开始维护的开发者文档入口。开发者文档只提供简体中文和英文两个版本；插件开发文档是本指南的一个子单元，同时也作为独立文件维护。

## 适用范围

- 核心应用开发：Server、Web、DB、推荐算法、迁移和发布验证。
- 插件开发：manifest、权限、Hook、任务、UI 扩展点、分发和更新。
- 自托管集成：Docker、持久化目录、备份、升级和回滚。

## 代码结构

- `apps/server`: Fastify API、后台任务、插件运行时入口。
- `apps/web`: React 前端、设置页、插件管理 UI、插件 UI host bridge。
- `packages/db`: SQLite schema、migration、repository。
- `packages/ranking`: 推荐排序与画像算法。
- `docs`: 对外公开的产品、工程和开发者参考文档。

本地计划、执行记录、临时验证证据和机器特定说明不放在 `docs/`，应放在仓库外或已忽略的 `local-docs/`。

## 开发流程

`0.2` 是当前插件系统和下一大版本功能开发线。普通新功能、UI 改造、推荐算法迭代和插件系统工作默认进入 `0.2`。`0.1` 只用于当前稳定线维护修复。

建议验证顺序：

```bash
npm run typecheck
npm test
npm run build
git diff --check
```

触及 Docker 发布、迁移或持久化路径时，还需要补充 Docker build smoke 和升级持久化 smoke。

## 插件开发

插件开发请阅读：

- [插件开发指南](./plugin-development.zh-CN.md)
- [Plugin development guide](./plugin-development.en-US.md)
- [插件系统设计](./plugin-system-design.md)

插件开发文档固定为中英文双语，不再为其他 UI 语言单独维护开发者文档。

## 兼容性约定

- 公开 API、manifest v1 字段、capability 名称和 Hook 名称必须按文档演进。
- 已发布 migration 不可删除或重写。
- 插件目录、插件数据目录和用户 SQLite 数据库必须在 Docker 重建后保留。
- 会导致 embedding 重算、向量索引重建或推荐画像重建的变更必须走明确的数据升级流程，不能在普通请求路径隐式执行。
