// ============================================================================
// EMS Runtime Mode — offline-only vs cloud (default: offline-only)
// ============================================================================
(function (global) {
    'use strict';

    if (global.EMS_OFFLINE_ONLY == null) {
        global.EMS_OFFLINE_ONLY = true;
    }

    global.emsIsOfflineOnly = function () {
        return global.EMS_OFFLINE_ONLY === true;
    };

    global.emsIsCloudEnabled = function () {
        return global.EMS_OFFLINE_ONLY !== true;
    };

    /** No-op stubs for removed hybrid / cloud bridge APIs */
    var noopPromise = function (payload) {
        return Promise.resolve(payload || { skipped: true, offlineOnly: true });
    };

    global.emsHybridSyncInit = global.emsHybridSyncInit || function () { return noopPromise({ started: false }); };
    global.emsHybridSyncManual = global.emsHybridSyncManual || function () { return noopPromise(); };
    global.emsForceFullTenantDownload = global.emsForceFullTenantDownload || function () {
        return noopPromise({ ok: false, source: 'offline_only' });
    };
    global.emsEnsureDataConsistency = global.emsEnsureDataConsistency || function () {
        return noopPromise({ ok: true, offlineOnly: true });
    };
    global.emsPendingSyncEnqueue = global.emsPendingSyncEnqueue || function () { return noopPromise({ ok: false }); };
    global.emsPendingSyncFlush = global.emsPendingSyncFlush || function () { return noopPromise({ flushed: 0 }); };
    global.emsPendingSyncCount = global.emsPendingSyncCount || function () { return Promise.resolve(0); };
    global.emsOfflinePersistRegistration = global.emsOfflinePersistRegistration || function (doc, opts) {
        if (typeof global.emsRegRepoPersistRegistration === 'function' && doc) {
            return global.emsRegRepoPersistRegistration(doc, opts || {});
        }
        return noopPromise({ ok: true, local: true });
    };
    global.emsLoadCloudStack = global.emsLoadCloudStack || function () {
        return noopPromise({ skipped: true, reason: 'offline_only' });
    };

    global.emsGetOfflineLocalUser = function () {
        return { uid: 'local_admin', email: 'admin@local', displayName: 'Local Admin' };
    };

    global.emsIsOfflineLocalSession = function () {
        return global.EMS_LOCAL_AUTH === true
            || (global.EMS_OFFLINE_ONLY === true && !!global.CURRENT_MADRASA_TENANT_ID
                && global.CURRENT_USER_TENANT_ROLE === 'owner');
    };
})(typeof window !== 'undefined' ? window : globalThis);
