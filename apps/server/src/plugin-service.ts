import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  DibaoDatabase,
  JobRepository,
  JobRow,
  PluginInstallRow,
  PluginRepository,
  PluginScheduleRow
} from "@dibao/db";
import type { JobHandler } from "./job-runner.js";

export const PLUGIN_CAPABILITIES = [
  "articles:read",
  "articles:write",
  "feeds:read",
  "feeds:write",
  "ranking:read",
  "ranking:write",
  "settings:plugin",
  "settings:core:read",
  "settings:core:write",
  "jobs:read",
  "jobs:write",
  "database:plugin",
  "network:outbound",
  "files:plugin-data",
  "telemetry:emit"
] as const;

const PLUGIN_CAPABILITY_SET = new Set<string>(PLUGIN_CAPABILITIES);
const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;
const PLUGIN_SCHEMA_NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const PLUGIN_HOOK_TIMEOUT_MS = 2_000;

export type PluginManifest = {
  manifestVersion: 1;
  id: string;
  name: string;
  version: string;
  publisher: string;
  dibao: {
    minVersion: string;
    maxVersion: string;
  };
  entry?: {
    server?: string;
    web?: string;
  };
  capabilities: string[];
  contributes?: {
    settingsTabs?: PluginPanelContribution[];
    tabs?: PluginPanelContribution[];
    routes?: PluginRouteContribution[];
    actions?: PluginActionContribution[];
    hooks?: string[];
    tasks?: PluginTaskContribution[];
    setupSteps?: PluginSetupStepContribution[];
  };
};

export type PluginPanelContribution = {
  id: string;
  title: string;
  slot: string;
  order?: number;
  icon?: string;
  route?: string;
  primaryNav?: boolean;
  primaryMobile?: boolean;
};

export type PluginRouteContribution = {
  id: string;
  path: string;
  title: string;
  panel: string;
  order?: number;
  icon?: string;
  primaryNav?: boolean;
  primaryMobile?: boolean;
};

export type PluginActionContribution = {
  id: string;
  title: string;
  slot: string;
  icon?: string;
  command: string;
  order?: number;
};

export type PluginTaskContribution = {
  id: string;
  kind: "foreground" | "background";
  schedule?: "manual" | "interval" | "daily" | "weekly";
  defaultEnabled?: boolean;
};

export type PluginSetupStepContribution = {
  id: string;
  title: string;
  body?: string;
  order?: number;
  defaultEnabled?: boolean;
};

type PluginPackage = {
  manifest?: unknown;
  files?: Record<string, string>;
  updateUrl?: string;
};

type PluginUpdateMetadata = {
  pluginId?: unknown;
  latestVersion?: unknown;
  updateUrl?: unknown;
  packageUrl?: unknown;
  sha256?: unknown;
  checksum?: unknown;
  manifest?: unknown;
  files?: Record<string, string>;
};

export type PluginListItem = {
  id: string;
  name: string;
  version: string;
  publisher: string;
  status: PluginInstallRow["status"];
  sourceType: PluginInstallRow["sourceType"];
  sourceUrl: string | null;
  updateUrl: string | null;
  official: boolean;
  bundled: boolean;
  trustLevel: PluginInstallRow["trustLevel"];
  capabilities: string[];
  grantedCapabilities: string[];
  contributes: PluginManifest["contributes"];
  contributions: PluginRuntimeContributions;
  installedAt: string;
  updatedAt: string;
  enabledAt: string | null;
  disabledAt: string | null;
  lastError: string | null;
};

export type PluginContributionListItem = PluginListItem & {
  webEntryUrl: string | null;
};

export type RankedWinner = {
  articleId: string;
  feedId: string;
  feedTitle: string;
  title: string;
  url: string;
  summary: string | null;
  publishedAt: number | null;
  discoveredAt: number;
  score: number | null;
  calculatedAt: number | null;
  familyId: string;
  familyLabel: string;
  reason: string | null;
};

export class PluginServiceError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "PluginServiceError";
  }
}

export type PluginServiceOptions = {
  db: DibaoDatabase;
  plugins: PluginRepository;
  jobs: JobRepository;
  dibaoVersion: string;
  getActiveRankContext: () => string;
  officialPluginsDir?: string;
  pluginDataDir?: string;
  fetcher?: typeof fetch;
  now?: () => number;
};

type PluginRuntime = {
  pluginId: string;
  hooks: Map<string, Array<(payload: unknown) => Promise<void> | void>>;
  tasks: Map<string, (job: JobRow) => Promise<void> | void>;
  apiGet: Map<string, (input: PluginApiInput) => Promise<unknown> | unknown>;
  apiPost: Map<string, (input: PluginApiInput) => Promise<unknown> | unknown>;
};

type PluginApiInput = {
  params: Record<string, string>;
  body: unknown;
};

type PluginRuntimeContributions = {
  routes: Array<{ id: string; title: string; path: string }>;
  primaryNav: Array<{ label: string; route: string; icon?: string; order?: number }>;
  primaryMobile: Array<{ label: string; route: string; icon?: string; order?: number }>;
  settingsTabs: Array<{ id: string; label: string; route: string; order?: number }>;
  setupSteps: Array<{
    id: string;
    title: string;
    body: string;
    enableLabel?: string;
    skipLabel?: string;
    recommended?: boolean;
  }>;
};

type PluginTableColumnType = "text" | "integer" | "real" | "boolean" | "json";

type PluginTableColumnDefinition = {
  name: string;
  type: PluginTableColumnType;
  nullable?: boolean;
  unique?: boolean;
  default?: string | number | boolean | null;
};

type PluginTableIndexDefinition = {
  name: string;
  columns: string[];
  unique?: boolean;
};

type PluginTableDefinition = {
  name: string;
  columns: PluginTableColumnDefinition[];
  indexes?: PluginTableIndexDefinition[];
};

type PluginTableListInput = {
  where?: Record<string, unknown>;
  limit?: number;
  orderBy?: string;
  direction?: "asc" | "desc";
};

export class PluginService {
  private readonly now: () => number;
  private readonly fetcher: typeof fetch;
  private readonly runtimes = new Map<string, Promise<PluginRuntime>>();
  readonly officialPluginsDir: string;
  readonly pluginDataDir: string;
  readonly installedPluginsDir: string;
  readonly pluginRuntimeDataDir: string;

  constructor(private readonly options: PluginServiceOptions) {
    this.now = options.now ?? Date.now;
    this.fetcher = options.fetcher ?? fetch;
    this.officialPluginsDir = resolvePluginPath(
      options.officialPluginsDir ??
        process.env.DIBAO_OFFICIAL_PLUGINS_DIR ??
        defaultOfficialPluginsDir()
    );
    this.pluginDataDir = resolvePluginPath(
      options.pluginDataDir ?? process.env.DIBAO_PLUGIN_DATA_DIR ?? "/data/plugins"
    );
    this.installedPluginsDir = join(this.pluginDataDir, "installed");
    this.pluginRuntimeDataDir = join(this.pluginDataDir, "data");
  }

