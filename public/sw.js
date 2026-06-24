// Service Worker: hält die App offline-fähig, ohne Updates zu blockieren.
// Strategie: NETWORK-FIRST – online immer die aktuelle Version vom Server,
// der Cache dient nur als Fallback (z.B. Handy ohne Verbindung). So werden
// neue Funktionen sofort sichtbar, sobald der Server die neuen Dateien liefert.
const CACHE = 'organizer2-shell-v2';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/manifest.webmanifest', '/icon.svg', '/vendor/sortable.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;       // nur GET cachen
  if (url.pathname.startsWith('/api/')) return; // API immer direkt ans Netz

  // Network-first: frische Antwort holen, im Cache aktualisieren,
  // bei Netzwerkfehler auf den Cache zurückfallen.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((cached) => cached || caches.match('/index.html'))),
  );
});
