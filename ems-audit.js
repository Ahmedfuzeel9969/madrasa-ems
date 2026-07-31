// ============================================================================
// EMS Unified Audit — tenant-scoped business action log (Phase 3)
// Collection: All_Madrasas/{tenantId}/EmsAudit
// ============================================================================
(function (global) {
    'use strict';

    function getDb() {
        return typeof global.getDbOrNull === 'function' ? global.getDbOrNull() : null;
    }

    function getTenantId() {
        if (global.emsGetTenantId) return global.emsGetTenantId();
        if (global.CURRENT_MADRASA_TENANT_ID) return global.CURRENT_MADRASA_TENANT_ID;
        if (typeof firebase !== 'undefined' && firebase.auth) {
            var u = firebase.auth().currentUser;
            return u ? u.uid : null;
        }
        return null;
    }

    /**
     * @param {string} module - admission|finance|exams|complaints|...
     * @param {string} action - create|edit|delete|approve|...
     * @param {string} entityId - affected record id
     * @param {Object} details - extra context (non-PII preferred)
     */
    global.emsLogAudit = function (module, action, entityId, details) {
        if (typeof firebase === 'undefined' || !firebase.auth || !firebase.firestore) {
            return Promise.resolve({ skipped: true, reason: 'offline' });
        }
        var db = getDb();
        var user = firebase.auth().currentUser;
        var tenantId = getTenantId();
        if (!db || !user || !tenantId || !module || !action) {
            return Promise.resolve({ skipped: true });
        }

        var payload = {
            module: String(module).substring(0, 40),
            action: String(action).substring(0, 40),
            entityId: entityId ? String(entityId).substring(0, 120) : '',
            details: details && typeof details === 'object' ? details : {},
            uid: user.uid,
            email: user.email || '',
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            clientTs: Date.now()
        };

        return db.collection('All_Madrasas').doc(tenantId).collection('EmsAudit')
            .add(payload)
            .then(function (ref) { return { id: ref.id }; })
            .catch(function (err) {
                console.warn('EmsAudit write failed:', err && err.message);
                return { error: err && err.message };
            });
    };

})(window);
