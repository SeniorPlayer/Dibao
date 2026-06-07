import { describe, expect, it } from "vitest";
import { scrolledPastArticleIdsForIgnoreTelemetry } from "./ReaderPanels.js";

describe("article list ignore telemetry", () => {
  it("keeps appended load-more candidates eligible after they scroll past", () => {
    expect(
      scrolledPastArticleIdsForIgnoreTelemetry(
        [
          {
            articleId: "article_before_load_more",
            bottom: -12,
            hasBeenSent: true,
            hasBeenVisible: true
          },
          {
            articleId: "article_appended_visible_then_scrolled",
            bottom: 0,
            hasBeenSent: false,
            hasBeenVisible: true
          },
          {
            articleId: "article_appended_not_seen",
            bottom: -4,
            hasBeenSent: false,
            hasBeenVisible: false
          },
          {
            articleId: "article_appended_still_visible",
            bottom: 96,
            hasBeenSent: false,
            hasBeenVisible: true
          }
        ],
        0
      )
    ).toEqual(["article_appended_visible_then_scrolled"]);
  });
});
