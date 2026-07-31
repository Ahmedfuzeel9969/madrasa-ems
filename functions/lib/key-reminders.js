/**
 * Key rotation reminders — scheduled alerts for expiring access keys (Phase 6)
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const logger = require('./logger');
const { scanTenantKeyExpiry } = require('./access-key-expiry');

function alertDocId(item, dateKey) {
    return item.type + '-' + item.id + '-' + dateKey;
}

async function materializeAlertsForTenant(db, tenantId, items, dateKey, now) {
    let created = 0;
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const id = alertDocId(item, dateKey);
        const ref = db.collection('All_Madrasas').doc(tenantId).collection('KeyExpiryAlerts').doc(id);
        const existing = await ref.get();
        if (existing.exists && existing.data().dismissed) continue;
        await ref.set({
            id: id,
            type: item.type,
            targetId: item.id,
            name: item.name || item.id,
            status: item.status,
            expiresAt: item.expiresAt || null,
            daysLeft: item.daysLeft,
            dismissed: false,
            dateKey: dateKey,
            createdAt: now,
            updatedAt: now
        }, { merge: true });
        created++;
    }
    return created;
}

async function runKeyRotationReminders(now) {
    const db = admin.firestore();
    const dateKey = new Date(now).toISOString().split('T')[0];
    const totals = { tenants: 0, alerts: 0, scanned: 0 };

    const madrasaSnap = await db.collection('All_Madrasas').get();
    for (let i = 0; i < madrasaSnap.docs.length; i++) {
        const tenantId = madrasaSnap.docs[i].id;
        const policySnap = await db.collection('All_Madrasas').doc(tenantId)
            .collection('TenantSettings').doc('securityPolicy').get();
        const policy = policySnap.exists ? policySnap.data() : {};
        if (policy.enableKeyExpiryAlerts === false) continue;

        totals.scanned++;
        const items = await scanTenantKeyExpiry(tenantId, now);
        if (!items.length) continue;
        const n = await materializeAlertsForTenant(db, tenantId, items, dateKey, now);
        const keyNotifications = require('./key-notifications');
        const notifyResult = await keyNotifications.dispatchKeyExpiryNotifications(
            db, tenantId, items, policy, dateKey, now
        );
        if (n > 0 || (notifyResult && notifyResult.queued)) {
            totals.tenants++;
            totals.alerts += n;
            totals.notifications = (totals.notifications || 0) + (notifyResult.queued || 0);
        }
    }
    return totals;
}

const scheduledKeyRotationReminders = functions.pubsub.schedule('every 24 hours').onRun(async function () {
    try {
        const totals = await runKeyRotationReminders(Date.now());
        if (totals.alerts > 0) {
            await logger.audit({
                action: 'keyReminders.scheduled',
                actorUid: 'system',
                actorEmail: 'system',
                meta: totals
            });
        }
    } catch (err) {
        await logger.logError('scheduledKeyRotationReminders', err, {});
    }
    return null;
});

/**
 * Callable — fetch active key expiry alerts for admin
 * data = { tenantId, includeDismissed? }
 */
const getKeyExpiryAlerts = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId درکار ہے۔');
    }

    const db = admin.firestore();
    const uid = context.auth.uid;
    const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    const isOwner = madrasaSnap.exists && madrasaSnap.data().ownerUid === uid;
    const staffLink = await db.collection('All_Madrasas').doc(tenantId)
        .collection('Staff_Links').doc(uid).get();
    const isStaff = staffLink.exists && staffLink.data().status === 'active';
    if (!isOwner && !isStaff) {
        throw new functions.https.HttpsError('permission-denied', 'رسائی نہیں۔');
    }

    const snap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('KeyExpiryAlerts').orderBy('updatedAt', 'desc').limit(100).get();
    const alerts = [];
    snap.forEach(function (doc) {
        const a = doc.data();
        if (!data || !data.includeDismissed) {
            if (a.dismissed) return;
        }
        alerts.push(a);
    });
    return { alerts: alerts, count: alerts.length };
});

/**
 * Callable — dismiss alert
 * data = { tenantId, alertId }
 */
const dismissKeyExpiryAlert = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    const alertId = String((data && data.alertId) || '').trim();
    if (!tenantId || !alertId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId اور alertId درکار ہیں۔');
    }

    const db = admin.firestore();
    const uid = context.auth.uid;
    const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    const isOwner = madrasaSnap.exists && madrasaSnap.data().ownerUid === uid;
    if (!isOwner) {
        throw new functions.https.HttpsError('permission-denied', 'صرف مالک alert dismiss کر سکتا ہے۔');
    }

    await db.collection('All_Madrasas').doc(tenantId)
        .collection('KeyExpiryAlerts').doc(alertId)
        .set({
            dismissed: true,
            dismissedAt: Date.now(),
            dismissedBy: context.auth.token.email || uid
        }, { merge: true });
    return { ok: true };
});

module.exports = {
    alertDocId,
    materializeAlertsForTenant,
    runKeyRotationReminders,
    scheduledKeyRotationReminders,
    getKeyExpiryAlerts,
    dismissKeyExpiryAlert
};
