// ============================================================================
// EMS Deferred Libraries — load heavy scripts only when needed (offline-first)
// ============================================================================
(function (global) {
    'use strict';

    var XLSX_LOCAL = 'vendor/xlsx/xlsx.full.min.js';
    var XLSX_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    var loaded = Object.create(null);
    var loading = Object.create(null);

    function inject(src) {
        if (loaded[src]) return loaded[src];
        if (loading[src]) return loading[src];
        loading[src] = new Promise(function (resolve, reject) {
            var el = document.createElement('script');
            el.src = src;
            el.async = false;
            el.onload = function () {
                loaded[src] = Promise.resolve();
                delete loading[src];
                resolve();
            };
            el.onerror = function () {
                delete loading[src];
                reject(new Error('lib load failed: ' + src));
            };
            document.head.appendChild(el);
        });
        return loading[src];
    }

    function firebaseVendorBase() {
        return 'vendor/firebasejs/9.22.0/';
    }

    function assertXlsxReady() {
        if (global.XLSX) return Promise.resolve();
        return Promise.reject(new Error('Excel لائبریری لوڈ نہیں'));
    }

    global.emsLoadFirebaseStorage = function () {
        return inject(firebaseVendorBase() + 'firebase-storage-compat.js');
    };

    global.emsLoadFirebaseMessaging = function () {
        var src = firebaseVendorBase() + 'firebase-messaging-compat.js';
        return inject(src).catch(function (err) {
            console.warn('[EMS] Firebase Messaging optional — skipped:', err && err.message ? err.message : err);
            loaded[src] = Promise.resolve();
            return Promise.resolve();
        });
    };

    global.emsLoadXlsxLib = function () {
        if (global.XLSX) return Promise.resolve();
        return inject(XLSX_LOCAL).then(assertXlsxReady).catch(function (localErr) {
            console.warn('[EMS] Local XLSX unavailable, trying CDN fallback:', localErr && localErr.message ? localErr.message : localErr);
            return inject(XLSX_CDN).then(assertXlsxReady);
        });
    };

    global.emsLoadExportLibs = function () {
        return global.emsLoadXlsxLib();
    };
})(typeof window !== 'undefined' ? window : globalThis);
