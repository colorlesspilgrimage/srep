const CACHE_PREFIX = 'srep-shell-';
const VERSION_URL = '/version.json';

const SHELL_URLS = [
  '/',
  '/app.css',
  '/themes.css',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/shims/bootstrap.js',
  '/pkg/srep_ui.js',
  '/pkg/srep_ui_bg.wasm',
];

// Set during install; re-discovered from Cache Storage after a worker restart.
let shellCacheName = null;

async function fetchVersion() {
  try {
    const response = await fetch(VERSION_URL, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Version fetch failed: ${response.status}`);
    }

    const metadata = await response.json();
    return typeof metadata.version === 'string' && metadata.version
      ? metadata.version
      : 'dev';
  } catch {
    // A dev checkout may not have generated version.json yet.
    return 'dev';
  }
}

async function getShellCache() {
  if (!shellCacheName) {
    const names = await caches.keys();
    shellCacheName =
      names.find((name) => name.startsWith(CACHE_PREFIX)) || null;
  }

  return shellCacheName ? caches.open(shellCacheName) : null;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const version = await fetchVersion();
      shellCacheName = `${CACHE_PREFIX}${version}`;

      const cache = await caches.open(shellCacheName);
      const requests = SHELL_URLS.map(
        (url) => new Request(url, { cache: 'reload' }),
      );

      // Do not activate a worker with an incomplete shell.
      await cache.addAll(requests);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // The worker may have restarted between install and activate; if the
      // current cache name was lost, re-discover it instead of deleting
      // every shell cache (including the just-installed one).
      if (!shellCacheName) {
        shellCacheName = `${CACHE_PREFIX}${await fetchVersion()}`;
      }

      const names = await caches.keys();
      await Promise.all(
        names
          .filter(
            (name) =>
              name.startsWith(CACHE_PREFIX) && name !== shellCacheName,
          )
          .map((name) => caches.delete(name)),
      );

      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          // Navigations always use the network response directly.
          return await fetch(event.request);
        } catch (networkError) {
          const cache = await getShellCache();
          const cachedShell = cache ? await cache.match('/') : null;

          if (cachedShell) {
            return cachedShell;
          }

          throw networkError;
        }
      })(),
    );
    return;
  }

  const isShellUrl =
    url.origin === self.location.origin &&
    url.search === '' &&
    SHELL_URLS.includes(url.pathname);

  if (isShellUrl) {
    event.respondWith(
      (async () => {
        const cache = await getShellCache();
        if (cache) {
          const cached = await cache.match(event.request);
          if (cached) {
            return cached;
          }
        }

        // Cache misses use the network without modifying the shell cache.
        return fetch(event.request);
      })(),
    );
  }

  // All other requests use normal browser network handling.
});
