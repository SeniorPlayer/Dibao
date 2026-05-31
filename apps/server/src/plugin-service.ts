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
import type { JobRepository, JobRow, PluginInstallRow, PluginRepository } from "@dibao/db";
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
  "network:outbound",
  "files:plugin-data",
  "telemetry:emit"
] as const;

const PLUGIN_CAPABILITY_SET = new Set<string>(PLUGIN_CAPABILITIES);
const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;

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
    settingsTabs?: PluginSettingsTabContribution[];
    tabs?: PluginTabContribution[];
    actions?: PluginActionContribution[];
    hooks?: string[];
    tasks?: PluginTaskContribution[];
  };
};

export type PluginSettingsTabContribution = {
  id: string;
  title: string;
  slot: string;
  order?: number;
  icon?: string;
};

export type PluginTabContribution = PluginSettingsTabContribution;

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
  installedAt: string;
  updatedAt: string;
  enabledAt: string | null;
  disabledAt: string | null;
  lastError: string | null;
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
  plugins: PluginRepository;
  jobs: JobRepository;
  dibaoVersion: string;
  officialPluginsDir?: string;
  pluginDataDir?: string;
  fetcher?: typeof fetch;
  now?: () => number;
};

export class PluginService {
  private readonly now: () => number;
  private readonly fetcher: typeof fetch;
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
        "/app/plugins/official"
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
    this.options.plugins.grantCapabilities(pluginId, manifest.capabilities, this.now());
    this.options.plugins.setStatus(pluginId, "enabled", null, this.now());
    return this.requireListItem(pluginId);
  }

  async emitHook(hook: string, payload: unknown): Promise<void> {
    for (const install of this.options.plugins.listInstalls()) {
      if (install.status !== "enabled") {
        continue;
      }
      const manifest = parseStoredManifest(install);
      if (!manifest.contributes?.hooks?.includes(hook)) {
        continue;
      }
      this.options.plugins.setKv(
        install.id,
        `hook:${hook}:last`,
        {
          hook,
          receivedAt: this.now(),
          payload
        },
        this.now()
      );
    }
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
    const manifest = parseStoredManifest(install);
    const task = manifest.contributes?.tasks?.find((candidate) => candidate.id === parsed.taskId);
    if (!task) {
      throw new Error(`Plugin task is not declared: ${parsed.taskId}`);
    }
    this.options.plugins.setKv(
      parsed.pluginId,
      `taskRun:${job.id}`,
      {
        jobId: job.id,
        taskId: parsed.taskId,
        status: "succeeded",
        finishedAt: this.now()
      },
      this.now()
    );
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
            : "disabled"
          : "incompatible";
        this.options.plugins.upsertInstall({
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
      } catch (error) {
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

  startTask(pluginId: string, taskId: string): JobRow {
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
      payloadJson: JSON.stringify({ pluginId, taskId, requestedAt: this.now() }),
      now: this.now()
    });
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

  private async fetchUpdateMetadata(url: string): Promise<PluginUpdateMetadata> {
    const response = await this.fetcher(url);
    if (!response.ok) {
      throw new PluginServiceError(400, "PROVIDER_ERROR", `Plugin update fetch failed: ${response.status}`);
    }
    const body = await response.json() as PluginUpdateMetadata;
    return body;
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
      installedAt: new Date(install.installedAt).toISOString(),
      updatedAt: new Date(install.updatedAt).toISOString(),
      enabledAt: install.enabledAt ? new Date(install.enabledAt).toISOString() : null,
      disabledAt: install.disabledAt ? new Date(install.disabledAt).toISOString() : null,
      lastError: install.lastError
    };
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

function normalizeContributions(contributes: PluginManifest["contributes"]): PluginManifest["contributes"] {
  if (!contributes || typeof contributes !== "object") {
    return {};
  }
  return {
    settingsTabs: Array.isArray(contributes.settingsTabs) ? contributes.settingsTabs : [],
    tabs: Array.isArray(contributes.tabs) ? contributes.tabs : [],
    actions: Array.isArray(contributes.actions) ? contributes.actions : [],
    hooks: Array.isArray(contributes.hooks)
      ? contributes.hooks.filter((hook): hook is string => typeof hook === "string")
      : [],
    tasks: Array.isArray(contributes.tasks) ? contributes.tasks : []
  };
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
