# 邸报插件开发指南

Last updated: 2026-05-31

本文描述 `0.2.0` 插件基础纵切的开发、分发、安装和更新方式。本版本不包含 `app.dibao.daily-brief` 正式插件，但官方插件机制必须能够承载它。

## 插件包

第三方插件以 `.dibao-plugin` 分发。`0.2.0` 的基础包格式是 JSON：

```json
{
  "manifest": {
    "manifestVersion": 1,
    "id": "dev.example.reader-tools",
    "name": "Reader Tools",
    "version": "0.1.0",
    "publisher": "Example",
    "dibao": {
      "minVersion": "0.2.0",
      "maxVersion": "<0.3.0"
    },
    "entry": {
      "server": "server/index.mjs",
      "web": "web/index.html"
    },
    "capabilities": ["articles:read", "settings:plugin"],
    "contributes": {
      "settingsTabs": [],
      "tabs": [],
      "actions": [],
      "hooks": ["settings.afterUpdated"],
      "tasks": [
        {
          "id": "refresh",
          "kind": "background",
          "schedule": "manual",
          "defaultEnabled": false
        }
      ]
    }
  },
  "files": {
    "web/index.html": "<!doctype html><html><body>Plugin UI</body></html>"
  },
  "updateUrl": "https://example.com/dibao/reader-tools/latest.json"
}
```

后续版本可以把同一结构封装进 zip/tar，但 manifest v1 字段保持兼容。

## Manifest v1

固定字段：

- `manifestVersion`: 当前必须为 `1`。
- `id`: 插件 ID，建议使用反向域名，如 `dev.example.reader-tools`。
- `name`: 展示名。
- `version`: 插件版本。
- `publisher`: 发布者。
- `dibao.minVersion/maxVersion`: Dibao 兼容范围。
- `entry.server/web`: 服务端入口和 Web 入口。
- `capabilities`: 权限声明。
- `contributes`: UI、Hook、任务贡献点。

首批 capability：

```text
articles:read
articles:write
feeds:read
feeds:write
ranking:read
ranking:write
settings:plugin
settings:core:read
settings:core:write
jobs:read
jobs:write
network:outbound
files:plugin-data
telemetry:emit
```

## 分发

开发者可以用三种方式分发：

- 直接提供 `.dibao-plugin` 文件，用户在设置的插件页上传安装。
- 提供插件包 URL，用户在插件页粘贴 URL 安装。
- 在 GitHub Release 或自有站点发布 update metadata，metadata 指向最新插件包和 checksum。

推荐同时发布 SHA-256：

```json
{
  "pluginId": "dev.example.reader-tools",
  "latestVersion": "0.1.1",
  "packageUrl": "https://example.com/dibao/reader-tools/0.1.1.dibao-plugin",
  "sha256": "..."
}
```

用户安装第三方插件后，插件默认是 `installed`/未启用。启用时 Dibao 才执行兼容性、权限和 migration 检查。

## Docker 升级和持久化

Docker 重建或升级官方镜像时，第三方插件不需要重新安装，前提是用户正确挂载了持久化数据卷。

持久化路径：

- `/data/plugins/installed`: 已安装第三方插件包。
- `/data/plugins/data/<plugin-id>`: 插件运行数据。
- SQLite 数据库中的 `plugin_installs`、`plugin_capability_grants`、`plugin_settings`、`plugin_kv`、`plugin_migrations`、`plugin_update_checks`。

升级后 Dibao 会重新扫描官方插件目录，并保留第三方插件记录。兼容插件恢复原状态；不兼容插件保留数据但进入 `incompatible`，等待用户更新插件或升级 Dibao。

## UI 和 Hook

第三方 rich UI 使用 sandboxed iframe 和 host bridge，不允许直接 patch DOM。`0.2.0` 首批低风险扩展点包括 settings tabs、状态块、action/route registry。

首批 Hook：

- `settings.afterUpdated`
- `article.actionRecorded`
- `ranking.afterRanked`
- `maintenance.tick`

热路径 Hook 必须只 enqueue 后续任务，不能同步执行网络请求、embedding、索引重建或大规模推荐诊断。

## 任务

插件任务使用 job type：

```text
plugin:<pluginId>:<taskId>
```

插件缺失 handler 时，核心 JobRunner 不把任务直接标记失败，而是保留为插件暂停状态，插件管理页展示该状态。禁用或不兼容插件不会注册 Hook 或执行任务。

## 版本更新

更新流程：

1. 读取插件的 `updateUrl`。
2. 下载 update metadata。
3. 校验 `pluginId`、目标 Dibao 版本范围和 SHA-256。
4. 写入 staging package。
5. 备份旧包。
6. 替换安装目录。
7. 失败时回滚旧包并保留原状态。

官方插件随 Release 分发，从 `/app/plugins/official` 扫描；第三方插件安装到 `/data/plugins/installed`。
