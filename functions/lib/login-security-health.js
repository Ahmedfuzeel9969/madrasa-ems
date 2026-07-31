/**
 * Login security health check — production readiness dashboard (Phase 22)
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const { countSecurityEvents } = require('./login-security-overview');
const { summarizeSecurityAlerts, shouldTriggerAlert } = require('./security-alert-digest');
const { isValidWebhookUrl } = require('./security-webhook');
const { parseIpRanges, parseCountries } = require('./login-ip-policy');
const { hasProviderRestriction } = require('./sso-policy');

async function assertOwner(db, tenantId, uid) {
    const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    if (!madrasaSnap.exists || madrasaSnap.data().ownerUid !== uid) {
        throw new functions.https.HttpsError('permission-denied', 'صرف مالک health check دیکھ سکتا ہے۔');
    }
}

function pushCheck(checks, id, label, status, detail) {
    checks.push({ id: id, label: label, status: status, detail: detail || '' });
}

function scoreChecks(checks) {
    let pass = 0;
    let warn = 0;
    let fail = 0;
    checks.forEach(function (c) {
        if (c.status === 'pass') pass++;
        else if (c.status === 'warn') warn++;
        else if (c.status === 'fail') fail++;
    });
    const total = checks.length || 1;
    return {
        pass: pass,
        warn: warn,
        fail: fail,
        total: total,
        score: Math.round((pass + warn * 0.5) / total * 100)
    };
}

async function buildHealthChecks(db, tenantId, policy, mfa, sso, sinceMs) {
    const checks = [];
    const devicesSnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('TrustedDevices')
        .where('status', '==', 'pending')
        .limit(20)
        .get();
    const alertSummary = await summarizeSecurityAlerts(db, tenantId, sinceMs);
    const threshold = parseInt(policy.securityAlertThreshold7d, 10) || 0;

    pushCheck(checks, 'access_key', 'Access Key policy', policy.requireAccessKey !== false ? 'pass' : 'warn',
        policy.requireAccessKey !== false ? 'Required' : 'Optional — less secure');
    pushCheck(checks, 'mfa_admin', 'Admin MFA', mfa.requireMfaForAdmin ? 'pass' : 'warn',
        mfa.requireMfaForAdmin ? 'ON' : 'Off');
    pushCheck(checks, 'mfa_staff', 'Staff MFA', mfa.requireMfaForStaff ? 'pass' : 'warn',
        mfa.requireMfaForStaff ? 'ON' : 'Off');
    pushCheck(checks, 'mfa_parent', 'Parent MFA', mfa.requireMfaForParent ? 'pass' : 'warn',
        mfa.requireMfaForParent ? 'ON' : 'Off');

    if (policy.enableSecurityWebhooks) {
        const ok = isValidWebhookUrl(String(policy.securityWebhookUrl || ''));
        pushCheck(checks, 'webhook', 'Security webhook', ok ? 'pass' : 'fail',
            ok ? 'URL configured' : 'Enabled but URL invalid');
    } else {
        pushCheck(checks, 'webhook', 'Security webhook', 'warn', 'Not enabled');
    }

    if (policy.enableCountryAllowlist) {
        const countries = parseCountries(policy.allowedCountries);
        pushCheck(checks, 'country_allowlist', 'Country allowlist', countries.length ? 'pass' : 'fail',
            countries.length ? countries.join(', ') : 'Enabled but no countries');
    } else {
        pushCheck(checks, 'country_allowlist', 'Country allowlist', 'warn', 'Not enabled');
    }

    if (policy.enableIpAllowlist) {
        const ranges = parseIpRanges(policy.allowedIpRanges);
        pushCheck(checks, 'ip_allowlist', 'IP allowlist', ranges.length ? 'pass' : 'fail',
            ranges.length ? (ranges.length + ' range(s)') : 'Enabled but no ranges');
    } else {
        pushCheck(checks, 'ip_allowlist', 'IP allowlist', 'warn', 'Not enabled');
    }

    if (policy.enableLoginBruteForceProtection) {
        const maxF = parseInt(policy.maxLoginFailuresPerEmail, 10) || 5;
        const lockMin = parseInt(policy.loginLockoutMinutes, 10) || 15;
        pushCheck(checks, 'login_brute_force', 'Login brute-force protection', 'pass',
            maxF + ' failures / ' + lockMin + ' min lockout');
    } else {
        pushCheck(checks, 'login_brute_force', 'Login brute-force protection', 'warn', 'Not enabled');
    }

    if (policy.enableSessionAnomalyDetection) {
        const maxH = parseInt(policy.sessionAnomalyMaxPerHour, 10) || 3;
        pushCheck(checks, 'session_anomaly', 'Session anomaly detection', 'pass',
            maxH + ' sessions/hour threshold');
    } else {
        pushCheck(checks, 'session_anomaly', 'Session anomaly detection', 'warn', 'Not enabled');
    }

    if (sso.oidcEnabled) {
        pushCheck(checks, 'oidc', 'OIDC SSO', sso.oidcDiscoveryValid ? 'pass' : 'warn',
            sso.oidcDiscoveryValid ? 'Discovery valid' : 'Run Validate Issuer');
    }

    if (hasProviderRestriction(sso)) {
        pushCheck(checks, 'sso_providers', 'SSO providers', 'pass', 'Restricted');
    }

    pushCheck(checks, 'pending_devices', 'Pending trusted devices',
        devicesSnap.size === 0 ? 'pass' : 'warn',
        String(devicesSnap.size));

    pushCheck(checks, 'critical_events', '7d critical events',
        shouldTriggerAlert(alertSummary, threshold) ? 'warn' : 'pass',
        (alertSummary.totalCritical || 0) + ' / threshold ' + threshold);

    pushCheck(checks, 'session_registry', 'Login session registry',
        policy.enableLoginSessionRegistry !== false ? 'pass' : 'warn',
        policy.enableLoginSessionRegistry !== false ? 'ON' : 'Off');

    return checks;
}

const getLoginSecurityHealthCheck = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId درکار ہے۔');
    }
    const db = admin.firestore();
    await assertOwner(db, tenantId, context.auth.uid);
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

    const checks = await buildHealthChecks(db, tenantId, policy, mfa, sso, sinceMs);
    const scoring = scoreChecks(checks);
    const ssoDenied = await countSecurityEvents(db, tenantId, ['sso_domain_denied', 'sso_provider_denied', 'login_ip_denied'], sinceMs);

    return {
        generatedAt: Date.now(),
        tenantId: tenantId,
        readinessScore: scoring.score,
        scoring: scoring,
        checks: checks,
        metrics: {
            ssoBlocks7d: ssoDenied,
            criticalEvents7d: (await summarizeSecurityAlerts(db, tenantId, sinceMs)).totalCritical || 0
        },
        productionReady: scoring.fail === 0 && scoring.score >= 70
    };
});

module.exports = {
    buildHealthChecks,
    scoreChecks,
    getLoginSecurityHealthCheck
};
