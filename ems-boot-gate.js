// ============================================================================
// EMS Boot Gate — login shell MUST render before enterprise data boot
// Set window.EMS_ENTERPRISE_BOOT_ENABLED = false to disable repo boot entirely.
// ============================================================================
(function (global) {
    'use strict';

    if (global.EMS_ENTERPRISE_BOOT_ENABLED === undefined) {
        global.EMS_ENTERPRISE_BOOT_ENABLED = true;
    }

    var bootStart = typeof performance !== 'undefined' && performance.now
        ? performance.now()
        : Date.now();
    var marks = [];

    global.emsBootMark = function (stage, detail) {
        var now = typeof performance !== 'undefined' && performance.now
            ? performance.now()
            : Date.now();
        var entry = {
            stage: stage,
            ms: Math.round(now - bootStart),
            detail: detail || null
        };
        marks.push(entry);
        try {
            console.info('[EMS:boot]', entry.stage, entry.ms + 'ms', entry.detail || '');
        } catch (e) { /* ignore */ }
        return entry;
    };

    global.emsGetBootMarks = function () {
        return marks.slice();
    };

    global.emsIsUserAuthenticated = function () {
        if (typeof global.emsIsOfflineLocalSession === 'function' && global.emsIsOfflineLocalSession()) {
            return true;
        }
        if (global.EMS_GUEST_MODE || global.CURRENT_USER_TENANT_ROLE === 'guest') {
            return true;
        }
        try {
            return !!(global.firebase && global.firebase.auth && global.firebase.auth().currentUser);
        } catch (e) {
            return false;
        }
    };

    global.emsCanRunEnterpriseBoot = function () {
        if (global.EMS_ENTERPRISE_BOOT_ENABLED === false) return false;
        if (typeof global.emsIsOfflineOnly === 'function' && global.emsIsOfflineOnly()) {
            return global.emsIsUserAuthenticated();
        }
        return global.emsIsUserAuthenticated();
    };

    global.emsHideBootSpinner = function () {
        var sp = document.getElementById('global-spinner');
        if (sp) {
            sp.style.display = 'none';
            sp.classList.remove('ems-boot-overlay');
            sp.innerHTML = '';
        }
        if (typeof global.emsDismissBootSplash === 'function') {
            global.emsDismissBootSplash();
        }
    };

    global.emsDismissBootSplash = function () {
        if (typeof document !== 'undefined' && document.documentElement) {
            document.documentElement.classList.remove('ems-booting');
        }
        var splash = document.getElementById('ems-boot-splash');
        if (splash) splash.remove();
    };

    global.emsSetBootSplashMessage = function (message) {
        var el = document.getElementById('ems-boot-splash-msg');
        if (el && message) el.textContent = message;
    };

    /**
     * Boot orchestration:
     *   1) Native returning user → instant offline boot (skip login entirely)
     *   2) Already authenticated → nothing to show
     *   3) Native first-time OR hosted web → show Gmail login landing
     * Keep splash until a real UI surface is ready (prevents Android white screen).
     */
    global.emsEnsureLoginShellVisible = function () {
        if (typeof global.emsShouldForceStrictOfflineBypass === 'function'
            && global.emsShouldForceStrictOfflineBypass()) {
            if (typeof global.emsAttemptStrictOfflineBoot === 'function') {
                global.emsAttemptStrictOfflineBoot();
            }
            global.emsBootMark('strict-offline-bypass-login-blocked');
            global.emsHideBootSpinner();
            global.emsRecoverBlankBootUi();
            return;
        }

        if (typeof global.emsTryNativeInstantBoot === 'function' && global.emsTryNativeInstantBoot()) {
            global.emsBootMark('native-instant-boot-ok');
            global.emsHideBootSpinner();
            return;
        }

        if (global.emsIsUserAuthenticated()) {
            global.emsHideBootSpinner();
            return;
        }

        if (typeof global.emsShowLanding === 'function') {
            global.emsShowLanding();
        } else {
            if (document.documentElement) {
                document.documentElement.classList.remove('ems-offline-no-signin');
            }
            var landing = document.getElementById('ems-landing');
            if (landing) landing.style.display = 'flex';
            document.body.classList.add('ems-locked');
        }
        if (typeof global.emsUpdateOfflineContinueButton === 'function') {
            global.emsUpdateOfflineContinueButton();
        }
        document.body.style.overflow = 'hidden';

        global.emsHideBootSpinner();
        global.emsRecoverBlankBootUi();

        if (typeof global.emsScheduleNativeInstantBoot === 'function') {
            global.emsScheduleNativeInstantBoot();
        }
        if (typeof global.emsScheduleDesktopOfflineAutoBoot === 'function') {
            global.emsScheduleDesktopOfflineAutoBoot();
        }
    };

    /** If splash is gone, shell locked, and landing CSS-hidden → force login UI. */
    global.emsRecoverBlankBootUi = function () {
        try {
            if (document.body.classList.contains('ems-authenticated')) return;
            if (document.documentElement.classList.contains('ems-booting')) return;
            var landing = document.getElementById('ems-landing');
            if (landing) {
                var cs = window.getComputedStyle ? window.getComputedStyle(landing) : null;
                if (cs && cs.display !== 'none' && cs.visibility !== 'hidden') return;
            }
            document.documentElement.classList.remove('ems-offline-no-signin');
            if (typeof global.emsShowLanding === 'function') {
                global.emsShowLanding();
            } else if (landing) {
                landing.style.display = 'flex';
                landing.style.visibility = 'visible';
                document.body.classList.add('ems-locked');
            }
            global.emsBootMark('blank-boot-ui-recovered');
        } catch (eRec) { /* ignore */ }
    };

    global.emsBootMark('boot-gate-loaded');

    if (typeof document !== 'undefined') {
        function deferLoginShell() {
            global.emsBootMark('dom-ready');
            if (typeof global.emsIsNativeApp === 'function' && global.emsIsNativeApp()
                && typeof global.emsHasNativeInstantBootCache === 'function'
                && global.emsHasNativeInstantBootCache()) {
                setTimeout(function () { global.emsEnsureLoginShellVisible(); }, 0);
                setTimeout(function () { global.emsRecoverBlankBootUi(); }, 800);
                setTimeout(function () { global.emsRecoverBlankBootUi(); }, 2500);
                return;
            }
            global.emsEnsureLoginShellVisible();
            setTimeout(function () { global.emsRecoverBlankBootUi(); }, 800);
        }
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', deferLoginShell);
        } else {
            global.emsBootMark('dom-already-ready');
            deferLoginShell();
        }
    }
})(typeof window !== 'undefined' ? window : globalThis);
