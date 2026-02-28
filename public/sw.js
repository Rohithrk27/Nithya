const CACHE_NAME = 'nithya-v4';
const APP_SHELL = ['/', '/index.html', '/manifest.json', '/logo/logo.png', '/logo/logo.svg', '/logo/header.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  const isNav = event.request.mode === 'navigate';
  const isSameOrigin = requestUrl.origin === self.location.origin;
  const isBuildAsset = requestUrl.pathname.startsWith('/assets/') || requestUrl.pathname.endsWith('.js') || requestUrl.pathname.endsWith('.css');
  const isBrandAsset = requestUrl.pathname.startsWith('/logo/');

  // Always prefer network for navigation so app updates are visible quickly.
  if (isNav) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', cloned)).catch(() => {});
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // For static assets: stale-while-revalidate, except build/brand assets which are network-first.
  if (isSameOrigin) {
    if (isBuildAsset || isBrandAsset) {
      event.respondWith(
        fetch(event.request)
          .then((response) => {
            const cloned = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned)).catch(() => {});
            return response;
          })
          .catch(() => caches.match(event.request))
      );
      return;
    }

    event.respondWith(
      caches.match(event.request).then((cached) => {
        const networkFetch = fetch(event.request)
          .then((response) => {
            const cloned = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned)).catch(() => {});
            return response;
          })
          .catch(() => cached);

        return cached || networkFetch;
      })
    );
  }
});
