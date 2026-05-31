# Dibao Developer Guide

Last updated: 2026-05-31

This is the developer documentation entry point maintained from `0.2.0` onward. Developer documentation is maintained only in Simplified Chinese and English. Plugin development is a sub-unit of this guide and is also maintained as standalone files.

## Scope

- Core application development: Server, Web, DB, recommendation, migrations, and release validation.
- Plugin development: manifest, capabilities, hooks, tasks, UI extension points, distribution, and updates.
- Self-hosted integration: Docker, persistent volumes, backups, upgrades, and rollback.

## Code Layout

- `apps/server`: Fastify APIs, background jobs, plugin runtime entry points.
- `apps/web`: React frontend, settings workspace, plugin manager UI, plugin UI host bridge.
- `packages/db`: SQLite schema, migrations, repositories.
- `packages/ranking`: recommendation ranking and profile algorithms.
- `docs`: public product, engineering, and developer references.

Local planning notes, execution logs, temporary validation evidence, and machine-specific notes do not belong in `docs/`. Keep them outside the repository or under ignored `local-docs/`.

## Development Flow

`0.2` is the active line for the plugin system and next-version feature work. Ordinary feature work, UI iteration, recommendation changes, and plugin-system work should target `0.2`. The `0.1` line is only for stable-line maintenance fixes.

Recommended validation:

```bash
npm run typecheck
npm test
npm run build
git diff --check
```

When Docker release, migrations, or persistence paths are touched, add Docker build smoke and persistent-upgrade smoke checks.

## Plugin Development

Read:

- [Plugin development guide](./plugin-development.en-US.md)
- [插件开发指南](./plugin-development.zh-CN.md)
- [Plugin system design](./plugin-system-design.md)

Plugin development docs are maintained in Chinese and English only. Other UI locales do not receive separate developer documentation.

## Compatibility Rules

- Public APIs, manifest v1 fields, capability names, and hook names must evolve through documented compatibility changes.
- Released migrations must not be deleted or rewritten.
- Plugin package directories, plugin data directories, and the user SQLite database must survive Docker rebuilds.
- Changes that require embedding recomputation, vector-index rebuilds, or recommendation-profile rebuilds must use an explicit data-upgrade flow and must not run implicitly on ordinary request paths.
