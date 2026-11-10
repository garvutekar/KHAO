const VERSION = 'khao-v3';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'store.js', 'data.js', 'places.js', 'config.js',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];
// Live data must never be served stale from cache.
const NO_CACHE = /overpass|nominatim|firebaseio|firebasedatabase/;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || NO_CACHE.test(req.url)) return;
  const sameOrigin = new URL(req.url).origin === location.origin;
  if (sameOrigin) {
    // Network first so updates land immediately; cache keeps it working offline.
    e.respondWith(fetch(req, { cache: 'no-cache' }).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('index.html'))));
  } else {
    // Fonts and other third-party assets: stale-while-revalidate.
    e.respondWith(caches.open(VERSION).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(res => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
  }
});
