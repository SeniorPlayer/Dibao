import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeConfigPath = resolve(repoRoot, ".dibao/sentry.json");

const defaultConfig = {
  dsn: "",
  org: "",
  project: "",
  tracesSampleRate: 0.1,
  devTracesSampleRate: 1,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1
};

const config = readSentryConfig();

mkdirSync(dirname(runtimeConfigPath), { recursive: true });
writeFileSync(
  runtimeConfigPath,
  `${JSON.stringify(toRuntimeConfig(config), null, 2)}\n`,
  "utf8"
);

function readSentryConfig() {
  const configPath = process.env.DIBAO_SENTRY_CONFIG
    ? resolve(repoRoot, process.env.DIBAO_SENTRY_CONFIG)
    : resolve(repoRoot, "config/sentry.json");

  let fileConfig = {};
  try {
    fileConfig = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  return normalizeConfig({
    ...fileConfig,
    dsn: process.env.DIBAO_SENTRY_DSN ?? fileConfig.dsn,
    org: process.env.SENTRY_ORG ?? process.env.DIBAO_SENTRY_ORG ?? fileConfig.org,
    project: process.env.SENTRY_PROJECT ?? process.env.DIBAO_SENTRY_PROJECT ?? fileConfig.project
  });
}

function normalizeConfig(input) {
  return {
    dsn: stringValue(input.dsn, defaultConfig.dsn),
    org: stringValue(input.org, defaultConfig.org),
    project: stringValue(input.project, defaultConfig.project),
    tracesSampleRate: sampleRateValue(input.tracesSampleRate, defaultConfig.tracesSampleRate),
    devTracesSampleRate: sampleRateValue(input.devTracesSampleRate, defaultConfig.devTracesSampleRate),
    replaysSessionSampleRate: sampleRateValue(
      input.replaysSessionSampleRate,
      defaultConfig.replaysSessionSampleRate
    ),
    replaysOnErrorSampleRate: sampleRateValue(
      input.replaysOnErrorSampleRate,
      defaultConfig.replaysOnErrorSampleRate
    )
  };
}

function toRuntimeConfig(config) {
  return {
    dsn: config.dsn,
    org: config.org,
    project: config.project,
    tracesSampleRate: config.tracesSampleRate,
    devTracesSampleRate: config.devTracesSampleRate,
    replaysSessionSampleRate: config.replaysSessionSampleRate,
    replaysOnErrorSampleRate: config.replaysOnErrorSampleRate
  };
}

function stringValue(value, fallback) {
  return typeof value === "string" ? value.trim() : fallback;
}

function sampleRateValue(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : fallback;
}
