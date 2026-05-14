import { describe, expect, it } from "vitest";
import { ApiRequestError, createDibaoApi, userMessageForError } from "./api.js";

describe("web API client", () => {
  it("parses contract-shaped errors", async () => {
    const api = createDibaoApi(async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "PROVIDER_ERROR",
            message: "Feed parse failed"
          }
        }),
        {
          status: 502,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    await expect(api.createFeed("https://example.com/feed.xml")).rejects.toMatchObject({
      status: 502,
      code: "PROVIDER_ERROR",
      message: "Feed parse failed"
    });
  });

  it("returns a stable user-facing error message", () => {
    expect(userMessageForError(new ApiRequestError(400, "VALIDATION_ERROR", "Invalid URL"))).toBe(
      "Invalid URL"
    );
    expect(userMessageForError("nope")).toBe("请求失败，请稍后重试。");
  });
});
