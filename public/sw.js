const CACHE = "shop-ledger-shell-v4";
const SHELL = ["/overview", "/sale", "/sales", "/sales/offline", "/inventory", "/customers", "/register", "/reports", "/settings", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const responses = await Promise.all(SHELL.map((path) => fetch(path)));
    const assets = new Set();
    for (let index = 0; index < SHELL.length; index += 1) {
      const response = responses[index];
      await cache.put(SHELL[index], response.clone());
      if (!(response.headers.get("content-type") || "").includes("text/html")) continue;
      const html = await response.text();
      for (const match of html.matchAll(/(?:src|href)="([^"?]*\/_next\/static\/[^"?]+)(?:\?[^\"]*)?"/g)) assets.add(match[1]);
    }
    await cache.addAll([...assets]);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(request, copy));
      return response;
    }).catch(async () => {
      const exact = await caches.match(request);
      if (exact) return exact;
      if (url.pathname.startsWith("/sales/")) return caches.match("/sales/offline");
      return caches.match("/overview");
    }));
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname === "/icon.svg") {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(request, copy));
      return response;
    })));
  }
});
