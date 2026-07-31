// ============================================================================
// EMS Offline Mode — browser/PWA vs installed app detection (Phase 1 + 5)
// ============================================================================
(function (global) {
    'use strict';

    var MODES = { BROWSER: 'browser', INSTALLED: 'installed' };
    var cachedMode = null;

    function isCapacitorNative() {
        try {
            if (global.Capacitor && typeof global.Capacitor.isNativePlatform === 'function') {
                return global.Capacitor.isNativePlatform();
            }
            if (global.Capacitor && global.Capacitor.getPlatform) {
                var p = global.Capacitor.getPlatform();
                return p === 'android' || p === 'ios';
            }
        } catch (e) { /* ignore */ }
        return false;
    }

    function detectInstalled() {
        try {
            if (global.emsDesktop && global.emsDesktop.isDesktop) return true;
            if (isCapacitorNative()) return true;
            if (global.location && global.location.search) {
                if (global.location.search.indexOf('desktop=1') >= 0) return true;
                if (global.location.search.indexOf('android=1') >= 0) return true;
            }
            if (global.matchMedia && global.matchMedia('(display-mode: standalone)').matches) return true;
            if (global.matchMedia && global.matchMedia('(display-mode: minimal-ui)').matches) return true;
            if (global.matchMedia && global.matchMedia('(display-mode: window-controls-overlay)').matches) return true;
            if (global.navigator && global.navigator.standalone === true) return true;
            if (document.referrer && document.referrer.indexOf('android-app://') === 0) return true;
            if (global.navigator && global.navigator.userAgent && global.navigator.userAgent.indexOf('EMS-Desktop') >= 0) return true;
        } catch (e) { /* ignore */ }
        return false;
    }

    global.emsIsDesktopApp = function () {
        return !!(global.emsDesktop && global.emsDesktop.isDesktop);
    };

    global.emsIsAndroidApp = function () {
        return isCapacitorNative() && global.Capacitor.getPlatform && global.Capacitor.getPlatform() === 'android';
    };

    global.emsGetOfflineMode = function () {
        if (cachedMode) return cachedMode;
        cachedMode = detectInstalled() ? MODES.INSTALLED : MODES.BROWSER;
        return cachedMode;
    };

    global.emsIsInstalledApp = function () {
        return global.emsGetOfflineMode() === MODES.INSTALLED;
    };

    global.emsIsBrowserMode = function () {
        return global.emsGetOfflineMode() === MODES.BROWSER;
    };

    global.emsRefreshOfflineMode = function () {
        cachedMode = null;
        return global.emsGetOfflineMode();
    };

    if (typeof global.addEventListener === 'function') {
        global.addEventListener('appinstalled', function () {
            global.emsRefreshOfflineMode();
            if (typeof global.emsHybridSyncOnModeChange === 'function') {
                global.emsHybridSyncOnModeChange('installed');
            }
        });
    }
})(typeof window !== 'undefined' ? window : globalThis);
