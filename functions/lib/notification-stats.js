/**
 * Notification delivery stats — admin dashboard (Phase 10)
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');

async function countByStatus(colRef, status) {
    const snap = await colRef.where('deliveryStatus', '==', status).limit(200).get();
    return snap.size;
}

async function getStatsForTenant(db, tenantId) {
    const keyCol = db.collection('All_Madrasas').doc(tenantId).collection('KeyExpiryNotifications');
    const parentCol = db.collection('All_Madrasas').doc(tenantId).collection('ParentPushNotifications');
    const key = {
        queued: await countByStatus(keyCol, 'queued'),
        sent: await countByStatus(keyCol, 'sent'),
        failed: await countByStatus(keyCol, 'failed'),
        inApp: await countByStatus(keyCol, 'in_app_only')
    };
    const parent = {
        queued: await countByStatus(parentCol, 'queued'),
        sent: await countByStatus(parentCol, 'sent'),
        failed: await countByStatus(parentCol, 'failed'),
        inApp: await countByStatus(parentCol, 'in_app_only')
    };
    return {
        keyExpiry: key,
        parentPush: parent,
        totals: {
            queued: key.queued + parent.queued,
            sent: key.sent + parent.sent,
            failed: key.failed + parent.failed,
            inApp: key.inApp + parent.inApp
        }
    };
}

const getNotificationDeliveryStats = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId درکار ہے۔');
    }
    const db = admin.firestore();
    const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    if (!madrasaSnap.exists || madrasaSnap.data().ownerUid !== context.auth.uid) {
        throw new functions.https.HttpsError('permission-denied', 'صرف مالک دیکھ سکتا ہے۔');
    }
    const stats = await getStatsForTenant(db, tenantId);
    return { ok: true, stats: stats };
});

module.exports = {
    countByStatus,
    getStatsForTenant,
    getNotificationDeliveryStats
};
