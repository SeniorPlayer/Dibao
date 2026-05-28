import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

const port = 18080;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  use: {
    baseURL,
    locale: "zh-CN",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "npm run start -w @dibao/server",
    url: `${baseURL}/api/system/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DIBAO_BACKGROUND_JOBS: "false",
      DIBAO_COOKIE_SECURE: "false",
      DIBAO_DATABASE_PATH: resolve(".tmp/e2e/dibao.sqlite"),
      DIBAO_HOST: "127.0.0.1",
      DIBAO_PORT: String(port),
      DIBAO_PROFILE_DECAY_INTERVAL_MS: "0",
      DIBAO_WEB_DIST_DIR: resolve("apps/web/dist"),
      NODE_ENV: "production"
    }
  },
  projects: [
    {
      name: "desktop-chromium",
      testMatch: /desktop\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: {
          width: 1280,
          height: 800
        }
      }
    },
    {
      name: "mobile-chromium",
      dependencies: ["desktop-chromium"],
      testMatch: /mobile\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: {
          width: 390,
          height: 844
        }
      }
    }
  ]
});
