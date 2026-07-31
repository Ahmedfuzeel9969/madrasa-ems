// ============================================================================
// EMS Global Cloud Sync — visible Push + Pull trigger (ribbon + dashboard)
// ============================================================================
(function (global) {
    'use strict';

    var inflight = null;
    var SYNC_BTN_IDS = ['btn-global-cloud-sync', 'ems-global-sync-btn', 'btn-dash-global-sync'];

    function setSyncButtonsBusy(busy) {
        SYNC_BTN_IDS.forEach(function (id) {
            var el = document.getElementById(id);
            if (!el) return;
            el.disabled = !!busy;
            el.setAttribute('aria-busy', busy ? 'true' : 'false');
            if (busy) {
                if (!el._emsSyncPrevHtml) el._emsSyncPrevHtml = el.innerHTML;
                el.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> سنک…';
            } else if (el._emsSyncPrevHtml) {
                el.innerHTML = el._emsSyncPrevHtml;
                delete el._emsSyncPrevHtml;
            }
        });
    }

    global.emsUpdateGlobalSyncButton = function () {
        function apply(online) {
            var signedIn = false;
            try {
                signedIn = !!(typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser);
            } catch (e) { /* ignore */ }

            SYNC_BTN_IDS.forEach(function (id) {
                var btn = document.getElementById(id);
                if (!btn) return;
                btn.title = online
                    ? (signedIn ? 'لوکل ↔ Firebase — Push پھر Pull' : 'لاگ ان درکار')
                    : 'آف لائن — انٹرنیٹ منسلک کریں';
                btn.classList.toggle('ems-sync-offline', !online);
                btn.classList.toggle('ems-sync-no-auth', online && !signedIn);
            });

            var dot = document.getElementById('ems-sync-status-dot');
            var txt = document.getElementById('ems-sync-status-text');
            if (dot) dot.style.background = online ? '#22c55e' : '#94a3b8';
            if (txt) txt.textContent = online ? 'آن لائن' : 'آف لائن';
        }

        if (typeof global.emsScheduleCloudReachabilityProbe === 'function') {
            global.emsScheduleCloudReachabilityProbe().then(apply).catch(function () {
                apply(typeof global.emsIsNetworkAvailable === 'function'
                    ? global.emsIsNetworkAvailable()
                    : !!(global.navigator && global.navigator.onLine));
            });
            return;
        }
        apply(typeof global.emsIsNetworkAvailable === 'function'
            ? global.emsIsNetworkAvailable()
            : !!(global.navigator && global.navigator.onLine));
    };

    /**
     * Manual bidirectional sync: push local queue → pull cloud (registrations + modules).
     * @param {{ scope?: string, skipConfirm?: boolean, pushOnly?: boolean, triggerButton?: HTMLElement }} [opts]
     */
    global.emsRunGlobalCloudSync = function (opts) {
        opts = opts || {};
        if (inflight) return inflight;

        setSyncButtonsBusy(true);

        var prep = (typeof global.emsPrepareManualCloudSync === 'function')
            ? global.emsPrepareManualCloudSync()
            : Promise.resolve({ ok: true });

        inflight = prep.then(function (prepRes) {
            if (prepRes && prepRes.ok === false) {
                if (prepRes.reason === 'no_network') {
                    if (typeof global.showToast === 'function') {
                        global.showToast('انٹرنیٹ منسلک نہیں — آف لائن موڈ میں کام جاری رکھیں', 'warning');
                    }
                    return { ok: false, reason: 'no_network' };
                }
                if (prepRes.reason === 'not_signed_in' || prepRes.needsReauth) {
                    if (typeof global.showToast === 'function') {
                        global.showToast('کلاؤڈ سنک کے لیے Gmail دوبارہ لاگ ان کریں', 'error');
                    }
                    if (typeof global.loginWithGoogle === 'function') {
                        setTimeout(function () { global.loginWithGoogle(); }, 400);
                    }
                    return { ok: false, reason: 'not_signed_in' };
                }
                if (typeof global.showToast === 'function') {
                    global.showToast('کلاؤڈ تیاری ناکام: ' + (prepRes.error || prepRes.reason || '?'), 'error');
                }
                return prepRes;
            }

            if (typeof global.showToast === 'function') {
                global.showToast('کلاؤڈ سنک شروع… (Push → Pull)', 'info');
            }

            return Promise.resolve();
        }).then(function (earlyExit) {
            if (earlyExit && earlyExit.ok === false) return earlyExit;

            if (typeof global.emsCloudPushNow === 'function') {
                return global.emsCloudPushNow();
            }
            if (typeof global.emsHybridSyncManual === 'function') {
                return global.emsHybridSyncManual();
            }
            return { ok: true, skipped: true };
        }).then(function (pushRes) {
            if (pushRes && pushRes.ok === false && (pushRes.reason === 'no_network' || pushRes.reason === 'not_signed_in')) {
                return pushRes;
            }
            if (opts.pushOnly) return pushRes;
            if (typeof global.emsCloudPullExecute === 'function') {
                return global.emsCloudPullExecute({
                    scope: opts.scope || 'all',
                    skipConfirm: !!opts.skipConfirm,
                    triggerButton: opts.triggerButton || null
                });
            }
            if (typeof global.emsCloudPullNow === 'function') {
                return global.emsCloudPullNow();
            }
            return pushRes;
        }).then(function (result) {
            if (typeof global.updateMasterDashboard === 'function') {
                try { global.updateMasterDashboard(); } catch (e) { /* ignore */ }
            }
            if (typeof global.renderRegTable === 'function') {
                try { global.renderRegTable(); } catch (e2) { /* ignore */ }
            }
            if (result && result.reason === 'cancelled') {
                return { ok: false, reason: 'cancelled', result: result };
            }
            if (typeof global.showToast === 'function' && result && result.ok !== false) {
                global.showToast('✅ کلاؤڈ سنک مکمل', 'success');
            }
            return { ok: true, result: result };
        }).catch(function (err) {
            console.error('[EMS] global sync failed', err);
            if (typeof global.showToast === 'function') {
                global.showToast('سنک ناکام: ' + (err && err.message ? err.message : String(err)), 'error');
            }
            return { ok: false, error: err && err.message ? err.message : String(err) };
        }).finally(function () {
            inflight = null;
            setSyncButtonsBusy(false);
            if (typeof global.emsFinishManualCloudSync === 'function') {
                global.emsFinishManualCloudSync();
            }
            global.emsUpdateGlobalSyncButton();
        });

        return inflight;
    };

    function bindSyncButtons() {
        var ribbonBtn = document.getElementById('btn-global-cloud-sync');
        if (ribbonBtn && !ribbonBtn._emsSyncBound) {
            ribbonBtn._emsSyncBound = true;
            ribbonBtn.addEventListener('click', function () {
                global.emsRunGlobalCloudSync({ triggerButton: ribbonBtn });
            });
        }
        var dashBtn = document.getElementById('btn-dash-global-sync');
        if (dashBtn && !dashBtn._emsSyncBound) {
            dashBtn._emsSyncBound = true;
            dashBtn.addEventListener('click', function () {
                global.emsRunGlobalCloudSync({ triggerButton: dashBtn });
            });
        }
        global.emsUpdateGlobalSyncButton();
    }

    if (typeof global.addEventListener === 'function') {
        global.addEventListener('online', global.emsUpdateGlobalSyncButton);
        global.addEventListener('offline', global.emsUpdateGlobalSyncButton);
        global.addEventListener('ems:cloud-pull-complete', global.emsUpdateGlobalSyncButton);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindSyncButtons);
    } else {
        bindSyncButtons();
    }
})(typeof window !== 'undefined' ? window : globalThis);