  async checkUpdate(pluginId: string): Promise<PluginListItem> {
    const install = this.requireInstall(pluginId);
    if (!install.updateUrl) {
      throw new PluginServiceError(400, "VALIDATION_ERROR", "Plugin has no update URL");
    }
    const metadata = await this.fetchUpdateMetadata(install.updateUrl);
    this.options.plugins.upsertUpdateCheck({
      pluginId,
      latestVersion: stringOrNull(metadata.latestVersion),
      updateUrl: stringOrNull(metadata.updateUrl) ?? install.updateUrl,
      packageUrl: stringOrNull(metadata.packageUrl),
      checksum: stringOrNull(metadata.sha256) ?? stringOrNull(metadata.checksum),
      metadataJson: JSON.stringify(metadata),
      now: this.now()
    });

    if (typeof metadata.packageUrl === "string") {
      await this.installFromUrl(metadata.packageUrl, {
        expectedId: pluginId,
        expectedSha256: stringOrNull(metadata.sha256) ?? stringOrNull(metadata.checksum),
        previousStatus: install.status
      });
    }

    return this.requireListItem(pluginId);
  }

  disable(pluginId: string): PluginListItem {
    this.requireInstall(pluginId);
    this.options.plugins.setStatus(pluginId, "disabled", null, this.now());
    this.runtimes.delete(pluginId);
    return this.requireListItem(pluginId);
  }

  enable(pluginId: string): PluginListItem {
    const install = this.requireInstall(pluginId);
    const manifest = parseStoredManifest(install);
    const compatibility = isDibaoVersionCompatible(this.options.dibaoVersion, manifest.dibao);
    if (!compatibility.ok) {
      this.options.plugins.setStatus(pluginId, "incompatible", compatibility.reason, this.now());
      return this.requireListItem(pluginId);
    }
    try {
      this.seedDefaultSchedules(pluginId, manifest);
      this.options.plugins.grantCapabilities(pluginId, manifest.capabilities, this.now());
      this.options.plugins.setStatus(pluginId, "enabled", null, this.now());
      this.runtimes.delete(pluginId);
      return this.requireListItem(pluginId);
    } catch (error) {
      this.options.plugins.setStatus(pluginId, "failed", errorMessage(error), this.now());
      throw error;
    }
  }

  async emitHook(hook: string, payload: unknown): Promise<void> {
    const installs = this.enabledInstallsForHook(hook);
    for (const install of installs) {
      const runtime = await this.ensureRuntime(install);
      const handlers = runtime.hooks.get(hook) ?? [];
      for (const handler of handlers) {
        try {
          await withTimeout(Promise.resolve(handler(payload)), PLUGIN_HOOK_TIMEOUT_MS);
          this.options.plugins.setKv(
            install.id,
            `hook:${hook}:last`,
            { hook, receivedAt: this.now(), payload },
            this.now()
          );
        } catch (error) {
          this.options.plugins.setStatus(install.id, "failed", errorMessage(error), this.now());
          this.runtimes.delete(install.id);
        }
      }
    }
  }

  async enqueueDueSchedules(): Promise<JobRow[]> {
    const enqueued: JobRow[] = [];
    for (const schedule of this.options.plugins.listDueSchedules(this.now())) {
      const install = this.options.plugins.findInstall(schedule.pluginId);
      if (!install || install.status !== "enabled") {
        continue;
      }
      const manifest = parseStoredManifest(install);
      const task = manifest.contributes?.tasks?.find((candidate) => candidate.id === schedule.taskId);
      if (!task) {
        continue;
      }
      const job = this.startTask(schedule.pluginId, schedule.taskId, {
        scheduledAt: this.now(),
        schedule
      });
      enqueued.push(job);
      this.options.plugins.upsertSchedule({
        ...schedule,
        lastRunAt: this.now(),
        lastJobId: job.id,
        nextRunAt: nextRunForSchedule(schedule, this.now()),
        now: this.now()
      });
    }
    return enqueued;
  }

  getHealth(pluginId: string): Record<string, unknown> {
    const install = this.requireInstall(pluginId);
    const manifest = parseStoredManifest(install);
    return {
      pluginId,
      status: install.status,
      compatible: isDibaoVersionCompatible(this.options.dibaoVersion, manifest.dibao).ok,
      lastError: install.lastError,
      capabilities: manifest.capabilities,
      schedules: this.options.plugins.listSchedules(pluginId),
      tasks: manifest.contributes?.tasks ?? []
    };
  }

  getSettings(pluginId: string): Record<string, unknown> {
    this.requireInstall(pluginId);
    return this.options.plugins.listSettings(pluginId);
  }

  handlePluginJob: JobHandler = async (job: JobRow) => {
    const parsed = parsePluginJobType(job.type);
    if (!parsed) {
      throw new PluginServiceError(400, "VALIDATION_ERROR", "Invalid plugin job type");
    }
    const install = this.requireInstall(parsed.pluginId);
    if (install.status !== "enabled") {
      throw new Error(`Plugin is not enabled: ${parsed.pluginId}`);
    }
    const runtime = await this.ensureRuntime(install);
    const handler = runtime.tasks.get(parsed.taskId);
    if (!handler) {
      throw new Error(`Plugin task is not registered: ${parsed.taskId}`);
    }
    await handler(job);
  };

  async installFromPackageContent(
    packageContent: string,
    input: {
      sourceType: "local_file" | "url" | "github_release" | "registry";
      sourceUrl?: string | null;
      updateUrl?: string | null;
      expectedId?: string;
      expectedSha256?: string | null;
      previousStatus?: PluginInstallRow["status"];
    }
  ): Promise<PluginListItem> {
    if (input.expectedSha256) {
      const actual = createHash("sha256").update(packageContent).digest("hex");
      if (actual !== input.expectedSha256) {
        throw new PluginServiceError(400, "VALIDATION_ERROR", "Plugin package checksum mismatch");
      }
    }
    const parsed = parsePluginPackage(packageContent);
    const manifest = parsePluginManifest(parsed.manifest);
    if (input.expectedId && manifest.id !== input.expectedId) {
      throw new PluginServiceError(400, "VALIDATION_ERROR", "Plugin package ID mismatch");
    }
    return this.writeInstalledPackage(manifest, parsed.files ?? {}, {
      sourceType: input.sourceType,
      sourceUrl: input.sourceUrl ?? null,
      updateUrl: input.updateUrl ?? parsed.updateUrl ?? input.sourceUrl ?? null,
      previousStatus: input.previousStatus
    });
  }

