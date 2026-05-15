import { describe, expect, it } from "vitest";
import { ApiRequestError, createDibaoApi, userMessageForError } from "./api.js";
import { dictionaries } from "./i18n.js";

describe("web API client", () => {
  it("calls auth endpoints with same-origin credentials", async () => {
    const calls: Array<{
      body: unknown;
      credentials: RequestCredentials | undefined;
      method: string | undefined;
      path: string;
    }> = [];
    const api = createDibaoApi(async (input, init) => {
      calls.push({
        path: String(input),
        method: init?.method,
        credentials: init?.credentials,
        body: init?.body ? JSON.parse(String(init.body)) : null
      });

      return new Response(
        JSON.stringify({
          data: String(input).endsWith("/session")
            ? {
                setupCompleted: true,
                authenticated: false
              }
            : {
                ok: true
              }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    });

    await expect(api.getAuthSession()).resolves.toEqual({
      setupCompleted: true,
      authenticated: false
    });
    await api.setupAuth("correct horse battery");
    await api.login("correct horse battery");
    await api.logout();

    expect(calls).toEqual([
      {
        path: "/api/auth/session",
        method: undefined,
        credentials: "same-origin",
        body: null
      },
      {
        path: "/api/auth/setup",
        method: "POST",
        credentials: "same-origin",
        body: {
          password: "correct horse battery"
        }
      },
      {
        path: "/api/auth/login",
        method: "POST",
        credentials: "same-origin",
        body: {
          password: "correct horse battery"
        }
      },
      {
        path: "/api/auth/logout",
        method: "POST",
        credentials: "same-origin",
        body: null
      }
    ]);
  });

  it("fetches feed folders", async () => {
    const calls: string[] = [];
    const api = createDibaoApi(async (input) => {
      calls.push(String(input));

      return new Response(
        JSON.stringify({
          data: [
            {
              id: "folder_design",
              title: "Design",
              sortOrder: 1
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    });

    await expect(api.listFeedFolders()).resolves.toEqual([
      {
        id: "folder_design",
        title: "Design",
        sortOrder: 1
      }
    ]);
    expect(calls).toEqual(["/api/feed-folders"]);
  });

  it("fetches setup status", async () => {
    const calls: string[] = [];
    const api = createDibaoApi(async (input) => {
      calls.push(String(input));

      return new Response(
        JSON.stringify({
          data: {
            setupCompleted: true,
            hasFeeds: false,
            hasEmbeddingProvider: false,
            firstRefreshStatus: "idle"
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    });

    await expect(api.getSetupStatus()).resolves.toEqual({
      setupCompleted: true,
      hasFeeds: false,
      hasEmbeddingProvider: false,
      firstRefreshStatus: "idle"
    });
    expect(calls).toEqual(["/api/setup/status"]);
  });

  it("fetches and updates app settings", async () => {
    const calls: Array<{ path: string; method: string | undefined; body: unknown }> = [];
    const api = createDibaoApi(async (input, init) => {
      calls.push({
        path: String(input),
        method: init?.method,
        body: init?.body ? JSON.parse(String(init.body)) : null
      });

      const settings = {
        ui: {
          locale: "en-US"
        },
        reader: {
          fontSize: 20,
          lineHeight: 1.8,
          paragraphGap: 1.2,
          readerWidth: 760,
          theme: "paper"
        },
        retention: {
          retentionDays: 45,
          keepFavorites: true,
          keepReadLater: true
        },
        ranking: {
          preferFreshness: 0.5,
          preferSource: 0.5,
          preferDiversity: 0.5
        }
      };

      return new Response(
        JSON.stringify({
          data:
            init?.method === "PATCH"
              ? {
                  ok: true,
                  settings
                }
              : settings
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    });

    await expect(api.getSettings()).resolves.toMatchObject({
      ui: {
        locale: "en-US"
      },
      retention: {
        retentionDays: 45
      }
    });
    await expect(
      api.updateSettings({
        ui: {
          locale: "en-US"
        },
        reader: {
          fontSize: 20
        },
        retention: {
          retentionDays: 45
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      settings: {
        reader: {
          fontSize: 20
        }
      }
    });

    expect(calls).toEqual([
      {
        path: "/api/settings",
        method: undefined,
        body: null
      },
      {
        path: "/api/settings",
        method: "PATCH",
        body: {
          ui: {
            locale: "en-US"
          },
          reader: {
            fontSize: 20
          },
          retention: {
            retentionDays: 45
          }
        }
      }
    ]);
  });

  it("calls feed and folder management endpoints", async () => {
    const calls: Array<{ path: string; method: string | undefined; body: unknown }> = [];
    const api = createDibaoApi(async (input, init) => {
      const path = String(input);
      calls.push({
        path,
        method: init?.method,
        body: init?.body ? JSON.parse(String(init.body)) : null
      });

      const data = path === "/api/feeds/refresh"
        ? {
            jobIds: ["job_1", "job_2"]
          }
        : path.includes("/feed-folders")
        ? {
            id: "folder_design",
            title: "Design",
            sortOrder: 1
          }
        : path === "/api/feeds"
          ? {
              feed: {
                id: "feed_design",
                folderId: "folder_design",
                title: "Design Feed",
                siteUrl: null,
                feedUrl: "https://example.com/feed.xml",
                description: null,
                enabled: true,
                sourceWeight: 0,
                lastFetchedAt: null,
                lastSuccessAt: null,
                lastError: null,
                createdAt: "2026-05-14T08:00:00.000Z",
                updatedAt: "2026-05-14T08:00:00.000Z"
              },
              refreshJobId: "job_1"
            }
          : path.includes("/feeds/")
            ? init?.method === "DELETE"
              ? { ok: true }
              : {
                  id: "feed_design",
                  folderId: "folder_design",
                  title: "Design Feed",
                  siteUrl: null,
                  feedUrl: "https://example.com/feed.xml",
                  description: null,
                  enabled: false,
                  sourceWeight: 0.2,
                  lastFetchedAt: null,
                  lastSuccessAt: null,
                  lastError: null,
                  createdAt: "2026-05-14T08:00:00.000Z",
                  updatedAt: "2026-05-14T08:00:00.000Z"
                }
            : { ok: true };

      return new Response(JSON.stringify({ data }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    });

    await api.createFeed("https://example.com/feed.xml", "folder_design");
    await api.createFeedFolder("Design");
    await api.updateFeedFolder("folder/design", { title: "Design Systems" });
    await api.deleteFeedFolder("folder/design");
    await api.updateFeed("feed/design", {
      title: "Design Feed",
      folderId: "folder_design",
      enabled: false,
      sourceWeight: 0.2
    });
    await api.deleteFeed("feed/design");
    await api.refreshAllFeeds();

    expect(calls).toEqual([
      {
        path: "/api/feeds",
        method: "POST",
        body: {
          feedUrl: "https://example.com/feed.xml",
          folderId: "folder_design"
        }
      },
      {
        path: "/api/feed-folders",
        method: "POST",
        body: {
          title: "Design"
        }
      },
      {
        path: "/api/feed-folders/folder%2Fdesign",
        method: "PATCH",
        body: {
          title: "Design Systems"
        }
      },
      {
        path: "/api/feed-folders/folder%2Fdesign",
        method: "DELETE",
        body: null
      },
      {
        path: "/api/feeds/feed%2Fdesign",
        method: "PATCH",
        body: {
          title: "Design Feed",
          folderId: "folder_design",
          enabled: false,
          sourceWeight: 0.2
        }
      },
      {
        path: "/api/feeds/feed%2Fdesign",
        method: "DELETE",
        body: null
      },
      {
        path: "/api/feeds/refresh",
        method: "POST",
        body: null
      }
    ]);
  });

  it("lists articles with view, folder, and cursor query", async () => {
    const calls: string[] = [];
    const api = createDibaoApi(async (input) => {
      calls.push(String(input));

      return new Response(
        JSON.stringify({
          data: [],
          page: {
            nextCursor: null
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    });

    await api.listArticles({
      view: "recommended",
      folderId: "folder_design",
      limit: 20,
      cursor: "cursor_1"
    });

    expect(calls).toEqual([
      "/api/articles?view=recommended&limit=20&folderId=folder_design&cursor=cursor_1"
    ]);
  });

  it("imports OPML without forcing a JSON content type", async () => {
    const calls: Array<{
      path: string;
      bodyIsFormData: boolean;
      contentType: string | null;
      method: string | undefined;
    }> = [];
    const api = createDibaoApi(async (input, init) => {
      calls.push({
        path: String(input),
        bodyIsFormData: init?.body instanceof FormData,
        contentType: new Headers(init?.headers).get("content-type"),
        method: init?.method
      });

      return new Response(
        JSON.stringify({
          data: {
            foldersCreated: 1,
            feedsCreated: 2,
            feedsSkipped: 3,
            errors: []
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    });

    await expect(
      api.importOpml(new File(["<opml version=\"2.0\" />"], "subscriptions.opml"))
    ).resolves.toMatchObject({
      foldersCreated: 1,
      feedsCreated: 2,
      feedsSkipped: 3
    });
    expect(calls).toEqual([
      {
        path: "/api/opml/import",
        method: "POST",
        bodyIsFormData: true,
        contentType: null
      }
    ]);
  });

  it("exports OPML as XML text", async () => {
    const calls: string[] = [];
    const api = createDibaoApi(async (input) => {
      calls.push(String(input));

      return new Response("<?xml version=\"1.0\"?><opml version=\"2.0\"></opml>", {
        status: 200,
        headers: {
          "content-type": "application/xml"
        }
      });
    });

    await expect(api.exportOpml()).resolves.toBe(
      "<?xml version=\"1.0\"?><opml version=\"2.0\"></opml>"
    );
    expect(calls).toEqual(["/api/opml/export"]);
  });

  it("fetches article rank explanations", async () => {
    const calls: string[] = [];
    const api = createDibaoApi(async (input) => {
      calls.push(String(input));

      return new Response(
        JSON.stringify({
          data: {
            articleId: "article/one",
            reasons: [
              {
                type: "source",
                label: "Fixture Feed",
                impact: "positive"
              }
            ],
            generatedAt: "2026-05-14T08:10:00.000Z"
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    });

    await expect(api.getArticleExplanation("article/one")).resolves.toMatchObject({
      articleId: "article/one",
      reasons: [
        {
          type: "source",
          label: "Fixture Feed",
          impact: "positive"
        }
      ]
    });
    expect(calls).toEqual(["/api/articles/article%2Fone/explanation"]);
  });

  it("posts article actions using the contract-shaped body", async () => {
    const calls: Array<{ path: string; body: unknown; method: string | undefined }> = [];
    const api = createDibaoApi(async (input, init) => {
      calls.push({
        path: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
        method: init?.method
      });

      return new Response(
        JSON.stringify({
          data: {
            state: {
              read: false,
              favorited: false,
              readLater: false,
              hidden: false,
              notInterested: false,
              readingProgress: 0
            }
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    });

    await api.postArticleAction("article/one", {
      type: "favorite",
      value: false
    });
    await api.postArticleAction("article/one", {
      type: "read_progress",
      progress: 0.5
    });

    expect(calls).toEqual([
      {
        path: "/api/articles/article%2Fone/actions",
        method: "POST",
        body: {
          type: "favorite",
          value: false
        }
      },
      {
        path: "/api/articles/article%2Fone/actions",
        method: "POST",
        body: {
          type: "read_progress",
          progress: 0.5
        }
      }
    ]);
  });

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
    expect(
      userMessageForError(
        new ApiRequestError(400, "VALIDATION_ERROR", "Invalid URL"),
        dictionaries["zh-CN"].errors.api
      )
    ).toBe("Invalid URL");
    expect(userMessageForError("nope", dictionaries["zh-CN"].errors.api)).toBe(
      dictionaries["zh-CN"].errors.api.requestFailed
    );
    expect(
      userMessageForError(
        new ApiRequestError(500, "INTERNAL_ERROR", "", undefined, false),
        dictionaries["en-US"].errors.api
      )
    ).toBe("Request failed (HTTP 500).");
  });
});
