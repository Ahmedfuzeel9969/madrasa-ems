// ============================================================================
// EMS Deferred Libraries — load heavy scripts only when needed (offline-first)
// ============================================================================
(function (global) {
    'use strict';

    var XLSX_LOCAL = 'vendor/xlsx/xlsx.full.min.js';
    var XLSX_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    var H2C_LOCAL = 'vendor/html2canvas/html2canvas.min.js';
    var H2C_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    var JSPDF_LOCAL = 'vendor/jspdf/jspdf.umd.min.js';
    var JSPDF_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    var loaded = Object.create(null);
    var loading = Object.create(null);
    var _pdfReady = null;

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

    function assertPdfReady() {
        if (global.html2canvas && global.jspdf && typeof global.jspdf.jsPDF === 'function') {
            return Promise.resolve();
        }
        return Promise.reject(new Error('PDF لائبریری لوڈ نہیں'));
    }

    function loadPdfPair(h2cSrc, jspdfSrc) {
        return inject(h2cSrc).then(function () { return inject(jspdfSrc); }).then(assertPdfReady);
    }

    /** On-demand html2canvas + jsPDF (not at boot — keeps login shell light). */
    global.emsLoadPdfLibs = function () {
        if (global.html2canvas && global.jspdf && typeof global.jspdf.jsPDF === 'function') {
            return Promise.resolve();
        }
        if (_pdfReady) return _pdfReady;
        _pdfReady = loadPdfPair(H2C_LOCAL, JSPDF_LOCAL).catch(function (localErr) {
            console.warn('[EMS] Local PDF libs unavailable, trying CDN:', localErr && localErr.message ? localErr.message : localErr);
            return loadPdfPair(H2C_CDN, JSPDF_CDN);
        }).then(function () {
            return assertPdfReady();
        }).catch(function (err) {
            _pdfReady = null;
            throw err;
        });
        return _pdfReady;
    };

    global.emsLoadExportLibs = function () {
        return global.emsLoadXlsxLib();
    };
})(typeof window !== 'undefined' ? window : globalThis);
