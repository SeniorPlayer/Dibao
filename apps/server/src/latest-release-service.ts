import type { AppSettingsRepository } from "@dibao/db";
import { dibaoVersion } from "@dibao/shared";

export const LATEST_RELEASE_SETTINGS_KEY = "release.latest";

const DAY_MS = 24 * 60 * 60 * 1000;
const GITHUB_RELEASE_CHECK_TIMEOUT_MS = 8000;
const GITHUB_LATEST_RELEASE_URL =
  "https://api.github.com/repos/Pls-1q43/Dibao/releases/latest";

type LatestReleaseCache = {
  latestVersion: string | null;
  releaseUrl: string | null;
  releaseName: string | null;
  publishedAt: string | null;
  checkedAt: number | null;
  lastError: string | null;
};

export type LatestReleaseStatus = {
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string | null;
  releaseName: string | null;
  publishedAt: string | null;
  checkedAt: string | null;
  nextAutoCheckAt: string;
  updateAvailable: boolean;
  status: "unknown" | "current" | "update_available" | "error";
  error: string | null;
};

export type LatestReleaseServiceOptions = {
  settings: AppSettingsRepository;
  now?: () => number;
  fetcher?: typeof fetch;
  getInstallationCompletedAt: () => number;
};

export class LatestReleaseService {
  private readonly now: () => number;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: LatestReleaseServiceOptions) {
    this.now = options.now ?? Date.now;
    this.fetcher = options.fetcher ?? fetch;
  }

  async getLatestRelease(): Promise<LatestReleaseStatus> {
    const cache = this.readCache();
    if (!this.shouldAutoRefresh(cache.checkedAt)) {
      return this.statusFor(cache);
    }

    return this.refresh();
  }

  async refresh(): Promise<LatestReleaseStatus> {
    const previous = this.readCache();
    const now = this.now();

    try {
      const release = await this.fetchLatestRelease();
      const cache: LatestReleaseCache = {
        latestVersion: release.version,
        releaseUrl: release.url,
        releaseName: release.name,
        publishedAt: release.publishedAt,
        checkedAt: now,
        lastError: null
      };
      this.writeCache(cache, now);
      return this.statusFor(cache);
    } catch (error) {
      const cache: LatestReleaseCache = {
        ...previous,
        checkedAt: now,
        lastError: error instanceof Error ? error.message : "Failed to check latest release"
      };
      this.writeCache(cache, now);
      return this.statusFor(cache);
    }
  }

  private shouldAutoRefresh(checkedAt: number | null): boolean {
    if (checkedAt === null) {
      return true;
    }

    const installedAt = this.options.getInstallationCompletedAt();
    return windowIndex(this.now(), installedAt) > windowIndex(checkedAt, installedAt);
  }

  private statusFor(cache: LatestReleaseCache): LatestReleaseStatus {
    const updateAvailable = isVersionNewer(cache.latestVersion, dibaoVersion);
    const status =
      cache.lastError !== null
        ? "error"
        : cache.latestVersion === null
          ? "unknown"
          : updateAvailable
            ? "update_available"
            : "current";

    return {
      currentVersion: dibaoVersion,
      latestVersion: cache.latestVersion,
      releaseUrl: cache.releaseUrl,
      releaseName: cache.releaseName,
      publishedAt: cache.publishedAt,
      checkedAt: cache.checkedAt === null ? null : new Date(cache.checkedAt).toISOString(),
      nextAutoCheckAt: new Date(this.nextAutoCheckAt(cache.checkedAt)).toISOString(),
      updateAvailable,
      status,
      error: cache.lastError
    };
  }

  private nextAutoCheckAt(checkedAt: number | null): number {
    const installedAt = this.options.getInstallationCompletedAt();
    const baseWindow = Math.max(windowIndex(checkedAt ?? this.now(), installedAt), 0);
    return installedAt + (baseWindow + 1) * DAY_MS;
  }

  private async fetchLatestRelease(): Promise<{
    version: string | null;
    url: string | null;
    name: string | null;
    publishedAt: string | null;
  }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GITHUB_RELEASE_CHECK_TIMEOUT_MS);
    let response: Response;

    try {
      response = await this.fetcher(GITHUB_LATEST_RELEASE_URL, {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": `dibao/${dibaoVersion}`
        },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    const text = await response.text();

    if (response.status === 404) {
      return {
        version: null,
        url: null,
        name: null,
        publishedAt: null
      };
    }

    if (!response.ok) {
      throw new Error(`GitHub release check failed with HTTP ${response.status}`);
    }

    const payload = parseJsonObject(text);
    const tagName = readString(payload.tag_name);
    const name = readString(payload.name);
    const url = readString(payload.html_url);
    const publishedAt = readString(payload.published_at);

    if (tagName === null) {
      throw new Error("GitHub release payload did not include a tag name");
    }

    return {
      version: tagName,
      url,
      name,
      publishedAt
    };
  }

  private readCache(): LatestReleaseCache {
    const stored = this.options.settings.getJson<unknown>(LATEST_RELEASE_SETTINGS_KEY);
    const input = isPlainObject(stored) ? stored : {};

    return {
      latestVersion: readString(input.latestVersion),
      releaseUrl: readString(input.releaseUrl),
      releaseName: readString(input.releaseName),
      publishedAt: readString(input.publishedAt),
      checkedAt: readNumber(input.checkedAt),
      lastError: readString(input.lastError)
    };
  }

  private writeCache(cache: LatestReleaseCache, now: number): void {
    this.options.settings.setJson(LATEST_RELEASE_SETTINGS_KEY, cache, now);
  }
}

function windowIndex(value: number, installedAt: number): number {
  return Math.floor((value - installedAt) / DAY_MS);
}

function isVersionNewer(latestVersion: string | null, currentVersion: string): boolean {
  if (latestVersion === null) {
    return false;
  }

  return compareVersionParts(normalizeVersion(latestVersion), normalizeVersion(currentVersion)) > 0;
}

function normalizeVersion(version: string): number[] {
  return version
    .trim()
    .replace(/^v/i, "")
    .split(/[.-]/)
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function compareVersionParts(a: number[], b: number[]): number {
  for (let index = 0; index < 3; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) {
      return left - right;
    }
  }

  return 0;
}

function parseJsonObject(text: string): Record<string, unknown> {
  const parsed = JSON.parse(text) as unknown;
  if (!isPlainObject(parsed)) {
    throw new Error("GitHub release payload must be an object");
  }
  return parsed;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}
