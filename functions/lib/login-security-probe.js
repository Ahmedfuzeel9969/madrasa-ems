/**
 * Login security backend probe — verify live CF wiring (Phase 23)
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');

const PROBE_VERSION = '20260620e26';
const PROBE_FUNCTIONS = [
    'validateLoginIpAddress',
    'validateLoginCountry',
    'validateStaffEmailDomain',
    'checkTrustedDevice',
    'checkMfaCompliance',
    'getLoginSecurityHealthCheck',
    'getLoginSecurityOverview',
    'testSecurityWebhook',
    'getSecurityAlertSummary',
    'probeLoginSecurityBackend',
    'checkTenantLoginAllowed',
    'recordTenantLoginFailure',
    'clearTenantLoginSuccess',
    'getTenantLoginLockouts',
    'unlockTenantLoginLockout',
    'getSessionAnomalySummary',
    'listSessionAnomalies',
    'dismissSessionAnomaly'
];

async function assertOwner(db, tenantId, uid) {
    const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    if (!madrasaSnap.exists || madrasaSnap.data().ownerUid !== uid) {
        throw new functions.https.HttpsError('permission-denied', 'صرف مالک probe چلا سکتا ہے۔');
    }
}

const probeLoginSecurityBackend = functions.https.onCall(async function (data, context) {
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
    return {
        ok: true,
        version: PROBE_VERSION,
        tenantId: tenantId,
        functions: PROBE_FUNCTIONS,
        policyLoaded: policySnap.exists,
        gates: {
            ipAllowlist: !!policy.enableIpAllowlist,
            countryAllowlist: !!policy.enableCountryAllowlist,
            trustedDeviceStaff: !!policy.requireTrustedDeviceForStaff,
            trustedDeviceParent: !!policy.requireTrustedDeviceForParents,
            securityWebhooks: !!policy.enableSecurityWebhooks,
            alertDigest: !!policy.enableSecurityAlertDigest,
            loginBruteForce: !!policy.enableLoginBruteForceProtection,
            sessionAnomaly: !!policy.enableSessionAnomalyDetection
        },
        generatedAt: Date.now()
    };
});

module.exports = {
    PROBE_VERSION,
    PROBE_FUNCTIONS,
    probeLoginSecurityBackend
};
