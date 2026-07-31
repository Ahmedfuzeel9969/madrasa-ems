// ============================================================================
// EMS Native App Boot — Desktop (.exe) + Mobile (.apk via Capacitor)
// ----------------------------------------------------------------------------
// Industry-standard auth boot for installed apps:
//   • FIRST boot (fresh install): mandatory Google/Gmail login → tenant ID
//   • RETURNING boot: instant offline open from saved session (no login screen)
//   • LOGOUT / SWITCH ACCOUNT: clears session → next boot requires Gmail again
//
// Hosted web browser is NOT native — it stays online-default (see index.html).
// ============================================================================
(function (global) {
    'use strict';

    var SESSION_KEY = 'ems_offline_session_v1';

    /** Electron desktop (.exe) */
    global.emsIsDesktopApp = function () {
        if (global.EMS_DESKTOP_UNLIMITED === true) return true;
        if (global.emsDesktop && global.emsDesktop.isDesktop) return true;
        try {
            if (/electron/i.test((global.navigator && global.navigator.userAgent) || '')) return true;
            if (global.location && global.location.search) {
                if (global.location.search.indexOf('desktop=1') >= 0) return true;
                if (global.location.search.indexOf('localBundle=1') >= 0) return true;
            }
        } catch (e) { /* ignore */ }
        return false;
    };

    /** Capacitor Android / iOS (.apk) */
    global.emsIsAndroidApp = function () {
        try {
            if (global.Capacitor && typeof global.Capacitor.isNativePlatform === 'function') {
                return global.Capacitor.isNativePlatform();
            }
        } catch (e) { /* ignore */ }
        return false;
    };

    /** Any installed native shell (desktop OR mobile) */
    global.emsIsNativeApp = function () {
        return global.emsIsDesktopApp() || global.emsIsAndroidApp();
    };

    /** Read the persisted offline session snapshot (tenant + auth uid). */
    global.emsReadNativeSessionSnapshot = function () {
        try {
            var raw = global.localStorage.getItem(SESSION_KEY);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (e) {
            return null;
        }
    };

    /**
     * True when a prior successful login saved tenant and/or session —
     * eligible for instant offline boot on subsequent launches.
     */
    global.emsHasNativeInstantBootCache = function () {
        if (typeof global.emsHasDesktopOfflineBootCache === 'function') {
            return global.emsHasDesktopOfflineBootCache();
        }
        var snap = global.emsReadNativeSessionSnapshot();
        if (!snap || !snap.tenantId || !snap.authUid) return false;
        if (snap.madrasaData && snap.madrasaData.subStatus === 'suspended') return false;
        return true;
    };

    /** Fresh install on native — Gmail login required before instant boot works. */
    global.emsRequiresFirstTimeGoogleLogin = function () {
        if (!global.emsIsNativeApp()) return false;
        return !global.emsHasNativeInstantBootCache();
    };

    /**
     * After a SUCCESSFUL authenticated unlock on native, lock FUTURE boots to
     * offline-first instant mode. Must NOT run before membership/Firestore boot —
     * that sets EMS_OFFLINE_ONLY and makes waitForDb fail immediately.
     */
    global.emsFinalizeNativeInstantBootMode = function () {
        if (!global.emsIsNativeApp()) return;
        try { global.localStorage.setItem('ems_online_mode', '0'); } catch (e) { /* ignore */ }
        global.EMS_OFFLINE_ONLY = true;
        global.EMS_NATIVE_FIRST_LOGIN_REQUIRED = false;
        if (typeof document !== 'undefined' && document.documentElement) {
            document.documentElement.classList.add('ems-offline-no-signin');
        }
        try {
            global.dispatchEvent(new CustomEvent('ems:native-instant-boot-ready'));
        } catch (e2) { /* ignore */ }
    };

    /**
     * Attempt instant offline boot (delegates to auth.js once it is loaded).
     * Called from boot-gate BEFORE the login shell is shown.
     */
    global.emsTryNativeInstantBoot = function () {
        if (!global.emsIsNativeApp()) return false;
        if (!global.emsHasNativeInstantBootCache()) return false;
        if (typeof global.emsTryNativeInstantBootImpl === 'function') {
            return global.emsTryNativeInstantBootImpl();
        }
        return false;
    };

    /** Schedule a near-instant retry (auth.js may not be loaded yet on first tick). */
    global.emsScheduleNativeInstantBoot = function () {
        if (!global.emsIsNativeApp()) return;
        if (!global.emsHasNativeInstantBootCache()) return;
        if (global.emsTryNativeInstantBoot()) return;
        var attempts = 0;
        var timer = setInterval(function () {
            attempts++;
            if (global.emsTryNativeInstantBoot() || attempts >= 20) {
                clearInterval(timer);
            }
        }, 50);
    };

    /** Display name / email for Settings → Account panel */
    global.emsGetNativeAccountLabel = function () {
        var snap = global.emsReadNativeSessionSnapshot();
        if (!snap) return '—';
        if (snap.userEmail) return snap.userEmail;
        if (snap.displayName) return snap.displayName;
        if (snap.madrasaData && snap.madrasaData.ownerEmail) return snap.madrasaData.ownerEmail;
        if (snap.authUid) return snap.authUid;
        return '—';
    };

    // Expose flag set by index.html head resolver (may be undefined on older builds)
    if (global.EMS_NATIVE_FIRST_LOGIN_REQUIRED == null) {
        global.EMS_NATIVE_FIRST_LOGIN_REQUIRED = global.emsRequiresFirstTimeGoogleLogin();
    }
})(typeof window !== 'undefined' ? window : globalThis);
