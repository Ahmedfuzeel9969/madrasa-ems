// ============================================================================
// EMS Online Mode — restore cloud connectivity as an OPT-IN, manual-sync layer
// ----------------------------------------------------------------------------
// Requirements honored:
//   1) App runs both online and offline (online is opt-in, offline is default).
//   2) Local permanent storage is the source of truth; data goes to Firebase and
//      comes back ONLY when the user presses a button (manual push / pull).
//
// This controller flips runtime mode, loads the cloud stack, initializes Firebase
// and the sync engines, and exposes manual push/pull. It NEVER auto-pulls:
// EMS_OFFLINE_FIRST_SSOT is forced on so emsMayPullFromCloud() returns false
// unless an explicit { force: true } is passed (i.e. the Pull button).
// ============================================================================
(function (global) {
    'use strict';

    var FLAG_KEY = 'ems_online_mode';
    var enabling = null;

    function readFlag() {
        try { return localStorage.getItem(FLAG_KEY) === '1'; } catch (e) { return false; }
    }
    function writeFlag(on) {
        try {
            // Persist BOTH choices explicitly ('1' online / '0' offline) so the
            // boot-time resolver in index.html honours a deliberate opt-out and
            // does not fall back to the platform default on the next reload.
            localStorage.setItem(FLAG_KEY, on ? '1' : '0');
        } catch (e) { /* ignore */ }
    }

    function tenantId() {
        if (typeof global.emsRequireTenantId === 'function') {
            var t = global.emsRequireTenantId();
            if (t) return t;
        }
        if (typeof global.emsGetTenantId === 'function') {
            var tid = global.emsGetTenantId();
            if (tid) return tid;
        }
        return global.CURRENT_MADRASA_TENANT_ID || null;
    }

    function currentUser() {
        try {
            if (typeof global.firebase !== 'undefined' && global.firebase.auth) {
                return global.firebase.auth().currentUser || null;
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    global.emsIsOnlineModeEnabled = function () {
        // EMS_OFFLINE_ONLY is the authoritative runtime state (resolved at boot in
        // index.html from the explicit choice or the platform default).
        return global.EMS_OFFLINE_ONLY !== true;
    };

    global.emsGetOnlineStatus = function () {
        var sync = (global.EmsSyncEngine && typeof global.EmsSyncEngine.getStatus === 'function')
            ? global.EmsSyncEngine.getStatus() : null;
        return {
            enabled: global.EMS_OFFLINE_ONLY !== true,
            persisted: readFlag(),
            firebaseReady: typeof global.emsIsFirebaseReady === 'function' ? global.emsIsFirebaseReady() : false,
            signedIn: !!currentUser(),
            networkAvailable: typeof global.emsIsNetworkAvailable === 'function' ? global.emsIsNetworkAvailable() : (global.navigator ? global.navigator.onLine : true),
            tenant: tenantId(),
            sync: sync
        };
    };

    /**
     * Turn ON online mode: load cloud stack, init Firebase + sync engines.
     * Keeps local as SSOT (manual pull only). Persists across reloads.
     */
    global.emsEnableOnlineMode = function () {
        if (enabling) return enabling;

        // Local remains source of truth — pulls blocked unless forced (the button).
        global.EMS_OFFLINE_FIRST_SSOT = true;
        global.EMS_OFFLINE_ONLY = false;
        writeFlag(true);

        var loadCloud = (typeof global.emsLoadCloudStack === 'function')
            ? global.emsLoadCloudStack()
            : Promise.resolve({ skipped: true });

        enabling = Promise.resolve(loadCloud).then(function () {
            if (typeof global.emsInitFirebase === 'function') {
                global.emsInitFirebase();
            }
            var tid = tenantId();
            if (tid && global.EmsSyncEngine && typeof global.EmsSyncEngine.init === 'function') {
                return global.EmsSyncEngine.init(tid).catch(function () { });
            }
        }).then(function () {
            if (global.EmsDirect && typeof global.EmsDirect.init === 'function') {
                return global.EmsDirect.init().catch(function () { });
            }
        }).then(function () {
            try { global.dispatchEvent(new CustomEvent('ems:online-mode-enabled', { detail: global.emsGetOnlineStatus() })); } catch (e) { /* ignore */ }
            enabling = null;
            return global.emsGetOnlineStatus();
        }).catch(function (err) {
            enabling = null;
            return { enabled: true, error: err && err.message ? err.message : String(err) };
        });

        return enabling;
    };

    /** Turn OFF online mode (offline-only). Reload recommended for a clean state. */
    global.emsDisableOnlineMode = function (opts) {
        opts = opts || {};
        writeFlag(false);
        global.EMS_OFFLINE_ONLY = true;
        if (typeof global.emsDisableFirestoreNetwork === 'function') {
            global.emsDisableFirestoreNetwork();
        }
        if (global.EmsSyncEngine && typeof global.EmsSyncEngine.shutdown === 'function') {
            try { global.EmsSyncEngine.shutdown(); } catch (e) { /* ignore */ }
        }
        if (typeof global.emsStopRegistrationLiveSync === 'function') {
            try { global.emsStopRegistrationLiveSync(); } catch (e2) { /* ignore */ }
        }
        if (typeof global.emsStopRegistrationSync === 'function') {
            try { global.emsStopRegistrationSync(); } catch (e3) { /* ignore */ }
        }
        try { global.dispatchEvent(new CustomEvent('ems:online-mode-disabled')); } catch (e4) { /* ignore */ }
        if (opts.reload !== false) {
            setTimeout(function () { global.location.reload(); }, 350);
        }
        return { enabled: false, reloadRecommended: true };
    };

    function requireReady() {
        if (global.EMS_OFFLINE_ONLY === true && global.EMS_MANUAL_CLOUD_SYNC !== true) {
            return { ok: false, reason: 'offline_mode' };
        }
        if (typeof global.emsIsNetworkAvailable === 'function' && !global.emsIsNetworkAvailable()) {
            return { ok: false, reason: 'no_network' };
        }
        if (!currentUser()) {
            return { ok: false, reason: 'not_signed_in' };
        }
        if (!tenantId()) {
            return { ok: false, reason: 'no_tenant' };
        }
        return { ok: true };
    }

    /**
     * Desktop offline boot → manual cloud sync: load Firebase, restore Gmail session, allow pull/push.
     */
    global.emsPrepareManualCloudSync = function () {
        global.EMS_MANUAL_CLOUD_SYNC = true;
        global.EMS_LOCAL_AUTH = false;

        var net = (typeof global.emsEnsureNetworkForCloudSync === 'function')
            ? global.emsEnsureNetworkForCloudSync()
            : Promise.resolve(!!(global.navigator && global.navigator.onLine));

        return net.then(function (online) {
            if (!online) {
                global.EMS_MANUAL_CLOUD_SYNC = false;
                return { ok: false, reason: 'no_network' };
            }
            var load = (typeof global.emsEnableOnlineMode === 'function')
                ? global.emsEnableOnlineMode()
                : Promise.resolve();
            return load;
        }).then(function () {
            if (typeof global.emsEnsureFirebaseAuthReady === 'function') {
                return global.emsEnsureFirebaseAuthReady();
            }
            return true;
        }).then(function (ready) {
            if (!ready) {
                global.EMS_MANUAL_CLOUD_SYNC = false;
                return { ok: false, reason: 'firebase_unavailable' };
            }
            if (typeof global.emsEnsureAuthListenerForCloudSync === 'function') {
                return global.emsEnsureAuthListenerForCloudSync();
            }
            return true;
        }).then(function () {
            if (typeof global.emsWaitForFirebaseAuthRestore === 'function') {
                return global.emsWaitForFirebaseAuthRestore(8000);
            }
            return currentUser();
        }).then(function (user) {
            if (user) {
                var tid = tenantId();
                if (tid && global.EmsSyncEngine && typeof global.EmsSyncEngine.init === 'function') {
                    return global.EmsSyncEngine.init(tid).catch(function () { }).then(function () {
                        return { ok: true, user: user, tenantId: tid };
                    });
                }
                return { ok: true, user: user, tenantId: tid };
            }
            global.EMS_MANUAL_CLOUD_SYNC = false;
            return { ok: false, reason: 'not_signed_in', needsReauth: true };
        }).catch(function (err) {
            global.EMS_MANUAL_CLOUD_SYNC = false;
            return { ok: false, error: err && err.message ? err.message : String(err) };
        });
    };

    global.emsFinishManualCloudSync = function () {
        global.EMS_MANUAL_CLOUD_SYNC = false;
    };

    /**
     * Manual PUSH — send locally-saved changes up to Firebase.
     * Flushes the sync-engine queue (module keys) and the direct-firestore queue.
     */
    global.emsCloudPushNow = function () {
        var gate = requireReady();
        if (!gate.ok) return Promise.resolve(gate);

        var steps = [];
        if (typeof global.emsOfflineFlushAll === 'function') {
            steps.push(global.emsOfflineFlushAll({ manual: true }));
        } else {
            if (global.EmsSyncEngine && typeof global.EmsSyncEngine.flushQueue === 'function') {
                steps.push(global.EmsSyncEngine.flushQueue());
            }
            if (global.EmsDirect && typeof global.EmsDirect.flushQueue === 'function') {
                steps.push(Promise.resolve(global.EmsDirect.flushQueue()));
            }
        }
        if (typeof global.emsStartRegistrationWriteSync === 'function') {
            try { global.emsStartRegistrationWriteSync(tenantId()); } catch (e) { /* ignore */ }
        }
        return Promise.all(steps).then(function (results) {
            return { ok: true, action: 'push', results: results };
        }).catch(function (err) {
            return { ok: false, action: 'push', error: err && err.message ? err.message : String(err) };
        });
    };

    /**
     * Manual PULL — sequential delta sync (no stacked full tenant downloads).
     * Full disaster recovery remains on emsForceCloudDisasterRecoverySync only.
     */
    global.emsCloudPullNow = function () {
        var gate = requireReady();
        if (!gate.ok) return Promise.resolve(gate);

        var uid = tenantId();
        var results = {};

        return Promise.resolve()
            .then(function () {
                if (global.EmsSyncEngine && typeof global.EmsSyncEngine.pullAllModules === 'function') {
                    return global.EmsSyncEngine.pullAllModules(uid, { force: true, deltaOnly: true });
                }
                return { skipped: true, step: 'sync_engine' };
            })
            .then(function (r1) {
                results.syncEngine = r1;
                if (global.EmsDirect && typeof global.EmsDirect.pullAll === 'function') {
                    return Promise.resolve(global.EmsDirect.pullAll({ delta: true, forceFull: false }));
                }
                return null;
            })
            .then(function (r2) {
                results.direct = r2;
                if (typeof global.emsRegRepoRefreshFirstPage === 'function') {
                    return global.emsRegRepoRefreshFirstPage();
                }
                return { skipped: true, step: 'registrations' };
            })
            .then(function (r3) {
                results.registrations = r3;
                if (typeof global.renderRegTable === 'function') global.renderRegTable();
                if (typeof global.updateMasterDashboard === 'function') global.updateMasterDashboard();
                return { ok: true, action: 'pull', mode: 'delta_sequential', results: results };
            })
            .catch(function (err) {
                return { ok: false, action: 'pull', mode: 'delta_sequential', error: err && err.message ? err.message : String(err), results: results };
            });
    };

    // Replace the offline-only no-op stubs with the real manual-sync hooks so the
    // existing desktop "Manual Sync" menu and any wired buttons now do real work.
    global.emsHybridSyncInit = function () { return global.emsEnableOnlineMode(); };
    global.emsHybridSyncManual = function () {
        return global.emsCloudPushNow().then(function (push) {
            return global.emsCloudPullNow().then(function (pull) {
                return { ok: !!(push && push.ok), push: push, pull: pull };
            });
        });
    };
    global.emsHybridSyncOnModeChange = function () {
        if (global.EMS_OFFLINE_ONLY === true) {
            return Promise.resolve({ skipped: true, reason: 'offline_mode' });
        }
        return global.emsEnableOnlineMode();
    };
    global.emsConfirmFullTenantDownload = function (opts) {
        opts = opts || {};
        if (opts.skipConfirm) return Promise.resolve(true);
        var msg = '⚠️ ADMIN WARNING: Full tenant download will read EVERY Firebase document in all collections (high billing cost). Continue?';
        if (typeof global.confirm === 'function') {
            return Promise.resolve(!!global.confirm(msg));
        }
        return Promise.resolve(false);
    };

    global.emsForceFullTenantDownload = function (tenantIdOrOpts) {
        var tid = null;
        var opts = {};
        if (typeof tenantIdOrOpts === 'string') {
            tid = tenantIdOrOpts;
        } else if (tenantIdOrOpts && typeof tenantIdOrOpts === 'object') {
            tid = tenantIdOrOpts.tenantId || null;
            opts = tenantIdOrOpts;
        }
        if (!tid) tid = tenantId();
        return global.emsConfirmFullTenantDownload(opts).then(function (ok) {
            if (!ok) return { ok: false, reason: 'cancelled', source: 'full_download_admin_cancel' };
            if (typeof global.emsForceCloudDisasterRecoverySync === 'function') {
                return global.emsForceCloudDisasterRecoverySync(tid, { skipConfirm: true });
            }
            return { ok: false, source: 'offline_only', count: 0 };
        });
    };

    // If the app booted straight into online mode (persisted flag), enforce the
    // SSOT flag immediately so nothing auto-pulls before the user asks, and bring
    // Firebase + sync engines up.
    if (global.emsIsOnlineModeEnabled && global.emsIsOnlineModeEnabled()) {
        global.EMS_OFFLINE_FIRST_SSOT = true;
    }

    // Boot-time bring-up: when the runtime resolved to online (web default, or a
    // persisted online choice), load the cloud stack + Firebase BEFORE auth so the
    // Gmail sign-in landing is the working first page. Desktop stays offline-first
    // (EMS_OFFLINE_ONLY === true there) and is skipped. Data remains local SSOT —
    // emsEnableOnlineMode forces EMS_OFFLINE_FIRST_SSOT so nothing auto-pulls.
    function bootstrapOnlineIfNeeded() {
        if (global.EMS_DESKTOP_OFFLINE_ONLY === true
            || (global.emsDesktop && global.emsDesktop.offlineOnly)) {
            return;
        }

        function startOnlineMode() {
            if (global.EMS_OFFLINE_ONLY === true) {
                if (typeof global.emsHasDesktopOfflineBootCache === 'function'
                    && global.emsHasDesktopOfflineBootCache()) {
                    return;
                }
                if (typeof global.emsRequiresFirstTimeGoogleLogin === 'function'
                    && global.emsRequiresFirstTimeGoogleLogin()) {
                    global.EMS_OFFLINE_ONLY = false;
                } else {
                    return;
                }
            }
            if (enabling) return;
            try { global.emsEnableOnlineMode(); } catch (e) { /* ignore */ }
        }

        if (typeof global.navigator !== 'undefined' && !global.navigator.onLine) {
            if (typeof global.emsScheduleCloudReachabilityProbe === 'function') {
                global.emsScheduleCloudReachabilityProbe(true).then(function (online) {
                    if (!online) return;
                    startOnlineMode();
                });
                return;
            }
            return;
        }
        startOnlineMode();
    }
    if (global.EMS_OFFLINE_ONLY !== true && typeof document !== 'undefined') {
        if (document.readyState === 'loading' || document.readyState === 'interactive') {
            document.addEventListener('DOMContentLoaded', bootstrapOnlineIfNeeded);
        } else {
            bootstrapOnlineIfNeeded();
        }
    } else if (typeof global.emsRequiresFirstTimeGoogleLogin === 'function'
        && global.emsRequiresFirstTimeGoogleLogin()
        && typeof document !== 'undefined') {
        var bootNativeFirstLogin = function () {
            global.EMS_OFFLINE_ONLY = false;
            try { global.emsEnableOnlineMode(); } catch (eBoot) { /* ignore */ }
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', bootNativeFirstLogin);
        } else {
            bootNativeFirstLogin();
        }
    }
})(typeof window !== 'undefined' ? window : globalThis);
