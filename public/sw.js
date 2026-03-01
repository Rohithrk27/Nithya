const CACHE_VERSION = 'v6';
const SHELL_CACHE = `nithya-shell-${CACHE_VERSION}`;
const ASSET_CACHE = `nithya-asset-${CACHE_VERSION}`;
const RUNTIME_CACHE = `nithya-runtime-${CACHE_VERSION}`;
const CACHE_PREFIX = 'nithya-';

const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/logo/logo.png',
  '/logo/logo.svg',
  '/logo/header.svg',
];

const ASSET_EXTENSIONS = new Set([
  '.js', '.mjs', '.css', '.png', '.svg', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.json',
]);

const getExtension = (pathname) => {
  const i = pathname.lastIndexOf('.');
  return i >= 0 ? pathname.slice(i).toLowerCase() : '';
};

const isCacheableResponse = (response) => response && response.ok && (response.type === 'basic' || response.type === 'default');

const putInCache = async (cacheName, request, response) => {
  if (!isCacheableResponse(response)) return;
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
};

const cacheFirst = async (request, cacheName) => {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    // Revalidate in background for freshness.
    fetch(request).then((res) => putInCache(cacheName, request, res)).catch(() => {});
    return cached;
  }
  const network = await fetch(request);
  await putInCache(cacheName, request, network);
  return network;
};

const staleWhileRevalidate = async (request, cacheName) => {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then(async (response) => {
      await putInCache(cacheName, request, response);
      return response;
    })
    .catch(() => cached);
  return cached || networkPromise;
};

const networkFirstForDocument = async (event) => {
  const preload = await event.preloadResponse;
  if (preload) {
    void putInCache(SHELL_CACHE, '/index.html', preload.clone());
    return preload;
  }
  try {
    const response = await fetch(event.request);
    await putInCache(SHELL_CACHE, '/index.html', response);
    return response;
  } catch (_) {
    const cached = await caches.match('/index.html');
    if (cached) return cached;
    throw _;
  }
};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && ![SHELL_CACHE, ASSET_CACHE, RUNTIME_CACHE].includes(key))
        .map((key) => caches.delete(key))
    );
    if ('navigationPreload' in self.registration) {
      await self.registration.navigationPreload.enable();
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  const isSameOrigin = requestUrl.origin === self.location.origin;
  if (!isSameOrigin) return;

  const pathname = requestUrl.pathname;
  const extension = getExtension(pathname);
  const isNavigation = event.request.mode === 'navigate';
  const isBuildChunk = pathname.startsWith('/assets/');
  const isStaticAsset = ASSET_EXTENSIONS.has(extension) || isBuildChunk || pathname.startsWith('/logo/');

  if (isNavigation) {
    event.respondWith(networkFirstForDocument(event));
    return;
  }

  // Fast repeat loads for scripts/chunks/styles/images/fonts.
  if (isStaticAsset) {
    event.respondWith(cacheFirst(event.request, ASSET_CACHE));
    return;
  }

  // Generic same-origin requests: quick cached response + background refresh.
  event.respondWith(staleWhileRevalidate(event.request, RUNTIME_CACHE));
});

self.addEventListener('push', (event) => {
  const fallback = {
    title: 'Nithya Reminder',
    body: 'Time to check your habits.',
    tag: 'nithya-push',
    url: '/dashboard',
  };

  let payload = fallback;
  try {
    if (event.data) {
      const parsed = event.data.json();
      payload = {
        ...fallback,
        ...(parsed && typeof parsed === 'object' ? parsed : {}),
      };
    }
  } catch (_) {
    try {
      const text = event.data ? event.data.text() : '';
      payload = { ...fallback, body: text || fallback.body };
    } catch (_) {
      payload = fallback;
    }
  }

  const title = String(payload.title || fallback.title);
  const options = {
    body: String(payload.body || fallback.body),
    icon: payload.icon || '/logo/logo.png',
    badge: payload.badge || '/logo/logo.png',
    tag: String(payload.tag || fallback.tag),
    renotify: !!payload.renotify,
    data: {
      ...(payload.data && typeof payload.data === 'object' ? payload.data : {}),
      url: payload.url || payload?.data?.url || fallback.url,
    },
  };

  if (event.waitUntil) {
    event.waitUntil(self.registration.showNotification(title, options));
  } else {
    void self.registration.showNotification(title, options);
  }
});

self.addEventListener('message', (event) => {
  const payload = event?.data || {};
  if (payload.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (payload.type === 'SHOW_NOTIFICATION') {
    const title = typeof payload.title === 'string' && payload.title.trim() ? payload.title : 'Nithya Reminder';
    const options = payload.options && typeof payload.options === 'object' ? payload.options : {};
    if (event.waitUntil) {
      event.waitUntil(self.registration.showNotification(title, options));
    } else {
      void self.registration.showNotification(title, options);
    }
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil((async () => {
    const targetUrl = event.notification?.data?.url || '/';
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

    for (const client of clientList) {
      try {
        const openedUrl = new URL(client.url);
        const desiredUrl = new URL(targetUrl, self.location.origin);
        if (openedUrl.origin === desiredUrl.origin) {
          if (typeof client.navigate === 'function' && openedUrl.pathname !== desiredUrl.pathname) {
            await client.navigate(desiredUrl.toString());
          }
          if (typeof client.focus === 'function') {
            await client.focus();
          }
          return;
        }
      } catch (_) {
        // Try next client.
      }
    }

    if (typeof self.clients.openWindow === 'function') {
      await self.clients.openWindow(targetUrl);
    }
  })());
});
