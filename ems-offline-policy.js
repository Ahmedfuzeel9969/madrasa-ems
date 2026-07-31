// ============================================================================
// EMS Offline Policy — central rules for cloud pull vs local SSOT (Phase 5)
// Phase 4 P2: Firestore reachability probe (replaces naive navigator.onLine)
// ============================================================================
(function (global) {
    'use strict';

    if (global.__EMS_OFFLINE_POLICY_INIT) return;
    global.__EMS_OFFLINE_POLICY_INIT = true;

    var PROBE_TTL_MS = 20000;
    var PROBE_TIMEOUT_MS = 4000;

    function isDesktop() {
        if (global.EMS_DESKTOP_UNLIMITED === true) return true;
        try {
            if (global.emsDesktop && global.emsDesktop.isDesktop) return true;
            if (global.location && global.location.search) {
                if (global.location.search.indexOf('desktop=1') >= 0) return true;
                if (global.location.search.indexOf('localBundle=1') >= 0) return true;
            }
        } catch (e) { /* ignore */ }
        if (typeof global.emsIsDesktopEnvironment === 'function') {
            return global.emsIsDesktopEnvironment();
        }
        return false;
    }

    global.emsIsOfflineFirstSsot = function () {
        return global.EMS_OFFLINE_FIRST_SSOT === true || global.EMS_DESKTOP_WHATSAPP_MODE === true;
    };

    global.emsIsDesktopWhatsAppMode = function () {
        return global.EMS_DESKTOP_WHATSAPP_MODE === true
            || (isDesktop() && global.EMS_OFFLINE_FIRST_SSOT === true);
    };

    global.emsCanUseOfflineDesktop = function () {
        return isDesktop();
    };

    var _cloudReachable = null;
    var _cloudProbePromise = null;
    var _probeAt = 0;

    function probeFresh() {
        return !_probeAt || (Date.now() - _probeAt > PROBE_TTL_MS);
    }

    function setReachable(ok) {
        _cloudReachable = !!ok;
        global.EMS_CLOUD_REACHABLE = _cloudReachable;
        _probeAt = Date.now();
        return _cloudReachable;
    }

    function getTenantIdForProbe() {
        if (typeof global.emsGetTenantId === 'function') {
            var tid = global.emsGetTenantId();
            if (tid) return tid;
        }
        if (typeof global.emsRequireTenantId === 'function') {
            var req = global.emsRequireTenantId();
            if (req) return req;
        }
        return global.CURRENT_MADRASA_TENANT_ID || null;
    }

    function probeHttp204() {
        return new Promise(function (resolve) {
            var done = false;
            function finish(ok) {
                if (done) return;
                done = true;
                resolve(!!ok);
            }
            try {
                var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
                var timer = setTimeout(function () {
                    if (ctrl) ctrl.abort();
                    finish(false);
                }, PROBE_TIMEOUT_MS);
                fetch('https://www.googleapis.com/generate_204', {
                    method: 'HEAD',
                    mode: 'no-cors',
                    cache: 'no-store',
                    signal: ctrl ? ctrl.signal : undefined
                }).then(function () {
                    clearTimeout(timer);
                    finish(true);
                }).catch(function () {
                    clearTimeout(timer);
                    finish(false);
                });
            } catch (e) {
                finish(!!(global.navigator && global.navigator.onLine));
            }
        });
    }

    /** Lightweight Firestore round-trip — authoritative when Firebase is loaded. */
    function probeFirestore() {
        return new Promise(function (resolve) {
            var db = typeof global.getDbOrNull === 'function' ? global.getDbOrNull() : null;
            if (!db) {
                resolve(null);
                return;
            }
            var done = false;
            function finish(ok) {
                if (done) return;
                done = true;
                resolve(!!ok);
            }
            var timer = setTimeout(function () { finish(false); }, PROBE_TIMEOUT_MS);
            var ref;
            var tid = getTenantIdForProbe();
            try {
                if (tid) {
                    ref = db.collection('All_Madrasas').doc(tid).collection('RegistrationMeta').doc('current');
                } else {
                    ref = db.collection('_ems_network_probe').doc('ping');
                }
                ref.get({ source: 'server' }).then(function () {
                    clearTimeout(timer);
                    finish(true);
                }).catch(function (err) {
                    clearTimeout(timer);
                    var code = err && err.code;
                    if (code === 'permission-denied' || code === 'unauthenticated') {
                        finish(true);
                    } else {
                        finish(false);
                    }
                });
            } catch (eFs) {
                clearTimeout(timer);
                finish(false);
            }
        });
    }

    global.emsProbeCloudReachable = function () {
        if (_cloudProbePromise) return _cloudProbePromise;

        _cloudProbePromise = probeFirestore().then(function (fsResult) {
            if (fsResult === true) return setReachable(true);
            if (fsResult === false) {
                return probeHttp204().then(function (httpOk) {
                    if (httpOk) return setReachable(true);
                    return setReachable(false);
                });
            }
            return probeHttp204().then(function (httpOk) {
                if (httpOk) return setReachable(true);
                return setReachable(!!(global.navigator && global.navigator.onLine));
            });
        }).finally(function () {
            _cloudProbePromise = null;
        });

        return _cloudProbePromise;
    };

    global.emsResetCloudReachabilityProbe = function () {
        _cloudReachable = null;
        _cloudProbePromise = null;
        _probeAt = 0;
        global.EMS_CLOUD_REACHABLE = null;
    };

    global.emsScheduleCloudReachabilityProbe = function (force) {
        if (!force && !probeFresh() && _cloudReachable !== null) {
            return Promise.resolve(_cloudReachable);
        }
        if (_cloudProbePromise) return _cloudProbePromise;
        return global.emsProbeCloudReachable();
    };

    global.emsEnsureNetworkForCloudSync = function () {
        global.emsResetCloudReachabilityProbe();
        return global.emsProbeCloudReachable();
    };

    global.emsIsNetworkAvailable = function () {
        try {
            if (_cloudReachable === true || global.EMS_CLOUD_REACHABLE === true) return true;
            if (_cloudReachable === false || global.EMS_CLOUD_REACHABLE === false) return false;

            if (typeof global.emsScheduleCloudReachabilityProbe === 'function') {
                global.emsScheduleCloudReachabilityProbe();
            }
            return !!(global.navigator && global.navigator.onLine);
        } catch (e) {
            return false;
        }
    };

    /**
     * May this client read from Firestore (pull)?
     * false on desktop/offline-first boot — true only for force recovery or explicit allow flags.
     */
    global.emsMayPullFromCloud = function (options) {
        options = options || {};
        if (options.force === true) return true;
        if (global.EMS_MANUAL_CLOUD_SYNC === true) return global.emsIsNetworkAvailable();
        if (global.EMS_FORCE_CLOUD_RECOVERY_SYNC === true) return true;
        if (global.EMS_FORCE_FULL_TENANT_DOWNLOAD === true) return true;
        if (global.EMS_ALLOW_FIRST_LOGIN_CLOUD_FETCH === true) return true;
        if (global.emsIsDesktopWhatsAppMode && global.emsIsDesktopWhatsAppMode()) return false;
        if (!global.emsIsNetworkAvailable()) return false;
        if (global.emsIsOfflineFirstSsot() && isDesktop()) return false;
        if (global.emsIsOfflineFirstSsot()) return false;
        return true;
    };

    /**
     * May this client write to Firestore (push)?
     * Pull policy (emsMayPullFromCloud) stays separate — manual fetch only.
     */
    global.emsMayPushToCloud = function (options) {
        options = options || {};
        if (global.EMS_OFFLINE_ONLY === true) return false;
        if (!global.emsIsNetworkAvailable()) return false;

        if (options.force === true || options.manual === true) {
            return true;
        }
        if (global.EMS_MANUAL_CLOUD_SYNC === true) {
            return true;
        }

        if (options.mutation === true) {
            return true;
        }

        if (global.emsIsOfflineFirstSsot && global.emsIsOfflineFirstSsot()) {
            return false;
        }
        return false;
    };

    function notifyNetworkUiRefresh() {
        if (typeof global.emsUpdateGlobalSyncButton === 'function') {
            try { global.emsUpdateGlobalSyncButton(); } catch (eUi) { /* ignore */ }
        }
        if (typeof global.emsPerfRenderOnlineMode === 'function') {
            try { global.emsPerfRenderOnlineMode(); } catch (ePerf) { /* ignore */ }
        }
        if (typeof global.apRenderSyncStatus === 'function') {
            try { global.apRenderSyncStatus(); } catch (eAp) { /* ignore */ }
        }
    }

    if (typeof global.addEventListener === 'function') {
        global.addEventListener('online', function () {
            global.emsResetCloudReachabilityProbe();
            global.emsScheduleCloudReachabilityProbe(true).then(notifyNetworkUiRefresh);
        });
        global.addEventListener('offline', function () {
            setTimeout(function () {
                global.emsResetCloudReachabilityProbe();
                global.emsScheduleCloudReachabilityProbe(true).then(notifyNetworkUiRefresh);
            }, 600);
        });
        global.addEventListener('ems:post-auth-ready', function () {
            global.emsScheduleCloudReachabilityProbe(true).then(notifyNetworkUiRefresh);
        });
    }

    if (typeof global.document !== 'undefined') {
        if (global.document.readyState === 'loading') {
            global.document.addEventListener('DOMContentLoaded', function () {
                global.emsScheduleCloudReachabilityProbe().then(notifyNetworkUiRefresh);
            });
        } else {
            setTimeout(function () {
                global.emsScheduleCloudReachabilityProbe().then(notifyNetworkUiRefresh);
            }, 0);
        }
    }
})(typeof window !== 'undefined' ? window : globalThis);
