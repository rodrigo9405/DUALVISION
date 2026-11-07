// DualVision: permite instalar la app y abrirla aunque la red falle un momento.
// Siempre intenta la red primero para que las actualizaciones lleguen enseguida.
const CACHE = 'dualvision-v1';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/room.js', 'js/rtc.js', 'js/youtube.js', 'config.js', 'vendor/supabase.js', 'img/icon.svg', 'fonts/big-shoulders-display-latin-800-normal.woff2', 'fonts/big-shoulders-display-latin-900-normal.woff2', 'fonts/instrument-sans-latin-400-normal.woff2', 'fonts/instrument-sans-latin-500-normal.woff2', 'fonts/instrument-sans-latin-600-normal.woff2'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
