/**
 * Security alert digest — threshold notifications for critical login events (Phase 20)
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const { countSecurityEvents } = require('./login-security-overview');

const CRITICAL_ALERT_ACTIONS = [
    'sso_domain_denied',
    'sso_provider_denied',
    'mfa_session_required',
    'trusted_device_rate_limited',
    'login_ip_denied',
    'login_country_denied',
    'login_lockout_triggered'
];

async function summarizeSecurityAlerts(db, tenantId, sinceMs) {
    const ssoDenied = await countSecurityEvents(db, tenantId, ['sso_domain_denied', 'sso_provider_denied'], sinceMs);
    const mfaBlocks = await countSecurityEvents(db, tenantId, ['mfa_session_required'], sinceMs);
    const rateLimited = await countSecurityEvents(db, tenantId, ['trusted_device_rate_limited'], sinceMs);
    const lockouts = await countSecurityEvents(db, tenantId, ['login_lockout_triggered'], sinceMs);
    const deviceRequests = await countSecurityEvents(db, tenantId, ['trusted_device_requested'], sinceMs);
    const totalCritical = ssoDenied + mfaBlocks + rateLimited + lockouts;
    return {
        ssoDenied: ssoDenied,
        mfaBlocks: mfaBlocks,
        rateLimited: rateLimited,
        lockouts: lockouts,
        deviceRequests: deviceRequests,
        totalCritical: totalCritical
    };
}

function shouldTriggerAlert(summary, threshold) {
    const t = parseInt(threshold, 10);
    if (t <= 0) return true;
    return (summary.totalCritical || 0) >= t;
}

function buildDigestBody(summary, threshold) {
    return [
        'SSO blocks: ' + (summary.ssoDenied || 0),
        'MFA blocks: ' + (summary.mfaBlocks || 0),
        'Device rate limits: ' + (summary.rateLimited || 0),
        'Login lockouts: ' + (summary.lockouts || 0),
        'Device requests: ' + (summary.deviceRequests || 0),
        'Critical total: ' + (summary.totalCritical || 0),
        'Threshold: ' + (threshold || 0)
    ].join('\n');
}

async function assertOwner(db, tenantId, uid) {
    const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    if (!madrasaSnap.exists || madrasaSnap.data().ownerUid !== uid) {
        throw new functions.https.HttpsError('permission-denied', 'صرف مالک یہ عمل کر سکتا ہے۔');
    }
}

async function materializeAlertDigest(db, tenantId, summary, policy, dateKey, now) {
    const threshold = parseInt(policy.securityAlertThreshold7d, 10) || 0;
    if (!shouldTriggerAlert(summary, threshold)) {
        return { triggered: false, reason: 'below_threshold' };
    }

    const digestId = 'security-alert-' + dateKey;
    const existing = await db.collection('All_Madrasas').doc(tenantId)
        .collection('SecurityAlertDigest').doc(digestId).get();
    if (existing.exists) {
        return { triggered: false, reason: 'already_sent', digestId: digestId };
    }

    const body = buildDigestBody(summary, threshold);
    await db.collection('All_Madrasas').doc(tenantId)
        .collection('SecurityAlertDigest').doc(digestId)
        .set({
            dateKey: dateKey,
            summary: summary,
            threshold: threshold,
            body: body,
            createdAt: now
        });

    await db.collection('All_Madrasas').doc(tenantId).collection('Announcements')
        .doc(digestId)
        .set({
            title: 'Security Alert — ' + (summary.totalCritical || 0) + ' critical events (7d)',
            details: body,
            audience: 'admin',
            category: 'security',
            date: dateKey,
            timestamp: now,
            source: 'security_alert_digest'
        }, { merge: true });

    let emailQueued = false;
    if (policy.notifyOwnerOnSecurityAlert !== false && policy.enableEmailDelivery !== false) {
        const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
        const madrasa = madrasaSnap.exists ? madrasaSnap.data() : {};
        const ownerEmail = madrasa.ownerEmail || madrasa.adminEmail || madrasa.email || '';
        if (ownerEmail) {
            await db.collection('All_Madrasas').doc(tenantId)
                .collection('KeyExpiryNotifications').doc('sec-alert-' + digestId)
                .set({
                    id: 'sec-alert-' + digestId,
                    tenantId: tenantId,
                    type: 'security_alert',
                    channel: 'email_queue',
                    to: ownerEmail,
                    subject: 'EMS Security Alert — ' + (summary.totalCritical || 0) + ' events',
                    body: body,
                    deliveryStatus: 'queued',
                    dateKey: dateKey,
                    createdAt: now,
                    updatedAt: now
                }, { merge: true });
            emailQueued = true;
        }
    }

    return { triggered: true, digestId: digestId, emailQueued: emailQueued };
}

async function runSecurityAlertDigest(now) {
    const db = admin.firestore();
    const dateKey = new Date(now).toISOString().split('T')[0];
    const sinceMs = now - 7 * 86400000;
    const totals = { scanned: 0, triggered: 0, skipped: 0 };

    const madrasaSnap = await db.collection('All_Madrasas').get();
    for (let i = 0; i < madrasaSnap.docs.length; i++) {
        const tenantId = madrasaSnap.docs[i].id;
        const policySnap = await db.collection('All_Madrasas').doc(tenantId)
            .collection('TenantSettings').doc('securityPolicy').get();
        const policy = policySnap.exists ? policySnap.data() : {};
        if (!policy.enableSecurityAlertDigest) continue;

        totals.scanned++;
        const summary = await summarizeSecurityAlerts(db, tenantId, sinceMs);
        const result = await materializeAlertDigest(db, tenantId, summary, policy, dateKey, now);
        if (result.triggered) totals.triggered++;
        else totals.skipped++;
    }
    return totals;
}

const scheduledSecurityAlertDigest = functions.pubsub.schedule('every 24 hours').onRun(async function () {
    const result = await runSecurityAlertDigest(Date.now());
    console.log('[security-alert-digest]', JSON.stringify(result));
    return result;
});

const getSecurityAlertSummary = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId درکار ہے۔');
    }
    const db = admin.firestore();
    await assertOwner(db, tenantId, context.auth.uid);
    const policySnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('TenantSettings').doc('securityPolicy').get();
    const policy = policySnap.exists ? policySnap.data() : {};
    const sinceMs = Date.now() - 7 * 86400000;
    const summary = await summarizeSecurityAlerts(db, tenantId, sinceMs);
    const threshold = parseInt(policy.securityAlertThreshold7d, 10) || 0;
    const digestSnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('SecurityAlertDigest')
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();
    let lastDigest = null;
    digestSnap.forEach(function (doc) {
        const d = doc.data() || {};
        lastDigest = { dateKey: d.dateKey || '', createdAt: d.createdAt || 0, totalCritical: (d.summary || {}).totalCritical || 0 };
    });
    return {
        generatedAt: Date.now(),
        enabled: !!policy.enableSecurityAlertDigest,
        threshold: threshold,
        summary: summary,
        alertTriggered: shouldTriggerAlert(summary, threshold),
        lastDigest: lastDigest
    };
});

module.exports = {
    CRITICAL_ALERT_ACTIONS,
    summarizeSecurityAlerts,
    shouldTriggerAlert,
    buildDigestBody,
    materializeAlertDigest,
    runSecurityAlertDigest,
    scheduledSecurityAlertDigest,
    getSecurityAlertSummary
};
