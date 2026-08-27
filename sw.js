/* =========================================================
   Study Cycle — Service Worker
   - Precaches the app shell so it works fully offline.
   - When online, checks for a newer version of this file
     (the browser does that automatically on every navigation/
     registration.update() call) and, if found, installs it,
     wipes old caches, and takes over the page.

   >>> Bump CACHE_VERSION every time you deploy new files. <<<
   That's what forces every visitor's cache to refresh.
   ========================================================= */

const CACHE_VERSION = 'v4';
const CACHE_NAME = `study-cycle-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  './',
  './index.html',
  './css/styles.css',
  './js/icons.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/favicon.svg',
];

const RUNTIME_CACHEABLE_ORIGINS = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith('study-cycle-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 1) Page navigations: network-first so a visitor with internet always
  //    gets the freshest HTML, falling back to the cached shell offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // 2) Google Fonts (and similar): cache-first, populate cache on first
  //    successful online fetch, so the right typefaces still work offline
  //    after the first visit.
  if (RUNTIME_CACHEABLE_ORIGINS.includes(url.origin)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // 3) Same-origin static assets: stale-while-revalidate — instant from
  //    cache (works offline), refreshed in the background for next time.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }
});
