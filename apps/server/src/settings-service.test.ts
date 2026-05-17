import { describe, expect, it } from "vitest";
import type { AppSettingsRepository } from "@dibao/db";
import { RETENTION_ARTICLE_DAYS_SETTING_KEY } from "./article-retention-service.js";
import { SettingsService, SettingsServiceError } from "./settings-service.js";

class MemorySettingsRepository implements AppSettingsRepository {
  private readonly values = new Map<string, unknown>();

  getJson<T>(key: string): T | null {
    return this.values.has(key) ? (this.values.get(key) as T) : null;
  }

  setJson(key: string, value: unknown): void {
    this.values.set(key, value);
  }

  delete(key: string): void {
    this.values.delete(key);
  }
}

describe("settings service", () => {
  it("resolves retentionDays from setting, env, then default", () => {
    const settings = new MemorySettingsRepository();
    const service = new SettingsService({
      settings,
      env: {
        DIBAO_ARTICLE_RETENTION_DAYS: "90"
      }
    });

    expect(service.getSettings().retention.retentionDays).toBe(90);

    settings.setJson(RETENTION_ARTICLE_DAYS_SETTING_KEY, 30);
    expect(service.getSettings().retention.retentionDays).toBe(30);

    settings.setJson(RETENTION_ARTICLE_DAYS_SETTING_KEY, 0);
    expect(service.getSettings().retention.retentionDays).toBe(0);

    settings.setJson(RETENTION_ARTICLE_DAYS_SETTING_KEY, "invalid");
    expect(service.getSettings().retention.retentionDays).toBe(60);

    settings.delete(RETENTION_ARTICLE_DAYS_SETTING_KEY);
    const invalidEnvService = new SettingsService({
      settings,
      env: {
        DIBAO_ARTICLE_RETENTION_DAYS: "invalid"
      }
    });
    expect(invalidEnvService.getSettings().retention.retentionDays).toBe(60);
  });

  it("strictly rejects unknown and unwritable settings fields", () => {
    const service = new SettingsService({
      settings: new MemorySettingsRepository()
    });

    for (const payload of [
      {
        ranking: {
          preferFreshness: 0.8
        }
      },
      {
        reader: {
          theme: "paper"
        }
      },
      {
        retention: {
          keepFavorites: false
        }
      }
    ]) {
      expect(() => service.updateSettings(payload)).toThrow(SettingsServiceError);
    }
  });
});
