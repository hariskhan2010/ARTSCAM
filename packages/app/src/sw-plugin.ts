import type { Plugin } from 'vite';

/**
 * Offline support (plan.md §4 "Web (PWA, offline)"): at build time, emit a
 * service worker that precaches every file of the build (app code, CAM
 * worker, HarfBuzz WASM, bundled fonts) under a cache named by the build's
 * content, so a new build replaces the old cache. Navigations go to the
 * network first and fall back to the cached app when offline.
 */
/** Small stable string hash (FNV-1a, 32-bit) for the cache name. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function serviceWorker(): Plugin {
  return {
    name: 'naqsh-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      // './' is the page itself; public/ files are copied as-is, so list them by hand.
      const files = [
        './',
        './manifest.webmanifest',
        './icon.svg',
        ...Object.keys(bundle).map((f) => `./${f}`),
      ].sort();
      const version = fnv1a(files.join('|'));
      const source = `// Generated at build time. Precaches the whole app for offline use.
const CACHE = 'naqsh-${version}';
const FILES = ${JSON.stringify(files)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('naqsh-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('./')));
    return;
  }
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}
