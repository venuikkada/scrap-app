// Service worker: makes the app installable and fast on slow connections.
// App files are served from the cache first and refreshed in the background.
// API calls (/api/...) always go to the network so data is never stale.
const CACHE = 'scrap-app-v3';
const SHELL = [
  '/', '/css/app.css', '/js/app.js', '/js/ui.js', '/js/i18n.js', '/js/rules.js',
  '/js/views/auth.js', '/js/views/customer.js', '/js/views/admin.js', '/js/views/partner.js', '/i18n/en.js',
  '/icons/icon-192.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  const key = e.request.mode === 'navigate' ? '/' : e.request;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(key);
      const fresh = fetch(e.request)
        .then((res) => {
          if (res.ok) cache.put(key, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || fresh;
    })
  );
});
