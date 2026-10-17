// Civitas offline cache (docs/local-mode.md, phase F). vite.config.ts copies this to dist-local/sw.js with the build's file list
// and version filled in. Registered only by the static local build (local/ui.ts registerServiceWorker), never by online play.
const VERSION = '__VERSION__';
const CACHE = `civitas-${VERSION}`;
const FILES = __FILES__;

self.addEventListener('install', (event) => {
  // every file of the build, relative to this worker: a visit with a network leaves the whole game offline-ready
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  // a newer worker waits until the old one's tabs are closed (no skipWaiting), then drops the old caches
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('civitas-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // ?local&name=... and the like are the same page; a navigation with no match falls back to the game page
    const hit = await cache.match(req, { ignoreSearch: true }) ?? (req.mode === 'navigate' ? await cache.match('./index.html') : undefined);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (e) {
      return new Response('Civitas is offline and this file was not saved.', { status: 503, headers: { 'content-type': 'text/plain' } });
    }
  })());
});
