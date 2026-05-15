import { expect, test } from "@playwright/test";
import { startFixtureServer } from "./fixtures.js";

const accessPassword = "correct horse battery";

test.beforeEach(async ({ page }) => {
  await blockExternalBrowserRequests(page);
});

test("desktop MVP self-host smoke flow", async ({ page }) => {
  const fixture = await startFixtureServer();

  try {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "欢迎使用邸报" })).toBeVisible();
    await page.getByRole("button", { name: "开始设置" }).click();

    await page.getByRole("textbox", { name: "访问密码" }).fill(accessPassword);
    await page.getByRole("button", { name: "完成设置" }).click();

    await expect(page.getByRole("heading", { name: "添加订阅源" })).toBeVisible();
    await page.getByLabel("RSS / Atom URL").fill(`${fixture.origin}/feeds/main.xml`);
    await page.getByRole("button", { name: "添加订阅源" }).click();

    await expect(page.getByRole("heading", { name: "推荐能力" })).toBeVisible();
    await page.getByRole("button", { name: "暂不配置，继续" }).click();

    await expect(page.getByRole("button", { name: /E2E Article Beta/ })).toBeVisible();

    await page.getByRole("button", { name: "退出" }).click();
    await expect(page.getByRole("heading", { name: "登录邸报" })).toBeVisible();
    await page.getByRole("textbox", { name: "访问密码" }).fill(accessPassword);
    await page.getByRole("button", { name: "登录" }).click();

    await expect(page.getByRole("button", { name: /E2E Article Beta/ })).toBeVisible();
    await page.getByRole("button", { name: /E2E Article Beta/ }).click();
    await expect(page.getByRole("heading", { name: "E2E Article Beta" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "为什么推荐" })).toBeVisible();

    await page.getByRole("button", { name: "收藏" }).click();
    await expect(page.getByRole("button", { name: "取消收藏" })).toBeVisible();
    await page.getByRole("button", { name: "稍后读" }).click();
    await expect(page.getByRole("button", { name: "移出稍后读" })).toBeVisible();
    await page.getByRole("button", { name: "不再推荐类似文章" }).click();
    await expect(page.getByRole("button", { name: "已标记不感兴趣" })).toBeVisible();

    await page.getByRole("link", { name: "推荐" }).click();
    await expect(page.getByRole("heading", { name: "推荐文章" })).toBeVisible();
    await expect(page.getByRole("button", { name: /E2E Article Alpha/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "为什么推荐" })).toBeVisible();

    await page.getByRole("link", { name: "最新" }).click();
    await page.getByTitle("刷新 E2E Fixture Feed").click();
    await expect(page.getByText("已刷新：E2E Fixture Feed")).toBeVisible();

    await page.getByRole("link", { name: "设置" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "设置" })).toBeVisible();
    await page.getByLabel("Base URL").fill(`${fixture.origin}/v1`);
    await page.getByLabel("模型").fill("e2e-embedding");
    await page.getByLabel("维度").fill("4");
    await page.getByLabel("启用 provider").check();
    await page.getByRole("button", { name: "保存 provider" }).click();
    await expect(page.getByText("Embedding provider 已保存。")).toBeVisible();
    await page.getByRole("button", { name: "测试连接" }).click();
    await expect(page.getByText("连接测试成功。")).toBeVisible();
  } finally {
    await fixture.close();
  }
});

async function blockExternalBrowserRequests(page: import("@playwright/test").Page): Promise<void> {
  await page.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    const isLocal =
      requestUrl.hostname === "127.0.0.1" ||
      requestUrl.hostname === "localhost" ||
      requestUrl.hostname === "::1";

    if ((requestUrl.protocol === "http:" || requestUrl.protocol === "https:") && !isLocal) {
      await route.abort();
      return;
    }

    await route.continue();
  });
}
