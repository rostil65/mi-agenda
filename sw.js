/* Guarda la app en el dispositivo para abrir sin Internet. Sube el número de versión al publicar cambios. */
var CACHE = 'miagenda-familia-v4j';
var FILES = ['./', 'index.html', 'styles.css', 'app.js', 'sync.js', 'crypto.js', 'config.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', function (e) { e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); })); self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (k) { return Promise.all(k.filter(function (x) { return x !== CACHE; }).map(function (x) { return caches.delete(x); })); }));
  self.clients.claim();
});
self.addEventListener('fetch', function (e) {
  var u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; /* Microsoft y OneDrive nunca se guardan en caché */
  e.respondWith(caches.open(CACHE).then(function (c) {
    /* 17.1: pide siempre la versión más nueva al servidor (sin la copia del navegador); sin Internet, usa la guardada */
    var req = e.request.mode === 'navigate' ? new Request(u.href.split('#')[0], { cache: 'no-cache', credentials: 'same-origin' }) : new Request(e.request, { cache: 'no-cache' });
    return fetch(req).then(function (r) { if (r.ok) c.put(e.request, r.clone()); return r; })
      .catch(function () { return c.match(e.request, { ignoreSearch: true }).then(function (m) { return m || c.match('index.html'); }); });
  }));
});
self.addEventListener('notificationclick', function (e) { e.notification.close(); e.waitUntil(self.clients.openWindow('./#inicio')); });
