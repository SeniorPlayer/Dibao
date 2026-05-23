import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type FixtureServer = {
  origin: string;
  close: () => Promise<void>;
};

export async function startFixtureServer(): Promise<FixtureServer> {
  let origin = "";
  const server = createServer((request, response) => {
    void handleFixtureRequest(request, response, origin);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${address.port}`;

  return {
    origin,
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  };
}

async function handleFixtureRequest(
  request: IncomingMessage,
  response: ServerResponse,
  origin: string
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://fixture.local");

  if (request.method === "GET" && url.pathname === "/feeds/main.xml") {
    sendResponse(response, 200, "application/rss+xml; charset=utf-8", fixtureRss(origin));
    return;
  }

  if (request.method === "GET" && url.pathname === "/articles/alpha") {
    sendResponse(response, 200, "text/html; charset=utf-8", fullArticlePage("Alpha"));
    return;
  }

  if (request.method === "GET" && url.pathname === "/articles/beta") {
    sendResponse(response, 200, "text/html; charset=utf-8", fullArticlePage("Beta"));
    return;
  }

  if (request.method === "GET" && url.pathname === "/articles/broken-full-content") {
    sendResponse(response, 500, "text/html; charset=utf-8", "<html><body>broken</body></html>");
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/articles/extra-")) {
    sendResponse(
      response,
      200,
      "text/html; charset=utf-8",
      "<html><body><article><p>short extra content</p></article></body></html>"
    );
    return;
  }

  if (request.method === "GET" && url.pathname === "/site-with-feeds") {
    sendResponse(response, 200, "text/html; charset=utf-8", fixtureSiteWithFeeds);
    return;
  }

  if (request.method === "GET" && url.pathname === "/feeds/alt.xml") {
    sendResponse(response, 200, "application/atom+xml; charset=utf-8", fixtureAtom);
    return;
  }

  if (request.method === "GET" && url.pathname === "/feeds/broken.xml") {
    sendResponse(response, 500, "application/xml; charset=utf-8", "<rss>");
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/embeddings") {
    const body = await readBody(request);
    const input = parseEmbeddingInput(body);
    sendResponse(
      response,
      200,
      "application/json; charset=utf-8",
      JSON.stringify({
        data: input.map((text, index) => ({
          index,
          embedding: embeddingForText(text)
        }))
      })
    );
    return;
  }

  sendResponse(
    response,
    599,
    "application/json; charset=utf-8",
    JSON.stringify({
      error: `Unexpected fixture request: ${request.method ?? "GET"} ${url.pathname}`
    })
  );
}

function sendResponse(
  response: ServerResponse,
  status: number,
  contentType: string,
  body: string
): void {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store"
  });
  response.end(body);
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function parseEmbeddingInput(body: string): string[] {
  const payload = JSON.parse(body) as { input?: unknown };
  if (Array.isArray(payload.input)) {
    return payload.input.map(String);
  }

  return [String(payload.input ?? "")];
}

function embeddingForText(text: string): number[] {
  const seed = Array.from(text).reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return [1, (seed % 7) / 10, (seed % 11) / 10, (seed % 13) / 10];
}

const longArticleBody = Array.from({ length: 42 })
  .map(
    (_, index) =>
      `<p>Beta long reader paragraph ${index + 1}. This local article gives the reader panel enough height for independent scroll telemetry.</p>`
  )
  .join("");

const extraFixtureItems = Array.from({ length: 58 })
  .map((_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return `
    <item>
      <title>E2E Article Extra ${number}</title>
      <link>{{origin}}/articles/extra-${number}</link>
      <guid>e2e-extra-${number}</guid>
      <author>Dibao Test</author>
      <pubDate>Wed, 13 May 2026 ${String(index % 24).padStart(2, "0")}:00:00 GMT</pubDate>
      <description>Extra summary ${number} for scroll measurement.</description>
      <content:encoded><![CDATA[<p>Extra article body ${number}.</p>]]></content:encoded>
    </item>`;
  })
  .join("");

function fixtureRss(origin: string): string {
  return `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>E2E Fixture Feed</title>
    <link>${origin}/fixture</link>
    <description>Local smoke test feed</description>
    <item>
      <title>E2E Article Alpha</title>
      <link>${origin}/articles/alpha</link>
      <guid>e2e-alpha</guid>
      <author>Dibao Test</author>
      <pubDate>Thu, 14 May 2026 07:30:00 GMT</pubDate>
      <description>Alpha summary for the smoke suite.</description>
      <content:encoded><![CDATA[<p>Alpha article body for local end-to-end smoke testing.</p>]]></content:encoded>
    </item>
    <item>
      <title>E2E Article Beta</title>
      <link>${origin}/articles/beta</link>
      <guid>e2e-beta</guid>
      <author>Dibao Test</author>
      <pubDate>Thu, 14 May 2026 08:00:00 GMT</pubDate>
      <description>Beta summary for the smoke suite.</description>
      <content:encoded><![CDATA[${longArticleBody}]]></content:encoded>
    </item>
    <item>
      <title>E2E Article Broken Full Content</title>
      <link>${origin}/articles/broken-full-content</link>
      <guid>e2e-broken-full-content</guid>
      <author>Dibao Test</author>
      <pubDate>Thu, 14 May 2026 07:45:00 GMT</pubDate>
      <description>Broken full content summary for the smoke suite.</description>
      <content:encoded><![CDATA[<p>Broken article feed body remains readable.</p>]]></content:encoded>
    </item>
    ${extraFixtureItems.replaceAll("{{origin}}", origin)}
  </channel>
</rss>`;
}

function fullArticlePage(label: "Alpha" | "Beta"): string {
  const repeated = Array.from({ length: label === "Alpha" ? 4 : 8 })
    .map(
      (_, index) =>
        `<p>${label} extracted full content paragraph ${index + 1}. This page body comes from the fixture article HTML and is intentionally long enough for the Dibao full content extractor to accept it during E2E validation.</p>`
    )
    .join("");
  return `<!doctype html>
<html>
  <head><title>${label} full page</title></head>
  <body>
    <nav>navigation should be removed</nav>
    <article>
      <h1>${label} full page</h1>
      ${repeated}
    </article>
    <script>throw new Error("should be removed")</script>
    <footer>footer should be removed</footer>
  </body>
</html>`;
}

const fixtureAtom = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>E2E Alternate Feed</title>
  <link href="http://127.0.0.1/alternate" rel="alternate" />
  <entry>
    <title>E2E Alternate Article</title>
    <link href="http://127.0.0.1/articles/alternate" />
    <id>e2e-alternate</id>
    <updated>2026-05-14T09:00:00.000Z</updated>
    <summary>Alternate summary.</summary>
  </entry>
</feed>`;

const fixtureSiteWithFeeds = `<!doctype html>
<html>
  <head>
    <title>E2E Fixture Site</title>
    <link rel="alternate feed" type="application/rss+xml" href="/feeds/main.xml" title="Main RSS">
    <link rel="alternate" type="application/atom+xml" href="/feeds/alt.xml" title="Alt Atom">
  </head>
  <body>E2E fixture site</body>
</html>`;
