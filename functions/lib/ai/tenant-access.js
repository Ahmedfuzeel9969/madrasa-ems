'use strict';

const admin = require('firebase-admin');
const functions = require('firebase-functions');

/**
 * Tenant staff gate — owner OR active Staff_Links.
 * Parents are explicitly denied in Phase 1.
 */
async function assertTenantStaffAccess(context, tenantId) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId لازمی ہے۔');
    }

    var db = admin.firestore();
    var madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    if (!madrasaSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'ادارہ نہیں ملا۔');
    }

    var uid = context.auth.uid;
    var ownerUid = madrasaSnap.data().ownerUid || tenantId;

    if (uid === ownerUid || uid === tenantId) {
        return { role: 'owner', uid: uid };
    }

    var staffSnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('Staff_Links').doc(uid).get();
    if (staffSnap.exists && staffSnap.data().status === 'active') {
        return { role: 'staff', uid: uid, staffId: staffSnap.data().staffId || '' };
    }

    var parentSnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('Parent_Links').doc(uid).get();
    if (parentSnap.exists && parentSnap.data().status === 'active') {
        throw new functions.https.HttpsError(
            'permission-denied',
            'والدین پورٹل کے لیے AI Assistant Phase 1 میں دستیاب نہیں۔'
        );
    }

    throw new functions.https.HttpsError('permission-denied', 'AI Assistant: اجازت نہیں۔');
}

module.exports = { assertTenantStaffAccess: assertTenantStaffAccess };
