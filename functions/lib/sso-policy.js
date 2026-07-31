/**
 * SSO / email domain policy hooks (Phase 12)
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const { writeSecurityLog } = require('./security-log-write');

function parseDomains(list) {
    if (!list) return [];
    if (Array.isArray(list)) {
        return list.map(function (d) { return String(d || '').trim().toLowerCase(); }).filter(Boolean);
    }
    return String(list).split(/[,;\s]+/).map(function (d) { return d.trim().toLowerCase(); }).filter(Boolean);
}

function emailMatchesDomains(email, domains) {
    if (!domains.length) return true;
    const parts = String(email || '').toLowerCase().split('@');
    if (parts.length < 2) return false;
    return domains.indexOf(parts[1]) >= 0;
}

function getSignInProvider(token) {
    if (!token || !token.firebase) return '';
    return String(token.firebase.sign_in_provider || '');
}

function resolveAllowedProviders(raw) {
    raw = raw || {};
    if (raw.enforceGoogleSignInOnly) return ['google.com'];
    var providers = ['google.com'];
    if (raw.oidcEnabled && raw.oidcProviderId) {
        var oidcId = String(raw.oidcProviderId).trim();
        if (oidcId && providers.indexOf(oidcId) < 0) providers.push(oidcId);
    }
    if (raw.samlEnabled && raw.samlProviderId) {
        var samlId = String(raw.samlProviderId).trim();
        if (samlId && providers.indexOf(samlId) < 0) providers.push(samlId);
    }
    if (Array.isArray(raw.allowedSignInProviders)) {
        raw.allowedSignInProviders.forEach(function (p) {
            var s = String(p || '').trim();
            if (s && providers.indexOf(s) < 0) providers.push(s);
        });
    }
    return providers;
}

function hasProviderRestriction(raw) {
    raw = raw || {};
    return !!raw.enforceGoogleSignInOnly || !!raw.oidcEnabled || !!raw.samlEnabled ||
        (Array.isArray(raw.allowedSignInProviders) && raw.allowedSignInProviders.length > 0);
}

function providerAllowed(raw, provider) {
    if (!raw) return true;
    if (!hasProviderRestriction(raw)) return true;
    return resolveAllowedProviders(raw).indexOf(provider) >= 0;
}

const getTenantSsoPolicy = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId درکار ہے۔');
    }
    const db = admin.firestore();
    const snap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('TenantSettings').doc('ssoPolicy').get();
    const raw = snap.exists ? snap.data() : {};
    const domains = parseDomains(raw.allowedEmailDomains);
    return {
        enforceStaffEmailDomain: !!raw.enforceStaffEmailDomain,
        enforceParentEmailDomain: !!raw.enforceParentEmailDomain,
        enforceGoogleSignInOnly: !!raw.enforceGoogleSignInOnly,
        allowedEmailDomains: domains,
        provider: raw.provider || 'google',
        oidcEnabled: !!raw.oidcEnabled,
        oidcProviderId: raw.oidcProviderId || '',
        oidcIssuerUrl: raw.oidcIssuerUrl || '',
        oidcClientId: raw.oidcClientId || '',
        samlEnabled: !!raw.samlEnabled,
        samlProviderId: raw.samlProviderId || '',
        samlEntityId: raw.samlEntityId || '',
        samlSsoUrl: raw.samlSsoUrl || '',
        allowedSignInProviders: resolveAllowedProviders(raw)
    };
});

const validateStaffEmailDomain = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    const portal = String((data && data.portal) || 'teacher').trim();
    const email = String((data && data.email) || context.auth.token.email || '').trim().toLowerCase();
    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId درکار ہے۔');
    }
    const db = admin.firestore();
    const snap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('TenantSettings').doc('ssoPolicy').get();
    const raw = snap.exists ? snap.data() : {};
    const signInProvider = getSignInProvider(context.auth.token);
    if (!providerAllowed(raw, signInProvider)) {
        var allowedProviders = resolveAllowedProviders(raw);
        await writeSecurityLog(db, tenantId, {
            action: 'sso_provider_denied',
            uid: context.auth.uid,
            email: email,
            details: {
                portal: portal,
                provider: signInProvider,
                allowedProviders: allowedProviders,
                enforceGoogleSignInOnly: !!raw.enforceGoogleSignInOnly,
                oidcEnabled: !!raw.oidcEnabled,
                samlEnabled: !!raw.samlEnabled
            }
        });
        var denyMsg = raw.enforceGoogleSignInOnly
            ? 'صرف Google Sign-In مجاز ہے۔'
            : 'یہ Sign-In provider مجاز نہیں: ' + (signInProvider || 'unknown');
        throw new functions.https.HttpsError('permission-denied', denyMsg);
    }
    const domains = parseDomains(raw.allowedEmailDomains);
    const enforce = portal === 'parent'
        ? !!raw.enforceParentEmailDomain
        : !!raw.enforceStaffEmailDomain;
    if (!enforce) {
        return { ok: true, allowed: true, skipped: true, provider: signInProvider };
    }
    const allowed = emailMatchesDomains(email, domains);
    if (!allowed) {
        await writeSecurityLog(db, tenantId, {
            action: 'sso_domain_denied',
            uid: context.auth.uid,
            email: email,
            details: { portal: portal, domain: email.split('@')[1] || '', enforce: true }
        });
        throw new functions.https.HttpsError('permission-denied', 'Email domain اس ادارے کے لیے مجاز نہیں: ' + (email.split('@')[1] || ''));
    }
    return { ok: true, allowed: true, domain: email.split('@')[1] || '' };
});

module.exports = {
    parseDomains,
    emailMatchesDomains,
    getSignInProvider,
    resolveAllowedProviders,
    hasProviderRestriction,
    providerAllowed,
    getTenantSsoPolicy,
    validateStaffEmailDomain
};
