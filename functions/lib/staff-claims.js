/**
 * Sync staff custom claims from StaffPermissions (Phase 5)
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');

async function syncStaffClaimsForUser(uid, tenantId) {
    const db = admin.firestore();
    const userRecord = await admin.auth().getUser(uid);
    const prev = userRecord.customClaims || {};

    if (!tenantId) {
        await admin.auth().setCustomUserClaims(uid, Object.assign({}, prev, {
            staffTenantId: null,
            staffId: null,
            staffModules: []
        }));
        return { synced: false, reason: 'no_tenant' };
    }

    const linkSnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('Staff_Links').doc(uid).get();

    if (!linkSnap.exists || linkSnap.data().status !== 'active') {
        await admin.auth().setCustomUserClaims(uid, Object.assign({}, prev, {
            staffTenantId: null,
            staffId: null,
            staffModules: []
        }));
        return { synced: false, reason: 'no_active_link' };
    }

    const staffId = String(linkSnap.data().staffId || '').trim();
    if (!staffId) {
        throw new functions.https.HttpsError(
            'failed-precondition',
            'Staff Link میں staffId نہیں — Admin Panel سے دوبارہ link کریں۔'
        );
    }

    const permSnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('StaffPermissions').doc(staffId).get();

    const modules = [];
    if (permSnap.exists && permSnap.data().modules) {
        Object.keys(permSnap.data().modules).forEach(function (k) {
            if (permSnap.data().modules[k] === true) modules.push(k);
        });
    }

    await admin.auth().setCustomUserClaims(uid, Object.assign({}, prev, {
        staffTenantId: tenantId,
        staffId: staffId,
        staffModules: modules.slice(0, 12)
    }));

    return { synced: true, tenantId: tenantId, staffId: staffId, modules: modules };
}

const syncStaffClaims = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId درکار ہے۔');
    }
    return syncStaffClaimsForUser(context.auth.uid, tenantId);
});

/** Admin: push claims for a linked staff member after permission change */
const syncStaffClaimsForMember = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    const targetUid = String((data && data.targetUid) || '').trim();
    if (!tenantId || !targetUid) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId اور targetUid درکار ہیں۔');
    }

    const db = admin.firestore();
    const isOwner = context.auth.uid === tenantId;
    if (!isOwner) {
        const saSnap = await db.collection('SuperAdmins').doc(context.auth.uid).get();
        if (!saSnap.exists) {
            throw new functions.https.HttpsError('permission-denied', 'صرف owner یا Super Admin۔');
        }
    }

    const linkSnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('Staff_Links').doc(targetUid).get();
    if (!linkSnap.exists || linkSnap.data().status !== 'active') {
        return { synced: false, reason: 'no_active_link' };
    }

    return syncStaffClaimsForUser(targetUid, tenantId);
});

const pingBackend = functions.https.onCall(async () => {
    return { ok: true, ts: Date.now(), version: '20260620p3' };
});

module.exports = {
    syncStaffClaims,
    syncStaffClaimsForMember,
    syncStaffClaimsForUser,
    pingBackend
};
