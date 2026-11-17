// Quranic Words service worker: keeps the app shell, dictionary data and the
// last verses available offline, and makes installs feel like a native app.
const VERSION = 'qw-v1';
const CORE = [
  './',
  './index.html',
  './config.json',
  './manifest.webmanifest',
  './quranic-words-logo.svg',
  './vendor/marked.js',
  './src/style.css',
  './src/app.js',
  './src/core.js',
  './src/markup.js',
  './src/firebase-cards.js',
  './src/local-cards.js',
  './data/entries.json',
  './data/toc.json',
  './data/manifest.json',
];
const caches = self.caches;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.allSettled(CORE.map(url => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name !== VERSION).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

const cacheFirst = async (request, cacheName = VERSION) => {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, {ignoreVary: true});
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
  return response;
};

const staleWhileRevalidate = async (request, cacheName = VERSION) => {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, {ignoreVary: true});
  const network = fetch(request).then(response => {
    if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
    return response;
  }).catch(() => cached);
  // Serve the cached copy instantly and refresh it in the background, so a
  // deploy becomes visible on the next visit without losing offline support.
  return cached || network;
};

const networkFirst = async (request, fallback) => {
  const cache = await caches.open(VERSION);
  try {
    // no-cache revalidates with the server, so a refresh always shows the
    // latest deploy instead of a stale HTTP-cached copy.
    const response = await fetch(request, {cache: 'no-cache'});
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request, {ignoreVary: true}))
      || (fallback ? await cache.match(fallback, {ignoreVary: true}) : undefined)
      || Response.error();
  }
};

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!['http:', 'https:'].includes(url.protocol)) return;
  if (request.mode === 'navigate') {
    // App routes are single-page; fall back to the cached shell when offline.
    event.respondWith(networkFirst(request, './index.html'));
    return;
  }
  if (url.origin === self.location.origin) {
    // The app shell must show the latest deploy on the first refresh; only the
    // large dictionary data files use stale-while-revalidate.
    event.respondWith(url.pathname.includes('/data/') ? staleWhileRevalidate(request) : networkFirst(request));
    return;
  }
  if (url.hostname.endsWith('alquran.cloud')) {
    event.respondWith(networkFirst(request));
    return;
  }
  if (/(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    // Font URLs are immutable; cache-first keeps them offline.
    event.respondWith(cacheFirst(request, `${VERSION}-fonts`));
  }
});