  async installFromUrl(
    url: string,
    options: {
      expectedId?: string;
      expectedSha256?: string | null;
      previousStatus?: PluginInstallRow["status"];
    } = {}
  ): Promise<PluginListItem> {
    const response = await this.fetcher(url);
    if (!response.ok) {
      throw new PluginServiceError(400, "PROVIDER_ERROR", `Plugin package fetch failed: ${response.status}`);
    }
    const content = await response.text();
    const metadata = parsePluginUpdateMetadataContent(content);
    const packageUrl = stringOrNull(metadata?.packageUrl);
    if (metadata && packageUrl) {
      const packageResponse = await this.fetcher(packageUrl);
      if (!packageResponse.ok) {
        throw new PluginServiceError(
          400,
          "PROVIDER_ERROR",
          `Plugin package fetch failed: ${packageResponse.status}`
        );
      }
      const packageContent = await packageResponse.text();
      return this.installFromPackageContent(packageContent, {
        sourceType: isGitHubUrl(url) ? "github_release" : "url",
        sourceUrl: packageUrl,
        updateUrl: stringOrNull(metadata.updateUrl) ?? url,
        expectedId: options.expectedId ?? stringOrNull(metadata.pluginId) ?? undefined,
        expectedSha256:
          options.expectedSha256 ??
          stringOrNull(metadata.sha256) ??
          stringOrNull(metadata.checksum),
        previousStatus: options.previousStatus
      });
    }
    return this.installFromPackageContent(content, {
      sourceType: isGitHubUrl(url) ? "github_release" : "url",
      sourceUrl: url,
      updateUrl: url,
      expectedId: options.expectedId,
      expectedSha256: options.expectedSha256 ?? null,
      previousStatus: options.previousStatus
    });
  }

  list(): PluginListItem[] {
    this.reconcileOfficialPlugins();
    return this.options.plugins.listInstalls().map((install) => this.toListItem(install));
  }

  listContributions(): PluginContributionListItem[] {
    this.reconcileOfficialPlugins();
    return this.options.plugins
      .listInstalls()
      .filter((install) => install.status === "enabled")
      .map((install) => ({
        ...this.toListItem(install),
        webEntryUrl: this.webEntryUrl(install)
      }));
  }

  listSetupSteps(): PluginContributionListItem[] {
    this.reconcileOfficialPlugins();
    return this.options.plugins
      .listInstalls()
      .filter((install) => {
        const manifest = parseStoredManifest(install);
        return Boolean(manifest.contributes?.setupSteps?.length);
      })
      .map((install) => ({
        ...this.toListItem(install),
        webEntryUrl: this.webEntryUrl(install)
      }));
  }

  listCatalog(): PluginListItem[] {
    this.reconcileOfficialPlugins();
    return this.list().filter((plugin) => plugin.official);
  }

  reconcileOfficialPlugins(): void {
    if (!existsSync(this.officialPluginsDir)) {
      return;
    }
    for (const entry of readdirSync(this.officialPluginsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const packagePath = join(this.officialPluginsDir, entry.name);
      const manifestPath = join(packagePath, "plugin.json");
      if (!existsSync(manifestPath)) {
        continue;
      }
      try {
        const manifest = parsePluginManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
        const compatibility = isDibaoVersionCompatible(this.options.dibaoVersion, manifest.dibao);
        const existing = this.options.plugins.findInstall(manifest.id);
        const status = compatibility.ok
          ? existing?.status === "enabled" || existing?.status === "disabled"
            ? existing.status
            : "installed"
          : "incompatible";
        const install = this.options.plugins.upsertInstall({
          id: manifest.id,
          version: manifest.version,
          sourceType: "official",
          packagePath,
          dataPath: join(this.pluginRuntimeDataDir, manifest.id),
          manifestJson: JSON.stringify(manifest),
          status,
          official: true,
          bundled: true,
          trustLevel: "official",
          lastError: compatibility.ok ? null : compatibility.reason,
          now: this.now()
        });
        this.options.plugins.grantCapabilities(manifest.id, manifest.capabilities, this.now());
      } catch {
        // A broken official plugin must not prevent the app from booting.
      }
    }
  }

  remove(pluginId: string, deleteData = false): void {
    const install = this.requireInstall(pluginId);
    if (install.official) {
      throw new PluginServiceError(400, "VALIDATION_ERROR", "Official plugins cannot be uninstalled");
    }
    if (install.packagePath && existsSync(install.packagePath)) {
      rmSync(install.packagePath, { recursive: true, force: true });
    }
    if (deleteData && install.dataPath && existsSync(install.dataPath)) {
      rmSync(install.dataPath, { recursive: true, force: true });
    }
    this.options.plugins.deleteInstall(pluginId);
    this.runtimes.delete(pluginId);
  }

  resolveAssetPath(pluginId: string, assetPath: string): string | null {
    const install = this.requireInstall(pluginId);
    if (!install.packagePath) {
      return null;
    }
    const normalizedAssetPath = normalize(assetPath).replace(/^(\.\.(?:\/|\\|$))+/, "");
    const root = resolve(install.packagePath);
    const candidate = resolve(root, normalizedAssetPath);
    if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
      return null;
    }
    if (!existsSync(candidate) || !statSync(candidate).isFile()) {
      return null;
    }
    return candidate;
  }

  startTask(pluginId: string, taskId: string, extraPayload: Record<string, unknown> = {}): JobRow {
    const install = this.requireInstall(pluginId);
    if (install.status !== "enabled") {
      throw new PluginServiceError(409, "CONFLICT", "Plugin is not enabled");
    }
    const manifest = parseStoredManifest(install);
    const task = manifest.contributes?.tasks?.find((candidate) => candidate.id === taskId);
    if (!task) {
      throw new PluginServiceError(404, "NOT_FOUND", "Plugin task not found");
    }
    return this.options.jobs.enqueue({
      id: `plugin_${pluginId.replace(/[^a-z0-9]+/gi, "_")}_${taskId.replace(/[^a-z0-9]+/gi, "_")}_${randomBytes(6).toString("hex")}`,
      type: `plugin:${pluginId}:${taskId}`,
      payloadJson: JSON.stringify({ pluginId, taskId, requestedAt: this.now(), ...extraPayload }),
      now: this.now()
    });
  }

  async dispatchApi(pluginId: string, method: "GET" | "POST", path: string, body: unknown): Promise<unknown> {
    const install = this.requireInstall(pluginId);
    if (install.status !== "enabled") {
      throw new PluginServiceError(409, "CONFLICT", "Plugin is not enabled");
    }
    const runtime = await this.ensureRuntime(install);
    const normalizedPath = normalizeApiPath(path);
    const handler = (method === "GET" ? runtime.apiGet : runtime.apiPost).get(normalizedPath);
    if (!handler) {
      throw new PluginServiceError(404, "NOT_FOUND", "Plugin API route not found");
    }
    return handler({ params: {}, body });
  }

