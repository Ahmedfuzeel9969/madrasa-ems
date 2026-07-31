/**
 * Compatibility wrapper — Migration Slice #1
 * ----------------------------------------------------------------------------
 * Canonical implementation: src/shared/utils/ems-utils.js
 *
 * index.html (and Hosting/Android/Electron via dist/) still load THIS root path.
 * Do not delete this wrapper until all loaders point at the canonical path and
 * regression + platform builds are green.
 *
 * Node / Vitest: require() re-exports the canonical module.
 * Browser: synchronous XHR + eval preserves defer-script ordering (no index.html change).
 */
(function (root) {
    'use strict';

    var CANONICAL_REL = 'src/shared/utils/ems-utils.js';

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = require('./src/shared/utils/ems-utils.js');
        return;
    }

    if (root.EmsUtils && typeof root.EmsUtils.sanitize === 'function') {
        return;
    }

    function fail(msg) {
        throw new Error('[EMS] ems-utils compatibility wrapper: ' + msg);
    }

    if (typeof XMLHttpRequest === 'undefined') {
        fail('XMLHttpRequest unavailable; cannot load ' + CANONICAL_REL);
    }

    var xhr = new XMLHttpRequest();
    try {
        xhr.open('GET', CANONICAL_REL, false);
        xhr.send(null);
    } catch (e) {
        fail('request failed for ' + CANONICAL_REL + ' — ' + (e && e.message ? e.message : String(e)));
    }

    var ok = (xhr.status >= 200 && xhr.status < 300) || xhr.status === 0;
    if (!ok || !xhr.responseText) {
        fail('HTTP ' + xhr.status + ' loading ' + CANONICAL_REL);
    }

    /* Indirect eval → global scope so UMD attaches EmsUtils / printDiv */
    (0, eval)(xhr.responseText);

    if (!root.EmsUtils || typeof root.EmsUtils.sanitize !== 'function') {
        fail('canonical script loaded but EmsUtils was not defined');
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
