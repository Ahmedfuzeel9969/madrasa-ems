// ============================================================================
// EMS Tenant Security Policy — Firestore-backed org-wide settings (Phase 6)
// Path: All_Madrasas/{tenantId}/TenantSettings/securityPolicy
// ============================================================================
(function (global) {
    'use strict';

    global.EMS_DEFAULT_SECURITY_POLICY = {
        requireAccessKey: true,
        keyRotationReminderDays: 30,
        enableKeyExpiryAlerts: true,
        notifyOwnerOnKeyExpiry: true,
        enableEmailDelivery: true,
        enablePushDelivery: true,
        notifyParentOnAdminReply: true,
        enableScheduledAuditExport: true,
        enableComplianceRetention: true,
        auditRetentionDays: 365,
        enableLoginSessionRegistry: true,
        maxActiveSessionsPerUser: 5,
        requireTrustedDeviceForStaff: false,
        requireTrustedDeviceForParents: false,
        trustedDeviceExpiryDays: 0,
        notifyOwnerOnTrustedDeviceRequest: true,
        trustedDeviceMaxRequestsPerDay: 5,
        enableSecurityWebhooks: false,
        securityWebhookUrl: '',
        securityWebhookSecret: '',
        enableSecurityAlertDigest: false,
        securityAlertThreshold7d: 5,
        notifyOwnerOnSecurityAlert: true,
        enableIpAllowlist: false,
        allowedIpRanges: [],
        enableCountryAllowlist: false,
        allowedCountries: [],
        enableLoginBruteForceProtection: false,
        maxLoginFailuresPerEmail: 5,
        loginLockoutMinutes: 15,
        enableSessionAnomalyDetection: false,
        notifyOwnerOnSessionAnomaly: true,
        sessionAnomalyMaxPerHour: 3,
        parentDataCfOnly: true,
        parentMessagingCfOnly: true,
        enforceStaffRbac: true
    };

    function getDb() {
        return typeof global.getDbOrNull === 'function' ? global.getDbOrNull() : null;
    }

    function mergePolicy(data) {
        var base = global.EMS_DEFAULT_SECURITY_POLICY;
        var out = {};
        Object.keys(base).forEach(function (k) { out[k] = base[k]; });
        if (data) {
            Object.keys(data).forEach(function (k) {
                if (k in base) out[k] = data[k];
            });
        }
        return out;
    }

    global.emsLoadTenantSecurityPolicy = function (madrasaId) {
        var db = getDb();
        if (!db || !madrasaId) {
            return Promise.resolve(mergePolicy(null));
        }
        return db.collection('All_Madrasas').doc(madrasaId)
            .collection('TenantSettings').doc('securityPolicy').get()
            .then(function (doc) {
                var policy = mergePolicy(doc.exists ? doc.data() : null);
                global.EMS_TENANT_SECURITY_POLICY = policy;
                return policy;
            })
            .catch(function () {
                return mergePolicy(null);
            });
    };

    global.emsSaveTenantSecurityPolicy = function (madrasaId, patch) {
        var db = getDb();
        if (!db || !madrasaId) return Promise.reject(new Error('tenantId درکار ہے'));
        var current = mergePolicy(global.EMS_TENANT_SECURITY_POLICY || null);
        var next = mergePolicy(Object.assign({}, current, patch || {}));
        return db.collection('All_Madrasas').doc(madrasaId)
            .collection('TenantSettings').doc('securityPolicy')
            .set({
                requireAccessKey: !!next.requireAccessKey,
                keyRotationReminderDays: parseInt(next.keyRotationReminderDays, 10) || 30,
                enableKeyExpiryAlerts: !!next.enableKeyExpiryAlerts,
                notifyOwnerOnKeyExpiry: !!next.notifyOwnerOnKeyExpiry,
                enableEmailDelivery: !!next.enableEmailDelivery,
                enablePushDelivery: !!next.enablePushDelivery,
                notifyParentOnAdminReply: !!next.notifyParentOnAdminReply,
                enableScheduledAuditExport: !!next.enableScheduledAuditExport,
                enableComplianceRetention: !!next.enableComplianceRetention,
                auditRetentionDays: parseInt(next.auditRetentionDays, 10) || 365,
                enableLoginSessionRegistry: !!next.enableLoginSessionRegistry,
                maxActiveSessionsPerUser: parseInt(next.maxActiveSessionsPerUser, 10) || 5,
                requireTrustedDeviceForStaff: !!next.requireTrustedDeviceForStaff,
                requireTrustedDeviceForParents: !!next.requireTrustedDeviceForParents,
                trustedDeviceExpiryDays: parseInt(next.trustedDeviceExpiryDays, 10) || 0,
                notifyOwnerOnTrustedDeviceRequest: next.notifyOwnerOnTrustedDeviceRequest !== false,
                trustedDeviceMaxRequestsPerDay: parseInt(next.trustedDeviceMaxRequestsPerDay, 10) || 0,
                enableSecurityWebhooks: !!next.enableSecurityWebhooks,
                securityWebhookUrl: String(next.securityWebhookUrl || '').slice(0, 512),
                securityWebhookSecret: String(next.securityWebhookSecret || '').slice(0, 128),
                enableSecurityAlertDigest: !!next.enableSecurityAlertDigest,
                securityAlertThreshold7d: parseInt(next.securityAlertThreshold7d, 10) || 0,
                notifyOwnerOnSecurityAlert: next.notifyOwnerOnSecurityAlert !== false,
                enableIpAllowlist: !!next.enableIpAllowlist,
                allowedIpRanges: Array.isArray(next.allowedIpRanges)
                    ? next.allowedIpRanges.map(function (r) { return String(r || '').slice(0, 64); }).filter(Boolean)
                    : String(next.allowedIpRanges || '').split(/[,;\s\n]+/).filter(Boolean),
                enableCountryAllowlist: !!next.enableCountryAllowlist,
                allowedCountries: Array.isArray(next.allowedCountries)
                    ? next.allowedCountries.map(function (c) { return String(c || '').slice(0, 4).toUpperCase(); }).filter(Boolean)
                    : String(next.allowedCountries || '').split(/[,;\s\n]+/).map(function (c) { return c.toUpperCase(); }).filter(Boolean),
                enableLoginBruteForceProtection: !!next.enableLoginBruteForceProtection,
                maxLoginFailuresPerEmail: parseInt(next.maxLoginFailuresPerEmail, 10) || 5,
                loginLockoutMinutes: parseInt(next.loginLockoutMinutes, 10) || 15,
                enableSessionAnomalyDetection: !!next.enableSessionAnomalyDetection,
                notifyOwnerOnSessionAnomaly: next.notifyOwnerOnSessionAnomaly !== false,
                sessionAnomalyMaxPerHour: parseInt(next.sessionAnomalyMaxPerHour, 10) || 3,
                parentDataCfOnly: !!next.parentDataCfOnly,
                parentMessagingCfOnly: !!next.parentMessagingCfOnly,
                enforceStaffRbac: !!next.enforceStaffRbac,
                updatedAt: Date.now(),
                updatedBy: (firebase.auth().currentUser && firebase.auth().currentUser.email) || 'admin'
            }, { merge: true })
            .then(function () {
                global.EMS_TENANT_SECURITY_POLICY = next;
                return next;
            });
    };

    global.emsGetTenantSecurityPolicy = function () {
        return global.EMS_TENANT_SECURITY_POLICY || mergePolicy(null);
    };

    global.emsEnsureTenantSecurityPolicy = function (madrasaId) {
        if (global.EMS_TENANT_SECURITY_POLICY && global.EMS_TENANT_POLICY_TENANT === madrasaId) {
            return Promise.resolve(global.EMS_TENANT_SECURITY_POLICY);
        }
        return global.emsLoadTenantSecurityPolicy(madrasaId).then(function (p) {
            global.EMS_TENANT_POLICY_TENANT = madrasaId;
            return p;
        });
    };

    global.emsValidateLoginIpForPortal = function (tenantId, portal) {
        if (typeof global.emsCallFunction !== 'function') {
            return Promise.resolve({ allowed: true, skipped: true });
        }
        var policy = global.EMS_TENANT_SECURITY_POLICY;
        if (policy && !policy.enableIpAllowlist) {
            return Promise.resolve({ allowed: true, skipped: true });
        }
        return global.emsCallFunction('validateLoginIpAddress', {
            tenantId: tenantId,
            portal: portal || 'teacher'
        }).then(function (res) {
            return { allowed: !!(res && res.allowed), skipped: !!(res && res.skipped), ip: res && res.ip };
        }).catch(function (err) {
            var code = (err && err.code) || '';
            var msg = (err && err.message) || String(err || '');
            if (code === 'functions/permission-denied' || msg.indexOf('permission-denied') >= 0 || msg.indexOf('مجاز نہیں') >= 0) {
                return { allowed: false, error: msg };
            }
            return { allowed: true, skipped: true, cfError: msg };
        });
    };

    global.emsValidateLoginCountryForPortal = function (tenantId, portal) {
        if (typeof global.emsCallFunction !== 'function') {
            return Promise.resolve({ allowed: true, skipped: true });
        }
        var policy = global.EMS_TENANT_SECURITY_POLICY;
        if (policy && !policy.enableCountryAllowlist) {
            return Promise.resolve({ allowed: true, skipped: true });
        }
        return global.emsCallFunction('validateLoginCountry', {
            tenantId: tenantId,
            portal: portal || 'teacher'
        }).then(function (res) {
            return { allowed: !!(res && res.allowed), skipped: !!(res && res.skipped), country: res && res.country };
        }).catch(function (err) {
            var code = (err && err.code) || '';
            var msg = (err && err.message) || String(err || '');
            if (code === 'functions/permission-denied' || msg.indexOf('permission-denied') >= 0 || msg.indexOf('مجاز نہیں') >= 0) {
                return { allowed: false, error: msg };
            }
            return { allowed: true, skipped: true, cfError: msg };
        });
    };

    global.emsCheckTenantLoginAllowed = function (tenantId, email) {
        if (typeof global.emsCallFunction !== 'function') {
            return Promise.resolve({ allowed: true, skipped: true });
        }
        var policy = global.EMS_TENANT_SECURITY_POLICY;
        if (policy && !policy.enableLoginBruteForceProtection) {
            return Promise.resolve({ allowed: true, skipped: true });
        }
        return global.emsCallFunction('checkTenantLoginAllowed', {
            tenantId: tenantId,
            email: email || (firebase.auth().currentUser && firebase.auth().currentUser.email) || ''
        }).then(function (res) {
            return {
                allowed: res ? res.allowed !== false : true,
                skipped: !!(res && res.skipped),
                lockedUntil: res && res.lockedUntil,
                attempts: res && res.attempts
            };
        }).catch(function () {
            return { allowed: true, skipped: true };
        });
    };

    global.emsRecordTenantLoginFailure = function (tenantId, email) {
        if (typeof global.emsCallFunction !== 'function') return Promise.resolve({ ok: true, skipped: true });
        return global.emsCallFunction('recordTenantLoginFailure', { tenantId: tenantId, email: email || '' });
    };

    global.emsClearTenantLoginSuccess = function (tenantId, email) {
        if (typeof global.emsCallFunction !== 'function') return Promise.resolve({ ok: true, skipped: true });
        return global.emsCallFunction('clearTenantLoginSuccess', { tenantId: tenantId, email: email || '' });
    };

})(window);
