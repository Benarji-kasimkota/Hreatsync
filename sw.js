// HeartSync Service Worker — offline-first cache
const CACHE  = 'heartsync-v2';
const ASSETS = [
  './',
  './mobile.html',
  './index.html',
  './watch.html',
  './account.html',
  './ml.html',
  './login.html',
  './health-connect.html',
  './mobile.css',
  './styles.css',
  './watch.css',
  './account.css',
  './ml.css',
  './login.css',
  './health-connect.css',
  './mobile-app.js',
  './app.js',
  './watch-app.js',
  './account.js',
  './ml-engine.js',
  './ml.js',
  './auth.js',
  './login.js',
  './dataset.js',
  './health-connect.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Share+Tech+Mono&display=swap',
];

// Install — cache all static assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

// Activate — remove old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — cache-first for local assets, network-first for external
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Always network-first for TF.js CDN (large, versioned)
  if (url.hostname.includes('jsdelivr') || url.hostname.includes('tensorflow')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first for everything else
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback for navigation requests
        if (e.request.mode === 'navigate') return caches.match('./mobile.html');
      });
    })
  );
});
