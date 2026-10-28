const CACHE = 'attendance-shell-v10';
const ASSETS = ['./', './index.html', './styles.css', './app.js', './model.js', './practice.js', './selection.js', './reports.html', './reports.js', './reports.css', './report-model.js', './group-context.js', './icon.svg', './icon-192.png', './icon-512.png', './manifest.webmanifest', ...Array.from({length:8},(_,i)=>'./manifest-group-'+(i+1)+'.webmanifest')];
const allowed = new Set(ASSETS.map(asset => new URL(asset, self.registration.scope).href));
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('attendance-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  // Only a fixed allowlist of public UI files is eligible. No API responses, snapshots, names or credentials.
  const shell=new URL(event.request.url);
  if(shell.searchParams.size===1 && /^[1-8]$/.test(shell.searchParams.get('group') ?? ''))shell.search='';
  if (event.request.method !== 'GET' || !allowed.has(shell.href)) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(shell.href, copy))); }
    return response;
  }).catch(() => caches.match(shell.href)));
});
