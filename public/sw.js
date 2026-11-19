const CACHE_PREFIX = "quincaillerie-shell";
const CACHE_NAME = `${CACHE_PREFIX}-v1`;
const APP_SHELL_CACHE = `${CACHE_PREFIX}-shell-v1`;
const STATIC_CACHE = `${CACHE_PREFIX}-static-v1`;
const OFFLINE_URL = "/offline.html";

function isPrivateRequest(url) {
  return url.pathname.startsWith("/api/")
    || url.pathname.startsWith("/verify-email")
    || url.pathname.startsWith("/password-reset");
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => cache.add(OFFLINE_URL)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== APP_SHELL_CACHE && key !== STATIC_CACHE && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isPrivateRequest(url)) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icon")) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const cacheControl = response.headers.get("cache-control") || "";
            if (!cacheControl.includes("no-store")) {
              const cache = await caches.open(APP_SHELL_CACHE);
              await cache.put(request, response.clone());
            }
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(APP_SHELL_CACHE);
          const cached = await cache.match(request);
          return cached || cache.match(OFFLINE_URL);
        }),
    );
  }
});
