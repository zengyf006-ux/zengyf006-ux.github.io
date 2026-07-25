const CACHE_PREFIX = 'atlas-x-shell-';
const CACHE_VERSION = 'v1';
const SHELL_CACHE = `${CACHE_PREFIX}${CACHE_VERSION}`;
const scopeUrl = new URL(self.registration.scope);
const shellUrl = (path) => new URL(path, scopeUrl).toString();
const SHELL_URLS = [
  shellUrl('./'),
  shellUrl('./index.html'),
  shellUrl('./manifest.webmanifest'),
  shellUrl('./icon.svg'),
  shellUrl('./icon-maskable.svg'),
];

function isSensitiveRequest(request, url) {
  if (request.method !== 'GET') return true;
  if (request.headers.has('authorization') || request.headers.has('cookie')) return true;
  return url.pathname.includes('/api/')
    || url.pathname.includes('/auth/')
    || url.pathname.includes('/orders/')
    || url.pathname.includes('/accounts/');
}

function isStaticDestination(destination) {
  return destination === 'script'
    || destination === 'style'
    || destination === 'image'
    || destination === 'font'
    || destination === 'manifest';
}

async function cacheShellResponse(request, response) {
  if (!response.ok || response.type !== 'basic') return response;
  const cache = await caches.open(SHELL_CACHE);
  await cache.put(request, response.clone());
  return response;
}

async function navigationResponse(request) {
  try {
    const response = await fetch(request);
    return await cacheShellResponse(request, response);
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    return await cache.match(request)
      || await cache.match(shellUrl('./index.html'))
      || await cache.match(shellUrl('./'))
      || new Response('ATLAS X is offline and the application shell is unavailable.', {
        status: 503,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
  }
}

async function staticResponse(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached !== undefined) return cached;
  const response = await fetch(request);
  return await cacheShellResponse(request, response);
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== SHELL_CACHE)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== scopeUrl.origin || isSensitiveRequest(request, url)) return;
  if (request.mode === 'navigate') {
    event.respondWith(navigationResponse(request));
    return;
  }
  if (isStaticDestination(request.destination)) event.respondWith(staticResponse(request));
});
