// ============================================================================
// EMS Device Identity — stable UUID per installation (Phase 1)
// Upgrades legacy dev-{timestamp}-{random} ids without breaking sessions.
// ============================================================================
(function (global) {
    'use strict';

    var DEVICE_KEY = 'ems_device_id';
    var DEVICE_UUID_KEY = 'ems_device_uuid';

    function randomUuid() {
        if (global.crypto && typeof global.crypto.randomUUID === 'function') {
            return global.crypto.randomUUID();
        }
        var s = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0;
            var v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
        return s;
    }

    function platformTag() {
        var ua = (global.navigator && global.navigator.userAgent) || '';
        if (/Android/i.test(ua)) return 'android';
        if (/Windows/i.test(ua)) return 'desktop';
        if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
        if (/Macintosh|Mac OS/i.test(ua)) return 'desktop';
        return 'web';
    }

    global.emsEnsureDeviceId = function () {
        try {
            var uuid = localStorage.getItem(DEVICE_UUID_KEY);
            if (!uuid) {
                uuid = platformTag() + '-' + randomUuid();
                localStorage.setItem(DEVICE_UUID_KEY, uuid);
            }
            var legacy = localStorage.getItem(DEVICE_KEY);
            if (!legacy || legacy.indexOf('dev-') === 0) {
                localStorage.setItem(DEVICE_KEY, uuid);
            }
            return uuid;
        } catch (e) {
            return platformTag() + '-anon-' + Date.now();
        }
    };

    global.emsGetStableDeviceId = function () {
        return global.emsEnsureDeviceId();
    };

    global.emsGetDevicePlatform = platformTag;

    /** Backward-compatible alias used across the app. */
    global.emsEnsureDeviceId();
})(typeof window !== 'undefined' ? window : globalThis);
