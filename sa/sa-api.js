/**
 * ============================================================================
 * sa-api.js — Client wrapper for Cloud Functions (Admin API)
 * ----------------------------------------------------------------------------
 * All sensitive admin actions should route through here. When Cloud Functions
 * are deployed, calls go to the secure server. When they are NOT deployed yet
 * (e.g. during StackBlitz dev), callers can fall back to the existing
 * client-side logic so the app keeps working.
 *
 * Usage:
 *   const res = await window.saApi.call('setUserStatus', { targetUid, status, reason });
 *   if (window.saApi.available()) { ... }  // functions deployed?
 * ============================================================================
 */
(function () {
    'use strict';

    var REGION = 'us-central1';
    var _functions = null;
    var _available = null; // tri-state: null=unknown, true/false once probed

    function getFunctions() {
        if (_functions) return _functions;
        if (typeof firebase === 'undefined' || !firebase.functions) return null;
        try {
            _functions = firebase.app().functions(REGION);
        } catch (e) {
            try { _functions = firebase.functions(); } catch (e2) { _functions = null; }
        }
        return _functions;
    }

    /**
     * Call a callable function. Throws a normalised Error on failure.
     */
    function call(name, payload) {
        var fns = getFunctions();
        if (!fns) {
            return Promise.reject(new Error('FUNCTIONS_UNAVAILABLE'));
        }
        return fns.httpsCallable(name)(payload || {}).then(function (res) {
            _available = true;
            return res.data;
        }).catch(function (err) {
            // 'internal' / network errors usually mean functions are not deployed.
            if (err && (err.code === 'internal' || err.code === 'not-found' || err.code === 'unavailable')) {
                _available = false;
            }
            var e = new Error((err && err.message) || 'CALL_FAILED');
            e.code = err && err.code;
            throw e;
        });
    }

    /**
     * Best-effort probe of whether the functions backend is reachable.
     * Returns last known state synchronously (may be null before first call).
     */
    function available() {
        return _available;
    }

    /**
     * Convenience: call a function, but if functions are unavailable run the
     * provided fallback (existing client-side logic). Keeps the UI working
     * before Cloud Functions are deployed.
     */
    function callOrFallback(name, payload, fallbackFn) {
        return call(name, payload).catch(function (err) {
            if (err.message === 'FUNCTIONS_UNAVAILABLE' || _available === false) {
                if (typeof fallbackFn === 'function') return fallbackFn();
            }
            throw err;
        });
    }

    /**
     * Probe backend reachability (pingBackend CF).
     */
    function probeBackend() {
        return call('pingBackend', {}).then(function (data) {
            _available = true;
            return data;
        }).catch(function () {
            _available = false;
            return null;
        });
    }

    window.saApi = {
        call: call,
        callOrFallback: callOrFallback,
        available: available,
        probeBackend: probeBackend
    };
})();
