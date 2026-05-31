import type {
  DibaoDatabase,
  PluginInstallRow,
  PluginInstallStatus,
  PluginSourceType,
  PluginTrustLevel,
  PluginUpdateCheckRow,
  UpsertPluginInstallInput,
  UpsertPluginUpdateCheckInput
} from "../types.js";

type PluginInstallDbRow = {
  id: string;
  version: string;
  sourceType: PluginSourceType;
  sourceUrl: string | null;
  updateUrl: string | null;
  packagePath: string | null;
  dataPath: string | null;
  manifestJson: string;
  status: PluginInstallStatus;
  official: number;
  bundled: number;
  trustLevel: PluginTrustLevel;
  installedAt: number;
  updatedAt: number;
  enabledAt: number | null;
  disabledAt: number | null;
  lastError: string | null;
};

type PluginUpdateCheckDbRow = {
  pluginId: string;
  latestVersion: string | null;
  updateUrl: string | null;
  packageUrl: string | null;
  checksum: string | null;
  metadataJson: string | null;
  checkedAt: number;
  error: string | null;
};

export interface PluginRepository {
  deleteInstall(pluginId: string): void;
  findInstall(pluginId: string): PluginInstallRow | null;
  getKv<T>(pluginId: string, key: string): T | null;
  getSetting<T>(pluginId: string, key: string): T | null;
  grantCapabilities(pluginId: string, capabilities: string[], now?: number): void;
  listCapabilityGrants(pluginId: string): string[];
  listInstalls(): PluginInstallRow[];
  listSettings(pluginId: string): Record<string, unknown>;
  setKv(pluginId: string, key: string, value: unknown, now?: number): void;
  setSetting(pluginId: string, key: string, value: unknown, now?: number): void;
  setStatus(pluginId: string, status: PluginInstallStatus, error?: string | null, now?: number): void;
  upsertInstall(input: UpsertPluginInstallInput): PluginInstallRow;
  upsertUpdateCheck(input: UpsertPluginUpdateCheckInput): PluginUpdateCheckRow;
}

export class SqlitePluginRepository implements PluginRepository {
  constructor(private readonly db: DibaoDatabase) {}

  deleteInstall(pluginId: string): void {
    this.db.prepare("delete from plugin_installs where id = ?").run(pluginId);
  }

  findInstall(pluginId: string): PluginInstallRow | null {
    const row = this.db
      .prepare(`${basePluginInstallSelect()} where id = ?`)
      .get(pluginId) as PluginInstallDbRow | undefined;

    return row ? mapPluginInstall(row) : null;
  }

  getKv<T>(pluginId: string, key: string): T | null {
    return readJsonRow<T>(this.db, "plugin_kv", pluginId, key);
  }

  getSetting<T>(pluginId: string, key: string): T | null {
    return readJsonRow<T>(this.db, "plugin_settings", pluginId, key);
  }

  grantCapabilities(pluginId: string, capabilities: string[], now = Date.now()): void {
    const insert = this.db.prepare(`
      insert or ignore into plugin_capability_grants (plugin_id, capability, granted_at)
      values (?, ?, ?)
    `);

    this.db.transaction(() => {
      this.db.prepare("delete from plugin_capability_grants where plugin_id = ?").run(pluginId);
      for (const capability of capabilities) {
        insert.run(pluginId, capability, now);
      }
    })();
  }

  listCapabilityGrants(pluginId: string): string[] {
    return (
      this.db
        .prepare(
          `
            select capability
            from plugin_capability_grants
            where plugin_id = ?
            order by capability
          `
        )
        .all(pluginId) as Array<{ capability: string }>
    ).map((row) => row.capability);
  }

  listInstalls(): PluginInstallRow[] {
    return (
      this.db
        .prepare(
          `
            ${basePluginInstallSelect()}
            order by official desc, bundled desc, id
          `
        )
        .all() as PluginInstallDbRow[]
    ).map(mapPluginInstall);
  }

  listSettings(pluginId: string): Record<string, unknown> {
    const rows = this.db
      .prepare(
        `
          select key, value_json as valueJson
          from plugin_settings
          where plugin_id = ?
          order by key
        `
      )
      .all(pluginId) as Array<{ key: string; valueJson: string }>;

    const settings: Record<string, unknown> = {};
    for (const row of rows) {
      settings[row.key] = JSON.parse(row.valueJson);
    }
    return settings;
  }

  setKv(pluginId: string, key: string, value: unknown, now = Date.now()): void {
    writeJsonRow(this.db, "plugin_kv", pluginId, key, value, now);
  }

  setSetting(pluginId: string, key: string, value: unknown, now = Date.now()): void {
    writeJsonRow(this.db, "plugin_settings", pluginId, key, value, now);
  }

  setStatus(pluginId: string, status: PluginInstallStatus, error: string | null = null, now = Date.now()): void {
    this.db
      .prepare(
        `
          update plugin_installs
          set
            status = ?,
            last_error = ?,
            enabled_at = case when ? = 'enabled' then ? else enabled_at end,
            disabled_at = case when ? in ('disabled', 'incompatible', 'failed') then ? else disabled_at end,
            updated_at = ?
          where id = ?
        `
      )
      .run(status, error, status, now, status, now, now, pluginId);
  }

