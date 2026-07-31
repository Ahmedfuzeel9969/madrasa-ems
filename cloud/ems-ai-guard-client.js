// ============================================================================
// EMS AI — Client Layer 1 guardrails (pre-filter before gateway call)
// ============================================================================
(function (global) {
    'use strict';

    var OFF_DOMAIN = [
        /سیاست|انتخابات|politic/i,
        /hack|phishing|password crack/i,
        /دوائی|تشخیص|medical/i,
        /وکیل|legal advice/i,
        /bitcoin|crypto|forex/i
    ];

    global.emsAiCanUse = function () {
        if (global.EMS_GUEST_MODE) return false;
        var role = global.CURRENT_USER_TENANT_ROLE;
        if (role === 'parent' || role === 'guest') return false;
        if (role === 'owner' || role === 'staff') return true;
        if (global.CURRENT_MADRASA_TENANT_ID && typeof global.firebase !== 'undefined'
            && global.firebase.auth && global.firebase.auth().currentUser) {
            return true;
        }
        return false;
    };

    function firebaseAppReady() {
        try {
            return typeof global.firebase !== 'undefined'
                && global.firebase.apps && global.firebase.apps.length > 0;
        } catch (e) {
            return false;
        }
    }

    function functionsCallableReady() {
        if (typeof global.emsCallFunction === 'function' && firebaseAppReady()) {
            return true;
        }
        try {
            if (typeof global.firebase !== 'undefined' && global.firebase.functions) {
                global.firebase.functions();
                return true;
            }
        } catch (e) { /* not initialized yet */ }
        return false;
    }

    /**
     * True when AI can reach Cloud Functions — aligned with main EMS online/sync state.
     * Avoids false negatives from a bare firebase.functions namespace check at load time.
     */
    global.emsAiIsOnlineReady = function () {
        if (typeof global.navigator !== 'undefined' && global.navigator.onLine === false) {
            return false;
        }
        if (typeof global.emsIsOfflineOnly === 'function' && global.emsIsOfflineOnly()) {
            return false;
        }
        if (!global.CURRENT_MADRASA_TENANT_ID) {
            return false;
        }

        if (functionsCallableReady()) {
            return true;
        }

        if (typeof global.emsGetOnlineStatus === 'function') {
            var st = global.emsGetOnlineStatus();
            if (st.enabled && st.signedIn && (st.firebaseReady || functionsCallableReady())) {
                return true;
            }
            if (st.enabled && st.signedIn && st.sync && st.sync.online) {
                return true;
            }
        }

        if (typeof global.getDbOrNull === 'function' && global.getDbOrNull()) {
            return true;
        }
        if (global.EMS_FIRESTORE_DB) {
            return true;
        }

        if (typeof global.emsIsCloudEnabled === 'function' && global.emsIsCloudEnabled()
            && firebaseAppReady()) {
            return true;
        }

        return false;
    };

    /** Try to hydrate cloud/functions then re-check (for late online-mode enable). */
    global.emsAiEnsureOnlineReady = function () {
        if (global.emsAiIsOnlineReady()) {
            return Promise.resolve({ ready: true });
        }
        var chain = Promise.resolve();
        if (typeof global.emsIsCloudEnabled === 'function' && global.emsIsCloudEnabled()
            && typeof global.emsLoadCloudStack === 'function') {
            chain = global.emsLoadCloudStack().then(function () {
                if (typeof global.emsInitFirebase === 'function') {
                    global.emsInitFirebase();
                }
            });
        }
        return chain.then(function () {
            if (global.emsAiIsOnlineReady()) {
                return { ready: true };
            }
            return Promise.reject(new Error('ai_offline'));
        });
    };

    global.emsAiClientGuard = function (question, intent) {
        var q = String(question || '').trim();
        if (!q) {
            return { ok: false, message: 'براہ کرم سوال لکھیں۔' };
        }
        if (q.length > 2000) {
            return { ok: false, message: 'سوال بہت لمبا ہے — مختصر کریں۔' };
        }
        for (var i = 0; i < OFF_DOMAIN.length; i++) {
            if (OFF_DOMAIN[i].test(q)) {
                return {
                    ok: false,
                    message: 'یہ سوال Madrasa EMS کے دائرہ کار سے باہر ہے۔'
                };
            }
        }
        if (intent) return { ok: true };
        return { ok: true };
    };
})(typeof window !== 'undefined' ? window : globalThis);
