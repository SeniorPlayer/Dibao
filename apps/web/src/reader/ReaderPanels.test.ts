import { describe, expect, it } from "vitest";
import {
  measuredVirtualArticleWindow,
  safeOriginalArticleUrl,
  scrolledPastArticleIdsForIgnoreTelemetry
} from "./ReaderPanels.js";

describe("reader original article link", () => {
  it("allows only HTTP and HTTPS original URLs", () => {
    expect(safeOriginalArticleUrl("https://example.com/article")).toBe("https://example.com/article");
    expect(safeOriginalArticleUrl("http://example.com/article")).toBe("http://example.com/article");
    expect(safeOriginalArticleUrl("javascript:alert(1)")).toBeNull();
    expect(safeOriginalArticleUrl("data:text/html,hello")).toBeNull();
    expect(safeOriginalArticleUrl("file:///etc/passwd")).toBeNull();
  });
});

describe("article list ignore telemetry", () => {
  it("does not ignore restored rows until the user scrolls down again", () => {
    expect(
      scrolledPastArticleIdsForIgnoreTelemetry(
        [
          {
            articleId: "article_restored_above_viewport",
            bottom: -12,
            currentScrollTop: 480,
            firstVisibleScrollTop: 480,
            hasBeenSent: false,
            hasBeenVisible: true
          }
        ],
        0,
        24
      )
    ).toEqual([]);
  });

  it("ignores only after a visible article is really scrolled past", () => {
    expect(
      scrolledPastArticleIdsForIgnoreTelemetry(
        [
          {
            articleId: "article_seen_then_scrolled",
            bottom: -12,
            currentScrollTop: 540,
            firstVisibleScrollTop: 480,
            hasBeenSent: false,
            hasBeenVisible: true
          },
          {
            articleId: "article_seen_but_not_moved_enough",
            bottom: -12,
            currentScrollTop: 500,
            firstVisibleScrollTop: 480,
            hasBeenSent: false,
            hasBeenVisible: true
          }
        ],
        0,
        24
      )
    ).toEqual(["article_seen_then_scrolled"]);
  });

  it("keeps appended load-more candidates eligible after they scroll past", () => {
    expect(
      scrolledPastArticleIdsForIgnoreTelemetry(
        [
          {
            articleId: "article_before_load_more",
            bottom: -12,
            currentScrollTop: 220,
            firstVisibleScrollTop: 120,
            hasBeenSent: true,
            hasBeenVisible: true
          },
          {
            articleId: "article_appended_visible_then_scrolled",
            bottom: 0,
            currentScrollTop: 260,
            firstVisibleScrollTop: 180,
            hasBeenSent: false,
            hasBeenVisible: true
          },
          {
            articleId: "article_appended_not_seen",
            bottom: -4,
            currentScrollTop: 260,
            firstVisibleScrollTop: 180,
            hasBeenSent: false,
            hasBeenVisible: false
          },
          {
            articleId: "article_appended_still_visible",
            bottom: 96,
            currentScrollTop: 260,
            firstVisibleScrollTop: 180,
            hasBeenSent: false,
            hasBeenVisible: true
          }
        ],
        0,
        24
      )
    ).toEqual(["article_appended_visible_then_scrolled"]);
  });
});

describe("measured article list virtualization", () => {
  it("uses measured row heights for offsets and total height", () => {
    const window = measuredVirtualArticleWindow({
      articleIds: ["a", "b", "c"],
      estimatedHeight: 100,
      overscan: 0,
      rowHeights: new Map([
        ["a", 80],
        ["b", 220]
      ]),
      scrollTop: 85,
      viewportHeight: 100
    });

    expect(window.offsets).toEqual([0, 80, 300]);
    expect(window.totalHeight).toBe(400);
    expect(window.startIndex).toBe(1);
    expect(window.endIndex).toBe(2);
  });

  it("keeps total height at least the measured row sum when rows exceed the estimate", () => {
    const window = measuredVirtualArticleWindow({
      articleIds: ["a", "b"],
      estimatedHeight: 100,
      overscan: 1,
      rowHeights: new Map([
        ["a", 180],
        ["b", 240]
      ]),
      scrollTop: 0,
      viewportHeight: 120
    });

    expect(window.totalHeight).toBe(420);
    expect(window.endIndex).toBe(2);
  });
});
