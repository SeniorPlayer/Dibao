import type { AppSettingsRepository } from "@dibao/db";
import {
  DEFAULT_ARTICLE_RETENTION_DAYS,
  MAX_ARTICLE_RETENTION_DAYS,
  MIN_ARTICLE_RETENTION_DAYS,
  RETENTION_ARTICLE_DAYS_SETTING_KEY,
  parseRetentionDays
} from "./article-retention-service.js";

export const UI_LOCALE_SETTING_KEY = "ui.locale";
export const READER_SETTINGS_KEY = "reader.settings";

export const supportedSettingsLocales = ["zh-CN", "en-US"] as const;
export type SettingsLocale = (typeof supportedSettingsLocales)[number];

export type ReaderSettings = {
  fontSize: number;
  lineHeight: number;
  paragraphGap: number;
  readerWidth: number;
  theme: "paper";
};

export type AppSettings = {
  ui: {
    locale: SettingsLocale;
  };
  reader: ReaderSettings;
  retention: {
    retentionDays: number;
    keepFavorites: true;
    keepReadLater: true;
  };
  ranking: {
    preferFreshness: number;
    preferSource: number;
    preferDiversity: number;
  };
};

export type UpdateSettingsResult = {
  ok: true;
  settings: AppSettings;
};

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  fontSize: 18,
  lineHeight: 1.75,
  paragraphGap: 1.1,
  readerWidth: 720,
  theme: "paper"
};

const DEFAULT_LOCALE: SettingsLocale = "zh-CN";
const DEFAULT_RANKING_SETTINGS = {
  preferFreshness: 0.5,
  preferSource: 0.5,
  preferDiversity: 0.5
} as const;

const READER_RANGES = {
  fontSize: { min: 16, max: 24 },
  lineHeight: { min: 1.45, max: 2.1 },
  paragraphGap: { min: 0.6, max: 1.6 },
  readerWidth: { min: 560, max: 860 }
} as const;

type ReaderSettingsPatch = Partial<
  Pick<ReaderSettings, "fontSize" | "lineHeight" | "paragraphGap" | "readerWidth">
>;

type SettingsPatch = {
  ui?: {
    locale?: SettingsLocale;
  };
  reader?: ReaderSettingsPatch;
  retention?: {
    retentionDays?: number;
  };
};

export class SettingsServiceError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "SettingsServiceError";
  }
}

export type SettingsServiceOptions = {
  settings: AppSettingsRepository;
  now?: () => number;
  env?: Record<string, string | undefined>;
};

export class SettingsService {
  private readonly now: () => number;
  private readonly env: Record<string, string | undefined>;

  constructor(private readonly options: SettingsServiceOptions) {
    this.now = options.now ?? Date.now;
    this.env = options.env ?? process.env;
  }

  getSettings(): AppSettings {
    return {
      ui: {
        locale: this.readLocale()
      },
      reader: this.readReaderSettings(),
      retention: {
        retentionDays: this.readRetentionDays(),
        keepFavorites: true,
        keepReadLater: true
      },
      ranking: {
        ...DEFAULT_RANKING_SETTINGS
      }
    };
  }

  updateSettings(body: unknown): UpdateSettingsResult {
    const patch = parseSettingsPatch(body);
    const now = this.now();

    if (patch.ui?.locale !== undefined) {
      this.options.settings.setJson(UI_LOCALE_SETTING_KEY, patch.ui.locale, now);
    }

    if (patch.reader !== undefined && Object.keys(patch.reader).length > 0) {
      this.options.settings.setJson(
        READER_SETTINGS_KEY,
        {
          ...this.readReaderSettings(),
          ...patch.reader
        },
        now
      );
    }

    if (patch.retention?.retentionDays !== undefined) {
      this.options.settings.setJson(
        RETENTION_ARTICLE_DAYS_SETTING_KEY,
        patch.retention.retentionDays,
        now
      );
    }

    return {
      ok: true,
      settings: this.getSettings()
    };
  }

  private readLocale(): SettingsLocale {
    const locale = this.options.settings.getJson<unknown>(UI_LOCALE_SETTING_KEY);
    return isSettingsLocale(locale) ? locale : DEFAULT_LOCALE;
  }

  private readReaderSettings(): ReaderSettings {
    const stored = this.options.settings.getJson<unknown>(READER_SETTINGS_KEY);
    const input = isPlainObject(stored) ? stored : {};

    return {
      fontSize: readStoredNumber(input.fontSize, DEFAULT_READER_SETTINGS.fontSize, "fontSize"),
      lineHeight: readStoredNumber(
        input.lineHeight,
        DEFAULT_READER_SETTINGS.lineHeight,
        "lineHeight"
      ),
      paragraphGap: readStoredNumber(
        input.paragraphGap,
        DEFAULT_READER_SETTINGS.paragraphGap,
        "paragraphGap"
      ),
      readerWidth: readStoredNumber(
        input.readerWidth,
        DEFAULT_READER_SETTINGS.readerWidth,
        "readerWidth"
      ),
      theme: "paper"
    };
  }

