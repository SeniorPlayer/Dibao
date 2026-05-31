# Dibao Plugin Development Guide

Last updated: 2026-05-31

This document describes the `0.2.0` plugin-system vertical slice: development, distribution, installation, and updates. This release does not ship the formal `app.dibao.daily-brief` plugin, but the official-plugin mechanism must be able to host it.

## Plugin Package

Third-party plugins are distributed as `.dibao-plugin` packages. In `0.2.0`, the baseline package format is JSON:

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

Later versions may wrap the same structure in zip/tar packages, while keeping manifest v1 compatible.

## Manifest v1

Fixed fields:

- `manifestVersion`: must be `1`.
- `id`: plugin ID, preferably reverse-domain style such as `dev.example.reader-tools`.
- `name`: display name.
- `version`: plugin version.
- `publisher`: publisher.
- `dibao.minVersion/maxVersion`: compatible Dibao version range.
- `entry.server/web`: server and web entry points.
- `capabilities`: permission declarations.
- `contributes`: UI, hook, and task contributions.

Initial capabilities:

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

## Distribution

Plugin developers can distribute plugins in three ways:

- Publish a `.dibao-plugin` file for users to upload in the Plugins settings tab.
- Publish a plugin package URL for users to paste into the Plugins settings tab.
- Publish GitHub Release or website update metadata that points to the latest package and checksum.

Recommended metadata:

```json
{
  "pluginId": "dev.example.reader-tools",
  "latestVersion": "0.1.1",
  "packageUrl": "https://example.com/dibao/reader-tools/0.1.1.dibao-plugin",
  "sha256": "..."
}
```

Third-party plugins are installed as `installed` and disabled by default. Dibao runs compatibility, capability, and migration checks when the user enables the plugin.

## Docker Upgrades And Persistence

Users do not need to reinstall third-party plugins after rebuilding or upgrading the official Docker image, as long as the persistent data volume is mounted correctly.

Persistent paths:

- `/data/plugins/installed`: installed third-party packages.
- `/data/plugins/data/<plugin-id>`: plugin runtime data.
- SQLite tables: `plugin_installs`, `plugin_capability_grants`, `plugin_settings`, `plugin_kv`, `plugin_migrations`, `plugin_update_checks`.

After an upgrade, Dibao rescans official plugins and preserves third-party records. Compatible plugins recover their previous state. Incompatible plugins keep their data and move to `incompatible` until the user updates the plugin or Dibao.

## UI And Hooks

Third-party rich UI uses a sandboxed iframe and host bridge. Plugins must not patch the DOM directly. The first low-risk extension points in `0.2.0` include settings tabs, status blocks, and action/route registry entries.

Initial hooks:

- `settings.afterUpdated`
- `article.actionRecorded`
- `ranking.afterRanked`
- `maintenance.tick`

Hot-path hooks must enqueue follow-up work only. They must not synchronously run network calls, embedding generation, index rebuilds, or broad recommendation diagnostics.

## Tasks

Plugin tasks use this job type:

```text
plugin:<pluginId>:<taskId>
```

When a plugin handler is missing, the core JobRunner does not fail the task immediately. It keeps the plugin job paused so the plugin manager can show it. Disabled or incompatible plugins do not register hooks or execute tasks.

## Updates

Update flow:

1. Read the plugin `updateUrl`.
2. Download update metadata.
3. Validate `pluginId`, target Dibao compatibility, and SHA-256.
4. Write a staged package.
5. Back up the old package.
6. Swap the installed directory.
7. Roll back to the old package on failure and preserve the previous state.

Official plugins are bundled with releases and scanned from `/app/plugins/official`; third-party plugins are installed under `/data/plugins/installed`.
