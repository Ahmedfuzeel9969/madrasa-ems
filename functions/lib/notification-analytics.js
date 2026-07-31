/**
 * Notification analytics — daily rollup + 7-day dashboard (Phase 11)
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');

function dateKeyFromMs(ms) {
    return new Date(ms).toISOString().split('T')[0];
}

async function countUpdatedInRange(colRef, dayStart, dayEnd) {
    const statuses = ['sent', 'failed', 'queued', 'in_app_only'];
    const out = { sent: 0, failed: 0, queued: 0, inApp: 0 };
    for (let i = 0; i < statuses.length; i++) {
        const st = statuses[i];
        const snap = await colRef.where('deliveryStatus', '==', st).limit(200).get();
        snap.forEach(function (doc) {
            const d = doc.data() || {};
            const ts = d.updatedAt || d.createdAt || 0;
            if (ts >= dayStart && ts < dayEnd) {
                if (st === 'in_app_only') out.inApp++;
                else if (st === 'sent') out.sent++;
                else if (st === 'failed') out.failed++;
                else out.queued++;
            }
        });
    }
    return out;
}

async function rollupTenantDay(db, tenantId, dateKey, now) {
    const dayStart = new Date(dateKey + 'T00:00:00.000Z').getTime();
    const dayEnd = dayStart + 86400000;
    const keyCol = db.collection('All_Madrasas').doc(tenantId).collection('KeyExpiryNotifications');
    const parentCol = db.collection('All_Madrasas').doc(tenantId).collection('ParentPushNotifications');
    const keyExpiry = await countUpdatedInRange(keyCol, dayStart, dayEnd);
    const parentPush = await countUpdatedInRange(parentCol, dayStart, dayEnd);
    const payload = {
        dateKey: dateKey,
        keyExpiry: keyExpiry,
        parentPush: parentPush,
        totals: {
            sent: keyExpiry.sent + parentPush.sent,
            failed: keyExpiry.failed + parentPush.failed,
            queued: keyExpiry.queued + parentPush.queued,
            inApp: keyExpiry.inApp + parentPush.inApp
        },
        updatedAt: now
    };
    await db.collection('All_Madrasas').doc(tenantId)
        .collection('NotificationAnalyticsDaily').doc(dateKey)
        .set(payload, { merge: true });
    return payload;
}

async function runDailyAnalytics(now) {
    const db = admin.firestore();
    const dateKey = dateKeyFromMs(now);
    const totals = { tenants: 0 };
    const madrasaSnap = await db.collection('All_Madrasas').get();
    for (let i = 0; i < madrasaSnap.docs.length; i++) {
        const tenantId = madrasaSnap.docs[i].id;
        try {
            await rollupTenantDay(db, tenantId, dateKey, now);
            totals.tenants++;
        } catch (err) {
            console.error('analytics rollup', tenantId, err.message);
        }
    }
    return totals;
}

const scheduledNotificationAnalytics = functions.pubsub.schedule('every 24 hours').onRun(async function () {
    try {
        await runDailyAnalytics(Date.now());
    } catch (err) {
        console.error('scheduledNotificationAnalytics', err);
    }
    return null;
});

const getNotificationAnalytics = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    const days = Math.min(Math.max(parseInt(data && data.days, 10) || 7, 1), 30);
    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId درکار ہے۔');
    }
    const db = admin.firestore();
    const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    if (!madrasaSnap.exists || madrasaSnap.data().ownerUid !== context.auth.uid) {
        throw new functions.https.HttpsError('permission-denied', 'صرف مالک analytics دیکھ سکتا ہے۔');
    }
    const snap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('NotificationAnalyticsDaily')
        .orderBy('dateKey', 'desc')
        .limit(days)
        .get();
    const rows = [];
    snap.forEach(function (doc) {
        rows.push(doc.data());
    });
    rows.sort(function (a, b) { return (a.dateKey || '').localeCompare(b.dateKey || ''); });
    return { days: rows, count: rows.length };
});

module.exports = {
    dateKeyFromMs,
    countUpdatedInRange,
    rollupTenantDay,
    runDailyAnalytics,
    scheduledNotificationAnalytics,
    getNotificationAnalytics
};
