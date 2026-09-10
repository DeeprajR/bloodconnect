/*
 * The service worker: an app shell, and network-only data (§2.8).
 *
 * The shell is cached so the application opens on a bad hospital connection.
 * **Nothing else is.** That is the whole design, and it is a clinical decision
 * rather than a performance one:
 *
 *  - A cached stock figure is a wrong stock figure. Units on the shelf, the
 *    status of a request, whether a donor confirmed, every one of those is
 *    only safe if it came from the server just now.
 *  - A cached page is somebody's page. These devices are shared at a ward
 *    desk, and a dashboard served from cache after a different person signs in
 *    is a disclosure, not a stale render.
 *
 * So: hashed build assets and icons are cached, because their URL changes when
 * their content does. Documents go to the network and fall back to an offline
 * notice, never to a stored copy of a real page. Everything else is passed
 * straight through.
 */

const VERSION = 'v1';
const SHELL_CACHE = `blood-connect-shell-${VERSION}`;
const OFFLINE_URL = '/offline';

/** Enough to render the offline notice with its styling and mark. */
const SHELL = [OFFLINE_URL, '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // `reload` so installing never picks the shell up from the HTTP cache.
      .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

/** Hashed by the build, so the URL changes whenever the bytes do. */
const isImmutableAsset = (url) =>
  url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/');

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only GET is ever considered. A mutation must reach the server.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            // Only a clean response is worth keeping; an opaque or errored one
            // would be served back indefinitely.
            if (response.ok && response.type === 'basic') {
              const copy = response.clone();
              void caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(SHELL_CACHE);
        const offline = await cache.match(OFFLINE_URL);
        return (
          offline ??
          new Response('You are offline.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' },
          })
        );
      }),
    );
    return;
  }

  // Data, RSC payloads, server actions, images behind a session: straight to
  // the network, never stored. Falling through without calling respondWith is
  // deliberate. The browser handles it exactly as if there were no worker.
});
