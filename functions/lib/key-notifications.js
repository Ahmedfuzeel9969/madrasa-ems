/**
 * Key expiry notifications — Firestore queue + in-app admin alert (Phase 7)
 * Email delivery hooks when SMTP is configured later; always writes audit trail.
 */
const admin = require('firebase-admin');
const logger = require('./logger');

function buildNotificationBody(item) {
    const label = item.type === 'teacher' ? 'استاد' : 'والد';
    const status = item.status === 'expired' ? 'ختم ہو چکی ہے' : (item.daysLeft + ' دن میں ختم ہوگی');
    return label + ' Access Key (' + (item.name || item.id) + ') — ' + status;
}

async function dispatchKeyExpiryNotifications(db, tenantId, items, policy, dateKey, now) {
    if (!items.length) return { queued: 0 };
    if (policy.enableKeyExpiryAlerts === false) return { queued: 0 };

    const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    const madrasa = madrasaSnap.exists ? madrasaSnap.data() : {};
    const ownerEmail = madrasa.ownerEmail || madrasa.adminEmail || madrasa.email || '';
    const notifyEmail = policy.notifyOwnerOnKeyExpiry !== false && !!ownerEmail;
    let queued = 0;

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const notifyId = 'notify-' + item.type + '-' + item.id + '-' + dateKey;
        const body = buildNotificationBody(item);
        const payload = {
            id: notifyId,
            tenantId: tenantId,
            type: item.type,
            targetId: item.id,
            targetName: item.name || item.id,
            status: item.status,
            daysLeft: item.daysLeft,
            channel: notifyEmail ? 'email_queue' : 'in_app',
            to: notifyEmail ? ownerEmail : '',
            subject: 'EMS Access Key Reminder — ' + (item.name || item.id),
            body: body,
            deliveryStatus: 'queued',
            dateKey: dateKey,
            createdAt: now,
            updatedAt: now
        };
        await db.collection('All_Madrasas').doc(tenantId)
            .collection('KeyExpiryNotifications').doc(notifyId)
            .set(payload, { merge: true });
        queued++;
    }

    if (queued > 0) {
        await db.collection('All_Madrasas').doc(tenantId).collection('Announcements')
            .doc('key-expiry-batch-' + dateKey)
            .set({
                title: 'Access Key Reminders (' + queued + ')',
                details: items.map(buildNotificationBody).join('\n'),
                audience: 'admin',
                category: 'security',
                date: dateKey,
                timestamp: now,
                source: 'key_rotation_reminder'
            }, { merge: true });
    }

    return { queued: queued, ownerEmail: notifyEmail ? ownerEmail : null };
}

module.exports = {
    buildNotificationBody,
    dispatchKeyExpiryNotifications
};
