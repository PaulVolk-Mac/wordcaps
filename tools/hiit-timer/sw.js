// HIIT Timer service worker: keeps the page available without internet.
// Scope = this folder only. Page loads go to the network first (so updates arrive at once)
// and fall back to the cached copy when offline. Bump V when the cached file list changes.
const V = 'hiit-v1';
const SHELL = ['./', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('hiit-') && k !== V).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // Settings live in the query string (?w=45&r=15…), the document itself is always the same file.
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) { const copy = res.clone(); caches.open(V).then(c => c.put('./', copy)); }
          return res;
        })
        .catch(() => caches.open(V).then(c => c.match('./')).then(hit => hit || Response.error()))
    );
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req)));
});
