// ============================================================================
// EMS Tenant SSO / Email Domain Policy (Phase 12)
// Path: All_Madrasas/{tenantId}/TenantSettings/ssoPolicy
// ============================================================================
(function (global) {
    'use strict';

    function getDb() {
        return typeof global.getDbOrNull === 'function' ? global.getDbOrNull() : null;
    }

    global.emsLoadTenantSsoPolicy = function (madrasaId) {
        var db = getDb();
        if (!db || !madrasaId) {
            return Promise.resolve({ enforceStaffEmailDomain: false, allowedEmailDomains: [] });
        }
        return db.collection('All_Madrasas').doc(madrasaId)
            .collection('TenantSettings').doc('ssoPolicy').get()
            .then(function (doc) {
                var d = doc.exists ? doc.data() : {};
                var domains = d.allowedEmailDomains;
                if (typeof domains === 'string') {
                    domains = domains.split(/[,;\s]+/).filter(Boolean);
                }
                var out = {
                    enforceStaffEmailDomain: !!d.enforceStaffEmailDomain,
                    enforceParentEmailDomain: !!d.enforceParentEmailDomain,
                    enforceGoogleSignInOnly: !!d.enforceGoogleSignInOnly,
                    allowedEmailDomains: Array.isArray(domains) ? domains : [],
                    provider: d.provider || 'google',
                    oidcEnabled: !!d.oidcEnabled,
                    oidcProviderId: d.oidcProviderId || '',
                    oidcIssuerUrl: d.oidcIssuerUrl || '',
                    oidcClientId: d.oidcClientId || '',
                    samlEnabled: !!d.samlEnabled,
                    samlProviderId: d.samlProviderId || '',
                    samlEntityId: d.samlEntityId || '',
                    samlSsoUrl: d.samlSsoUrl || '',
                    allowedSignInProviders: Array.isArray(d.allowedSignInProviders) ? d.allowedSignInProviders : []
                };
                global.EMS_TENANT_SSO_POLICY = out;
                return out;
            })
            .catch(function () {
                return { enforceStaffEmailDomain: false, allowedEmailDomains: [] };
            });
    };

    global.emsSaveTenantSsoPolicy = function (madrasaId, patch) {
        var db = getDb();
        if (!db || !madrasaId) return Promise.reject(new Error('tenantId درکار ہے'));
        var domains = patch.allowedEmailDomains;
        if (typeof domains === 'string') {
            domains = domains.split(/[,;\s]+/).map(function (s) { return s.trim(); }).filter(Boolean);
        }
        var extraProviders = patch.allowedSignInProviders;
        if (typeof extraProviders === 'string') {
            extraProviders = extraProviders.split(/[,;\s]+/).map(function (s) { return s.trim(); }).filter(Boolean);
        }
        return db.collection('All_Madrasas').doc(madrasaId)
            .collection('TenantSettings').doc('ssoPolicy')
            .set({
                enforceStaffEmailDomain: !!patch.enforceStaffEmailDomain,
                enforceParentEmailDomain: !!patch.enforceParentEmailDomain,
                enforceGoogleSignInOnly: !!patch.enforceGoogleSignInOnly,
                allowedEmailDomains: domains || [],
                provider: patch.provider || 'google',
                oidcEnabled: !!patch.oidcEnabled,
                oidcProviderId: String(patch.oidcProviderId || '').slice(0, 128),
                oidcIssuerUrl: String(patch.oidcIssuerUrl || '').slice(0, 512),
                oidcClientId: String(patch.oidcClientId || '').slice(0, 256),
                samlEnabled: !!patch.samlEnabled,
                samlProviderId: String(patch.samlProviderId || '').slice(0, 128),
                samlEntityId: String(patch.samlEntityId || '').slice(0, 256),
                samlSsoUrl: String(patch.samlSsoUrl || '').slice(0, 512),
                allowedSignInProviders: Array.isArray(extraProviders) ? extraProviders : [],
                updatedAt: Date.now(),
                updatedBy: (firebase.auth().currentUser && firebase.auth().currentUser.email) || 'admin'
            }, { merge: true })
            .then(function () {
                return global.emsLoadTenantSsoPolicy(madrasaId);
            });
    };

    global.emsValidateEmailDomainForPortal = function (tenantId, portal, email) {
        if (typeof global.emsCallFunction !== 'function') {
            return Promise.resolve({ allowed: true, skipped: true });
        }
        var policy = global.EMS_TENANT_SSO_POLICY;
        if (policy) {
            var enforce = portal === 'parent'
                ? !!policy.enforceParentEmailDomain
                : !!policy.enforceStaffEmailDomain;
            if (!enforce) {
                return Promise.resolve({ allowed: true, skipped: true });
            }
        }
        return global.emsCallFunction('validateStaffEmailDomain', {
            tenantId: tenantId,
            portal: portal || 'teacher',
            email: email || (firebase.auth().currentUser && firebase.auth().currentUser.email) || ''
        }).then(function (res) {
            return { allowed: !!(res && res.allowed), skipped: !!(res && res.skipped) };
        }).catch(function (err) {
            var code = (err && err.code) || '';
            var msg = (err && err.message) || String(err || '');
            if (code === 'functions/permission-denied' || msg.indexOf('permission-denied') >= 0 || msg.indexOf('مجاز نہیں') >= 0) {
                return { allowed: false, error: msg };
            }
            return { allowed: true, skipped: true, cfError: msg };
        });
    };

    global.emsGetTenantSsoProviders = function () {
        var p = global.EMS_TENANT_SSO_POLICY || {};
        var list = ['google.com'];
        if (p.oidcEnabled && p.oidcProviderId) list.push(p.oidcProviderId);
        if (p.samlEnabled && p.samlProviderId) list.push(p.samlProviderId);
        if (Array.isArray(p.allowedSignInProviders)) {
            p.allowedSignInProviders.forEach(function (id) {
                if (id && list.indexOf(id) < 0) list.push(id);
            });
        }
        if (p.enforceGoogleSignInOnly) return ['google.com'];
        return list;
    };

    global.emsRenderOrgSsoLoginHint = function () {
        var p = global.EMS_TENANT_SSO_POLICY;
        var el = document.getElementById('ems-org-sso-hint');
        if (!el || !p) return;
        var parts = [];
        if (p.enforceGoogleSignInOnly) {
            el.textContent = 'This madrasa requires Google Sign-In only.';
            el.style.display = 'block';
            return;
        }
        if (p.oidcEnabled && p.oidcProviderId) parts.push('OIDC (' + p.oidcProviderId + ')');
        if (p.samlEnabled && p.samlProviderId) parts.push('SAML (' + p.samlProviderId + ')');
        if (parts.length) {
            el.textContent = 'ادارہ SSO فعال: ' + parts.join(' + ') + ' — Firebase Console میں provider configure کریں۔';
            el.style.display = 'block';
        } else {
            el.textContent = '';
            el.style.display = 'none';
        }
    };

    global.emsIsGoogleSignInOnlyEnforced = function () {
        var p = global.EMS_TENANT_SSO_POLICY;
        return !!(p && p.enforceGoogleSignInOnly);
    };

    global.emsResolveLoginTenantForSso = function (portal) {
        if (portal === 'guest') return null;
        if (typeof global.emsReadOfflineSession === 'function') {
            var snap = global.emsReadOfflineSession();
            if (snap && snap.tenantId) return snap.tenantId;
        }
        if (typeof global.emsReadPersistedBootTenantId === 'function') {
            var tid = global.emsReadPersistedBootTenantId();
            if (tid) return tid;
        }
        return null;
    };

    global.emsRefreshLoginSsoPolicy = function (portal) {
        if (portal === 'guest') {
            global.EMS_TENANT_SSO_POLICY = { enforceGoogleSignInOnly: true };
            return Promise.resolve(global.EMS_TENANT_SSO_POLICY);
        }
        var tenantId = global.emsResolveLoginTenantForSso(portal);
        if (!tenantId || typeof global.emsLoadTenantSsoPolicy !== 'function') {
            global.EMS_TENANT_SSO_POLICY = { enforceGoogleSignInOnly: false };
            return Promise.resolve(global.EMS_TENANT_SSO_POLICY);
        }
        return global.emsLoadTenantSsoPolicy(tenantId).catch(function () {
            global.EMS_TENANT_SSO_POLICY = { enforceGoogleSignInOnly: false };
            return global.EMS_TENANT_SSO_POLICY;
        });
    };

    global.emsEmailPasswordLoginAllowed = function () {
        return !global.emsIsGoogleSignInOnlyEnforced();
    };
})(window);