  private readRetentionDays(): number {
    const setting = this.options.settings.getJson<unknown>(RETENTION_ARTICLE_DAYS_SETTING_KEY);
    if (setting !== null) {
      return parseRetentionDays(setting) ?? DEFAULT_ARTICLE_RETENTION_DAYS;
    }

    const envValue = this.env.DIBAO_ARTICLE_RETENTION_DAYS;
    if (envValue !== undefined) {
      return parseRetentionDays(envValue) ?? DEFAULT_ARTICLE_RETENTION_DAYS;
    }

    return DEFAULT_ARTICLE_RETENTION_DAYS;
  }
}

function parseSettingsPatch(body: unknown): SettingsPatch {
  const input = readBodyObject(body);
  const patch: SettingsPatch = {};

  rejectUnknownKeys(input, ["ui", "reader", "retention"]);

  if (Object.hasOwn(input, "ui")) {
    patch.ui = parseUiPatch(input.ui);
  }

  if (Object.hasOwn(input, "reader")) {
    patch.reader = parseReaderPatch(input.reader);
  }

  if (Object.hasOwn(input, "retention")) {
    patch.retention = parseRetentionPatch(input.retention);
  }

  return patch;
}

function parseUiPatch(value: unknown): SettingsPatch["ui"] {
  const input = readSectionObject(value, "ui");
  rejectUnknownKeys(input, ["locale"], "ui");

  if (!Object.hasOwn(input, "locale")) {
    return {};
  }

  if (!isSettingsLocale(input.locale)) {
    throw validationError("ui.locale must be zh-CN or en-US", {
      field: "ui.locale",
      allowed: supportedSettingsLocales
    });
  }

  return {
    locale: input.locale
  };
}

function parseReaderPatch(value: unknown): ReaderSettingsPatch {
  const input = readSectionObject(value, "reader");
  rejectUnknownKeys(
    input,
    ["fontSize", "lineHeight", "paragraphGap", "readerWidth"],
    "reader"
  );

  const patch: ReaderSettingsPatch = {};

  if (Object.hasOwn(input, "fontSize")) {
    patch.fontSize = parseNumberInRange(input.fontSize, "reader.fontSize", "fontSize");
  }
  if (Object.hasOwn(input, "lineHeight")) {
    patch.lineHeight = parseNumberInRange(input.lineHeight, "reader.lineHeight", "lineHeight");
  }
  if (Object.hasOwn(input, "paragraphGap")) {
    patch.paragraphGap = parseNumberInRange(
      input.paragraphGap,
      "reader.paragraphGap",
      "paragraphGap"
    );
  }
  if (Object.hasOwn(input, "readerWidth")) {
    patch.readerWidth = parseNumberInRange(
      input.readerWidth,
      "reader.readerWidth",
      "readerWidth"
    );
  }

  return patch;
}

function parseRetentionPatch(value: unknown): SettingsPatch["retention"] {
  const input = readSectionObject(value, "retention");
  rejectUnknownKeys(input, ["retentionDays"], "retention");

  if (!Object.hasOwn(input, "retentionDays")) {
    return {};
  }

  if (typeof input.retentionDays !== "number") {
    throw validationError("retention.retentionDays must be a number", {
      field: "retention.retentionDays"
    });
  }

  const retentionDays = parseRetentionDays(input.retentionDays);
  if (retentionDays === null) {
    throw validationError(
      `retention.retentionDays must be an integer between ${MIN_ARTICLE_RETENTION_DAYS} and ${MAX_ARTICLE_RETENTION_DAYS}`,
      {
        field: "retention.retentionDays",
        min: MIN_ARTICLE_RETENTION_DAYS,
        max: MAX_ARTICLE_RETENTION_DAYS
      }
    );
  }

  return {
    retentionDays
  };
}

function readBodyObject(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw validationError("request body must be an object");
  }

  return value;
}

function readSectionObject(value: unknown, section: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw validationError(`${section} must be an object`, { field: section });
  }

  return value;
}

function rejectUnknownKeys(
  input: Record<string, unknown>,
  allowedKeys: readonly string[],
  prefix?: string
): void {
  const allowed = new Set(allowedKeys);

  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      throw validationError(
        prefix ? `${prefix}.${key} is not a writable setting` : `${key} is not a writable setting`,
        {
          field: prefix ? `${prefix}.${key}` : key
        }
      );
    }
  }
}

function readStoredNumber(
  value: unknown,
  fallback: number,
  field: keyof typeof READER_RANGES
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  const range = READER_RANGES[field];
  return value >= range.min && value <= range.max ? value : fallback;
}

function parseNumberInRange(
  value: unknown,
  field: string,
  rangeField: keyof typeof READER_RANGES
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw validationError(`${field} must be a number`, { field });
  }

  const range = READER_RANGES[rangeField];
  if (value < range.min || value > range.max) {
    throw validationError(`${field} must be between ${range.min} and ${range.max}`, {
      field,
      min: range.min,
      max: range.max
    });
  }

  return value;
}

function isSettingsLocale(value: unknown): value is SettingsLocale {
  return (
    typeof value === "string" &&
    (supportedSettingsLocales as readonly string[]).includes(value)
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validationError(message: string, details?: unknown): SettingsServiceError {
  return new SettingsServiceError(400, "VALIDATION_ERROR", message, details);
}
