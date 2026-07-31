// ============================================================================
// EMS Tenant Notification Delivery Settings (Phase 9)
// Path: All_Madrasas/{tenantId}/TenantSettings/notificationDelivery
// ============================================================================
(function (global) {
    'use strict';

    function getDb() {
        return typeof global.getDbOrNull === 'function' ? global.getDbOrNull() : null;
    }

    global.emsLoadTenantNotificationDelivery = function (madrasaId) {
        var db = getDb();
        if (!db || !madrasaId) {
            return Promise.resolve({ fcmVapidKey: '' });
        }
        return db.collection('All_Madrasas').doc(madrasaId)
            .collection('TenantSettings').doc('notificationDelivery').get()
            .then(function (doc) {
                var data = doc.exists ? doc.data() : {};
                var out = {
                    fcmVapidKey: String(data.fcmVapidKey || '').trim()
                };
                global.EMS_TENANT_NOTIFICATION_DELIVERY = out;
                if (out.fcmVapidKey) global.EMS_FCM_VAPID_KEY = out.fcmVapidKey;
                return out;
            })
            .catch(function () {
                return { fcmVapidKey: '' };
            });
    };

    global.emsSaveTenantNotificationDelivery = function (madrasaId, patch) {
        var db = getDb();
        if (!db || !madrasaId) return Promise.reject(new Error('tenantId درکار ہے'));
        var vapidKey = String((patch && patch.fcmVapidKey) || '').trim();
        return db.collection('All_Madrasas').doc(madrasaId)
            .collection('TenantSettings').doc('notificationDelivery')
            .set({
                fcmVapidKey: vapidKey,
                updatedAt: Date.now(),
                updatedBy: (firebase.auth().currentUser && firebase.auth().currentUser.email) || 'admin'
            }, { merge: true })
            .then(function () {
                global.EMS_TENANT_NOTIFICATION_DELIVERY = { fcmVapidKey: vapidKey };
                if (vapidKey) global.EMS_FCM_VAPID_KEY = vapidKey;
                return { fcmVapidKey: vapidKey };
            });
    };

    global.emsEnsureTenantPushConfig = function (tenantId) {
        if (global.EMS_FCM_VAPID_KEY) {
            return Promise.resolve({ vapidKey: global.EMS_FCM_VAPID_KEY, pushEnabled: true });
        }
        if (typeof global.emsCallFunction === 'function' && tenantId) {
            return global.emsCallFunction('getTenantPushConfig', { tenantId: tenantId }).then(function (res) {
                if (res && res.vapidKey) global.EMS_FCM_VAPID_KEY = res.vapidKey;
                return res || { vapidKey: '', pushEnabled: false };
            }).catch(function () {
                return global.emsLoadTenantNotificationDelivery(tenantId).then(function (d) {
                    return { vapidKey: d.fcmVapidKey || '', pushEnabled: !!d.fcmVapidKey };
                });
            });
        }
        return global.emsLoadTenantNotificationDelivery(tenantId).then(function (d) {
            return { vapidKey: d.fcmVapidKey || '', pushEnabled: !!d.fcmVapidKey };
        });
    };

})(window);
