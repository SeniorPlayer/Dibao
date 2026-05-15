import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type FixtureServer = {
  origin: string;
  close: () => Promise<void>;
};

export async function startFixtureServer(): Promise<FixtureServer> {
  const server = createServer((request, response) => {
    void handleFixtureRequest(request, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;

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
  response: ServerResponse
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://fixture.local");

  if (request.method === "GET" && url.pathname === "/feeds/main.xml") {
    sendResponse(response, 200, "application/rss+xml; charset=utf-8", fixtureRss);
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

const fixtureRss = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>E2E Fixture Feed</title>
    <link>http://127.0.0.1/fixture</link>
    <description>Local smoke test feed</description>
    <item>
      <title>E2E Article Alpha</title>
      <link>http://127.0.0.1/articles/alpha</link>
      <guid>e2e-alpha</guid>
      <author>Dibao Test</author>
      <pubDate>Thu, 14 May 2026 07:30:00 GMT</pubDate>
      <description>Alpha summary for the smoke suite.</description>
      <content:encoded><![CDATA[<p>Alpha article body for local end-to-end smoke testing.</p>]]></content:encoded>
    </item>
    <item>
      <title>E2E Article Beta</title>
      <link>http://127.0.0.1/articles/beta</link>
      <guid>e2e-beta</guid>
      <author>Dibao Test</author>
      <pubDate>Thu, 14 May 2026 08:00:00 GMT</pubDate>
      <description>Beta summary for the smoke suite.</description>
      <content:encoded><![CDATA[<p>Beta article body for recommended fallback and explanation checks.</p>]]></content:encoded>
    </item>
  </channel>
</rss>`;
