import { describe, expect, it } from "vitest";
import { shouldSkipPassiveIgnoreTelemetry } from "./articleListState.js";

describe("passive article ignore telemetry", () => {
  it("keeps other unseen articles eligible while a detail article is open", () => {
    expect(
      shouldSkipPassiveIgnoreTelemetry({
        articleId: "article_scrolled_past",
        interactionStatus: "unseen",
        isAlreadyIgnored: false,
        isOpened: false,
        selectedArticleId: "article_open_in_detail"
      })
    ).toBe(false);
  });

  it("does not passively ignore the article currently open in detail", () => {
    expect(
      shouldSkipPassiveIgnoreTelemetry({
        articleId: "article_open_in_detail",
        interactionStatus: "unseen",
        isAlreadyIgnored: false,
        isOpened: false,
        selectedArticleId: "article_open_in_detail"
      })
    ).toBe(true);
  });
});