  updateSettings(pluginId: string, body: unknown): Record<string, unknown> {
    this.requireInstall(pluginId);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new PluginServiceError(400, "VALIDATION_ERROR", "Plugin settings body must be an object");
    }
    for (const [key, value] of Object.entries(body)) {
      this.options.plugins.setSetting(pluginId, key, value, this.now());
    }
    return this.getSettings(pluginId);
  }

  private async ensureRuntime(install: PluginInstallRow): Promise<PluginRuntime> {
    const existing = this.runtimes.get(install.id);
    if (existing) {
      return existing;
    }
    const runtimePromise = this.activateRuntime(install);
    this.runtimes.set(install.id, runtimePromise);
    return runtimePromise;
  }

  private async activateRuntime(install: PluginInstallRow): Promise<PluginRuntime> {
    const manifest = parseStoredManifest(install);
    const runtime: PluginRuntime = {
      pluginId: install.id,
      hooks: new Map(),
      tasks: new Map(),
      apiGet: new Map(),
      apiPost: new Map()
    };
    if (!install.packagePath || !manifest.entry?.server) {
      return runtime;
    }
    const entryPath = this.resolveAssetPath(install.id, manifest.entry.server);
    if (!entryPath) {
      return runtime;
    }
    const moduleUrl = pathToFileURL(entryPath);
    moduleUrl.searchParams.set("pluginVersion", install.version);
    moduleUrl.searchParams.set("updatedAt", String(install.updatedAt));
    const module = await import(moduleUrl.href) as {
      default?: { activate?: (ctx: unknown) => Promise<void> | void } | ((ctx: unknown) => Promise<void> | void);
      activate?: (ctx: unknown) => Promise<void> | void;
    };
    const activate =
      typeof module.default === "function"
        ? module.default
        : module.default?.activate ?? module.activate;
    if (typeof activate === "function") {
      await activate(this.createContext(install, runtime));
    }
    return runtime;
  }

  private createContext(install: PluginInstallRow, runtime: PluginRuntime): Record<string, unknown> {
    const manifest = parseStoredManifest(install);
    const hasCapability = (capability: string) => manifest.capabilities.includes(capability);
    const requireCapability = (capability: string) => {
      if (!hasCapability(capability)) {
        throw new PluginServiceError(403, "FORBIDDEN", `Plugin capability required: ${capability}`);
      }
    };
    const pluginId = install.id;
    return {
      pluginId,
      manifest,
      now: this.now,
      hooks: {
        on: (hook: string, handler: (payload: unknown) => Promise<void> | void) => {
          const handlers = runtime.hooks.get(hook) ?? [];
          handlers.push(handler);
          runtime.hooks.set(hook, handlers);
        }
      },
      tasks: {
        register: (taskId: string, handler: (job: JobRow) => Promise<void> | void) => {
          runtime.tasks.set(taskId, handler);
        },
        start: (taskId: string, payload?: Record<string, unknown>) => {
          requireCapability("jobs:write");
          return this.startTask(pluginId, taskId, payload);
        }
      },
      api: {
        get: (path: string, handler: (input: PluginApiInput) => Promise<unknown> | unknown) => {
          runtime.apiGet.set(normalizeApiPath(path), handler);
        },
        post: (path: string, handler: (input: PluginApiInput) => Promise<unknown> | unknown) => {
          runtime.apiPost.set(normalizeApiPath(path), handler);
        }
      },
      storage: {
        get: <T>(key: string) => {
          requireCapability("files:plugin-data");
          return this.options.plugins.getKv<T>(pluginId, key);
        },
        set: (key: string, value: unknown) => {
          requireCapability("files:plugin-data");
          this.options.plugins.setKv(pluginId, key, value, this.now());
        },
        listByPrefix: <T>(prefix: string) => {
          requireCapability("files:plugin-data");
          return this.options.plugins.listKvByPrefix<T>(pluginId, prefix);
        },
        delete: (key: string) => {
          requireCapability("files:plugin-data");
          this.options.plugins.deleteKv(pluginId, key);
        }
      },
      settings: {
        get: <T>(key: string) => {
          requireCapability("settings:plugin");
          return this.options.plugins.getSetting<T>(pluginId, key);
        },
        set: (key: string, value: unknown) => {
          requireCapability("settings:plugin");
          this.options.plugins.setSetting(pluginId, key, value, this.now());
        },
        list: () => {
          requireCapability("settings:plugin");
          return this.options.plugins.listSettings(pluginId);
        }
      },
      database: {
        defineTable: (definition: PluginTableDefinition) => {
          requireCapability("database:plugin");
          this.definePluginTable(pluginId, definition);
        },
        insert: (tableName: string, record: Record<string, unknown>) => {
          requireCapability("database:plugin");
          return this.insertPluginRow(pluginId, tableName, record);
        },
        get: (tableName: string, rowId: number) => {
          requireCapability("database:plugin");
          return this.getPluginRow(pluginId, tableName, rowId);
        },
        list: (tableName: string, input: PluginTableListInput = {}) => {
          requireCapability("database:plugin");
          return this.listPluginRows(pluginId, tableName, input);
        },
        delete: (tableName: string, rowId: number) => {
          requireCapability("database:plugin");
          this.deletePluginRow(pluginId, tableName, rowId);
        }
      },
      scheduler: {
        configureDaily: (taskId: string, input: { enabled: boolean; localTime: string; timezone?: string | null }) => {
          requireCapability("jobs:write");
          this.options.plugins.upsertSchedule({
            pluginId,
            taskId,
            enabled: input.enabled,
            schedule: "daily",
            localTime: input.localTime,
            timezone: input.timezone ?? "UTC",
            nextRunAt: nextDailyRunAt(this.now(), input.localTime, input.timezone ?? "UTC"),
            now: this.now()
          });
        }
      },
      ranking: {
        listRankedWinners: (input: { windowMs: number; limit: number }) => {
          requireCapability("ranking:read");
          return this.listRankedWinners(input);
        }
      },
      articles: {
        openableSummary: (articleId: string) => {
          requireCapability("articles:read");
          return this.openableArticleSummary(articleId);
        }
      }
    };
  }

  private listRankedWinners(input: { windowMs: number; limit: number }): RankedWinner[] {
    const limit = Math.min(Math.max(Math.trunc(input.limit), 1), 250);
    const since = this.now() - Math.max(input.windowMs, 60_000);
    const rankContext = this.options.getActiveRankContext();
    const rows = this.options.db
      .prepare(
        `
          select
            a.id as articleId,
            a.feed_id as feedId,
            f.title as feedTitle,
            a.title,
            a.url,
            a.summary,
            a.published_at as publishedAt,
            a.discovered_at as discoveredAt,
            coalesce(rs.score, base_rs.score) as score,
            coalesce(rs.calculated_at, base_rs.calculated_at) as calculatedAt,
            ex.payload_json as payloadJson
          from articles a
          join feeds f on f.id = a.feed_id
          left join article_states s on s.article_id = a.id
          left join article_rank_scores rs
            on rs.article_id = a.id
            and rs.rank_context = ?
          left join article_rank_scores base_rs
            on base_rs.article_id = a.id
            and base_rs.rank_context = ?
          left join article_rank_explanations ex
            on ex.article_id = a.id
            and ex.rank_context = ?
          where a.deleted_at is null
            and a.status != 'deleted'
            and f.deleted_at is null
            and f.enabled = 1
            and s.hidden_at is null
            and s.not_interested_at is null
            and coalesce(a.published_at, a.discovered_at) >= ?
          order by
            case when rs.rerank_position is null then 1 else 0 end,
            rs.rerank_position asc,
            coalesce(rs.score, base_rs.score) desc,
            coalesce(a.published_at, a.discovered_at) desc,
            a.id desc
          limit ?
        `
      )
      .all(rankContext, "base", rankContext, since, limit) as Array<RankedWinner & { payloadJson: string | null }>;

    return rows.map((row) => {
      const payload = parseJsonObject(row.payloadJson);
      const components = parseJsonObject(payload?.components);
      const familyId = stringOrNull(components?.primaryFamilyId) ?? `source:${row.feedId}`;
      const familyLabel = stringOrNull(components?.primaryFamilyLabel) ?? row.feedTitle;
      return {
        articleId: row.articleId,
        feedId: row.feedId,
        feedTitle: row.feedTitle,
        title: row.title,
        url: row.url,
        summary: row.summary,
        publishedAt: row.publishedAt,
        discoveredAt: row.discoveredAt,
        score: row.score,
        calculatedAt: row.calculatedAt,
        familyId,
        familyLabel,
        reason: familyId.startsWith("source:") ? "source" : "interest-family"
      };
    });
  }

  private openableArticleSummary(articleId: string): RankedWinner | null {
    const rows = this.listRankedWinners({ windowMs: 365 * 24 * 60 * 60 * 1000, limit: 250 });
    return rows.find((row) => row.articleId === articleId) ?? null;
  }

  private enabledInstallsForHook(hook: string): PluginInstallRow[] {
    return this.options.plugins
      .listInstalls()
      .filter((install) => {
        if (install.status !== "enabled") {
          return false;
        }
        const manifest = parseStoredManifest(install);
        return manifest.contributes?.hooks?.includes(hook) ?? false;
      });
  }

  private async fetchUpdateMetadata(url: string): Promise<PluginUpdateMetadata> {
    const response = await this.fetcher(url);
    if (!response.ok) {
      throw new PluginServiceError(400, "PROVIDER_ERROR", `Plugin update fetch failed: ${response.status}`);
    }
    return await response.json() as PluginUpdateMetadata;
  }

  private requireInstall(pluginId: string): PluginInstallRow {
    const install = this.options.plugins.findInstall(pluginId);
    if (!install) {
      throw new PluginServiceError(404, "NOT_FOUND", "Plugin not found");
    }
    return install;
  }

  private requireListItem(pluginId: string): PluginListItem {
    return this.toListItem(this.requireInstall(pluginId));
  }

  private toListItem(install: PluginInstallRow): PluginListItem {
    const manifest = parseStoredManifest(install);
    return {
      id: install.id,
      name: manifest.name,
      version: install.version,
      publisher: manifest.publisher,
      status: install.status,
      sourceType: install.sourceType,
      sourceUrl: install.sourceUrl,
      updateUrl: install.updateUrl,
      official: install.official,
      bundled: install.bundled,
      trustLevel: install.trustLevel,
      capabilities: manifest.capabilities,
      grantedCapabilities: this.options.plugins.listCapabilityGrants(install.id),
      contributes: manifest.contributes ?? {},
      contributions: runtimeContributions(manifest.contributes),
      installedAt: new Date(install.installedAt).toISOString(),
      updatedAt: new Date(install.updatedAt).toISOString(),
      enabledAt: install.enabledAt ? new Date(install.enabledAt).toISOString() : null,
      disabledAt: install.disabledAt ? new Date(install.disabledAt).toISOString() : null,
      lastError: install.lastError
    };
  }

  private webEntryUrl(install: PluginInstallRow): string | null {
    const manifest = parseStoredManifest(install);
    return manifest.entry?.web ? `/api/plugins/${encodeURIComponent(install.id)}/assets/${manifest.entry.web}` : null;
  }

  private seedDefaultSchedules(pluginId: string, manifest: PluginManifest): void {
    for (const task of manifest.contributes?.tasks ?? []) {
      if (!task.defaultEnabled || task.schedule !== "daily") {
        continue;
      }
      const existing = this.options.plugins
        .listSchedules(pluginId)
        .find((schedule) => schedule.taskId === task.id);
      if (existing) {
        continue;
      }
      this.options.plugins.upsertSchedule({
        pluginId,
        taskId: task.id,
        enabled: true,
        schedule: "daily",
        localTime: "08:00",
        timezone: "UTC",
        nextRunAt: nextDailyRunAt(this.now(), "08:00", "UTC"),
        now: this.now()
      });
    }
  }

  private definePluginTable(pluginId: string, definition: PluginTableDefinition): void {
    const normalized = normalizePluginTableDefinition(definition);
    const physicalTable = pluginTableName(pluginId, normalized.name);
    const checksum = createHash("sha256")
      .update(JSON.stringify(normalized))
      .digest("hex");
    const version = `schema:${normalized.name}`;
    const existing = this.options.db
      .prepare(
        `
          select name, checksum
          from plugin_migrations
          where plugin_id = ?
            and version = ?
        `
      )
      .get(pluginId, version) as { name: string; checksum: string | null } | undefined;

    if (existing) {
      if (existing.name !== normalized.name || existing.checksum !== checksum) {
        throw new PluginServiceError(
          409,
          "CONFLICT",
          `Plugin table schema changed after creation: ${normalized.name}`
        );
      }
      return;
    }

    const columnSql = normalized.columns.map(pluginColumnSql).join(",\n            ");
    const uniqueSql = normalized.columns
      .filter((column) => column.unique)
      .map((column) => `unique (${quoteIdentifier(column.name)})`);
    const constraints = uniqueSql.length > 0 ? `,\n            ${uniqueSql.join(",\n            ")}` : "";

    this.options.db.transaction(() => {
      this.options.db.exec(
        `
          create table if not exists ${quoteIdentifier(physicalTable)} (
            id integer primary key autoincrement,
            ${columnSql},
            created_at integer not null,
            updated_at integer not null${constraints}
          )
        `
      );
      for (const index of normalized.indexes ?? []) {
        const physicalIndex = pluginIndexName(pluginId, normalized.name, index.name);
        const columns = index.columns.map(quoteIdentifier).join(", ");
        this.options.db.exec(
          `create ${index.unique ? "unique " : ""}index if not exists ${quoteIdentifier(physicalIndex)}
           on ${quoteIdentifier(physicalTable)} (${columns})`
        );
      }
      this.options.db
        .prepare(
          `
            insert into plugin_migrations (plugin_id, version, name, checksum, applied_at)
            values (?, ?, ?, ?, ?)
          `
        )
        .run(pluginId, version, normalized.name, checksum, this.now());
      this.options.plugins.setKv(pluginId, `schema:${normalized.name}`, normalized, this.now());
    })();
  }

  private insertPluginRow(
    pluginId: string,
    tableName: string,
    record: Record<string, unknown>
  ): { id: number } {
    const schema = this.requirePluginTableSchema(pluginId, tableName);
    const columns = schema.columns.filter((column) => Object.hasOwn(record, column.name));
    if (columns.length === 0) {
      throw new PluginServiceError(400, "VALIDATION_ERROR", "Plugin row has no known columns");
    }
    const now = this.now();
    const names = [...columns.map((column) => column.name), "created_at", "updated_at"];
    const placeholders = names.map(() => "?").join(", ");
    const values = [
      ...columns.map((column) => pluginColumnValue(column, record[column.name])),
      now,
      now
    ];
    const result = this.options.db
      .prepare(
        `
          insert into ${quoteIdentifier(pluginTableName(pluginId, schema.name))}
            (${names.map(quoteIdentifier).join(", ")})
          values (${placeholders})
        `
      )
      .run(...values);
    return { id: Number(result.lastInsertRowid) };
  }

  private getPluginRow(pluginId: string, tableName: string, rowId: number): Record<string, unknown> | null {
    const schema = this.requirePluginTableSchema(pluginId, tableName);
    const row = this.options.db
      .prepare(
        `
          select *
          from ${quoteIdentifier(pluginTableName(pluginId, schema.name))}
          where id = ?
        `
      )
      .get(rowId) as Record<string, unknown> | undefined;
    return row ? decodePluginRow(schema, row) : null;
  }

  private listPluginRows(
    pluginId: string,
    tableName: string,
    input: PluginTableListInput
  ): Array<Record<string, unknown>> {
    const schema = this.requirePluginTableSchema(pluginId, tableName);
    const physicalTable = pluginTableName(pluginId, schema.name);
    const columns = new Map(schema.columns.map((column) => [column.name, column]));
    const where = input.where ?? {};
    const whereSql: string[] = [];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(where)) {
      const column = columns.get(key);
      if (!column) {
        throw new PluginServiceError(400, "VALIDATION_ERROR", `Unknown plugin table column: ${key}`);
      }
      whereSql.push(`${quoteIdentifier(key)} = ?`);
      values.push(pluginColumnValue(column, value));
    }
    const orderBy =
      input.orderBy && (columns.has(input.orderBy) || input.orderBy === "created_at" || input.orderBy === "updated_at")
        ? input.orderBy
        : "id";
    const direction = input.direction === "asc" ? "asc" : "desc";
    const limit = Math.min(Math.max(Math.trunc(input.limit ?? 100), 1), 500);
    const rows = this.options.db
      .prepare(
        `
          select *
          from ${quoteIdentifier(physicalTable)}
          ${whereSql.length > 0 ? `where ${whereSql.join(" and ")}` : ""}
          order by ${quoteIdentifier(orderBy)} ${direction}
          limit ?
        `
      )
      .all(...values, limit) as Array<Record<string, unknown>>;
    return rows.map((row) => decodePluginRow(schema, row));
  }

  private deletePluginRow(pluginId: string, tableName: string, rowId: number): void {
    const schema = this.requirePluginTableSchema(pluginId, tableName);
    this.options.db
      .prepare(
        `
          delete from ${quoteIdentifier(pluginTableName(pluginId, schema.name))}
          where id = ?
        `
      )
      .run(rowId);
  }

  private requirePluginTableSchema(pluginId: string, tableName: string): PluginTableDefinition {
    const normalizedName = normalizePluginName(tableName, "table");
    const row = this.options.db
      .prepare(
        `
          select checksum
          from plugin_migrations
          where plugin_id = ?
            and version = ?
        `
      )
      .get(pluginId, `schema:${normalizedName}`) as { checksum: string } | undefined;
    if (!row) {
      throw new PluginServiceError(404, "NOT_FOUND", "Plugin table is not defined");
    }
    const schema = this.options.plugins.getKv<PluginTableDefinition>(
      pluginId,
      `schema:${normalizedName}`
    );
    if (!schema) {
      throw new PluginServiceError(500, "INTERNAL_ERROR", "Plugin table schema metadata is missing");
    }
    return schema;
  }

  private writeInstalledPackage(
    manifest: PluginManifest,
    files: Record<string, string>,
    input: {
      sourceType: "local_file" | "url" | "github_release" | "registry";
      sourceUrl: string | null;
      updateUrl: string | null;
      previousStatus?: PluginInstallRow["status"];
    }
  ): PluginListItem {
    const compatibility = isDibaoVersionCompatible(this.options.dibaoVersion, manifest.dibao);
    const packagePath = join(this.installedPluginsDir, manifest.id);
    const stagingPath = `${packagePath}.staging-${randomBytes(4).toString("hex")}`;
    const backupPath = `${packagePath}.backup-${randomBytes(4).toString("hex")}`;
    mkdirSync(stagingPath, { recursive: true });
    writeFileSync(join(stagingPath, "plugin.json"), JSON.stringify(manifest, null, 2));
    for (const [filePath, content] of Object.entries(files)) {
      const normalizedPath = normalize(filePath).replace(/^(\.\.(?:\/|\\|$))+/, "");
      const targetPath = resolve(stagingPath, normalizedPath);
      if (!targetPath.startsWith(`${resolve(stagingPath)}${sep}`)) {
        continue;
      }
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, content);
    }
    mkdirSync(dirname(packagePath), { recursive: true });
    try {
      if (existsSync(packagePath)) {
        renameSync(packagePath, backupPath);
      }
      renameSync(stagingPath, packagePath);
      rmSync(backupPath, { recursive: true, force: true });
    } catch (error) {
      rmSync(packagePath, { recursive: true, force: true });
      if (existsSync(backupPath)) {
        renameSync(backupPath, packagePath);
      }
      rmSync(stagingPath, { recursive: true, force: true });
      throw new PluginServiceError(500, "INTERNAL_ERROR", "Plugin package install failed", error);
    }

    const dataPath = join(this.pluginRuntimeDataDir, manifest.id);
    mkdirSync(dataPath, { recursive: true });
    const status = compatibility.ok
      ? input.previousStatus === "enabled"
        ? "enabled"
        : "installed"
      : "incompatible";
    const install = this.options.plugins.upsertInstall({
      id: manifest.id,
      version: manifest.version,
      sourceType: input.sourceType,
      sourceUrl: input.sourceUrl,
      updateUrl: input.updateUrl,
      packagePath,
      dataPath,
      manifestJson: JSON.stringify(manifest),
      status,
      official: false,
      bundled: false,
      trustLevel: "untrusted",
      lastError: compatibility.ok ? null : compatibility.reason,
      now: this.now()
    });
    this.options.plugins.grantCapabilities(manifest.id, manifest.capabilities, this.now());
    return this.toListItem(install);
  }
}

