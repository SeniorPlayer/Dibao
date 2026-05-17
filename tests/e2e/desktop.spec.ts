import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { startFixtureServer } from "./fixtures.js";

const accessPassword = "correct horse battery";
const e2eDatabasePath = resolve(".tmp/e2e/dibao.sqlite");

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
    await page.getByLabel("只看未读").check();
    await page.getByTestId("article-list-scroll-container").evaluate((element) => {
      element.scrollTop = 900;
      element.dispatchEvent(new Event("scroll"));
    });
    await expect
      .poll(() => latestBehaviorEvent("E2E Article Beta", "impression") !== null)
      .toBe(true);
    await expect(page.getByRole("button", { name: /E2E Article Beta/ })).toBeVisible();
    await page.getByRole("button", { name: /E2E Article Beta/ }).click();
    await expect(page.getByRole("button", { name: /E2E Article Beta/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "E2E Article Beta" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "为什么推荐" })).toBeVisible();

    const scrollMetrics = await page.evaluate(() => {
      function panelMetrics(testId: string) {
        const element = document.querySelector(`[data-testid="${testId}"]`);
        if (!(element instanceof HTMLElement)) {
          throw new Error(`Missing ${testId}`);
        }
        const style = window.getComputedStyle(element);
        return {
          clientHeight: element.clientHeight,
          overflowY: style.overflowY,
          scrollHeight: element.scrollHeight
        };
      }

      return {
        documentClientHeight: document.documentElement.clientHeight,
        documentScrollHeight: document.documentElement.scrollHeight,
        feed: panelMetrics("feed-scroll-container"),
        list: panelMetrics("article-list-scroll-container"),
        reader: panelMetrics("reader-scroll-container")
      };
    });
    expect(scrollMetrics.documentScrollHeight).toBeLessThanOrEqual(
      scrollMetrics.documentClientHeight + 4
    );
    expect(scrollMetrics.feed.overflowY).toBe("auto");
    expect(scrollMetrics.list.overflowY).toBe("auto");
    expect(scrollMetrics.reader.overflowY).toBe("auto");
    expect(scrollMetrics.list.scrollHeight).toBeGreaterThan(scrollMetrics.list.clientHeight);
    expect(scrollMetrics.reader.scrollHeight).toBeGreaterThan(scrollMetrics.reader.clientHeight);

    await page.getByTestId("reader-scroll-container").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event("scroll"));
    });
    await expect
      .poll(() => latestReadProgressEvent("E2E Article Beta")?.metadata.scrollSource)
      .toBe("reader");
    await expect
      .poll(() =>
        page.getByTestId("reader-scroll-container").evaluate((element) => element.scrollTop)
      )
      .toBeGreaterThan(0);
    const readProgress = latestReadProgressEvent("E2E Article Beta");
    expect(readProgress?.metadata.durationMs).toBeGreaterThanOrEqual(0);
    expect(readProgress?.metadata.activeDurationMs).toBeGreaterThanOrEqual(0);
    expect(readProgress?.metadata.progress).toBeGreaterThanOrEqual(0.25);

    const readerPanel = page.getByTestId("reader-scroll-container");
    await readerPanel.getByRole("button", { name: "收藏这篇文章" }).first().click();
    await expect(readerPanel.getByRole("button", { name: "取消收藏这篇文章" }).first()).toBeVisible();
    await readerPanel.getByRole("button", { name: "稍后读这篇文章" }).first().click();
    await expect(readerPanel.getByRole("button", { name: "移出稍后读" }).first()).toBeVisible();
    await readerPanel.getByRole("button", { name: "不再推荐类似文章" }).first().click();
    await expect(readerPanel.getByRole("button", { name: "已标记不感兴趣" }).first()).toBeVisible();

    await page.getByLabel("只看未读").uncheck();
    await page.getByRole("link", { name: "推荐" }).click();
    await expect(page.getByRole("heading", { name: "推荐文章" })).toBeVisible();
    await expect(page.getByText("推荐状态")).toBeVisible();
    await expect(page.getByText("基础排序中")).toBeVisible();
    await expect(page.getByText(/行为 \d+/)).toBeVisible();
    await expect(page.getByText(/Coverage \d+%/)).toBeVisible();
    await expect(page.getByRole("button", { name: /E2E Article Alpha/ })).toBeVisible();
    await page.getByRole("button", { name: /E2E Article Alpha/ }).click();
    await expect(page.getByRole("heading", { name: "为什么推荐" })).toBeVisible();

    await page.getByRole("link", { name: "最新" }).click();
    await page.getByRole("button", { name: "打开来源" }).click();
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
    await expect(page.getByText(/0 \/ \d+ · 0%/)).toBeVisible();
    await expect(page.getByText(/待处理 \d+/)).toBeVisible();
    await expect(page.getByText("失败 0")).toBeVisible();
    await expect(page.getByRole("button", { name: "重建向量索引" })).toBeVisible();
    await page.getByRole("button", { name: "测试连接" }).click();
    await expect(page.getByText("连接测试成功。")).toBeVisible();

    await page.getByRole("link", { name: "查看算法透明说明" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "算法透明说明" })).toBeVisible();
    await expect(page.getByText("当前推荐状态")).toBeVisible();
    await expect(page.getByText("排序流程图")).toBeVisible();

    await page.getByRole("link", { name: "订阅源" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "订阅源管理" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "导入、导出与刷新" })).toBeVisible();
    await expect(page.getByLabel("RSS / Atom URL")).toBeVisible();
    await expect(page.getByRole("button", { name: "刷新全部" })).toBeVisible();
    await expect(page.getByText("Feed URL")).toBeVisible();
  } finally {
    await fixture.close();
  }
});

function latestReadProgressEvent(articleTitle: string):
  | {
      metadata: {
        activeDurationMs: number;
        durationMs: number;
        progress: number;
        scrollSource: string;
      };
    }
  | null {
  const db = new Database(e2eDatabasePath, {
    readonly: true
  });
  try {
    const row = db
      .prepare(
        `
          select be.metadata_json as metadataJson
          from behavior_events be
          join articles a on a.id = be.article_id
          where a.title = ?
            and be.event_type = 'read_progress'
          order by be.created_at desc
          limit 1
        `
      )
      .get(articleTitle) as { metadataJson: string | null } | undefined;

    if (!row?.metadataJson) {
      return null;
    }

    return {
      metadata: JSON.parse(row.metadataJson) as {
        activeDurationMs: number;
        durationMs: number;
        progress: number;
        scrollSource: string;
      }
    };
  } finally {
    db.close();
  }
}

function latestBehaviorEvent(articleTitle: string, eventType: string): { metadata: unknown } | null {
  const db = new Database(e2eDatabasePath, {
    readonly: true
  });
  try {
    const row = db
      .prepare(
        `
          select be.metadata_json as metadataJson
          from behavior_events be
          join articles a on a.id = be.article_id
          where a.title = ?
            and be.event_type = ?
          order by be.created_at desc
          limit 1
        `
      )
      .get(articleTitle, eventType) as { metadataJson: string | null } | undefined;

    if (!row) {
      return null;
    }

    return {
      metadata: row.metadataJson ? JSON.parse(row.metadataJson) : null
    };
  } finally {
    db.close();
  }
}

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
