/**
 * Failed notification retry — dashboard + callable retry (Phase 9)
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const notificationDelivery = require('./notification-delivery');
const parentPush = require('./parent-push');

const MAX_RETRY_ATTEMPTS = 5;

async function listFailedForTenant(db, tenantId, limit) {
    const keySnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('KeyExpiryNotifications')
        .where('deliveryStatus', '==', 'failed')
        .limit(limit)
        .get();
    const parentSnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('ParentPushNotifications')
        .where('deliveryStatus', '==', 'failed')
        .limit(limit)
        .get();

    const items = [];
    keySnap.forEach(function (doc) {
        const d = doc.data() || {};
        items.push({
            id: doc.id,
            type: 'key_expiry',
            channel: d.channel || '',
            targetName: d.targetName || d.targetId || '',
            error: d.deliveryError || '',
            attempts: d.deliveryAttempts || 0,
            updatedAt: d.updatedAt || d.createdAt || 0
        });
    });
    parentSnap.forEach(function (doc) {
        const d = doc.data() || {};
        items.push({
            id: doc.id,
            type: 'parent_push',
            channel: 'push',
            targetName: d.studentName || d.studentId || '',
            error: d.deliveryError || '',
            attempts: d.deliveryAttempts || 0,
            updatedAt: d.updatedAt || d.createdAt || 0
        });
    });
    items.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    return items;
}

async function retryKeyExpiry(db, tenantId, notifyId, now) {
    const ref = db.collection('All_Madrasas').doc(tenantId)
        .collection('KeyExpiryNotifications').doc(notifyId);
    const snap = await ref.get();
    if (!snap.exists) {
        throw new functions.https.HttpsError('not-found', 'Notification نہیں ملی۔');
    }
    const data = snap.data() || {};
    if ((data.deliveryAttempts || 0) >= MAX_RETRY_ATTEMPTS) {
        throw new functions.https.HttpsError('failed-precondition', 'زیادہ کوششیں ہو چکی ہیں۔');
    }
    await ref.set({
        deliveryStatus: 'queued',
        deliveryError: admin.firestore.FieldValue.delete(),
        retryRequestedAt: now,
        updatedAt: now
    }, { merge: true });
    const policySnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('TenantSettings').doc('securityPolicy').get();
    const policy = policySnap.exists ? policySnap.data() : {};
    const result = await notificationDelivery.processKeyExpiryNotification(
        db, tenantId, ref, Object.assign({}, data, { deliveryStatus: 'queued' }), policy, now
    );
    return { ok: true, status: result.status, notifyId: notifyId };
}

async function retryParentPush(db, tenantId, notifyId, now) {
    const ref = db.collection('All_Madrasas').doc(tenantId)
        .collection('ParentPushNotifications').doc(notifyId);
    const snap = await ref.get();
    if (!snap.exists) {
        throw new functions.https.HttpsError('not-found', 'Notification نہیں ملی۔');
    }
    const data = snap.data() || {};
    if ((data.deliveryAttempts || 0) >= MAX_RETRY_ATTEMPTS) {
        throw new functions.https.HttpsError('failed-precondition', 'زیادہ کوششیں ہو چکی ہیں۔');
    }
    const msgSnap = data.messageId
        ? await db.collection('All_Madrasas').doc(tenantId)
            .collection('ParentMessages').doc(data.messageId).get()
        : null;
    const msg = msgSnap && msgSnap.exists ? msgSnap.data() : {
        id: data.messageId,
        studentId: data.studentId,
        studentName: data.studentName,
        direction: 'out',
        format: 'text',
        text: data.body || ''
    };
    const result = await parentPush.redeliverParentPushNotification(db, tenantId, msg, now);
    return { ok: true, status: result.deliveryStatus || 'sent', notifyId: notifyId };
}

async function processRetryableFailed(db, tenantId, policy, now) {
    const snap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('KeyExpiryNotifications')
        .where('deliveryStatus', '==', 'failed')
        .limit(20)
        .get();
    let retried = 0;
    for (let i = 0; i < snap.docs.length; i++) {
        const data = snap.docs[i].data() || {};
        if ((data.deliveryAttempts || 0) >= MAX_RETRY_ATTEMPTS) continue;
        await snap.docs[i].ref.set({ deliveryStatus: 'queued', updatedAt: now }, { merge: true });
        await notificationDelivery.processKeyExpiryNotification(
            db, tenantId, snap.docs[i].ref, Object.assign({}, data, { deliveryStatus: 'queued' }), policy, now
        );
        retried++;
    }
    return retried;
}

const getFailedNotifications = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    const limit = Math.min(Math.max(parseInt(data && data.limit, 10) || 50, 1), 100);
    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId درکار ہے۔');
    }
    const db = admin.firestore();
    const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    const uid = context.auth.uid;
    const isOwner = madrasaSnap.exists && madrasaSnap.data().ownerUid === uid;
    if (!isOwner) {
        throw new functions.https.HttpsError('permission-denied', 'صرف مالک دیکھ سکتا ہے۔');
    }
    const items = await listFailedForTenant(db, tenantId, limit);
    return { items: items, count: items.length };
});

const retryFailedNotification = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    const notifyId = String((data && data.notifyId) || '').trim();
    const type = String((data && data.type) || 'key_expiry').trim();
    if (!tenantId || !notifyId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId اور notifyId درکار ہیں۔');
    }
    const db = admin.firestore();
    const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    if (!madrasaSnap.exists || madrasaSnap.data().ownerUid !== context.auth.uid) {
        throw new functions.https.HttpsError('permission-denied', 'صرف مالک retry کر سکتا ہے۔');
    }
    const now = Date.now();
    if (type === 'parent_push') {
        return retryParentPush(db, tenantId, notifyId, now);
    }
    return retryKeyExpiry(db, tenantId, notifyId, now);
});

const retryAllFailedNotifications = functions.https.onCall(async function (data, context) {
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
        throw new functions.https.HttpsError('permission-denied', 'صرف مالک retry کر سکتا ہے۔');
    }
    const items = await listFailedForTenant(db, tenantId, 50);
    const now = Date.now();
    let succeeded = 0;
    let failed = 0;
    for (let i = 0; i < items.length; i++) {
        try {
            if (items[i].type === 'parent_push') {
                await retryParentPush(db, tenantId, items[i].id, now);
            } else {
                await retryKeyExpiry(db, tenantId, items[i].id, now);
            }
            succeeded++;
        } catch (e) {
            failed++;
        }
    }
    return { ok: true, total: items.length, succeeded: succeeded, failed: failed };
});

module.exports = {
    MAX_RETRY_ATTEMPTS,
    listFailedForTenant,
    retryKeyExpiry,
    retryParentPush,
    processRetryableFailed,
    getFailedNotifications,
    retryFailedNotification,
    retryAllFailedNotifications
};
