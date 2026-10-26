// Mude esta versão sempre que um arquivo listado em ASSETS for alterado.
// Sem isso, um PWA já instalado pode continuar executando uma cópia antiga
// dos módulos em assets/js/ no celular, mesmo depois de uma nova publicação.
const CACHE = 'mental-math-v2-7';
const ASSETS = [
  './',
  './index.html',
  './assets/styles.css',
  './assets/js/01-utils.js',
  './assets/js/02-engine-constants.js',
  './assets/js/03-i18n.js',
  './assets/js/04-operations.js',
  './assets/js/05-expression-terms.js',
  './assets/js/06-tracks.js',
  './assets/js/07-storage.js',
  './assets/js/08-speed-engine.js',
  './assets/js/09-feedback.js',
  './assets/js/10-progress.js',
  './assets/js/11-session.js',
  './assets/js/12-analytics.js',
  './assets/js/13-export.js',
  './assets/js/14-ui.js',
  './assets/js/15-init.js',
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Ignora requisições que não sejam GET
  if (event.request.method !== 'GET') return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);

    // A navegação sempre tem uma página-reserva. Isso evita a tela em branco no
    // GitHub Pages quando o aparelho abre o app já sem conexão.
    if (event.request.mode === 'navigate') {
      try {
        const response = await fetch(event.request);
        if (response.ok) cache.put('./index.html', response.clone());
        return response;
      } catch {
        return (await cache.match('./index.html')) || Response.error();
      }
    }

    // BUGFIX: isto era cache-first (servia a cópia salva sem checar se havia uma
    // nova, e só parava de servir a antiga se CACHE mudasse de nome). Como
    // index.html acima é sempre buscado fresco da rede, uma pessoa que já tinha
    // visitado o site ficava com o HTML novo publicado rodando junto com
    // módulos de assets/js/ e styles.css antigos — se não batessem mais (ex.: um id
    // renomeado), botões paravam de funcionar silenciosamente. Agora, com rede
    // disponível, sempre busca a versão mais nova primeiro; o cache só é usado
    // como reserva para abrir offline.
    try {
      const response = await fetch(event.request);
      // Não grava respostas de erro; fontes com resposta opaca continuam podendo
      // ser guardadas após o primeiro carregamento online.
      if (response.ok || response.type === 'opaque') cache.put(event.request, response.clone());
      return response;
    } catch {
      return (await cache.match(event.request)) || Response.error();
    }
  })());
});