  upsertInstall(input: UpsertPluginInstallInput): PluginInstallRow {
    const now = input.now ?? Date.now();
    const existing = this.findInstall(input.id);
    this.db
      .prepare(
        `
          insert into plugin_installs (
            id,
            version,
            source_type,
            source_url,
            update_url,
            package_path,
            data_path,
            manifest_json,
            status,
            official,
            bundled,
            trust_level,
            installed_at,
            updated_at,
            enabled_at,
            disabled_at,
            last_error
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          on conflict(id) do update set
            version = excluded.version,
            source_type = excluded.source_type,
            source_url = excluded.source_url,
            update_url = excluded.update_url,
            package_path = excluded.package_path,
            data_path = excluded.data_path,
            manifest_json = excluded.manifest_json,
            status = excluded.status,
            official = excluded.official,
            bundled = excluded.bundled,
            trust_level = excluded.trust_level,
            updated_at = excluded.updated_at,
            enabled_at = excluded.enabled_at,
            disabled_at = excluded.disabled_at,
            last_error = excluded.last_error
        `
      )
      .run(
        input.id,
        input.version,
        input.sourceType,
        input.sourceUrl ?? null,
        input.updateUrl ?? null,
        input.packagePath ?? null,
        input.dataPath ?? null,
        input.manifestJson,
        input.status,
        input.official ? 1 : 0,
        input.bundled ? 1 : 0,
        input.trustLevel,
        existing?.installedAt ?? now,
        now,
        input.status === "enabled" ? now : existing?.enabledAt ?? null,
        input.status === "disabled" ? now : existing?.disabledAt ?? null,
        input.lastError ?? null
      );

    const install = this.findInstall(input.id);
    if (!install) {
      throw new Error(`Failed to upsert plugin install: ${input.id}`);
    }
    return install;
  }

  upsertUpdateCheck(input: UpsertPluginUpdateCheckInput): PluginUpdateCheckRow {
    const now = input.now ?? Date.now();
    this.db
      .prepare(
        `
          insert into plugin_update_checks (
            plugin_id,
            latest_version,
            update_url,
            package_url,
            checksum,
            metadata_json,
            checked_at,
            error
          )
          values (?, ?, ?, ?, ?, ?, ?, ?)
          on conflict(plugin_id) do update set
            latest_version = excluded.latest_version,
            update_url = excluded.update_url,
            package_url = excluded.package_url,
            checksum = excluded.checksum,
            metadata_json = excluded.metadata_json,
            checked_at = excluded.checked_at,
            error = excluded.error
        `
      )
      .run(
        input.pluginId,
        input.latestVersion ?? null,
        input.updateUrl ?? null,
        input.packageUrl ?? null,
        input.checksum ?? null,
        input.metadataJson ?? null,
        now,
        input.error ?? null
      );

    const row = this.db
      .prepare(
        `
          select
            plugin_id as pluginId,
            latest_version as latestVersion,
            update_url as updateUrl,
            package_url as packageUrl,
            checksum,
            metadata_json as metadataJson,
            checked_at as checkedAt,
            error
          from plugin_update_checks
          where plugin_id = ?
        `
      )
      .get(input.pluginId) as PluginUpdateCheckDbRow | undefined;

    if (!row) {
      throw new Error(`Failed to upsert plugin update check: ${input.pluginId}`);
    }
    return row;
  }
}

function basePluginInstallSelect(): string {
  return `
    select
      id,
      version,
      source_type as sourceType,
      source_url as sourceUrl,
      update_url as updateUrl,
      package_path as packagePath,
      data_path as dataPath,
      manifest_json as manifestJson,
      status,
      official,
      bundled,
      trust_level as trustLevel,
      installed_at as installedAt,
      updated_at as updatedAt,
      enabled_at as enabledAt,
      disabled_at as disabledAt,
      last_error as lastError
    from plugin_installs
  `;
}

function mapPluginInstall(row: PluginInstallDbRow): PluginInstallRow {
  return {
    ...row,
    official: row.official === 1,
    bundled: row.bundled === 1
  };
}

function readJsonRow<T>(
  db: DibaoDatabase,
  table: "plugin_kv" | "plugin_settings",
  pluginId: string,
  key: string
): T | null {
  const row = db
    .prepare(
      `
        select value_json as valueJson
        from ${table}
        where plugin_id = ?
          and key = ?
      `
    )
    .get(pluginId, key) as { valueJson: string } | undefined;

  return row ? (JSON.parse(row.valueJson) as T) : null;
}

function writeJsonRow(
  db: DibaoDatabase,
  table: "plugin_kv" | "plugin_settings",
  pluginId: string,
  key: string,
  value: unknown,
  now: number
): void {
  db.prepare(
    `
      insert into ${table} (plugin_id, key, value_json, updated_at)
      values (?, ?, ?, ?)
      on conflict(plugin_id, key) do update set
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `
  ).run(pluginId, key, JSON.stringify(value), now);
}
