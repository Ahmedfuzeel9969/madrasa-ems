// ============================================================================
// EMS Guest Demo Sandbox — isolated Demo_Madrasas tenant (3-day TTL metadata)
// Full admin UI; production All_Madrasas never touched for guest sessions.
// ============================================================================
(function (global) {
    'use strict';

    var DEMO_ROOT = 'Demo_Madrasas';
    var PROD_ROOT = 'All_Madrasas';
    var DEMO_TTL_MS = 3 * 24 * 60 * 60 * 1000;
    var BANNER_TEXT = 'یہ مہمان / ڈیمو پورٹل ہے۔ یہاں آپ کا درج کیا گیا ڈیٹا صرف 3 دن تک محفوظ رہے گا اور اس کے بعد خودکار طور پر ڈیلیٹ ہو جائے گا۔';

    function authUser() {
        try {
            return firebase.auth && firebase.auth().currentUser;
        } catch (e) {
            return null;
        }
    }

    global.emsBuildDemoTenantId = function (uid) {
        uid = uid || (authUser() && authUser().uid);
        if (!uid) return null;
        return 'demo_guest_' + uid;
    };

    global.emsIsDemoSandbox = function () {
        if (global.EMS_GUEST_MODE) return true;
        if (global.CURRENT_MADRASA_DATA && global.CURRENT_MADRASA_DATA.isDemo) {
            return true;
        }
        var tid = global.CURRENT_MADRASA_TENANT_ID;
        return !!(tid && String(tid).indexOf('demo_guest_') === 0);
    };

    global.emsGetTenantRootCollection = function () {
        return global.emsIsDemoSandbox() ? DEMO_ROOT : PROD_ROOT;
    };

    global.emsDemoExpiresAt = function (fromMs) {
        fromMs = fromMs || Date.now();
        return fromMs + DEMO_TTL_MS;
    };

    global.emsApplyDemoSandboxContext = function (user, opts) {
        opts = opts || {};
        user = user || authUser();
        var demoId = user && user.uid
            ? global.emsBuildDemoTenantId(user.uid)
            : ('demo_guest_offline_' + (opts.offlineKey || Date.now()));
        var now = Date.now();
        var modules = typeof global.buildDefaultAllowedModules === 'function'
            ? global.buildDefaultAllowedModules('free')
            : (global.LICENSED_MODULE_IDS || []);

        global.EMS_GUEST_MODE = true;
        global.CURRENT_MADRASA_TENANT_ID = demoId;
        global.CURRENT_USER_TENANT_ROLE = 'owner';
        global.EMS_ACTIVE_TENANT_ID = demoId;
        global.CURRENT_MADRASA_DATA = {
            madrasaName: 'ڈیمو ماحول (مہمان)',
            principalName: (user && user.displayName) || 'مہمان صارف',
            email: (user && user.email) || '',
            subStatus: 'free',
            allowedModules: modules,
            isDemo: true,
            demoId: demoId,
            ownerUid: user ? user.uid : null,
            createdAtMs: now,
            expiresAtMs: global.emsDemoExpiresAt(now)
        };

        try {
            localStorage.setItem('ems_persisted_tenant_id_v1', demoId);
        } catch (e) { /* ignore */ }

        if (typeof global.emsActivateTenantStorage === 'function') {
            global.emsActivateTenantStorage(demoId);
        }
        if (typeof global.emsRegRepoInit === 'function') {
            global.emsRegRepoInit(demoId);
        }
        return demoId;
    };

    global.emsEnsureDemoMadrasaProfile = function (user) {
        user = user || authUser();
        var demoId = global.CURRENT_MADRASA_TENANT_ID || (user ? global.emsBuildDemoTenantId(user.uid) : null);
        if (!demoId) return Promise.resolve(false);

        var db = typeof global.getDbOrNull === 'function' ? global.getDbOrNull() : null;
        if (!db || !user) return Promise.resolve(true);

        var now = Date.now();
        var ref = db.collection(DEMO_ROOT).doc(demoId);

        return ref.get().then(function (snap) {
            var payload = {
                madrasaName: 'ڈیمو ماحول (مہمان)',
                principalName: user.displayName || 'مہمان صارف',
                email: user.email || '',
                subStatus: 'free',
                allowedModules: typeof global.buildDefaultAllowedModules === 'function'
                    ? global.buildDefaultAllowedModules('free')
                    : {},
                isDemo: true,
                demoId: demoId,
                ownerUid: user.uid,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            if (!snap.exists) {
                payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                payload.createdAtMs = now;
                payload.expiresAtMs = global.emsDemoExpiresAt(now);
                payload.expiresAt = new Date(payload.expiresAtMs).toISOString();
            } else {
                var existing = snap.data() || {};
                var createdMs = existing.createdAtMs || now;
                if (!existing.createdAtMs) payload.createdAtMs = createdMs;
                if (!existing.createdAt) payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                if (!existing.expiresAtMs) {
                    payload.expiresAtMs = global.emsDemoExpiresAt(createdMs);
                    payload.expiresAt = new Date(payload.expiresAtMs).toISOString();
                }
            }
            return ref.set(payload, { merge: true }).then(function () {
                if (global.CURRENT_MADRASA_DATA) {
                    Object.assign(global.CURRENT_MADRASA_DATA, {
                        madrasaName: payload.madrasaName,
                        isDemo: true,
                        demoId: demoId,
                        expiresAtMs: payload.expiresAtMs || global.CURRENT_MADRASA_DATA.expiresAtMs
                    });
                }
                return true;
            });
        }).catch(function (err) {
            console.warn('[EMS:demo] Demo_Madrasas profile init failed:', err && err.message);
            return false;
        });
    };

    global.emsShowDemoSandboxBanner = function () {
        var el = document.getElementById('ems-demo-sandbox-banner');
        if (!el) return;
        el.textContent = BANNER_TEXT;
        el.style.display = 'block';
        document.body.classList.add('ems-demo-sandbox-active');
    };

    global.emsHideDemoSandboxBanner = function () {
        var el = document.getElementById('ems-demo-sandbox-banner');
        if (el) el.style.display = 'none';
        document.body.classList.remove('ems-demo-sandbox-active');
    };

    global.emsClearDemoSandboxSession = function () {
        global.emsHideDemoSandboxBanner();
    };

})(typeof window !== 'undefined' ? window : globalThis);
