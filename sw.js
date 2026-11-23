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
  './js/math.js',
  './js/screens.js',
  './js/modals.js',
  './js/main.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/favicon.svg',
];

// Sites externos que vale guardar para uso offline: fontes, OCR (Tesseract) e KaTeX.
const EXTERNAL_ORIGINS = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
  'https://cdn.jsdelivr.net',
  'https://tessdata.projectnaptha.com',
];

// KaTeX (gabarito com LaTeX): baixado na instalação junto com as fontes que o
// CSS referencia, para a formatação funcionar offline depois da 1ª visita.
// Atenção: manter a mesma versão em js/math.js (VERSION).
const MATH_ASSETS = [
  'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css',
  'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js',
];

async function prefetchMath(cache) {
  try {
    const cssUrl = MATH_ASSETS[0];
    const res = await fetch(cssUrl, { cache: 'no-cache' });
    if (!res.ok) return;
    await cache.put(cssUrl, res.clone());
    const css = await res.text();
    const re = /url\((?:['"]?)([^)'"]+)(?:['"]?)\)/g;
    const fonts = [];
    let m;
    while ((m = re.exec(css)) !== null) {
      if (/\.woff2(?:\?|$)/.test(m[1])) fonts.push(new URL(m[1], cssUrl).href); // só woff2: o formato que os navegadores atuais usam
    }
    await Promise.all(fonts.map((u) => fetch(u).then((r) => (r.ok ? cache.put(u, r) : null)).catch(() => null)));
    const jsRes = await fetch(MATH_ASSETS[1], { cache: 'no-cache' });
    if (jsRes.ok) await cache.put(MATH_ASSETS[1], jsRes);
  } catch (e) { /* sem internet: o app segue normal, o texto simples continua funcionando */ }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await Promise.all(APP_FILES.map((url) =>
        fetch(url, { cache: 'reload' })
          .then((res) => (res.ok ? cache.put(url, res) : null))
          .catch(() => null)));
      await Promise.race([
        prefetchMath(cache),
        new Promise((resolve) => setTimeout(resolve, 8000)),
      ]);
      await self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      // Apaga caches de versões antigas (study-cycle-v1, -v2, ...).
      .then((names) => Promise.all(names.filter((n) => n !== CACHE && n.startsWith('study-cycle')).map((n) => caches.delete(n))))
      // Também remove entradas órfãs do próprio cache (arquivo renomeado ou
      // versão antiga do KaTeX), que a estratégia rede-primeiro não apagaria.
      .then(() => caches.open(CACHE))
      .then((cache) => cache.keys().then((reqs) => {
        const keep = new Set(APP_FILES.concat(MATH_ASSETS).map((u) => new URL(u, self.location.href).href));
        const stale = reqs.filter((r) => {
          const href = new URL(r.url).href;
          if (keep.has(href)) return false;
          // Mantém fontes/OCR vindos da rede, mas descarta versões antigas do
          // KaTeX: o CDN inteiro não pode ficar na lista de preservados.
          if (href.indexOf('/katex@') !== -1) return true;
          return !EXTERNAL_ORIGINS.some((o) => href.indexOf(o) === 0);
        });
        return Promise.all(stale.map((r) => cache.delete(r)));
      }))
      .then(() => self.clients.claim())
  );
});

function networkFirst(req, { timeout }) {
  // `no-cache`: sempre confere com o servidor (resposta 304 é barata).
  const fromNetwork = fetch(req.mode === 'navigate' ? req.url : req, { cache: 'no-cache' }).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((cache) => cache.put(req.mode === 'navigate' ? './index.html' : req, copy)).catch(() => null);
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
