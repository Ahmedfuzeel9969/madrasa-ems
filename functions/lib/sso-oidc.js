/**
 * OIDC / SAML SSO provider hooks (Phase 19)
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const https = require('https');
const http = require('http');
const { resolveAllowedProviders } = require('./sso-policy');

function normalizeIssuer(url) {
    let u = String(url || '').trim();
    while (u.endsWith('/')) u = u.slice(0, -1);
    return u;
}

function fetchJson(url) {
    return new Promise(function (resolve, reject) {
        let parsed;
        try {
            parsed = new URL(url);
        } catch (e) {
            reject(new Error('Invalid URL'));
            return;
        }
        const lib = parsed.protocol === 'https:' ? https : http;
        const req = lib.get(url, { timeout: 10000 }, function (res) {
            if (res.statusCode < 200 || res.statusCode >= 300) {
                reject(new Error('HTTP ' + res.statusCode));
                res.resume();
                return;
            }
            let data = '';
            res.on('data', function (chunk) { data += chunk; });
            res.on('end', function () {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error('Invalid JSON'));
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', function () {
            req.destroy(new Error('timeout'));
        });
    });
}

async function fetchOidcDiscovery(issuerUrl) {
    const issuer = normalizeIssuer(issuerUrl);
    if (!issuer) throw new Error('Issuer URL درکار ہے۔');
    const doc = await fetchJson(issuer + '/.well-known/openid-configuration');
    if (!doc || !doc.issuer) {
        throw new Error('OIDC discovery document نامکمل ہے۔');
    }
    const docIssuer = normalizeIssuer(doc.issuer);
    if (docIssuer !== issuer && docIssuer.indexOf(issuer) !== 0 && issuer.indexOf(docIssuer) !== 0) {
        throw new Error('Issuer mismatch: ' + docIssuer);
    }
    return {
        issuer: docIssuer,
        authorizationEndpoint: doc.authorization_endpoint || '',
        tokenEndpoint: doc.token_endpoint || '',
        jwksUri: doc.jwks_uri || ''
    };
}

async function assertOwner(db, tenantId, uid) {
    const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    if (!madrasaSnap.exists || madrasaSnap.data().ownerUid !== uid) {
        throw new functions.https.HttpsError('permission-denied', 'صرف مالک یہ عمل کر سکتا ہے۔');
    }
}

async function loadSsoPolicy(db, tenantId) {
    const snap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('TenantSettings').doc('ssoPolicy').get();
    return snap.exists ? snap.data() : {};
}

const validateOidcIssuerConfig = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    const issuerUrl = String((data && data.issuerUrl) || '').trim();
    if (!tenantId || !issuerUrl) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId اور issuerUrl درکار ہیں۔');
    }
    const db = admin.firestore();
    await assertOwner(db, tenantId, context.auth.uid);
    const discovery = await fetchOidcDiscovery(issuerUrl);
    await db.collection('All_Madrasas').doc(tenantId)
        .collection('TenantSettings').doc('ssoPolicy')
        .set({
            oidcDiscoveryValid: true,
            oidcDiscoveryCheckedAt: Date.now(),
            oidcDiscoveryIssuer: discovery.issuer
        }, { merge: true });
    return { ok: true, discovery: discovery };
});

const getSsoProviderSummary = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId درکار ہے۔');
    }
    const db = admin.firestore();
    await assertOwner(db, tenantId, context.auth.uid);
    const raw = await loadSsoPolicy(db, tenantId);
    const allowed = resolveAllowedProviders(raw);
    return {
        generatedAt: Date.now(),
        googleOnly: !!raw.enforceGoogleSignInOnly,
        allowedProviders: allowed,
        oidc: {
            enabled: !!raw.oidcEnabled,
            providerId: raw.oidcProviderId || '',
            issuerUrl: raw.oidcIssuerUrl || '',
            clientId: raw.oidcClientId || '',
            discoveryValid: !!raw.oidcDiscoveryValid,
            discoveryCheckedAt: raw.oidcDiscoveryCheckedAt || 0
        },
        saml: {
            enabled: !!raw.samlEnabled,
            providerId: raw.samlProviderId || '',
            entityId: raw.samlEntityId || '',
            ssoUrl: raw.samlSsoUrl || ''
        }
    };
});

module.exports = {
    normalizeIssuer,
    fetchOidcDiscovery,
    validateOidcIssuerConfig,
    getSsoProviderSummary
};
