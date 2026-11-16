// PhysMap service worker: makes the web version installable and usable offline.
//
// Strategy:
//   - Built assets (hashed file names under /assets/) never change, so they are
//     served from the cache first.
//   - Everything else (the pages, fonts, icons) goes to the network first, so a
//     new release shows up on the next visit, and falls back to the cache when
//     there is no connection.
//   - Nothing from another origin is touched (YouTube embeds, etc.).

const CACHE = 'physmap-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

// The page tells us what it loaded on its first visit, before this worker was
// in control, so the app already works offline the second time it is opened.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'physmap-precache' || !Array.isArray(event.data.urls)) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(event.data.urls.map(async (url) => {
      try {
        if (new URL(url).origin !== self.location.origin) return;
        if (await cache.match(url)) return;
        const response = await fetch(url);
        if (response.ok) await cache.put(url, response);
      } catch (error) {
        // Offline or blocked: skip it, the next visit will try again.
      }
    }));
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.headers.has('range')) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const immutable = url.pathname.includes('/assets/');

    if (immutable) {
      const cached = await cache.match(request);
      if (cached) return cached;
    }

    try {
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    } catch (error) {
      const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
      if (cached) return cached;
      throw error;
    }
  })());
});
