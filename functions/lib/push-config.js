/**
 * Push config — VAPID key for authenticated parent/owner (Phase 9)
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');

async function assertParentOrOwner(db, tenantId, uid) {
    const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    if (madrasaSnap.exists && madrasaSnap.data().ownerUid === uid) return 'owner';
    const linkSnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('Parent_Links').doc(uid).get();
    if (linkSnap.exists && linkSnap.data().status === 'active') return 'parent';
    throw new functions.https.HttpsError('permission-denied', 'رسائی نہیں۔');
}

const getTenantPushConfig = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId درکار ہے۔');
    }
    const db = admin.firestore();
    await assertParentOrOwner(db, tenantId, context.auth.uid);

    const policySnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('TenantSettings').doc('securityPolicy').get();
    const policy = policySnap.exists ? policySnap.data() : {};
    const deliverySnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('TenantSettings').doc('notificationDelivery').get();
    const delivery = deliverySnap.exists ? deliverySnap.data() : {};

    return {
        vapidKey: String(delivery.fcmVapidKey || '').trim(),
        pushEnabled: policy.enablePushDelivery !== false
    };
});

module.exports = {
    assertParentOrOwner,
    getTenantPushConfig
};
