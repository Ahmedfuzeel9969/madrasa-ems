// ============================================================================
// EMS Status Bar — Capacitor Android (Phase 0 mobile shell hygiene)
// ============================================================================
(function (global) {
    'use strict';

    function isNativeAndroid() {
        try {
            if (global.Capacitor && typeof global.Capacitor.getPlatform === 'function') {
                return global.Capacitor.getPlatform() === 'android'
                    && global.Capacitor.isNativePlatform
                    && global.Capacitor.isNativePlatform();
            }
        } catch (e) { /* ignore */ }
        return false;
    }

    function getStatusBar() {
        try {
            if (global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.StatusBar) {
                return global.Capacitor.Plugins.StatusBar;
            }
            if (global.Capacitor && typeof global.Capacitor.registerPlugin === 'function') {
                return global.Capacitor.registerPlugin('StatusBar');
            }
        } catch (e2) { /* ignore */ }
        return null;
    }

    /**
     * @param {'landing'|'app'} mode
     */
    global.emsApplyStatusBar = function (mode) {
        if (!isNativeAndroid()) return Promise.resolve(false);
        var StatusBar = getStatusBar();
        if (!StatusBar) return Promise.resolve(false);
        var bg = mode === 'app' ? '#2c3e50' : '#0f172a';
        var style = 'DARK'; // light icons on dark bg
        var chain = Promise.resolve();
        if (typeof StatusBar.setOverlaysWebView === 'function') {
            chain = chain.then(function () {
                return StatusBar.setOverlaysWebView({ overlay: false });
            });
        }
        if (typeof StatusBar.setBackgroundColor === 'function') {
            chain = chain.then(function () {
                return StatusBar.setBackgroundColor({ color: bg });
            });
        }
        if (typeof StatusBar.setStyle === 'function') {
            chain = chain.then(function () {
                return StatusBar.setStyle({ style: style });
            });
        }
        if (typeof StatusBar.show === 'function') {
            chain = chain.then(function () {
                return StatusBar.show();
            });
        }
        return chain.then(function () { return true; }).catch(function (err) {
            console.warn('[EMS:statusbar]', err && err.message ? err.message : err);
            return false;
        });
    };

    function boot() {
        if (!isNativeAndroid()) return;
        var onLanding = !!(global.document && global.document.getElementById('ems-landing')
            && global.document.getElementById('ems-landing').offsetParent !== null
            && !(global.document.body && global.document.body.classList.contains('ems-authenticated')));
        global.emsApplyStatusBar(onLanding ? 'landing' : 'app');
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () {
                setTimeout(boot, 300);
            });
        } else {
            setTimeout(boot, 300);
        }
    }

    try {
        global.addEventListener('ems:native-instant-boot-ready', function () {
            global.emsApplyStatusBar('app');
        });
    } catch (e3) { /* ignore */ }
})(typeof window !== 'undefined' ? window : globalThis);
