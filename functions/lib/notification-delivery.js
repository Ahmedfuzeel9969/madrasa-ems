/**
 * Notification delivery — SMTP email + FCM push for queued alerts (Phase 8)
 * Configure SMTP: firebase functions:config:set ems.smtp_host="..." ems.smtp_user="..." ems.smtp_pass="..." ems.smtp_from="..."
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const logger = require('./logger');

function getSmtpConfig() {
    try {
        const cfg = functions.config().ems || {};
        if (!cfg.smtp_host) return null;
        return {
            host: cfg.smtp_host,
            port: parseInt(cfg.smtp_port, 10) || 587,
            secure: cfg.smtp_secure === 'true',
            user: cfg.smtp_user || '',
            pass: cfg.smtp_pass || '',
            from: cfg.smtp_from || cfg.smtp_user || 'noreply@ems.local'
        };
    } catch (e) {
        return null;
    }
}

async function sendEmailSmtp(to, subject, body) {
    if (!to) return { sent: false, reason: 'no_recipient' };
    const smtp = getSmtpConfig();
    if (!smtp) return { sent: false, reason: 'smtp_not_configured' };
    try {
        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport({
            host: smtp.host,
            port: smtp.port,
            secure: smtp.secure,
            auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined
        });
        await transporter.sendMail({
            from: smtp.from,
            to: to,
            subject: subject,
            text: body
        });
        return { sent: true };
    } catch (err) {
        return { sent: false, reason: err.message || 'smtp_error' };
    }
}

async function sendFcmToTokens(tokens, title, body, data) {
    const list = (tokens || []).filter(function (t) { return !!t; });
    if (!list.length) return { sent: 0, reason: 'no_tokens' };
    try {
        const messaging = admin.messaging();
        const res = await messaging.sendEachForMulticast({
            tokens: list.slice(0, 500),
            notification: { title: title, body: body },
            data: data || {}
        });
        return { sent: res.successCount, failed: res.failureCount };
    } catch (err) {
        return { sent: 0, reason: err.message || 'fcm_error' };
    }
}

async function loadDeviceTokens(db, tenantId, collection, uid) {
    const snap = await db.collection('All_Madrasas').doc(tenantId)
        .collection(collection).doc(uid).get();
    if (!snap.exists) return [];
    const data = snap.data() || {};
    return Array.isArray(data.tokens) ? data.tokens : (data.token ? [data.token] : []);
}

async function processKeyExpiryNotification(db, tenantId, docRef, data, policy, now) {
    const updates = { updatedAt: now, deliveryAttempts: (data.deliveryAttempts || 0) + 1 };
    let emailResult = null;
    let fcmResult = null;

    if (policy.enableEmailDelivery !== false && data.channel === 'email_queue' && data.to) {
        emailResult = await sendEmailSmtp(data.to, data.subject || 'EMS Key Reminder', data.body || '');
        if (emailResult.sent) {
            updates.deliveryStatus = 'sent';
            updates.deliveredVia = 'email';
            updates.deliveredAt = now;
        } else {
            updates.deliveryStatus = 'failed';
            updates.deliveryError = emailResult.reason;
        }
    } else if (policy.enablePushDelivery !== false) {
        const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
        const ownerUid = madrasaSnap.exists ? madrasaSnap.data().ownerUid : null;
        if (ownerUid) {
            const tokens = await loadDeviceTokens(db, tenantId, 'OwnerDeviceTokens', ownerUid);
            fcmResult = await sendFcmToTokens(tokens, data.subject || 'Key Reminder', data.body || '', {
                type: 'key_expiry',
                tenantId: tenantId,
                notifyId: data.id || docRef.id
            });
            if (fcmResult.sent > 0) {
                updates.deliveryStatus = 'sent';
                updates.deliveredVia = 'fcm';
                updates.deliveredAt = now;
            } else if (data.channel === 'in_app') {
                updates.deliveryStatus = 'in_app_only';
                updates.deliveredVia = 'in_app';
            } else {
                updates.deliveryStatus = 'queued';
                updates.deliveryError = fcmResult.reason || 'no_delivery_channel';
            }
        }
    } else {
        updates.deliveryStatus = data.channel === 'in_app' ? 'in_app_only' : 'skipped';
    }

    await docRef.set(updates, { merge: true });
    return { emailResult: emailResult, fcmResult: fcmResult, status: updates.deliveryStatus };
}

async function processQueuedKeyExpiryForTenant(db, tenantId, policy, now) {
    const snap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('KeyExpiryNotifications')
        .where('deliveryStatus', '==', 'queued')
        .limit(40)
        .get();
    let processed = 0;
    for (let i = 0; i < snap.docs.length; i++) {
        await processKeyExpiryNotification(db, tenantId, snap.docs[i].ref, snap.docs[i].data(), policy, now);
        processed++;
    }
    return processed;
}

async function runNotificationDelivery(now) {
    const db = admin.firestore();
    const totals = { tenants: 0, processed: 0 };
    const madrasaSnap = await db.collection('All_Madrasas').get();
    for (let i = 0; i < madrasaSnap.docs.length; i++) {
        const tenantId = madrasaSnap.docs[i].id;
        const policySnap = await db.collection('All_Madrasas').doc(tenantId)
            .collection('TenantSettings').doc('securityPolicy').get();
        const policy = policySnap.exists ? policySnap.data() : {};
        if (policy.enableKeyExpiryAlerts === false && policy.notifyOwnerOnTrustedDeviceRequest === false) continue;
        const n = await processQueuedKeyExpiryForTenant(db, tenantId, policy, now);
        const notificationRetry = require('./notification-retry');
        const retried = await notificationRetry.processRetryableFailed(db, tenantId, policy, now);
        if (n > 0 || retried > 0) {
            totals.tenants++;
            totals.processed += n;
            totals.retried = (totals.retried || 0) + retried;
        }
    }
    return totals;
}

const scheduledDeliverKeyExpiryNotifications = functions.pubsub.schedule('every 6 hours').onRun(async function () {
    try {
        const totals = await runNotificationDelivery(Date.now());
        if (totals.processed > 0) {
            await logger.audit({
                action: 'notifications.delivered',
                actorUid: 'system',
                actorEmail: 'system',
                meta: totals
            });
        }
    } catch (err) {
        await logger.logError('scheduledDeliverKeyExpiryNotifications', err, {});
    }
    return null;
});

module.exports = {
    getSmtpConfig,
    sendEmailSmtp,
    sendFcmToTokens,
    processKeyExpiryNotification,
    processQueuedKeyExpiryForTenant,
    runNotificationDelivery,
    scheduledDeliverKeyExpiryNotifications
};
