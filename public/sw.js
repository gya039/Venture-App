// Venture — Service Worker
// Strategy:
//   /_next/static/*  → cache-first  (content-hashed, immutable)
//   /api/*           → network-only (SSE streaming must not be intercepted)
//   external URLs    → network-only (Firebase, Mapbox, OpenAI)
//   everything else  → network-first, fall back to cache (pages, icons, manifest)

const CACHE = 'venture-v1';

const PRECACHE = [
  '/',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

// ── Install: pre-cache app shell ──────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

// ── Activate: purge old caches ────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept non-GET or cross-origin requests to external services
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // Never intercept API routes — SSE streaming breaks if we touch these
  if (url.pathname.startsWith('/api/')) return;

  // /_next/static/ assets are content-hashed → cache-first, never expires
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(request, clone));
            return res;
          })
      )
    );
    return;
  }

  // Everything else: network-first, cache fallback (offline resilience)
  event.respondWith(
    fetch(request)
      .then((res) => {
        // Only cache successful same-origin responses
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(request, clone));
        }
        return res;
      })
      .catch(() => caches.match(request))
  );
});
