// ============================================================================
// EMS Tenant Context — Staff_Links + Parent_Links multi-login (Phase 3)
// Phase 0: link activation via Cloud Function activateTenantLink (server-side)
// ============================================================================
(function (global) {
    'use strict';

    global.CURRENT_MADRASA_TENANT_ID = null;
    global.CURRENT_USER_TENANT_ROLE = null; // owner | staff | parent
    global.CURRENT_STAFF_LINK = null;
    global.CURRENT_PARENT_LINK = null;

    function getDb() {
        return typeof global.getDbOrNull === 'function' ? global.getDbOrNull() : null;
    }

    function normalizeEmail(email) {
        return (email || '').toLowerCase().trim();
    }

    /** Server-side link resolution via resolveTenantLink Cloud Function (TI-01) */
    function queryLinkCollection(collectionName, user) {
        if (typeof global.emsCallFunction !== 'function') {
            return Promise.resolve(null);
        }
        return global.emsCallFunction('resolveTenantLink', { collection: collectionName })
            .then(function (data) {
                if (!data || !data.tenantId) return null;
                return {
                    tenantId: data.tenantId,
                    role: data.role || (collectionName === 'Parent_Links' ? 'parent' : 'staff'),
                    link: data.link || {}
                };
            })
            .catch(function (err) {
                console.warn('resolveTenantLink failed:', collectionName, err && err.message);
                return null;
            });
    }

    /** Owner profile exists? */
    function checkOwnerProfile(user, firestore) {
        return firestore.collection('All_Madrasas').doc(user.uid).get()
            .then(function (doc) {
                if (doc.exists && doc.data().madrasaName) {
                    return { tenantId: user.uid, role: 'owner', profileDoc: doc };
                }
                return null;
            });
    }

    /**
     * Resolve tenant: owner > staff link > parent link
     * When intendedPortal is teacher/parent, prefer matching link over owner profile.
     * @returns Promise<{tenantId, role, link?, profileDoc?}|null>
     */
    global.emsResolveTenantContext = function (user, firestore, options) {
        options = options || {};
        var intendedPortal = options.intendedPortal;
        if (intendedPortal == null && typeof global.emsGetIntendedPortal === 'function') {
            intendedPortal = global.emsGetIntendedPortal();
        }

        if (!user || !firestore) return Promise.resolve(null);
        if (intendedPortal === 'guest') {
            var demoId = typeof global.emsBuildDemoTenantId === 'function'
                ? global.emsBuildDemoTenantId(user.uid)
                : ('demo_guest_' + user.uid);
            return Promise.resolve({
                tenantId: demoId,
                role: 'owner',
                isDemo: true
            });
        }
        if (global.isSuperAdminUser && global.isSuperAdminUser(user)) {
            return Promise.resolve({ tenantId: user.uid, role: 'owner', isSuperAdmin: true });
        }

        if (intendedPortal === 'teacher') {
            return queryLinkCollection('Staff_Links', user);
        }

        if (intendedPortal === 'parent') {
            return queryLinkCollection('Parent_Links', user);
        }

        return checkOwnerProfile(user, firestore)
            .then(function (ownerCtx) {
                if (ownerCtx) return ownerCtx;
                return queryLinkCollection('Staff_Links', user);
            })
            .then(function (ctx) {
                if (ctx) return ctx;
                return queryLinkCollection('Parent_Links', user);
            });
    };

    global.emsGetTenantId = function () {
        return global.CURRENT_MADRASA_TENANT_ID || null;
    };

    global.emsClearTenantContext = function (options) {
        options = options || {};
        global.EMS_TENANT_TRANSITION_IN_PROGRESS = true;
        global.EMS_TENANT_GENERATION = (Number(global.EMS_TENANT_GENERATION) || 0) + 1;
        global.EMS_TENANT_STORAGE_READY = false;
        if (typeof global.emsStopAttendanceSync === 'function') {
            try { global.emsStopAttendanceSync(); } catch (eStop) { /* ignore */ }
        }
        global.CURRENT_MADRASA_TENANT_ID = null;
        global.CURRENT_USER_TENANT_ROLE = null;
        global.CURRENT_STAFF_LINK = null;
        global.CURRENT_PARENT_LINK = null;
        global.EMS_ACTIVE_TENANT_ID = null;
        global.EMS_TENANT_TRANSITION_IN_PROGRESS = false;
        if (options.preserveOfflineCache === true) return;
        if (typeof global.emsClearPersistedBootTenantId === 'function') {
            global.emsClearPersistedBootTenantId();
        }
        if (typeof global.emsClearOfflineSession === 'function') {
            global.emsClearOfflineSession();
        }
    };

    /** Admin: staff account link (pending until staff logs in) */
    global.emsCreateStaffLink = function (madrasaId, staffId, email) {
        var db = getDb();
        email = normalizeEmail(email);
        if (!db || !madrasaId || !staffId || !email) {
            return Promise.reject(new Error('مکمل معلومات درج کریں'));
        }
        return db.collection('All_Madrasas').doc(madrasaId).collection('Staff_Links')
            .doc('pending_' + staffId)
            .set({
                staffId: staffId,
                email: email,
                authUid: '',
                status: 'pending',
                createdAt: Date.now(),
                createdBy: (firebase.auth().currentUser && firebase.auth().currentUser.email) || 'admin'
            }, { merge: true });
    };

    /** Admin: parent account link */
    global.emsCreateParentLink = function (madrasaId, studentId, email) {
        var db = getDb();
        email = normalizeEmail(email);
        if (!db || !madrasaId || !studentId || !email) {
            return Promise.reject(new Error('مکمل معلومات درج کریں'));
        }
        return db.collection('All_Madrasas').doc(madrasaId).collection('Parent_Links')
            .doc('pending_' + studentId)
            .set({
                studentIds: [studentId],
                email: email,
                authUid: '',
                status: 'pending',
                createdAt: Date.now()
            }, { merge: true });
    };

    global.emsGetLinkedStudentIds = function () {
        if (global.CURRENT_PARENT_LINK && global.CURRENT_PARENT_LINK.studentIds) {
            return global.CURRENT_PARENT_LINK.studentIds;
        }
        if (global.CURRENT_PARENT_LINK && global.CURRENT_PARENT_LINK.studentId) {
            return [global.CURRENT_PARENT_LINK.studentId];
        }
        return [];
    };

})(window);
