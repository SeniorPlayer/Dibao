import { expect, test, type Page } from "@playwright/test";

const accessPassword = "correct horse battery";

test.beforeEach(async ({ page }) => {
  await blockExternalBrowserRequests(page);
});

test("mobile MVP reader smoke has visible controls and no horizontal overflow", async ({ page }) => {
  await login(page);

  await expect(page.getByRole("button", { name: /E2E Article Alpha/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "打开来源" })).toBeVisible();

  const initialLayout = await page.evaluate(mobilePanelState);
  expect(initialLayout.feedRight).toBeLessThanOrEqual(2);
  expect(initialLayout.listDisplay).toBe("block");
  expect(initialLayout.readerDisplay).toBe("none");

  await page.getByRole("button", { name: "打开来源" }).click();
  await expect(page.getByRole("button", { name: "全部订阅源" })).toBeVisible();
  await expect
    .poll(async () => (await page.evaluate(mobilePanelState)).feedLeft)
    .toBeGreaterThanOrEqual(-1);
  await page
    .getByTestId("feed-scroll-container")
    .getByRole("button", { name: "关闭来源" })
    .click();

  await page.getByRole("button", { name: /E2E Article Alpha/ }).click();
  await expect(page.getByRole("heading", { name: "E2E Article Alpha" })).toBeVisible();
  await expect(page.getByRole("button", { name: "返回列表" })).toBeVisible();
  await expect(page.getByRole("button", { name: "收藏" })).toBeVisible();
  await expect(page.getByRole("button", { name: "稍后读" })).toBeVisible();
  await expect(page.getByRole("button", { name: "不再推荐类似文章" })).toBeVisible();
  const readingLayout = await page.evaluate(mobilePanelState);
  expect(readingLayout.listDisplay).toBe("none");
  expect(readingLayout.readerDisplay).toBe("block");

  await page.getByRole("button", { name: "返回列表" }).click();
  await expect(page.getByRole("button", { name: /E2E Article Alpha/ })).toBeVisible();
  const backLayout = await page.evaluate(mobilePanelState);
  expect(backLayout.listDisplay).toBe("block");
  expect(backLayout.readerDisplay).toBe("none");

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(4);
});

test("mobile recommended list keeps a dense first screen without horizontal overflow", async ({
  page
}) => {
  await login(page);

  await page.getByRole("link", { name: "推荐" }).click();
  await expect(page.getByRole("heading", { name: "推荐" })).toBeVisible();
  await expect(page.getByText("推荐状态")).toBeVisible();
  await expect(page.getByRole("button", { name: /E2E Article Alpha/ })).toBeVisible();

  const visibleArticles = await page.evaluate(visibleArticleCountInListViewport);
  expect(visibleArticles).toBeGreaterThanOrEqual(5);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(4);
});

test("mobile recommended article exposes algorithm transparency details", async ({ page }) => {
  await login(page);

  await page.getByRole("link", { name: "推荐" }).click();
  await expect(page.getByRole("heading", { name: "推荐" })).toBeVisible();
  await page.getByRole("button", { name: /E2E Article Alpha/ }).click();

  await expect(page.getByRole("heading", { name: "E2E Article Alpha" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "为什么推荐" })).toBeVisible();
  await expect(
    page.getByTestId("reader-scroll-container").getByText("新鲜度", { exact: true })
  ).toBeVisible();
});

