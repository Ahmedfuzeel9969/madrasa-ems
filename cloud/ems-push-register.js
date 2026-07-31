// ============================================================================
// EMS Push Registration — FCM device tokens (Phase 8–9)
// VAPID key loaded from Firestore / getTenantPushConfig (no manual window var).
// ============================================================================
(function (global) {
    'use strict';

    function getTenantId() {
        if (typeof global.emsGetTenantId === 'function') return global.emsGetTenantId();
        var u = typeof firebase !== 'undefined' && firebase.auth ? firebase.auth().currentUser : null;
        return u ? u.uid : null;
    }

    function getPortalRole() {
        if (typeof global.emsGetIntendedPortal === 'function') {
            var p = global.emsGetIntendedPortal();
            if (p === 'parent') return 'parent';
        }
        if (global.CURRENT_USER_TENANT_ROLE === 'parent') return 'parent';
        if (global.CURRENT_MADRASA_DATA && global.CURRENT_MADRASA_DATA.ownerUid) {
            var u = firebase.auth().currentUser;
            if (u && u.uid === global.CURRENT_MADRASA_DATA.ownerUid) return 'owner';
        }
        return null;
    }

    function registerToken(token, role, tenantId) {
        if (!token || !tenantId || typeof global.emsCallFunction !== 'function') {
            return Promise.resolve(false);
        }
        var fn = role === 'parent' ? 'registerParentDeviceToken' : 'registerOwnerDeviceToken';
        return global.emsCallFunction(fn, { tenantId: tenantId, token: token })
            .then(function (res) { return !!(res && res.ok); })
            .catch(function () { return false; });
    }

    global.emsRegisterPushTokenIfAvailable = function () {
        if (typeof firebase === 'undefined' || typeof firebase.messaging !== 'function') {
            return Promise.resolve(false);
        }
        var tenantId = getTenantId();
        var role = getPortalRole();
        if (!tenantId || !role) return Promise.resolve(false);

        var ensureConfig = typeof global.emsEnsureTenantPushConfig === 'function'
            ? global.emsEnsureTenantPushConfig(tenantId)
            : Promise.resolve({ vapidKey: global.EMS_FCM_VAPID_KEY || '', pushEnabled: true });

        return ensureConfig.then(function (cfg) {
            if (cfg && cfg.pushEnabled === false) return false;
            var vapidKey = (cfg && cfg.vapidKey) || global.EMS_FCM_VAPID_KEY || '';
            if (!vapidKey) return false;
            try {
                var messaging = firebase.messaging();
                var swReg = Promise.resolve(null);
                if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
                    swReg = navigator.serviceWorker.register('./firebase-messaging-sw.js').catch(function () {
                        return null;
                    });
                }
                return swReg.then(function (reg) {
                    if (reg && typeof messaging.useServiceWorker === 'function') {
                        messaging.useServiceWorker(reg);
                    }
                    return messaging.getToken({ vapidKey: vapidKey }).then(function (token) {
                        if (!token) return false;
                        return registerToken(token, role, tenantId);
                    });
                }).catch(function () { return false; });
            } catch (e) {
                return false;
            }
        });
    };

    if (typeof firebase !== 'undefined' && firebase.auth) {
        firebase.auth().onAuthStateChanged(function (user) {
            if (!user) return;
            setTimeout(function () {
                global.emsRegisterPushTokenIfAvailable();
            }, 2500);
        });
    }
})(window);
