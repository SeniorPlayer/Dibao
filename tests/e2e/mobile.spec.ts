import { expect, test, type Page } from "@playwright/test";

const accessPassword = "correct horse battery";

test.beforeEach(async ({ page }) => {
  await blockExternalBrowserRequests(page);
});

test("mobile MVP reader smoke has visible controls and no horizontal overflow", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "登录邸报" })).toBeVisible();
  await page.getByRole("textbox", { name: "访问密码" }).fill(accessPassword);
  await page.getByRole("button", { name: "登录" }).click();

  await expect(page.getByRole("link", { name: "最新" })).toBeVisible();
  await expect(page.getByRole("link", { name: "推荐" })).toBeVisible();
  await expect(page.getByRole("button", { name: /E2E Article Alpha/ })).toBeVisible();

  await page.getByRole("button", { name: /E2E Article Alpha/ }).click();
  await expect(page.getByRole("heading", { name: "E2E Article Alpha" })).toBeVisible();
  await expect(page.getByRole("button", { name: "收藏" })).toBeVisible();
  await expect(page.getByRole("button", { name: "稍后读" })).toBeVisible();
  await expect(page.getByRole("button", { name: "不再推荐类似文章" })).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(4);
});

async function blockExternalBrowserRequests(page: Page): Promise<void> {
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
