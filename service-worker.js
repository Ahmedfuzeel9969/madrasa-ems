var EMS_SW_BUILD_TAG = '20260902_exams_marks_arrow_nav_v1';
const CACHE_NAME = 'ems-offline-v16-' + EMS_SW_BUILD_TAG;
const SHELL = [
    './index.html',
    './manifest.json',
    './style.css',
    './landing.css',
    './ems-utils.js',
    './core.js',
    './auth.js',
    './security-layer.js',
    './cache-policy.js'
];

self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function (cache) {
            return cache.addAll(SHELL).catch(function () { return Promise.resolve(); });
        }).then(function () { return self.skipWaiting(); })
    );
});

self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; })
                .map(function (k) { return caches.delete(k); }));
        }).then(function () { return self.clients.claim(); })
    );
});

self.addEventListener('message', function (event) {
    var data = event.data || {};
    if (data.type === 'ems-get-build-tag') {
        if (event.ports && event.ports[0]) {
            event.ports[0].postMessage({ type: 'ems-build-tag', tag: EMS_SW_BUILD_TAG });
        }
        return;
    }
    if (data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

function isApiRequest(url) {
    return url.hostname.indexOf('googleapis.com') >= 0
        || url.hostname.indexOf('firebaseio.com') >= 0
        || url.hostname.indexOf('cloudfunctions.net') >= 0
        || url.pathname.indexOf('/firestore/') >= 0;
}

function isMutableAppScript(url) {
    return url.pathname.indexOf('ems-') >= 0
        || url.pathname.indexOf('auth.js') >= 0
        || url.pathname.indexOf('core.js') >= 0
        || url.pathname.indexOf('dashboard.js') >= 0
        || url.pathname.indexOf('admission.js') >= 0
        || url.pathname.indexOf('attendance.js') >= 0
        || url.pathname.indexOf('att-dashboard.js') >= 0
        || url.pathname.indexOf('att-save-status.js') >= 0
        || url.pathname.indexOf('att-collective.js') >= 0
        || url.pathname.indexOf('att-collective-view.js') >= 0;
}

self.addEventListener('fetch', function (event) {
    if (event.request.method !== 'GET') return;
    var url = new URL(event.request.url);
    if (isApiRequest(url)) return;

    if (isMutableAppScript(url)) {
        event.respondWith(
            fetch(event.request).catch(function () {
                return caches.match(event.request);
            })
        );
        return;
    }

    if (event.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
        event.respondWith(
            fetch(event.request).catch(function () {
                return caches.match('./index.html');
            })
        );
        return;
    }

    event.respondWith(
        caches.match(event.request).then(function (cached) {
            if (cached) return cached;
            return fetch(event.request).then(function (response) {
                if (!response || response.status !== 200 || response.type === 'opaque') return response;
                var copy = response.clone();
                caches.open(CACHE_NAME).then(function (cache) {
                    cache.put(event.request, copy);
                });
                return response;
            });
        })
    );
});
