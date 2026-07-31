// ============================================================================
// EMS Registration Sync — session-persistent; pause never destroys repository
// ============================================================================
(function (global) {
    'use strict';

    var started = false;
    var paused = false;

    global.emsEnsureRegistrationSync = function () {
        if (started && !paused) {
            var count = typeof global.emsRegRepoGetList === 'function'
                ? global.emsRegRepoGetList().length : 0;
            if (count > 0) {
                return Promise.resolve({ ready: true, count: count, source: 'repo_cached' });
            }
            if (typeof global.emsBootRegistrationModule === 'function') {
                var tid = typeof global.emsRequireTenantId === 'function'
                    ? global.emsRequireTenantId()
                    : (typeof global.emsGetTenantId === 'function' ? global.emsGetTenantId() : null);
                return global.emsBootRegistrationModule(tid, { force: true, startLiveSync: false });
            }
            return Promise.resolve({ skipped: true, reason: 'no_boot_fn' });
        }
        if (typeof global.emsStartRegistrationSync === 'function') {
            paused = false;
            started = true;
            return global.emsStartRegistrationSync();
        }
        return Promise.resolve({ skipped: true });
    };

    /** Pause live listener only — repository memory MUST survive. */
    global.emsPauseRegistrationSync = function () {
        if (!started || paused) return;
        paused = true;
        if (typeof global.emsPauseRegistrationLiveSync === 'function') {
            global.emsPauseRegistrationLiveSync();
        }
    };

    global.emsResumeRegistrationSync = function () {
        if (!started) {
            return global.emsEnsureRegistrationSync();
        }
        if (!paused) return Promise.resolve({ skipped: true });
        paused = false;
        var tid = typeof global.emsRequireTenantId === 'function'
            ? global.emsRequireTenantId()
            : (typeof global.emsGetTenantId === 'function' ? global.emsGetTenantId() : null);
        if (tid && typeof global.emsStartRegistrationWriteSync === 'function') {
            return global.emsStartRegistrationWriteSync(tid).then(function (res) {
                return res || { resumed: true };
            });
        }
        if (tid && typeof global.emsStartRegistrationLiveSync === 'function') {
            return global.emsStartRegistrationLiveSync(tid).then(function (res) {
                return res || { resumed: true };
            });
        }
        return Promise.resolve({ skipped: true });
    };

    global.emsIsRegistrationSyncActive = function () {
        return started && !paused;
    };

    global.emsIsRegistrationSyncPaused = function () {
        return paused;
    };

    global.emsResetRegistrationSyncFlag = function () {
        started = false;
        paused = false;
    };
})(typeof window !== 'undefined' ? window : globalThis);
