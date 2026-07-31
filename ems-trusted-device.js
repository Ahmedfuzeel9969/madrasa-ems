// ============================================================================
// EMS Trusted Device client helpers (Phase 12)
// ============================================================================
(function (global) {
    'use strict';

    global.emsCheckTrustedDevice = function (tenantId, user, portal) {
        if (!tenantId || !user || typeof global.emsCallFunction !== 'function') {
            return Promise.resolve({ trusted: true, status: 'skip' });
        }
        var deviceId = typeof global.emsGetDeviceId === 'function' ? global.emsGetDeviceId() : '';
        if (!deviceId) return Promise.resolve({ trusted: true, status: 'no_device' });
        var p = portal || (typeof global.emsGetIntendedPortal === 'function' ? (global.emsGetIntendedPortal() || 'teacher') : 'teacher');
        return global.emsCallFunction('checkTrustedDevice', {
            tenantId: tenantId,
            deviceId: deviceId,
            portal: p
        }).catch(function () {
            return { trusted: true, status: 'cf_error' };
        });
    };

    global.emsRequestTrustedDevice = function (tenantId, user) {
        if (!tenantId || !user || typeof global.emsCallFunction !== 'function') {
            return Promise.resolve(false);
        }
        var portal = typeof global.emsGetIntendedPortal === 'function' ? (global.emsGetIntendedPortal() || '') : '';
        return global.emsCallFunction('requestTrustedDevice', {
            tenantId: tenantId,
            deviceId: global.emsGetDeviceId(),
            portal: portal,
            userAgent: navigator.userAgent || ''
        }).then(function (res) {
            return !!(res && res.ok);
        }).catch(function () { return false; });
    };
})(window);
