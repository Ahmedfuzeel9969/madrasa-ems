/**
 * Compatibility wrapper — Migration Slice #2
 * ----------------------------------------------------------------------------
 * Canonical implementation: src/shared/utils/ems-query-utils.js
 *
 * index.html and Electron still resolve THIS root path.
 * Do not delete until loaders point at the canonical path and gates are green.
 *
 * Node / Vitest / Electron native-db: require() re-exports canonical.
 * Browser: synchronous XHR + eval preserves defer-script ordering.
 */
(function (root) {
    'use strict';

    var CANONICAL_REL = 'src/shared/utils/ems-query-utils.js';

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = require('./src/shared/utils/ems-query-utils.js');
        return;
    }

    if (root.EmsQueryUtils && typeof root.EmsQueryUtils.pageFromAll === 'function') {
        return;
    }

    function fail(msg) {
        throw new Error('[EMS] ems-query-utils compatibility wrapper: ' + msg);
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

    (0, eval)(xhr.responseText);

    if (!root.EmsQueryUtils || typeof root.EmsQueryUtils.pageFromAll !== 'function') {
        fail('canonical script loaded but EmsQueryUtils was not defined');
    }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
