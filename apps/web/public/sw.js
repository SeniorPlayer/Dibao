const CACHE_VERSION = "dibao-pwa-v4";
const APP_SHELL_CACHE = `${CACHE_VERSION}:app-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}:runtime`;

const PUBLIC_ICON_URLS = [
  "/logo.svg",
  "/logo-16.png",
  "/logo-32.png",
  "/logo-48.png",
  "/logo-64.png",
  "/logo-192.png",
  "/logo-512.png",
  "/apple-touch-icon.png",
  "/favicon.ico"
];

const APP_SHELL_URLS = [
  "/",
  "/index.html",
  "/site.webmanifest",
  ...PUBLIC_ICON_URLS
];

const STATIC_PATHS = new Set([
  "/site.webmanifest",
  ...PUBLIC_ICON_URLS
]);

self.addEventListener("install", (event) => {
  event.waitUntil(precacheAppShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((cacheName) => !cacheName.startsWith(CACHE_VERSION))
            .map((cacheName) => caches.delete(cacheName))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    event.waitUntil(self.skipWaiting());
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  if (requestUrl.pathname === "/api" || requestUrl.pathname.startsWith("/api/")) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (isStaticAsset(requestUrl.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function precacheAppShell() {
  const cache = await caches.open(APP_SHELL_CACHE);

  await Promise.all(
    APP_SHELL_URLS.map(async (url) => {
      try {
        const response = await fetch(new Request(url, { cache: "reload" }));
        if (response.ok) {
          await cache.put(url, response.clone());
          if (isHtmlResponse(response)) {
            const html = await response.clone().text();
            await cacheDiscoveredStaticAssets(cache, html);
          }
        }
      } catch {
        // Missing optional public assets must not abort service worker install.
      }
    })
  );
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(APP_SHELL_CACHE);

  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
      await cache.put("/index.html", response.clone());
      if (isHtmlResponse(response)) {
        const html = await response.clone().text();
        await cacheDiscoveredStaticAssets(cache, html);
      }
    }
    return response;
  } catch {
    return (
      (await cache.match(request)) ??
      (await cache.match("/index.html")) ??
      Response.error()
    );
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cachedResponse = await caches.match(request);

  const freshResponsePromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        void cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  return cachedResponse ?? (await freshResponsePromise) ?? Response.error();
}

function isStaticAsset(pathname) {
  return pathname.startsWith("/assets/") || STATIC_PATHS.has(pathname);
}

function isHtmlResponse(response) {
  return response.headers.get("content-type")?.includes("text/html") ?? false;
}

async function cacheDiscoveredStaticAssets(cache, html) {
  const urls = new Set();
  const attributePattern = /\b(?:href|src)=["']([^"']+)["']/g;

  for (const match of html.matchAll(attributePattern)) {
    const url = new URL(match[1], self.location.origin);
    if (url.origin === self.location.origin && isStaticAsset(url.pathname)) {
      urls.add(url.pathname);
    }
  }

  await Promise.all(
    Array.from(urls).map(async (url) => {
      try {
        const response = await fetch(new Request(url, { cache: "reload" }));
        if (response.ok) {
          await cache.put(url, response);
        }
      } catch {
        // Runtime build asset caching is best effort; navigation fallback still works.
      }
    })
  );
}
