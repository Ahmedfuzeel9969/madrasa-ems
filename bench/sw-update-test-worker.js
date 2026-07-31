var EMS_SW_BUILD_TAG = '20260708_sw_update_v1';

self.addEventListener('install', function (event) {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', function (event) {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('message', function (event) {
    var data = event.data || {};
    if (data.type === 'ems-get-build-tag' && event.ports && event.ports[0]) {
        event.ports[0].postMessage({ type: 'ems-build-tag', tag: EMS_SW_BUILD_TAG });
    }
    if (data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
