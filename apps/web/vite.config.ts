import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { dibaoVersion } from "@dibao/shared";
import { defineConfig } from "vite";

const dibaoSentrySourceMapProject = {
  org: "akashio",
  project: "dibao"
} as const;

const webConfigDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(webConfigDir, "../..");

function readSentryAuthToken(): string | undefined {
  const envToken = process.env.SENTRY_AUTH_TOKEN?.trim();
  if (envToken) {
    return envToken;
  }

  for (const envFile of [
    resolve(repoRoot, ".env.sentry-build-plugin"),
    resolve(webConfigDir, ".env.sentry-build-plugin")
  ]) {
    if (!existsSync(envFile)) {
      continue;
    }

    for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      if (key !== "SENTRY_AUTH_TOKEN") {
        continue;
      }

      const value = trimmed.slice(separatorIndex + 1).trim();
      return value.replace(/^['"]|['"]$/g, "") || undefined;
    }
  }

  return undefined;
}

const sentryAuthToken = readSentryAuthToken();
const dibaoSentryRelease = `dibao@${dibaoVersion}`;
const sentrySourceMapsEnabled = Boolean(
  sentryAuthToken &&
    dibaoSentrySourceMapProject.org &&
    dibaoSentrySourceMapProject.project
);

export default defineConfig({
  build: {
    sourcemap: sentrySourceMapsEnabled
  },
  plugins: [
    react(),
    ...(sentrySourceMapsEnabled
      ? [
          sentryVitePlugin({
            org: dibaoSentrySourceMapProject.org,
            project: dibaoSentrySourceMapProject.project,
            authToken: sentryAuthToken,
            release: {
              name: dibaoSentryRelease,
              setCommits: false
            },
            telemetry: false,
            errorHandler(error) {
              throw error;
            },
            sourcemaps: {
              filesToDeleteAfterUpload: ["dist/**/*.map"]
            },
            silent: false
          })
        ]
      : [])
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_DIBAO_API_PROXY ?? "http://127.0.0.1:8080",
        changeOrigin: true
      }
    }
  }
});
