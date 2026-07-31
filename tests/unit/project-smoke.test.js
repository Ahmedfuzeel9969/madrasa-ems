import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readAppScriptManifest } from '../helpers/boot-manifest.js';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('project smoke', function () {
    it('index.html has manifest and allows zoom', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('rel="manifest"');
        expect(html).not.toContain('user-scalable=no');
    });

    it('firestore.rules has staff RBAC helpers', function () {
        var rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
        expect(rules).toContain('canWriteStaffModule');
        expect(rules).toContain('canOwnerAct');
        expect(rules).toContain('canStaffDelete');
        expect(rules).toContain('staffHasAction');
        expect(rules).toContain('EmsAudit');
    });

    it('dist build manifest lists core assets after build', function () {
        var manifestPath = path.join(ROOT, 'dist', '.hosting-manifest.json');
        if (!fs.existsSync(manifestPath)) return;
        var m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        expect(m.files['index.html']).toBeTruthy();
        expect(m.files['service-worker.js']).toBeTruthy();
        if (fs.existsSync(path.join(ROOT, 'dist', 'ems-utils.js'))) {
            expect(m.files['ems-utils.js']).toBeTruthy();
        }
    });

    it('functions export Phase 3+4 endpoints', function () {
        var idx = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
        expect(idx).toContain('checkMfaCompliance');
        expect(idx).toContain('getParentStudentData');
        expect(idx).toContain('syncStaffClaims');
        expect(idx).toContain('pingBackend');
        expect(idx).toContain('resolveSuperAdminAccess');
        expect(idx).toContain('rejectManualPayment');
        expect(idx).toContain('purgeExpiredTempGrantsScheduled');
        expect(idx).toContain('submitParentMessage');
        expect(idx).toContain('getAccessKeyExpiryReport');
        expect(idx).toContain('scheduledKeyRotationReminders');
        expect(idx).toContain('markParentMessagesRead');
    });

    it('Phase 6 security policy and alerts', function () {
        var rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
        expect(rules).toContain('KeyExpiryAlerts');
        expect(fs.existsSync(path.join(ROOT, 'tenant-security.js'))).toBe(true);
        var fb = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase.json'), 'utf8'));
        expect(fb.emulators).toBeTruthy();
        expect(fb.emulators.auth).toBeTruthy();
    });

    it('Phase 7 notifications, audit export, policy runtime', function () {
        var idx = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
        expect(idx).toContain('exportSecurityLog');
        expect(fs.existsSync(path.join(ROOT, 'functions', 'lib', 'key-notifications.js'))).toBe(true);
        expect(fs.existsSync(path.join(ROOT, 'functions', 'lib', 'security-audit.js'))).toBe(true);
        expect(fs.existsSync(path.join(ROOT, 'scripts', 'seed-emulator-login.js'))).toBe(true);
        var rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
        expect(rules).toContain('KeyExpiryNotifications');
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('ap-sp-notify-owner');
        expect(html).toContain('apExportSecurityLog');
        var ig = fs.readFileSync(path.join(ROOT, 'identity-gate.js'), 'utf8');
        expect(ig).toContain('policyRequiresAccessKey');
        var ts = fs.readFileSync(path.join(ROOT, 'tenant-security.js'), 'utf8');
        expect(ts).toContain('notifyOwnerOnKeyExpiry');
    });

    it('Phase 8 delivery, audit storage, parent push', function () {
        var idx = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
        expect(idx).toContain('scheduledDeliverKeyExpiryNotifications');
        expect(idx).toContain('scheduledSecurityLogExport');
        expect(idx).toContain('triggerSecurityLogExport');
        expect(idx).toContain('onParentMessageCreated');
        expect(idx).toContain('registerParentDeviceToken');
        expect(fs.existsSync(path.join(ROOT, 'functions', 'lib', 'notification-delivery.js'))).toBe(true);
        expect(fs.existsSync(path.join(ROOT, 'functions', 'lib', 'parent-push.js'))).toBe(true);
        expect(fs.existsSync(path.join(ROOT, 'cloud', 'ems-push-register.js'))).toBe(true);
        var rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
        expect(rules).toContain('ParentDeviceTokens');
        expect(rules).toContain('ParentPushNotifications');
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('ap-sp-parent-reply-push');
        expect(html).toContain('apTriggerAuditExportToStorage');
        expect(html).toContain('ems-deferred-libs.js');
        var libs = fs.readFileSync(path.join(ROOT, 'ems-deferred-libs.js'), 'utf8');
        expect(libs).toContain('emsLoadFirebaseMessaging');
    });

    it('Phase 9 VAPID UI, retry dashboard, signed audit URL', function () {
        var idx = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
        expect(idx).toContain('getTenantPushConfig');
        expect(idx).toContain('getFailedNotifications');
        expect(idx).toContain('retryFailedNotification');
        expect(idx).toContain('getAuditExportDownloadUrl');
        expect(fs.existsSync(path.join(ROOT, 'tenant-delivery.js'))).toBe(true);
        expect(fs.existsSync(path.join(ROOT, 'functions', 'lib', 'notification-retry.js'))).toBe(true);
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('ap-fcm-vapid-key');
        expect(html).toContain('ap-failed-notify-tbody');
        expect(html).toContain('apDownloadAuditExportSignedUrl');
        var push = fs.readFileSync(path.join(ROOT, 'cloud', 'ems-push-register.js'), 'utf8');
        expect(push).toContain('emsEnsureTenantPushConfig');
    });

    it('Phase 10 audit history, bulk retry, retention, FCM SW', function () {
        var idx = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
        expect(idx).toContain('listAuditExportHistory');
        expect(idx).toContain('retryAllFailedNotifications');
        expect(idx).toContain('getNotificationDeliveryStats');
        expect(idx).toContain('scheduledComplianceRetention');
        expect(fs.existsSync(path.join(ROOT, 'firebase-messaging-sw.js'))).toBe(true);
        var rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
        expect(rules).toContain('SecurityAuditExports');
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('ap-audit-exports-tbody');
        expect(html).toContain('apRetryAllFailedNotifications');
        expect(html).toContain('ap-notify-stats');
        var ts = fs.readFileSync(path.join(ROOT, 'tenant-security.js'), 'utf8');
        expect(ts).toContain('auditRetentionDays');
    });

    it('Phase 11 login sessions + notification analytics', function () {
        var idx = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
        expect(idx).toContain('registerLoginSession');
        expect(idx).toContain('listLoginSessions');
        expect(idx).toContain('getNotificationAnalytics');
        expect(idx).toContain('scheduledNotificationAnalytics');
        expect(fs.existsSync(path.join(ROOT, 'ems-session-registry.js'))).toBe(true);
        var rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
        expect(rules).toContain('LoginSessions');
        expect(rules).toContain('NotificationAnalyticsDaily');
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('ap-login-sessions-tbody');
        expect(html).toContain('ap-notify-analytics-tbody');
        expect(html).toContain('ap-sp-session-registry');
    });

    it('Phase 12 trusted devices + SSO email domain', function () {
        var idx = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
        expect(idx).toContain('checkTrustedDevice');
        expect(idx).toContain('requestTrustedDevice');
        expect(idx).toContain('approveTrustedDevice');
        expect(idx).toContain('getTenantSsoPolicy');
        expect(idx).toContain('validateStaffEmailDomain');
        expect(fs.existsSync(path.join(ROOT, 'functions', 'lib', 'trusted-devices.js'))).toBe(true);
        expect(fs.existsSync(path.join(ROOT, 'functions', 'lib', 'sso-policy.js'))).toBe(true);
        expect(fs.existsSync(path.join(ROOT, 'ems-trusted-device.js'))).toBe(true);
        expect(fs.existsSync(path.join(ROOT, 'tenant-sso.js'))).toBe(true);
        var rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
        expect(rules).toContain('TrustedDevices');
        var ig = fs.readFileSync(path.join(ROOT, 'identity-gate.js'), 'utf8');
        expect(ig).toContain('proceedTeacherTrustedGate');
        expect(ig).toContain('emsValidateEmailDomainForPortal');
        var ts = fs.readFileSync(path.join(ROOT, 'tenant-security.js'), 'utf8');
        expect(ts).toContain('requireTrustedDeviceForStaff');
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        var manifest = readAppScriptManifest(ROOT);
        expect(html).toContain('ap-trusted-devices-tbody');
        expect(html).toContain('ap-sso-domains');
        expect(manifest.combined).toContain('tenant-sso.js');
        expect(manifest.combined).toContain('ems-trusted-device.js');
        expect(html).toContain('ap-sp-trusted-device');
        var sso = require(path.join(ROOT, 'functions', 'lib', 'sso-policy'));
        expect(sso.emailMatchesDomains('a@example.org', ['example.org'])).toBe(true);
        expect(sso.emailMatchesDomains('a@bad.com', ['example.org'])).toBe(false);
    });

    it('Phase 13 parent SSO gate, device revoke/expiry, audit', function () {
        var idx = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
        expect(idx).toContain('revokeTrustedDevice');
        expect(idx).toContain('scheduledTrustedDeviceExpiry');
        expect(fs.existsSync(path.join(ROOT, 'functions', 'lib', 'security-log-write.js'))).toBe(true);
        var ig = fs.readFileSync(path.join(ROOT, 'identity-gate.js'), 'utf8');
        expect(ig).toContain('proceedParentDomainGate');
        expect(ig).toContain('runPortalDomainGate');
        expect(ig).toContain('proceedAdminWithDomainGate');
        var ts = fs.readFileSync(path.join(ROOT, 'tenant-security.js'), 'utf8');
        expect(ts).toContain('trustedDeviceExpiryDays');
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('ap-sp-trusted-expiry-days');
        var ap13 = fs.readFileSync(path.join(ROOT, 'admin-panel.js'), 'utf8');
        expect(ap13).toContain('apRevokeTrustedDevice');
        var trusted = require(path.join(ROOT, 'functions', 'lib', 'trusted-devices'));
        expect(trusted.isDeviceExpired(Date.now() - 100 * 86400000, 90)).toBe(true);
    });

    it('Phase 14 MFA login gate, device alerts, security feed', function () {
        var idx = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
        expect(idx).toContain('getRecentSecurityEvents');
        expect(idx).toContain('approveAllPendingTrustedDevices');
        expect(fs.existsSync(path.join(ROOT, 'functions', 'lib', 'trusted-device-notify.js'))).toBe(true);
        expect(fs.existsSync(path.join(ROOT, 'functions', 'lib', 'security-events-feed.js'))).toBe(true);
        var ig = fs.readFileSync(path.join(ROOT, 'identity-gate.js'), 'utf8');
        expect(ig).toContain('proceedAdminMfaGate');
        var ts = fs.readFileSync(path.join(ROOT, 'tenant-security.js'), 'utf8');
        expect(ts).toContain('notifyOwnerOnTrustedDeviceRequest');
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('ap-security-events-tbody');
        expect(html).toContain('apApproveAllPendingTrustedDevices');
        var ap14 = fs.readFileSync(path.join(ROOT, 'admin-panel.js'), 'utf8');
        expect(ap14).toContain('apLoadSecurityEvents');
    });

    it('Phase 15 staff MFA gate, device stats, security export', function () {
        var idx = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
        expect(idx).toContain('getTrustedDeviceStats');
        expect(idx).toContain('exportSecurityEvents');
        var mfa = fs.readFileSync(path.join(ROOT, 'functions', 'lib', 'mfa.js'), 'utf8');
        expect(mfa).toContain('requireMfaForStaff');
        expect(mfa).toContain('isActiveStaff');
        var ig = fs.readFileSync(path.join(ROOT, 'identity-gate.js'), 'utf8');
        expect(ig).toContain('proceedTeacherMfaGate');
        expect(ig).toContain('emsCheckMfaComplianceForPortal');
        var sm = fs.readFileSync(path.join(ROOT, 'security-mfa.js'), 'utf8');
        expect(sm).toContain('ems-mfa-require-staff');
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('ap-trusted-device-stats');
        expect(html).toContain('apExportSecurityEvents');
        var ap15 = fs.readFileSync(path.join(ROOT, 'admin-panel.js'), 'utf8');
        expect(ap15).toContain('apLoadTrustedDeviceStats');
    });

    it('Phase 16 parent MFA gate, MFA audit, policy summary', function () {
        var idx = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
        expect(idx).toContain('getMfaPolicySummary');
        var mfa = fs.readFileSync(path.join(ROOT, 'functions', 'lib', 'mfa.js'), 'utf8');
        expect(mfa).toContain('requireMfaForParent');
        expect(mfa).toContain('isActiveParent');
        expect(mfa).toContain('mfa_session_required');
        var ig = fs.readFileSync(path.join(ROOT, 'identity-gate.js'), 'utf8');
        expect(ig).toContain('proceedParentMfaGate');
        var sm = fs.readFileSync(path.join(ROOT, 'security-mfa.js'), 'utf8');
        expect(sm).toContain('ems-mfa-require-parent');
        expect(sm).toContain('emsRenderParentMfaBanner');
        var pp = fs.readFileSync(path.join(ROOT, 'parent-portal.js'), 'utf8');
        expect(pp).toContain('emsRenderParentMfaBanner');
        var feed = fs.readFileSync(path.join(ROOT, 'functions', 'lib', 'security-events-feed.js'), 'utf8');
        expect(feed).toContain('MFA_ACTIONS');
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('ap-mfa-policy-summary');
        expect(html).toContain('value="mfa"');
        var ap = fs.readFileSync(path.join(ROOT, 'admin-panel.js'), 'utf8');
        expect(ap).toContain('apLoadMfaPolicySummary');
    });

    it('Phase 17 parent trusted device, Google SSO, login overview', function () {
        var idx = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
        expect(idx).toContain('getLoginSecurityOverview');
        expect(fs.existsSync(path.join(ROOT, 'functions', 'lib', 'login-security-overview.js'))).toBe(true);
        var ts = fs.readFileSync(path.join(ROOT, 'tenant-security.js'), 'utf8');
        expect(ts).toContain('requireTrustedDeviceForParents');
        var ig = fs.readFileSync(path.join(ROOT, 'identity-gate.js'), 'utf8');
        expect(ig).toContain('proceedParentTrustedGate');
        expect(ig).toContain('policyRequiresTrustedDeviceForParent');
        var sso = fs.readFileSync(path.join(ROOT, 'functions', 'lib', 'sso-policy.js'), 'utf8');
        expect(sso).toContain('enforceGoogleSignInOnly');
        expect(sso).toContain('sso_provider_denied');
        var td = fs.readFileSync(path.join(ROOT, 'functions', 'lib', 'trusted-devices.js'), 'utf8');
        expect(td).toContain('requireTrustedDeviceForParents');
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('ap-login-security-overview');
        expect(html).toContain('ap-sp-trusted-parent');
        expect(html).toContain('ap-sso-google-only');
        var ap = fs.readFileSync(path.join(ROOT, 'admin-panel.js'), 'utf8');
        expect(ap).toContain('apLoadLoginSecurityOverview');
    });

    it('Phase 18 security webhooks + device rate limiting', function () {
        var idx = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
        expect(idx).toContain('testSecurityWebhook');
        expect(idx).toContain('getSecurityWebhookStatus');
        expect(fs.existsSync(path.join(ROOT, 'functions', 'lib', 'security-webhook.js'))).toBe(true);
        var logWrite = fs.readFileSync(path.join(ROOT, 'functions', 'lib', 'security-log-write.js'), 'utf8');
        expect(logWrite).toContain('security-webhook');
        var td = fs.readFileSync(path.join(ROOT, 'functions', 'lib', 'trusted-devices.js'), 'utf8');
        expect(td).toContain('trusted_device_rate_limited');
        expect(td).toContain('countRecentDeviceRequests');
        var ts = fs.readFileSync(path.join(ROOT, 'tenant-security.js'), 'utf8');
        expect(ts).toContain('enableSecurityWebhooks');
        expect(ts).toContain('trustedDeviceMaxRequestsPerDay');
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('ap-security-webhook-status');
        expect(html).toContain('ap-sp-webhook-url');
        expect(html).toContain('ap-sp-device-rate-limit');
        var ap = fs.readFileSync(path.join(ROOT, 'admin-panel.js'), 'utf8');
        expect(ap).toContain('apTestSecurityWebhook');
        expect(ap).toContain('apLoadSecurityWebhookStatus');
    });

    it('Phase 19 OIDC/SAML SSO policy hooks', function () {
        var idx = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
        expect(idx).toContain('validateOidcIssuerConfig');
        expect(idx).toContain('getSsoProviderSummary');
        expect(fs.existsSync(path.join(ROOT, 'functions', 'lib', 'sso-oidc.js'))).toBe(true);
        var sso = fs.readFileSync(path.join(ROOT, 'functions', 'lib', 'sso-policy.js'), 'utf8');
        expect(sso).toContain('resolveAllowedProviders');
        expect(sso).toContain('oidcEnabled');
        var ts = fs.readFileSync(path.join(ROOT, 'tenant-sso.js'), 'utf8');
        expect(ts).toContain('samlEnabled');
        expect(ts).toContain('emsRenderOrgSsoLoginHint');
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('ap-sso-oidc-issuer');
        expect(html).toContain('ap-sso-saml-enable');
        expect(html).toContain('ems-org-sso-hint');
        var ap = fs.readFileSync(path.join(ROOT, 'admin-panel.js'), 'utf8');
        expect(ap).toContain('apValidateOidcIssuer');
        expect(ap).toContain('apLoadSsoProviderSummary');
    });

    it('Phase 20 security alert digest + threshold notifications', function () {
        var idx = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
        expect(idx).toContain('getSecurityAlertSummary');
        expect(idx).toContain('scheduledSecurityAlertDigest');
        expect(fs.existsSync(path.join(ROOT, 'functions', 'lib', 'security-alert-digest.js'))).toBe(true);
        var ts = fs.readFileSync(path.join(ROOT, 'tenant-security.js'), 'utf8');
        expect(ts).toContain('enableSecurityAlertDigest');
        expect(ts).toContain('securityAlertThreshold7d');
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('ap-security-alert-summary');
        expect(html).toContain('ap-sp-alert-digest');
        var ap = fs.readFileSync(path.join(ROOT, 'admin-panel.js'), 'utf8');
        expect(ap).toContain('apLoadSecurityAlertSummary');
    });

    it('Phase 21 IP allowlist gate + emulator seed update', function () {
        var idx = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
        expect(idx).toContain('validateLoginIpAddress');
        expect(idx).toContain('getLoginIpPolicySummary');
        expect(fs.existsSync(path.join(ROOT, 'functions', 'lib', 'login-ip-policy.js'))).toBe(true);
        var ts = fs.readFileSync(path.join(ROOT, 'tenant-security.js'), 'utf8');
        expect(ts).toContain('enableIpAllowlist');
        expect(ts).toContain('emsValidateLoginIpForPortal');
        var ig = fs.readFileSync(path.join(ROOT, 'identity-gate.js'), 'utf8');
        expect(ig).toContain('runPortalSecurityGates');
        expect(ig).toContain('runPortalIpGate');
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('ap-login-ip-summary');
        expect(html).toContain('ap-sp-ip-ranges');
        var ap = fs.readFileSync(path.join(ROOT, 'admin-panel.js'), 'utf8');
        expect(ap).toContain('apLoadLoginIpSummary');
        var seed = fs.readFileSync(path.join(ROOT, 'scripts', 'seed-emulator-login.js'), 'utf8');
        expect(seed).toContain('enableIpAllowlist');
        expect(seed).toContain('ssoPolicy');
    });

    it('Phase 22 production health check + deploy readiness', function () {
        var idx = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
        expect(idx).toContain('getLoginSecurityHealthCheck');
        expect(fs.existsSync(path.join(ROOT, 'functions', 'lib', 'login-security-health.js'))).toBe(true);
        expect(fs.existsSync(path.join(ROOT, 'scripts', 'enterprise-login-deploy-check.js'))).toBe(true);
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('ap-login-security-health');
        expect(html).toContain('ap-login-security-health-tbody');
        var ap = fs.readFileSync(path.join(ROOT, 'admin-panel.js'), 'utf8');
        expect(ap).toContain('apLoadLoginSecurityHealth');
        var pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
        expect(pkg.scripts['preflight:login']).toBe('node scripts/enterprise-login-deploy-check.js');
    });

    it('Phase 23 country allowlist + backend probe', function () {
        var idx = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
        expect(idx).toContain('validateLoginCountry');
        expect(idx).toContain('probeLoginSecurityBackend');
        expect(fs.existsSync(path.join(ROOT, 'functions', 'lib', 'login-security-probe.js'))).toBe(true);
        var ts = fs.readFileSync(path.join(ROOT, 'tenant-security.js'), 'utf8');
        expect(ts).toContain('enableCountryAllowlist');
        expect(ts).toContain('emsValidateLoginCountryForPortal');
        var ig = fs.readFileSync(path.join(ROOT, 'identity-gate.js'), 'utf8');
        expect(ig).toContain('runPortalCountryGate');
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('ap-sp-country-allowlist');
        expect(html).toContain('apProbeLoginSecurityBackend');
        var ap = fs.readFileSync(path.join(ROOT, 'admin-panel.js'), 'utf8');
        expect(ap).toContain('apProbeLoginSecurityBackend');
    });

    it('Phase 24 login brute-force protection', function () {
        var idx = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
        expect(idx).toContain('checkTenantLoginAllowed');
        expect(idx).toContain('unlockTenantLoginLockout');
        expect(fs.existsSync(path.join(ROOT, 'functions', 'lib', 'login-brute-force.js'))).toBe(true);
        var ts = fs.readFileSync(path.join(ROOT, 'tenant-security.js'), 'utf8');
        expect(ts).toContain('enableLoginBruteForceProtection');
        expect(ts).toContain('emsCheckTenantLoginAllowed');
        var ig = fs.readFileSync(path.join(ROOT, 'identity-gate.js'), 'utf8');
        expect(ig).toContain('withBruteForceCheck');
        expect(ig).toContain('emsRecordTenantLoginFailure');
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('ap-sp-brute-force');
        expect(html).toContain('ap-login-lockouts-tbody');
        var ap = fs.readFileSync(path.join(ROOT, 'admin-panel.js'), 'utf8');
        expect(ap).toContain('apLoadLoginLockouts');
        expect(ap).toContain('apUnlockLoginLockout');
        expect(fs.existsSync(path.join(ROOT, 'docs', 'ENTERPRISE-LOGIN-PHASE24.md'))).toBe(true);
    });

    it('Phase 25 session anomaly detection', function () {
        var idx = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
        expect(idx).toContain('getSessionAnomalySummary');
        expect(idx).toContain('dismissSessionAnomaly');
        expect(fs.existsSync(path.join(ROOT, 'functions', 'lib', 'login-session-anomaly.js'))).toBe(true);
        var ts = fs.readFileSync(path.join(ROOT, 'tenant-security.js'), 'utf8');
        expect(ts).toContain('enableSessionAnomalyDetection');
        var ls = fs.readFileSync(path.join(ROOT, 'functions', 'lib', 'login-sessions.js'), 'utf8');
        expect(ls).toContain('processSessionRegistrationAnomalies');
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('ap-sp-session-anomaly');
        expect(html).toContain('ap-session-anomalies-tbody');
        var ap = fs.readFileSync(path.join(ROOT, 'admin-panel.js'), 'utf8');
        expect(ap).toContain('apLoadSessionAnomalies');
        expect(fs.existsSync(path.join(ROOT, 'docs', 'ENTERPRISE-LOGIN-PHASE25.md'))).toBe(true);
    });

    it('Phase 26 login audit export', function () {
        var idx = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
        expect(idx).toContain('exportLoginAudit');
        expect(idx).toContain('getLoginAuditSummary');
        expect(idx).toContain('bulkImportRegistrations');
        expect(fs.existsSync(path.join(ROOT, 'functions', 'lib', 'login-audit-export.js'))).toBe(true);
        expect(fs.existsSync(path.join(ROOT, 'docs', 'ENTERPRISE-LOGIN-PHASE26.md'))).toBe(true);
        var ap = fs.readFileSync(path.join(ROOT, 'admin-panel.js'), 'utf8');
        expect(ap).toContain('apExportLoginAudit');
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('ap-login-audit-summary');
    });

    it('Import Phase 2 templates merge bulk', function () {
        expect(fs.existsSync(path.join(ROOT, 'ems-import-templates.js'))).toBe(true);
        expect(fs.existsSync(path.join(ROOT, 'ems-import-merge.js'))).toBe(true);
        expect(fs.existsSync(path.join(ROOT, 'docs', 'IMPORT-PHASE2.md'))).toBe(true);
        var idx = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
        expect(idx).toContain('bulkImportRegistrations');
        var wiz = fs.readFileSync(path.join(ROOT, 'ems-import-wizard.js'), 'utf8');
        expect(wiz).toContain('emsImportMergeStep5Html');
        expect(wiz).toContain('emsImportTemplatesBar');
    });

    it('Phase 5 tenant settings in rules and access-keys', function () {
        var rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
        expect(rules).toContain('TenantSettings');
        var ak = fs.readFileSync(path.join(ROOT, 'access-keys.js'), 'utf8');
        expect(ak).toContain('emsLoadTenantAccessKeySettings');
    });

    it('parent portal is CF-only (Phase 4)', function () {
        var pp = fs.readFileSync(path.join(ROOT, 'parent-portal.js'), 'utf8');
        expect(pp).toContain('Cloud Function data path only');
        expect(pp).not.toContain('fetchStudentAttendanceFromCache');
        expect(pp).not.toContain('pullRegistrationsForTenant');
    });

    it('super admin module has two-tier nav and email-key rules', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('id="sa-main-nav"');
        expect(html).toContain('id="sa-ribbon-menu"');
        expect(html).toContain('ems-lazy-loader.js');
        var lazy = fs.readFileSync(path.join(ROOT, 'ems-lazy-loader.js'), 'utf8');
        expect(lazy).toContain('sa/sa-nav.js');
        expect(html).toContain('id="sa-boot-banner"');
        var rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
        expect(rules).toContain('isSuperAdminEmailDoc');
        expect(rules).toContain('isSuperAdminPlatformListed');
        var nav = fs.readFileSync(path.join(ROOT, 'sa', 'sa-nav.js'), 'utf8');
        expect(nav).toContain('dashboard');
        expect(nav).toContain('operations');
        expect(nav).toContain('sa-win-tenants');
        expect(fs.existsSync(path.join(ROOT, 'sa', 'sa-ui.js'))).toBe(true);
    });
});