test("mobile article actions expose selected favorite and read-later state", async ({ page }) => {
  await login(page);

  await page.getByRole("button", { name: /E2E Article Extra 22/ }).click();
  await expect(page.getByRole("heading", { name: "E2E Article Extra 22" })).toBeVisible();

  const favoriteButton = page.getByRole("button", { name: "收藏这篇文章" });
  await favoriteButton.click();
  await expect(page.getByRole("button", { name: "取消收藏这篇文章" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );

  const readLaterButton = page.getByRole("button", { name: "稍后读这篇文章" });
  await readLaterButton.click();
  await expect(page.getByRole("button", { name: "移出稍后读" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
});

test("mobile browser history back returns from article detail to the list", async ({ page }) => {
  await login(page);

  await page.getByRole("button", { name: /E2E Article Alpha/ }).click();
  await expect(page.getByRole("heading", { name: "E2E Article Alpha" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("button", { name: /E2E Article Alpha/ })).toBeVisible();
  const backLayout = await page.evaluate(mobilePanelState);
  expect(backLayout.listDisplay).toBe("block");
  expect(backLayout.readerDisplay).toBe("none");
});

test("favorites page sort dropdown can switch order", async ({ page }) => {
  await login(page);

  await favoriteArticle(page, "E2E Article Alpha");
  await favoriteArticle(page, "E2E Article Extra 24");

  await page.getByRole("link", { name: "收藏" }).click();
  await expect(page.getByRole("heading", { name: "收藏" })).toBeVisible();
  await expect(page.getByLabel("排序")).toHaveValue("favorited_desc");
  await expect(firstArticleTitle(page)).resolves.toContain("E2E Article Extra 24");

  await page.getByLabel("排序").selectOption("favorited_asc");
  const oldestFavorite = await firstArticleTitle(page);
  expect(oldestFavorite).toContain("E2E Article");
  expect(oldestFavorite).not.toContain("E2E Article Extra 24");
});

test("read-later page can open a saved article", async ({ page }) => {
  await login(page);

  await saveArticleForLater(page, "E2E Article Extra 23");

  await page.getByRole("link", { name: "稍后读" }).click();
  await expect(page.getByRole("heading", { name: "稍后读" })).toBeVisible();
  await page.getByRole("button", { name: /E2E Article Extra 23/ }).click();
  await expect(page.getByRole("heading", { name: "E2E Article Extra 23" })).toBeVisible();
});

test("liking an article exposes visible pressed UI state", async ({ page }) => {
  await login(page);

  await page.getByRole("button", { name: /E2E Article Alpha/ }).click();
  await expect(page.getByRole("heading", { name: "E2E Article Alpha" })).toBeVisible();
  await page.getByRole("button", { name: "点赞这篇文章" }).click();
  await expect(page.getByRole("button", { name: "取消点赞这篇文章" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
});

async function login(page: Page): Promise<void> {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "登录邸报" })).toBeVisible();
  await page.getByRole("textbox", { name: "访问密码" }).fill(accessPassword);
  await page.getByRole("button", { name: "登录" }).click();

  await expect(page.getByRole("link", { name: "最新" })).toBeVisible();
  await expect(page.getByRole("link", { name: "推荐" })).toBeVisible();
}

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

async function favoriteArticle(page: Page, title: string): Promise<void> {
  await page.getByRole("link", { name: "最新" }).click();
  await page.getByRole("button", { name: new RegExp(title) }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  const favorite = page.getByRole("button", { name: "收藏这篇文章" });
  if (await favorite.isVisible()) {
    await favorite.click();
    await expect(page.getByRole("button", { name: "取消收藏这篇文章" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  }
  await page.goBack();
  await expect(page.getByRole("button", { name: new RegExp(title) })).toBeVisible();
}

async function saveArticleForLater(page: Page, title: string): Promise<void> {
  await page.getByRole("link", { name: "最新" }).click();
  await page.getByRole("button", { name: new RegExp(title) }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  const readLater = page.getByRole("button", { name: "稍后读这篇文章" });
  if (await readLater.isVisible()) {
    await readLater.click();
    await expect(page.getByRole("button", { name: "移出稍后读" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  }
  await page.goBack();
  await expect(page.getByRole("button", { name: new RegExp(title) })).toBeVisible();
}

async function firstArticleTitle(page: Page): Promise<string> {
  return page.getByTestId("article-list-scroll-container").evaluate((element) => {
    const button = Array.from(element.querySelectorAll("button")).find((candidate) =>
      candidate.textContent?.includes("E2E Article")
    );
    return button?.textContent ?? "";
  });
}

function mobilePanelState() {
  const feed = document.querySelector('[data-testid="feed-scroll-container"]');
  const list = document.querySelector('[data-testid="article-list-scroll-container"]');
  const reader = document.querySelector('[data-testid="reader-scroll-container"]');

  if (!(feed instanceof HTMLElement) || !(list instanceof HTMLElement) || !(reader instanceof HTMLElement)) {
    throw new Error("Missing mobile panels");
  }

  const feedRect = feed.getBoundingClientRect();
  return {
    feedLeft: feedRect.left,
    feedRight: feedRect.right,
    listDisplay: window.getComputedStyle(list).display,
    readerDisplay: window.getComputedStyle(reader).display
  };
}

function visibleArticleCountInListViewport() {
  const list = document.querySelector('[data-testid="article-list-scroll-container"]');
  if (!(list instanceof HTMLElement)) {
    throw new Error("Missing article list panel");
  }

  const listRect = list.getBoundingClientRect();
  return Array.from(list.querySelectorAll("[data-article-id]")).filter((element) => {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.top < listRect.bottom && rect.bottom > listRect.top;
  }).length;
}
