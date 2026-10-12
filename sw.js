/* =========================================================
   Study Cycle — Service Worker (uso offline)

   Estratégia: "rede primeiro, cache de reserva".
   - Com internet, o app SEMPRE carrega a versão mais nova dos
     arquivos (a rede é consultada a cada abertura; se nada mudou
     é só uma checagem rápida).
   - Sem internet (ou rede lenta), usa a última cópia guardada.

   Por isso NÃO existe mais número de versão para lembrar de trocar
   a cada publicação. A única manutenção: se você criar um arquivo
   novo em js/ ou css/, acrescente-o em APP_FILES abaixo.
   ========================================================= */

const CACHE = 'study-cycle';
const NETWORK_TIMEOUT_MS = 4000;

const APP_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/icons.js',
  './js/store.js',
  './js/logic.js',
  './js/ui.js',
  './js/sync.js',
  './js/ocr.js',
  './js/screens.js',
  './js/modals.js',
  './js/main.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/favicon.svg',
];

// Sites externos que vale guardar para uso offline: fontes e OCR (Tesseract).
const EXTERNAL_ORIGINS = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
  'https://cdn.jsdelivr.net',
  'https://tessdata.projectnaptha.com',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(APP_FILES.map((url) =>
        fetch(url, { cache: 'reload' }).then((res) => (res.ok ? cache.put(url, res) : null)))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      // Apaga caches de versões antigas (study-cycle-v1, -v2, ...).
      .then((names) => Promise.all(names.filter((n) => n !== CACHE && n.startsWith('study-cycle')).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

function networkFirst(req, { timeout }) {
  // `no-cache`: sempre confere com o servidor (resposta 304 é barata).
  const fromNetwork = fetch(req.mode === 'navigate' ? req.url : req, { cache: 'no-cache' }).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((cache) => cache.put(req.mode === 'navigate' ? './index.html' : req, copy));
    }
    return res;
  });
  const fromCache = () => caches.match(req.mode === 'navigate' ? './index.html' : req);
  const limited = timeout
    ? Promise.race([fromNetwork, new Promise((_, reject) => setTimeout(reject, timeout))])
    : fromNetwork;
  return limited.catch(() => fromCache().then((hit) => hit || fromNetwork));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req, { timeout: NETWORK_TIMEOUT_MS }));
  } else if (EXTERNAL_ORIGINS.includes(url.origin)) {
    // Fontes e OCR quase nunca mudam: cache primeiro, atualiza em segundo plano.
    event.respondWith(
      caches.match(req).then((hit) => {
        const net = fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
          return res;
        }).catch(() => hit);
        return hit || net;
      })
    );
  }
});
