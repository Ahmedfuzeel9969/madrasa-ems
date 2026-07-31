// ============================================================================
// EMS Login Session Registry — device id + CF registration (Phase 11)
// ============================================================================
(function (global) {
    'use strict';

    var DEVICE_KEY = 'ems_device_id';
    var SESSION_ID_KEY = 'ems_login_session_id';

    global.emsGetDeviceId = function () {
        if (typeof global.emsEnsureDeviceId === 'function') {
            return global.emsEnsureDeviceId();
        }
        try {
            var id = localStorage.getItem(DEVICE_KEY);
            if (!id) {
                id = 'dev-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
                localStorage.setItem(DEVICE_KEY, id);
            }
            return id;
        } catch (e) {
            return 'dev-anon-' + Date.now();
        }
    };

    global.emsGetLoginSessionId = function (user) {
        if (!user || !user.uid) return null;
        try {
            var existing = localStorage.getItem(SESSION_ID_KEY + '_' + user.uid);
            if (existing) return existing;
            var sid = 'sess-' + global.emsGetDeviceId().slice(-12) + '-' + user.uid.slice(0, 8);
            localStorage.setItem(SESSION_ID_KEY + '_' + user.uid, sid);
            return sid;
        } catch (e) {
            return 'sess-' + user.uid.slice(0, 12);
        }
    };

    global.emsRegisterLoginSession = function (user, tenantId) {
        if (!user || !tenantId || typeof global.emsCallFunction !== 'function') {
            return Promise.resolve(false);
        }
        var sessionId = global.emsGetLoginSessionId(user);
        var portal = typeof global.emsGetIntendedPortal === 'function' ? (global.emsGetIntendedPortal() || '') : '';
        return global.emsCallFunction('registerLoginSession', {
            tenantId: tenantId,
            deviceId: global.emsGetDeviceId(),
            sessionId: sessionId,
            portal: portal,
            userAgent: navigator.userAgent || ''
        }).then(function (res) {
            if (res && res.anomalies && res.anomalies > 0 && typeof global.showTopAlert === 'function') {
                global.showTopAlert('Session anomaly detected — admin notified.', true);
            }
            return !!(res && res.ok);
        }).catch(function () { return false; });
    };

    global.emsTouchLoginSession = function (user, tenantId) {
        if (!user || !tenantId || typeof global.emsCallFunction !== 'function') return;
        var sessionId = global.emsGetLoginSessionId(user);
        if (!sessionId) return;
        global.emsCallFunction('touchLoginSession', {
            tenantId: tenantId,
            sessionId: sessionId
        }).then(function (res) {
            if (res && res.revoked && typeof global.logoutUser === 'function') {
                global.showTopAlert && global.showTopAlert('یہ session admin نے revoke کر دیا ہے۔', true);
                global.logoutUser();
            }
        }).catch(function () { });
    };

    if (typeof firebase !== 'undefined' && firebase.auth) {
        setInterval(function () {
            var user = firebase.auth().currentUser;
            if (!user) return;
            var tenantId = typeof global.emsGetTenantId === 'function' ? global.emsGetTenantId() : user.uid;
            global.emsTouchLoginSession(user, tenantId);
        }, 5 * 60 * 1000);
    }
})(window);
