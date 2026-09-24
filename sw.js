/* SMC Guidance Center - service worker (PWA app shell) */
"use strict";
var CACHE = 'smc-guidance-v11-hotfix-20260924';
var CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './css/eval-built.css',
  './css/drive-folder.css',
  './css/classlists.css',
  './css/chat.css',
  './js/config.js',
  './js/ui.js',
  './js/api.js',
  './js/auth.js',
  './js/share.js',
  './js/charts.js',
  './js/export.js',
  './js/records.js',
  './js/evaluations.js',
  './js/procedures.js',
  './js/evalproc.js',
  './js/evalexport.js',
  './css/eval-export.css',
  './js/evaltemplate.js',
  './js/evalbuild.js',
  './js/evaldash.js',
  './js/profile.js',
  './js/settings.js',
  './js/incidents.js',
  './js/classlists.js',
  './js/routine.js',
  './js/schedule.js',
  './js/cmd.js',
  './js/app.js',
  './js/pwa.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/maskable-512.png',
  './assets/icons/apple-touch-icon-180.png'
];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // Cache core files individually so one missing asset does not abort install.
      return Promise.all(CORE.map(function (url) {
        return c.add(url).catch(function () { return null; });
      }));
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  // Only handle same-origin GET requests. Let everything else (e.g. the
  // Google Apps Script API POSTs and CDN scripts) go straight to the network.
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  // Navigation requests: network-first, fall back to cached index for offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (m) { return m || caches.match('./index.html'); });
      })
    );
    return;
  }

  // Scripts and styles are network-first so a security or deployment fix is
  // never hidden behind an old service-worker copy. Offline use still falls
  // back to the cache.
  if (/\.(?:js|css)$/.test(url.pathname)) {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return caches.match(req); })
    );
    return;
  }

  // Other static assets: cache-first, then network.
  e.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return cached; });
    })
  );
});
