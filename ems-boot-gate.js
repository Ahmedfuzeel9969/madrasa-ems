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
    var stuckWatchdogTimer = null;
    var STUCK_BOOT_MS = 8000;

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

    function isAppShellUnlocked() {
        try {
            if (!document.body) return false;
            if (document.body.classList.contains('ems-locked')) return false;
            return document.body.classList.contains('ems-authenticated');
        } catch (e) {
            return false;
        }
    }

    function isLandingVisible() {
        try {
            var landing = document.getElementById('ems-landing');
            if (!landing) return false;
            var cs = window.getComputedStyle ? window.getComputedStyle(landing) : null;
            return !!(cs && cs.display !== 'none' && cs.visibility !== 'hidden');
        } catch (e) {
            return false;
        }
    }

    function isFailOrGatewayVisible() {
        try {
            var fail = document.getElementById('ems-post-login-fail');
            if (fail) {
                var fcs = window.getComputedStyle ? window.getComputedStyle(fail) : null;
                if (fcs && fcs.display !== 'none') return true;
            }
            var gw = document.getElementById('profile-setup-gateway');
            if (gw) {
                var gcs = window.getComputedStyle ? window.getComputedStyle(gw) : null;
                if (gcs && gcs.display === 'flex') return true;
            }
            return false;
        } catch (e2) {
            return false;
        }
    }

    /** Real UI only — splash alone does NOT count (avoids infinite spinner). */
    function hasRealUiSurface() {
        return isAppShellUnlocked() || isLandingVisible() || isFailOrGatewayVisible();
    }

    function clearStuckWatchdog() {
        if (stuckWatchdogTimer) {
            clearTimeout(stuckWatchdogTimer);
            stuckWatchdogTimer = null;
        }
    }

    function forceShowLoginShell(message) {
        clearStuckWatchdog();
        try {
            document.documentElement.classList.remove('ems-offline-no-signin', 'ems-booting');
        } catch (e) { /* ignore */ }
        global.emsDismissBootSplash();
        var sp = document.getElementById('global-spinner');
        if (sp) {
            sp.style.display = 'none';
            sp.classList.remove('ems-boot-overlay');
            sp.innerHTML = '';
        }
        document.body.classList.add('ems-locked');
        document.body.classList.remove('ems-authenticated');
        if (typeof global.emsShowLanding === 'function') {
            /* Bypass early-return on firebase user by clearing offline-no-signin first */
            try { document.documentElement.classList.remove('ems-offline-no-signin'); } catch (e2) { /* ignore */ }
            var landing = document.getElementById('ems-landing');
            if (landing) {
                landing.style.display = 'flex';
                landing.style.visibility = 'visible';
                landing.removeAttribute('hidden');
            }
            /* emsShowLanding returns early if firebase user — force landing anyway when stuck */
            if (!global.emsIsUserAuthenticated()) {
                global.emsShowLanding();
            } else if (landing) {
                landing.style.display = 'flex';
                landing.style.visibility = 'visible';
            }
        }
        if (message && typeof global.showTopAlert === 'function') {
            global.showTopAlert(message, true);
        }
        global.emsBootMark('force-login-shell', message || '');
    }

    function scheduleStuckBootWatchdog() {
        clearStuckWatchdog();
        stuckWatchdogTimer = setTimeout(function () {
            stuckWatchdogTimer = null;
            if (isAppShellUnlocked() || isFailOrGatewayVisible()) return;
            global.emsBootMark('stuck-boot-watchdog');
            if (typeof global.emsShowPostLoginBootFailure === 'function' && global.emsIsUserAuthenticated()) {
                global.emsDismissBootSplash();
                global.emsShowPostLoginBootFailure(
                    'stuck_boot_spinner',
                    'ایپ لوڈ ہونے میں رکاوٹ۔ دوبارہ کوشش کریں یا سائن آؤٹ کر کے لاگ ان کریں۔'
                );
                return;
            }
            forceShowLoginShell('لوڈنگ رک گئی — لاگ ان صفحہ کھول دیا گیا۔');
        }, STUCK_BOOT_MS);
    }

    global.emsHideBootSpinner = function () {
        var sp = document.getElementById('global-spinner');
        if (sp) {
            sp.style.display = 'none';
            sp.classList.remove('ems-boot-overlay');
            sp.innerHTML = '';
        }
        if (isAppShellUnlocked() || isLandingVisible() || isFailOrGatewayVisible()) {
            global.emsDismissBootSplash();
            clearStuckWatchdog();
            return;
        }
        /* Still locked with no landing — keep splash briefly; watchdog will unblock. */
        global.emsEnsureBootSplashVisible('ایپ کھل رہی ہے…');
        scheduleStuckBootWatchdog();
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

    /** Re-create splash if removed early (prevents blank white page). */
    global.emsEnsureBootSplashVisible = function (message) {
        try {
            if (isAppShellUnlocked() || isLandingVisible()) return false;
            if (typeof document === 'undefined' || !document.body) return false;
            document.documentElement.classList.add('ems-booting');
            var splash = document.getElementById('ems-boot-splash');
            if (!splash) {
                splash = document.createElement('div');
                splash.id = 'ems-boot-splash';
                splash.setAttribute('aria-live', 'polite');
                splash.setAttribute('aria-busy', 'true');
                splash.innerHTML = '<div class="ems-boot-ring" aria-hidden="true"></div>'
                    + '<p class="ems-boot-title">تعلیمی مینجمنٹ سسٹم</p>'
                    + '<p class="ems-boot-sub" id="ems-boot-splash-msg"></p>';
                document.body.appendChild(splash);
            }
            splash.style.display = 'flex';
            if (message && typeof global.emsSetBootSplashMessage === 'function') {
                global.emsSetBootSplashMessage(message);
            }
            scheduleStuckBootWatchdog();
            return true;
        } catch (eEns) {
            return false;
        }
    };

    /**
     * Boot orchestration:
     *   1) Native returning user → instant offline boot
     *   2) Already authenticated → splash until unlock (with stuck watchdog)
     *   3) Otherwise → show login landing and dismiss splash
     */
    global.emsEnsureLoginShellVisible = function () {
        if (typeof global.emsShouldForceStrictOfflineBypass === 'function'
            && global.emsShouldForceStrictOfflineBypass()) {
            if (typeof global.emsAttemptStrictOfflineBoot === 'function') {
                global.emsAttemptStrictOfflineBoot();
            }
            global.emsBootMark('strict-offline-bypass-login-blocked');
            if (isAppShellUnlocked()) {
                global.emsDismissBootSplash();
                clearStuckWatchdog();
            } else {
                global.emsEnsureBootSplashVisible('آف لائن موڈ کھل رہا ہے…');
            }
            return;
        }

        if (typeof global.emsTryNativeInstantBoot === 'function' && global.emsTryNativeInstantBoot()) {
            global.emsBootMark('native-instant-boot-ok');
            if (isAppShellUnlocked()) {
                global.emsDismissBootSplash();
                clearStuckWatchdog();
            } else {
                global.emsEnsureBootSplashVisible('مقامی سیشن سے کھل رہا ہے…');
            }
            return;
        }

        if (global.emsIsUserAuthenticated()) {
            if (isAppShellUnlocked()) {
                global.emsDismissBootSplash();
                clearStuckWatchdog();
                return;
            }
            global.emsBootMark('auth-session-pending-unlock');
            global.emsEnsureBootSplashVisible('سائن ان تصدیق ہو رہی ہے…');
            return;
        }

        /* Not signed in — always show login; never leave infinite splash. */
        if (typeof global.emsShowLanding === 'function') {
            global.emsShowLanding();
        } else {
            if (document.documentElement) {
                document.documentElement.classList.remove('ems-offline-no-signin');
            }
            var landing = document.getElementById('ems-landing');
            if (landing) {
                landing.style.display = 'flex';
                landing.style.visibility = 'visible';
            }
            document.body.classList.add('ems-locked');
        }
        if (typeof global.emsUpdateOfflineContinueButton === 'function') {
            global.emsUpdateOfflineContinueButton();
        }
        document.body.style.overflow = 'hidden';
        global.emsDismissBootSplash();
        clearStuckWatchdog();
        var sp = document.getElementById('global-spinner');
        if (sp) {
            sp.style.display = 'none';
            sp.classList.remove('ems-boot-overlay');
            sp.innerHTML = '';
        }

        /* If landing still hidden (CSS / race), force it once. */
        if (!isLandingVisible() && !isAppShellUnlocked()) {
            forceShowLoginShell(null);
        }

        if (typeof global.emsScheduleNativeInstantBoot === 'function') {
            global.emsScheduleNativeInstantBoot();
        }
        if (typeof global.emsScheduleDesktopOfflineAutoBoot === 'function') {
            global.emsScheduleDesktopOfflineAutoBoot();
        }
    };

    /**
     * Recover blank UI — never treat splash alone as success.
     * body.ems-locked is normal on the login screen; do NOT re-show splash for that.
     */
    global.emsRecoverBlankBootUi = function () {
        try {
            if (hasRealUiSurface()) {
                if (isAppShellUnlocked() || isLandingVisible()) {
                    clearStuckWatchdog();
                }
                return;
            }

            if (global.emsIsUserAuthenticated() && !isAppShellUnlocked()) {
                global.emsEnsureBootSplashVisible('ایپ لوڈ ہو رہی ہے…');
                global.emsBootMark('blank-boot-splash-restored');
                return;
            }

            forceShowLoginShell(null);
            global.emsBootMark('blank-boot-ui-recovered');
        } catch (eRec) { /* ignore */ }
    };

    global.emsForceShowLoginShell = forceShowLoginShell;
    global.emsClearBootStuckWatchdog = clearStuckWatchdog;

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
            setTimeout(function () { global.emsRecoverBlankBootUi(); }, 500);
            setTimeout(function () { global.emsRecoverBlankBootUi(); }, 2000);
        }
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', deferLoginShell);
        } else {
            global.emsBootMark('dom-already-ready');
            deferLoginShell();
        }
    }
})(typeof window !== 'undefined' ? window : globalThis);
