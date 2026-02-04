const CACHE_NAME = 'restro-manager-v12';
const ASSETS = [
  '/',
  '/index.html',
  '/dashboard.html',
  '/expense-entry.html',
  '/expense-history.html',
  '/tally.html',
  '/vendors.html',
  '/vendor-history.html',
  '/vendor-details.html',
  '/owner.html',
  '/salary.html',
  '/pl.html',
  '/settings.html',
  '/css/base.css',
  '/css/dashboard.css',
  '/css/hamburger.css',
  '/css/login.css',
  '/css/expense-entry.css',
  '/css/expense-history.css',
  '/js/config.js',
  '/js/shortcuts.js',
  'https://cdn.jsdelivr.net/npm/remixicon@2.5.0/fonts/remixicon.css'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((res) => {
      return res || fetch(e.request);
    })
  );
});
