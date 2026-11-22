// Bump on every release so old caches are cleared.
const CACHE = 'ryogae-v8';
const SHELL = ['./', 'index.html', 'app.js', 'style.css', 'manifest.webmanifest', 'icons/icon.svg',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'];
const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener('install', (e) => {
  // cache: 'reload' bypasses the browser's HTTP cache so we never store a stale copy.
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Versioned CDN files (OCR library) never change: cache first.
  if (url.hostname.endsWith('jsdelivr.net')) {
    e.respondWith(caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin !== location.origin) return; // exchange-rate APIs: straight to network

  // App files: network first (always fresh when online), cache fallback when offline or slow.
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const network = fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    });
    const timeout = new Promise((r) => setTimeout(r, NETWORK_TIMEOUT_MS));
    try {
      const res = await Promise.race([network, timeout]);
      if (res) return res;
    } catch {}
    return (await cache.match(req, { ignoreSearch: true })) || network;
  }));
});
