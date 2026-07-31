/**
 * Login security overview — combined dashboard stats (Phase 17)
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');

async function countSecurityEvents(db, tenantId, actions, sinceMs) {
    const snap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('SecurityLog')
        .orderBy('clientTs', 'desc')
        .limit(150)
        .get();
    let count = 0;
    snap.forEach(function (doc) {
        const e = doc.data() || {};
        if (e.clientTs && e.clientTs < sinceMs) return;
        if (actions.indexOf(e.action) >= 0) count++;
    });
    return count;
}

const getLoginSecurityOverview = functions.https.onCall(async function (data, context) {
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
        throw new functions.https.HttpsError('permission-denied', 'صرف مالک overview دیکھ سکتا ہے۔');
    }

    const sinceMs = Date.now() - 7 * 86400000;
    const policySnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('TenantSettings').doc('securityPolicy').get();
    const policy = policySnap.exists ? policySnap.data() : {};
    const mfaSnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('SecuritySettings').doc('mfa').get();
    const mfa = mfaSnap.exists ? mfaSnap.data() : {};
    const ssoSnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('TenantSettings').doc('ssoPolicy').get();
    const sso = ssoSnap.exists ? ssoSnap.data() : {};

    const sessionsSnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('LoginSessions')
        .where('revoked', '==', false)
        .limit(100)
        .get();
    const devicesSnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('TrustedDevices')
        .limit(200)
        .get();
    const deviceStats = { pending: 0, approved: 0, total: 0 };
    devicesSnap.forEach(function (doc) {
        const d = doc.data() || {};
        deviceStats.total++;
        if (d.status === 'pending') deviceStats.pending++;
        if (d.status === 'approved') deviceStats.approved++;
    });

    const ssoDenied = await countSecurityEvents(db, tenantId, ['sso_domain_denied', 'sso_provider_denied', 'login_ip_denied'], sinceMs);
    const mfaBlocks = await countSecurityEvents(db, tenantId, ['mfa_session_required'], sinceMs);
    const deviceEvents = await countSecurityEvents(db, tenantId, [
        'trusted_device_requested', 'trusted_device_approved', 'trusted_device_rejected',
        'trusted_device_rate_limited'
    ], sinceMs);

    const lockouts7d = await countSecurityEvents(db, tenantId, ['login_lockout_triggered'], sinceMs);
    const sessionAnomalies7d = await countSecurityEvents(db, tenantId, ['session_anomaly_detected'], sinceMs);
    const activeLockoutsSnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('LoginFailures')
        .limit(100)
        .get();
    let activeLockouts = 0;
    const now = Date.now();
    activeLockoutsSnap.forEach(function (doc) {
        const d = doc.data() || {};
        if (d.lockedUntil && d.lockedUntil > now) activeLockouts++;
    });

    return {
        generatedAt: Date.now(),
        activeSessions: sessionsSnap.size,
        trustedDevices: deviceStats,
        securityEvents7d: {
            ssoDenied: ssoDenied,
            mfaBlocks: mfaBlocks,
            deviceEvents: deviceEvents,
            lockouts: lockouts7d,
            sessionAnomalies: sessionAnomalies7d
        },
        sessionAnomalies: {
            open7d: sessionAnomalies7d
        },
        loginLockouts: {
            active: activeLockouts
        },
        policies: {
            requireTrustedDeviceForStaff: !!policy.requireTrustedDeviceForStaff,
            requireTrustedDeviceForParents: !!policy.requireTrustedDeviceForParents,
            requireMfaForAdmin: !!mfa.requireMfaForAdmin,
            requireMfaForStaff: !!mfa.requireMfaForStaff,
            requireMfaForParent: !!mfa.requireMfaForParent,
            enforceGoogleSignInOnly: !!sso.enforceGoogleSignInOnly,
            enforceStaffEmailDomain: !!sso.enforceStaffEmailDomain,
            enforceParentEmailDomain: !!sso.enforceParentEmailDomain,
            enableSecurityWebhooks: !!policy.enableSecurityWebhooks,
            trustedDeviceMaxRequestsPerDay: parseInt(policy.trustedDeviceMaxRequestsPerDay, 10) || 0,
            oidcEnabled: !!sso.oidcEnabled,
            samlEnabled: !!sso.samlEnabled,
            enableSecurityAlertDigest: !!policy.enableSecurityAlertDigest,
            securityAlertThreshold7d: parseInt(policy.securityAlertThreshold7d, 10) || 0,
            enableIpAllowlist: !!policy.enableIpAllowlist,
            enableLoginBruteForceProtection: !!policy.enableLoginBruteForceProtection,
            maxLoginFailuresPerEmail: parseInt(policy.maxLoginFailuresPerEmail, 10) || 5,
            loginLockoutMinutes: parseInt(policy.loginLockoutMinutes, 10) || 15,
            enableSessionAnomalyDetection: !!policy.enableSessionAnomalyDetection,
            sessionAnomalyMaxPerHour: parseInt(policy.sessionAnomalyMaxPerHour, 10) || 3
        }
    };
});

module.exports = { getLoginSecurityOverview, countSecurityEvents };