export function parsePluginJobType(type: string): { pluginId: string; taskId: string } | null {
  if (!type.startsWith("plugin:")) {
    return null;
  }
  const rest = type.slice("plugin:".length);
  const separator = rest.lastIndexOf(":");
  if (separator <= 0 || separator === rest.length - 1) {
    return null;
  }
  return {
    pluginId: rest.slice(0, separator),
    taskId: rest.slice(separator + 1)
  };
}

function parsePluginPackage(content: string): PluginPackage {
  try {
    const parsed = JSON.parse(content) as PluginPackage;
    if (parsed && typeof parsed === "object" && Object.hasOwn(parsed, "manifest")) {
      return parsed;
    }
    return { manifest: parsed };
  } catch {
    throw new PluginServiceError(400, "VALIDATION_ERROR", "Plugin package must be JSON");
  }
}

function parsePluginUpdateMetadataContent(content: string): PluginUpdateMetadata | null {
  try {
    const parsed = JSON.parse(content) as PluginUpdateMetadata & { manifest?: unknown };
    if (
      parsed &&
      typeof parsed === "object" &&
      !Object.hasOwn(parsed, "manifest") &&
      typeof parsed.packageUrl === "string"
    ) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

function parsePluginManifest(input: unknown): PluginManifest {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new PluginServiceError(400, "VALIDATION_ERROR", "Plugin manifest must be an object");
  }
  const manifest = input as Partial<PluginManifest>;
  if (manifest.manifestVersion !== 1) {
    throw new PluginServiceError(400, "VALIDATION_ERROR", "Plugin manifestVersion must be 1");
  }
  const id = stringValue(manifest.id);
  if (!id || !PLUGIN_ID_PATTERN.test(id)) {
    throw new PluginServiceError(400, "VALIDATION_ERROR", "Plugin id is invalid");
  }
  const name = stringValue(manifest.name);
  const version = stringValue(manifest.version);
  const publisher = stringValue(manifest.publisher);
  if (!name || !version || !publisher) {
    throw new PluginServiceError(400, "VALIDATION_ERROR", "Plugin name, version, and publisher are required");
  }
  const dibao = manifest.dibao;
  if (!dibao || typeof dibao !== "object" || !stringValue(dibao.minVersion) || !stringValue(dibao.maxVersion)) {
    throw new PluginServiceError(400, "VALIDATION_ERROR", "Plugin Dibao compatibility range is required");
  }
  const capabilities = Array.isArray(manifest.capabilities) ? manifest.capabilities : [];
  for (const capability of capabilities) {
    if (typeof capability !== "string" || !PLUGIN_CAPABILITY_SET.has(capability)) {
      throw new PluginServiceError(400, "VALIDATION_ERROR", `Unsupported plugin capability: ${String(capability)}`);
    }
  }
  return {
    manifestVersion: 1,
    id,
    name,
    version,
    publisher,
    dibao: {
      minVersion: dibao.minVersion,
      maxVersion: dibao.maxVersion
    },
    entry: manifest.entry,
    capabilities,
    contributes: normalizeContributions(manifest.contributes)
  };
}

function normalizeContributions(
  contributes: PluginManifest["contributes"]
): NonNullable<PluginManifest["contributes"]> {
  if (!contributes || typeof contributes !== "object") {
    return {};
  }
  return {
    settingsTabs: Array.isArray(contributes.settingsTabs) ? contributes.settingsTabs : [],
    tabs: Array.isArray(contributes.tabs) ? contributes.tabs : [],
    routes: Array.isArray(contributes.routes) ? contributes.routes : [],
    actions: Array.isArray(contributes.actions) ? contributes.actions : [],
    hooks: Array.isArray(contributes.hooks)
      ? contributes.hooks.filter((hook): hook is string => typeof hook === "string")
      : [],
    tasks: Array.isArray(contributes.tasks) ? contributes.tasks : [],
    setupSteps: Array.isArray(contributes.setupSteps) ? contributes.setupSteps : []
  };
}

function runtimeContributions(contributes: PluginManifest["contributes"]): PluginRuntimeContributions {
  const normalized = normalizeContributions(contributes);
  const routes = (normalized.routes ?? []).map((route) => ({
    id: route.id,
    title: route.title,
    path: route.path
  }));
  const primaryNav = dedupePluginNav([
    ...(normalized.tabs ?? [])
      .filter((tab) => tab.primaryNav)
      .map((tab) => ({
        label: tab.title,
        route: tab.route ?? tab.id,
        icon: tab.icon,
        order: tab.order
      })),
    ...(normalized.routes ?? [])
      .filter((route) => route.primaryNav)
      .map((route) => ({
        label: route.title,
        route: route.id,
        icon: route.icon,
        order: route.order
      }))
  ]).sort(sortContributionByOrder);
  const primaryMobile = dedupePluginNav([
    ...(normalized.tabs ?? [])
      .filter((tab) => tab.primaryMobile)
      .map((tab) => ({
        label: tab.title,
        route: tab.route ?? tab.id,
        icon: tab.icon,
        order: tab.order
      })),
    ...(normalized.routes ?? [])
      .filter((route) => route.primaryMobile)
      .map((route) => ({
        label: route.title,
        route: route.id,
        icon: route.icon,
        order: route.order
      }))
  ]).sort(sortContributionByOrder);
  return {
    routes,
    primaryNav,
    primaryMobile,
    settingsTabs: (normalized.settingsTabs ?? [])
      .map((tab) => ({
        id: tab.id,
        label: tab.title,
        route: tab.route ?? tab.id,
        order: tab.order
      }))
      .sort(sortContributionByOrder),
    setupSteps: (normalized.setupSteps ?? [])
      .map((step) => ({
        id: step.id,
        title: step.title,
        body: step.body ?? "",
        recommended: step.defaultEnabled
      }))
      .sort(sortContributionByOrder)
  };
}

function sortContributionByOrder(
  left: { order?: number; label?: string; title?: string },
  right: { order?: number; label?: string; title?: string }
): number {
  return (left.order ?? 100) - (right.order ?? 100) ||
    (left.label ?? left.title ?? "").localeCompare(right.label ?? right.title ?? "");
}

function dedupePluginNav<T extends { route: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.route)) {
      return false;
    }
    seen.add(item.route);
    return true;
  });
}

