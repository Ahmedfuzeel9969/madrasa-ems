/**
 * Trusted device request notifications — owner email/push queue (Phase 14)
 */
const admin = require('firebase-admin');

async function dispatchTrustedDeviceRequestNotification(db, tenantId, device, policy, now) {
    if (policy.notifyOwnerOnTrustedDeviceRequest === false) return { queued: 0 };
    const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    const madrasa = madrasaSnap.exists ? madrasaSnap.data() : {};
    const ownerEmail = madrasa.ownerEmail || madrasa.adminEmail || madrasa.email || '';
    const notifyEmail = policy.enableEmailDelivery !== false && !!ownerEmail;
    const dateKey = new Date(now).toISOString().split('T')[0];
    const notifyId = 'td-notify-' + (device.deviceId || 'dev') + '-' + dateKey;
    const label = device.deviceLabel || 'Unknown device';
    const email = device.email || device.uid || '';
    const body = 'نئی Trusted Device approval درخواست: ' + label + ' (' + email + ')';

    await db.collection('All_Madrasas').doc(tenantId)
        .collection('KeyExpiryNotifications').doc(notifyId)
        .set({
            id: notifyId,
            tenantId: tenantId,
            type: 'trusted_device',
            targetId: device.deviceId || '',
            targetName: label,
            status: 'pending',
            channel: notifyEmail ? 'email_queue' : 'in_app',
            to: notifyEmail ? ownerEmail : '',
            subject: 'EMS Trusted Device Approval Request',
            body: body,
            deliveryStatus: 'queued',
            dateKey: dateKey,
            createdAt: now,
            updatedAt: now
        }, { merge: true });

    await db.collection('All_Madrasas').doc(tenantId).collection('Announcements')
        .doc('trusted-device-' + notifyId)
        .set({
            title: 'Trusted Device درخواست',
            details: body,
            audience: 'admin',
            category: 'security',
            date: dateKey,
            timestamp: now,
            source: 'trusted_device_request'
        }, { merge: true });

    return { queued: 1, ownerEmail: notifyEmail ? ownerEmail : null };
}

module.exports = { dispatchTrustedDeviceRequestNotification };
