// Service worker: la app se abre sin conexión (lo anotado se guarda en el móvil y se envía al volver la cobertura).
const VERSION = 'v12';
const CACHE = `urdaibai-${VERSION}`;
const SHELL = ['/', '/index.html', '/css/app.css', '/manifest.webmanifest', '/icons/logo.png', '/icons/icon-192.png',
  '/js/app.js', '/js/dom.js', '/js/i18n.js', '/js/strings.js', '/js/store.js', '/js/stats.js', '/js/ui.js', '/js/court.js', '/js/shot-sheet.js',
  '/js/files.js', '/js/templates.js', '/js/names.js', '/js/views/match.js', '/js/views/summary.js', '/js/views/home.js', '/js/views/players.js',
  '/js/views/import.js', '/js/views/player.js', '/js/views/import-inpesca.js', '/js/inpesca.js', '/js/views/reports.js', '/js/views/admin.js', '/js/views/usage.js', '/js/views/misc.js', '/js/views/tables.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return; // la API nunca se cachea
  e.respondWith((async () => {
    try {
      const res = await fetch(req); // primero la red: siempre la versión más nueva
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    } catch {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') return (await caches.match('/index.html')) || Response.error();
      return Response.error();
    }
  })());
});
