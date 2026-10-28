const CACHE = 'attendance-shell-v6';
const ASSETS = ['./', './index.html', './styles.css', './app.js', './model.js', './practice.js', './selection.js', './icon.svg', './icon-192.png', './icon-512.png', './manifest.webmanifest'];
const allowed = new Set(ASSETS.map(asset => new URL(asset, self.registration.scope).href));
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('attendance-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  // Only a fixed allowlist of public UI files is eligible. No API responses, snapshots, names or credentials.
  if (event.request.method !== 'GET' || !allowed.has(event.request.url)) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy))); }
    return response;
  }).catch(() => caches.match(event.request)));
});
