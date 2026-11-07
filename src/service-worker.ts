/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;
import { version } from '$app/environment';
import { immutable } from '$app/manifest';

const CACHE = `srep-static-${version}`;

const ASSETS = immutable
  .map((entry) => entry.path)
  .filter((path) => path.includes('/_app/immutable/'));

self.addEventListener('install', (event) => {
  async function prep() {
    const cache = await caches.open(CACHE);
    await Promise.all(ASSETS.map((asset) => cache.add(asset)));
  }
  event.waitUntil(prep());
});

self.addEventListener('activate', (event) => {
  async function sweep() {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
  }
  event.waitUntil(sweep());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith('/_app/immutable/')) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached ?? fetch(event.request);
    }),
  );
});