function parseStoredManifest(install: PluginInstallRow): PluginManifest {
  return parsePluginManifest(JSON.parse(install.manifestJson));
}

function isDibaoVersionCompatible(
  version: string,
  range: { minVersion: string; maxVersion: string }
): { ok: true } | { ok: false; reason: string } {
  if (compareVersions(version, range.minVersion) < 0) {
    return { ok: false, reason: `Requires Dibao >= ${range.minVersion}` };
  }
  const maxVersion = range.maxVersion.trim();
  if (maxVersion.startsWith("<") && compareVersions(version, maxVersion.slice(1).trim()) >= 0) {
    return { ok: false, reason: `Requires Dibao ${maxVersion}` };
  }
  return { ok: true };
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = right.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }
  return 0;
}

function resolvePluginPath(path: string): string {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

function defaultOfficialPluginsDir(): string {
  const candidates = [
    resolve(process.cwd(), "plugins/official"),
    process.env.INIT_CWD ? resolve(process.env.INIT_CWD, "plugins/official") : null,
    resolve(process.cwd(), "../../plugins/official")
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringOrNull(value: unknown): string | null {
  const normalized = stringValue(value);
  return normalized ? normalized : null;
}

function isGitHubUrl(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase().endsWith("github.com");
  } catch {
    return false;
  }
}

function normalizePluginTableDefinition(definition: PluginTableDefinition): PluginTableDefinition {
  const name = normalizePluginName(definition.name, "table");
  if (!Array.isArray(definition.columns) || definition.columns.length === 0) {
    throw new PluginServiceError(400, "VALIDATION_ERROR", "Plugin table needs columns");
  }
  const seenColumns = new Set<string>();
  const columns = definition.columns.map((column) => {
    const columnName = normalizePluginName(column.name, "column");
    if (columnName === "id" || columnName === "created_at" || columnName === "updated_at") {
      throw new PluginServiceError(400, "VALIDATION_ERROR", `Reserved plugin column: ${columnName}`);
    }
    if (seenColumns.has(columnName)) {
      throw new PluginServiceError(400, "VALIDATION_ERROR", `Duplicate plugin column: ${columnName}`);
    }
    seenColumns.add(columnName);
    if (!["text", "integer", "real", "boolean", "json"].includes(column.type)) {
      throw new PluginServiceError(400, "VALIDATION_ERROR", `Unsupported plugin column type: ${String(column.type)}`);
    }
    return {
      name: columnName,
      type: column.type,
      nullable: column.nullable === true,
      unique: column.unique === true,
      default: normalizePluginDefault(column)
    };
  });
  const indexes = Array.isArray(definition.indexes)
    ? definition.indexes.map((index) => {
        const indexName = normalizePluginName(index.name, "index");
        const indexColumns = Array.isArray(index.columns)
          ? index.columns.map((columnName) => normalizePluginName(columnName, "column"))
          : [];
        if (indexColumns.length === 0 || indexColumns.some((columnName) => !seenColumns.has(columnName))) {
          throw new PluginServiceError(400, "VALIDATION_ERROR", `Invalid plugin index columns: ${indexName}`);
        }
        return {
          name: indexName,
          columns: indexColumns,
          unique: index.unique === true
        };
      })
    : [];
  return { name, columns, indexes };
}

function normalizePluginName(value: unknown, label: string): string {
  const normalized = stringValue(value);
  if (!PLUGIN_SCHEMA_NAME_PATTERN.test(normalized)) {
    throw new PluginServiceError(400, "VALIDATION_ERROR", `Invalid plugin ${label} name`);
  }
  return normalized;
}

function normalizePluginDefault(column: PluginTableColumnDefinition): string | number | boolean | null | undefined {
  if (!Object.hasOwn(column, "default")) {
    return undefined;
  }
  if (column.default === null) {
    return null;
  }
  if (column.type === "text" && typeof column.default === "string") {
    return column.default;
  }
  if ((column.type === "integer" || column.type === "real") && typeof column.default === "number") {
    return column.default;
  }
  if (column.type === "boolean" && typeof column.default === "boolean") {
    return column.default;
  }
  throw new PluginServiceError(400, "VALIDATION_ERROR", `Invalid default for plugin column: ${column.name}`);
}

function pluginTableName(pluginId: string, tableName: string): string {
  const scope = createHash("sha256").update(pluginId).digest("hex").slice(0, 12);
  return `plugin_${scope}_${tableName}`;
}

function pluginIndexName(pluginId: string, tableName: string, indexName: string): string {
  const scope = createHash("sha256").update(`${pluginId}:${tableName}:${indexName}`).digest("hex").slice(0, 16);
  return `idx_plugin_${scope}`;
}

function pluginColumnSql(column: PluginTableColumnDefinition): string {
  const type = column.type === "json" || column.type === "boolean" ? "text" : column.type;
  const notNull = column.nullable ? "" : " not null";
  const defaultSql = Object.hasOwn(column, "default")
    ? ` default ${pluginDefaultSql(column.default)}`
    : "";
  return `${quoteIdentifier(column.name)} ${type}${notNull}${defaultSql}`;
}

function pluginDefaultSql(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "'true'" : "'false'";
  }
  return `'${value.replaceAll("'", "''")}'`;
}

function pluginColumnValue(column: PluginTableColumnDefinition, value: unknown): unknown {
  if (value === null || value === undefined) {
    if (!column.nullable) {
      throw new PluginServiceError(400, "VALIDATION_ERROR", `Plugin column is required: ${column.name}`);
    }
    return null;
  }
  if (column.type === "text") {
    if (typeof value !== "string") {
      throw new PluginServiceError(400, "VALIDATION_ERROR", `Plugin column must be text: ${column.name}`);
    }
    return value;
  }
  if (column.type === "integer") {
    if (!Number.isInteger(value)) {
      throw new PluginServiceError(400, "VALIDATION_ERROR", `Plugin column must be integer: ${column.name}`);
    }
    return value;
  }
  if (column.type === "real") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new PluginServiceError(400, "VALIDATION_ERROR", `Plugin column must be real: ${column.name}`);
    }
    return value;
  }
  if (column.type === "boolean") {
    if (typeof value !== "boolean") {
      throw new PluginServiceError(400, "VALIDATION_ERROR", `Plugin column must be boolean: ${column.name}`);
    }
    return value ? "true" : "false";
  }
  return JSON.stringify(value);
}

