import { createServer } from "node:http";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const project = `dibao-d-smoke-${process.pid}`;
const hostPort = process.env.DIBAO_DOCKER_SMOKE_PORT ?? "18080";
const username = "docker-smoke";
const password = "docker smoke password";
const fixtureRss = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Docker Smoke Feed</title>
    <link>http://host.docker.internal/docker-smoke</link>
    <description>Local Docker recommendation smoke feed</description>
    <item>
      <title>Docker Smoke Alpha</title>
      <link>http://host.docker.internal/articles/alpha</link>
      <guid>docker-smoke-alpha</guid>
      <pubDate>Thu, 14 May 2026 07:30:00 GMT</pubDate>
      <description>Alpha summary for Docker recommendation smoke.</description>
      <content:encoded><![CDATA[<p>Alpha article body for Docker recommendation smoke.</p>]]></content:encoded>
    </item>
    <item>
      <title>Docker Smoke Beta</title>
      <link>http://host.docker.internal/articles/beta</link>
      <guid>docker-smoke-beta</guid>
      <pubDate>Thu, 14 May 2026 08:00:00 GMT</pubDate>
      <description>Beta summary for Docker recommendation smoke.</description>
      <content:encoded><![CDATA[<p>Beta article body for Docker recommendation smoke.</p>]]></content:encoded>
    </item>
  </channel>
</rss>`;
const tmp = mkdtempSync(join(tmpdir(), "dibao-docker-smoke-"));
const dataPath = join(tmp, "data");
const overridePath = join(tmp, "compose.override.yaml");
mkdirSync(dataPath, { recursive: true });
chmodSync(dataPath, 0o777);

const fixture = await startFixtureServer();
const apiBase = `http://127.0.0.1:${hostPort}`;

writeFileSync(
  overridePath,
  `services:
  dibao:
    ports:
      - "${hostPort}:8080"
    environment:
      DIBAO_BACKGROUND_JOBS: "true"
      DIBAO_JOB_RUNNER_INTERVAL_MS: "500"
    volumes:
      - "${dataPath}:/data"
    extra_hosts:
      - "host.docker.internal:host-gateway"
`
);

try {
  run("docker", ["compose", "-p", project, "-f", "compose.yaml", "-f", overridePath, "up", "-d", "--build"]);
  await waitForHealth(apiBase);

  const setup = await postJson(`${apiBase}/api/auth/setup`, { username, password });
  const cookie = setup.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) {
    throw new Error("Setup did not return a session cookie");
  }

  await postJson(
    `${apiBase}/api/feeds`,
    {
      feedUrl: `http://host.docker.internal:${fixture.port}/feeds/main.xml`
    },
    cookie
  );

  const provider = await postJson(
    `${apiBase}/api/embedding/providers`,
    {
      type: "openai_compatible",
      name: "Docker Smoke Mock",
      baseUrl: `http://host.docker.internal:${fixture.port}/v1`,
      model: "docker-smoke-embedding",
      dimension: 4,
      enabled: true
    },
    cookie
  );
  if (!provider.data?.id) {
    throw new Error("Provider creation did not return an id");
  }

  const indexes = await getJson(`${apiBase}/api/embedding/indexes`, cookie);
  const activeIndex = indexes.data?.find((index) => index.status === "active");
  if (!activeIndex) {
    throw new Error("No active embedding index after provider setup");
  }

  await postJson(`${apiBase}/api/embedding/indexes/${activeIndex.id}/backfill`, {}, cookie);
  const status = await waitForRecommendationStatus(apiBase, cookie);
  const recommended = await getJson(`${apiBase}/api/articles?view=recommended`, cookie);
  if (!Array.isArray(recommended.data) || recommended.data.length === 0) {
    throw new Error("Recommended API returned no articles");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        providerId: provider.data.id,
        activeIndexId: activeIndex.id,
        recommendationMode: status.data.mode,
        coverage: status.data.coverage,
        recommendedCount: recommended.data.length
      },
      null,
      2
    )
  );
} finally {
  try {
    run("docker", ["compose", "-p", project, "-f", "compose.yaml", "-f", overridePath, "down", "-v"]);
  } finally {
    await fixture.close();
  }
}

function run(command, args) {
  execFileSync(command, args, {
    cwd: process.cwd(),
    stdio: "inherit"
  });
}

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/system/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // keep polling
    }
    await sleep(1000);
  }
  throw new Error("Timed out waiting for Docker smoke health check");
}

async function waitForRecommendationStatus(baseUrl, cookie) {
  const deadline = Date.now() + 60_000;
  let last;
  while (Date.now() < deadline) {
    last = await getJson(`${baseUrl}/api/recommendation/status`, cookie);
    if (last.data?.coverage?.embeddingCount > 0 && last.data?.coverage?.pendingJobs === 0) {
      return last;
    }
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for embedding jobs: ${JSON.stringify(last)}`);
}

async function getJson(url, cookie) {
  const response = await fetch(url, {
    headers: {
      cookie
    }
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${url} failed: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function postJson(url, body, cookie) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {})
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${url} failed: ${JSON.stringify(payload)}`);
  }
  return {
    ...payload,
    headers: response.headers
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startFixtureServer() {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://fixture.local");
    if (request.method === "GET" && url.pathname === "/feeds/main.xml") {
      send(response, 200, "application/rss+xml; charset=utf-8", fixtureRss);
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/embeddings") {
      const body = JSON.parse(await readBody(request));
      const input = Array.isArray(body.input) ? body.input : [body.input];
      send(
        response,
        200,
        "application/json; charset=utf-8",
        JSON.stringify({
          data: input.map((text, index) => ({
            index,
            embedding: embeddingForText(String(text))
          }))
        })
      );
      return;
    }
    send(response, 404, "application/json; charset=utf-8", JSON.stringify({ error: "not found" }));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    port: server.address().port,
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

function readBody(request) {
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

function send(response, status, contentType, body) {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store"
  });
  response.end(body);
}

function embeddingForText(text) {
  const seed = Array.from(text).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return [1, (seed % 7) / 10, (seed % 11) / 10, (seed % 13) / 10];
}
