// ============================================================================
// EMS Registration Live Sync — write-trigger via RegistrationMeta (Phase A4)
// No Registrations collection onSnapshot. Meta doc listener + targeted fetch.
// ============================================================================
(function (global) {
    'use strict';

    var tenantId = null;
    var started = false;
    var meta = {
        lastMetaTime: null,
        lastError: null,
        mode: 'write_trigger'
    };

    function getTenantId(tid) {
        return tid
            || (typeof global.emsRequireTenantId === 'function' ? global.emsRequireTenantId() : null)
            || (typeof global.emsGetTenantId === 'function' ? global.emsGetTenantId() : null);
    }

    /**
     * Start RegistrationMeta listener — cross-tab / cross-device sync without collection listener.
     * @returns {Promise<{started:boolean, listening?:boolean, mode:string}>}
     */
    global.emsStartRegistrationWriteSync = function (tid) {
        tid = getTenantId(tid);
        if (!tid) {
            return Promise.resolve({ started: false, mode: meta.mode, reason: 'no_tenant' });
        }
        if (started && tenantId === tid) {
            return Promise.resolve({ started: true, listening: true, mode: meta.mode, cached: true });
        }

        tenantId = tid;
        started = true;
        meta.lastError = null;

        if (typeof global.emsRegRepoInit === 'function') {
            global.emsRegRepoInit(tid);
        }

        var chain = Promise.resolve();
        if (typeof global.emsRegRepoEnsureMetaListener === 'function') {
            chain = global.emsRegRepoEnsureMetaListener(tid);
        }

        return chain.then(function (res) {
            meta.lastMetaTime = Date.now();
            return {
                started: true,
                listening: !!(res && res.listening),
                mode: meta.mode,
                count: typeof global.emsRegRepoGetList === 'function'
                    ? global.emsRegRepoGetList().length : 0
            };
        }).catch(function (err) {
            meta.lastError = err && err.message;
            return { started: false, mode: meta.mode, error: meta.lastError };
        });
    };

    /** @deprecated Phase A4 — alias; no collection onSnapshot. */
    global.emsStartRegistrationLiveSync = function (tid, options) {
        if (options && options.limit) {
            /* limit ignored — write-trigger does not use collection listener */
        }
        return global.emsStartRegistrationWriteSync(tid);
    };

    global.emsGetRegistrationLiveSyncMeta = function () {
        return {
            lastSnapshotTime: meta.lastMetaTime,
            lastSyncTime: meta.lastMetaTime,
            snapshotReceived: started,
            lastError: meta.lastError,
            lastSnapSize: typeof global.emsRegRepoGetList === 'function'
                ? global.emsRegRepoGetList().length : 0,
            listenerActive: started,
            tenantId: tenantId,
            mode: meta.mode
        };
    };

    global.emsPauseRegistrationLiveSync = function () {
        /* Meta listener stays active — pausing collection sync is a no-op in A4 */
    };

    global.emsStopRegistrationLiveSync = function () {
        if (typeof global.emsRegRepoReset === 'function') {
            global.emsRegRepoReset();
        }
        started = false;
        tenantId = null;
        meta.lastMetaTime = null;
        meta.lastError = null;
    };

    global.emsIsRegistrationLiveSyncActive = function () {
        return started;
    };
})(typeof window !== 'undefined' ? window : globalThis);