function decodePluginRow(
  schema: PluginTableDefinition,
  row: Record<string, unknown>
): Record<string, unknown> {
  const decoded: Record<string, unknown> = {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  for (const column of schema.columns) {
    const value = row[column.name];
    decoded[column.name] =
      column.type === "json"
        ? parseJsonObject(value)
        : column.type === "boolean"
          ? value === "true"
          : value;
  }
  return decoded;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return parseJsonObject(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeApiPath(path: string): string {
  const trimmed = path.trim();
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error("Plugin hook timed out")), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolvePromise(value);
      },
      (error) => {
        clearTimeout(timer);
        rejectPromise(error);
      }
    );
  });
}

function nextRunForSchedule(schedule: PluginScheduleRow, now: number): number | null {
  if (schedule.schedule === "daily" && schedule.localTime) {
    return nextDailyRunAt(now + 1_000, schedule.localTime, schedule.timezone ?? "UTC");
  }
  if (schedule.schedule === "interval" && schedule.intervalMs) {
    return now + schedule.intervalMs;
  }
  return null;
}

function nextDailyRunAt(now: number, localTime: string, timezone: string): number {
  const [hourText, minuteText] = localTime.split(":");
  const hour = clampInteger(Number.parseInt(hourText ?? "", 10), 0, 23, 8);
  const minute = clampInteger(Number.parseInt(minuteText ?? "", 10), 0, 59, 0);
  const parts = zonedParts(now, timezone);
  let candidate = zonedTimeToUtc({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour,
    minute,
    timezone
  });
  if (candidate <= now) {
    const nextDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
    candidate = zonedTimeToUtc({
      year: nextDate.getUTCFullYear(),
      month: nextDate.getUTCMonth() + 1,
      day: nextDate.getUTCDate(),
      hour,
      minute,
      timezone
    });
  }
  return candidate;
}

function zonedParts(value: number, timezone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(value));
  return {
    year: Number(parts.find((part) => part.type === "year")?.value ?? "1970"),
    month: Number(parts.find((part) => part.type === "month")?.value ?? "1"),
    day: Number(parts.find((part) => part.type === "day")?.value ?? "1")
  };
}

function zonedTimeToUtc(input: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  timezone: string;
}): number {
  const utcGuess = Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, 0, 0);
  const offset = timeZoneOffsetMs(utcGuess, input.timezone);
  return utcGuess - offset;
}

function timeZoneOffsetMs(value: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(new Date(value));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - value;
}

function clampInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isInteger(value)) {
    return fallback;
  }
  return Math.min(Math.max(value, min), max);
}
