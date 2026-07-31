/**
 * ============================================================================
 * Cloud Functions — Super Admin Platform Admin API (entry point)
 * ----------------------------------------------------------------------------
 * Every export below is the secure server-side counterpart of a client action.
 * Sensitive operations are permission-checked in lib/guard.js and audited in
 * lib/logger.js. Deploy with:  firebase deploy --only functions
 * ============================================================================
 */
const admin = require('firebase-admin');

if (!admin.apps.length) {
    admin.initializeApp();
}

const rbac = require('./lib/rbac');
const users = require('./lib/users');
const payments = require('./lib/payments');
const stats = require('./lib/stats');
const security = require('./lib/security');
const tenantLinks = require('./lib/tenant-links');
const parentData = require('./lib/parent-data');
const mfa = require('./lib/mfa');
const staffClaims = require('./lib/staff-claims');
const saAccess = require('./lib/sa-access');

/* ----------------------------- RBAC ----------------------------- */
exports.assignRoles = rbac.assignRoles;
exports.getRbacCatalogue = rbac.getRbacCatalogue;

/* ------------------------- User lifecycle ----------------------- */
exports.onAuthCreate = users.onAuthCreate;
exports.onAuthDelete = users.onAuthDelete;
exports.setUserStatus = users.setUserStatus;
exports.bulkSetStatus = users.bulkSetStatus;
exports.forceLogout = users.forceLogout;
exports.linkTenant = users.linkTenant;

/* ----------------------------- Payments ------------------------- */
exports.initiatePayment = payments.initiatePayment;
exports.approveManualPayment = payments.approveManualPayment;
exports.rejectManualPayment = payments.rejectManualPayment;
exports.refundPayment = payments.refundPayment;
exports.stripeWebhook = payments.stripeWebhook;

/* ------------------------------ Stats --------------------------- */
exports.scheduledAggregate = stats.scheduledAggregate;
exports.refreshStats = stats.refreshStats;

/* ---------------------------- Security -------------------------- */
exports.forcePasswordReset = security.forcePasswordReset;
exports.setAccountLock = security.setAccountLock;
exports.checkLoginAllowed = security.checkLoginAllowed;
exports.recordLoginFailure = security.recordLoginFailure;
exports.clearLoginAttempts = security.clearLoginAttempts;

/* ------------------------- Tenant link activation ---------------- */
exports.activateTenantLink = tenantLinks.activateTenantLink;
exports.resolveTenantLink = tenantLinks.resolveTenantLink;

/* ------------------------- Parent scoped data -------------------- */
exports.getParentStudentData = parentData.getParentStudentData;
exports.getParentLinkedStudents = parentData.getParentLinkedStudents;
exports.submitParentVote = parentData.submitParentVote;

/* ------------------------- MFA compliance ------------------------ */
exports.checkMfaCompliance = mfa.checkMfaCompliance;
exports.getMfaPolicySummary = mfa.getMfaPolicySummary;

/* ------------------------- Staff claims + health ----------------- */
exports.syncStaffClaims = staffClaims.syncStaffClaims;
exports.syncStaffClaimsForMember = staffClaims.syncStaffClaimsForMember;
exports.pingBackend = staffClaims.pingBackend;

/* ------------------------- Access key verification (Phase 2) ----- */
const accessKeys = require('./lib/access-keys');
exports.verifyTeacherAccessKey = accessKeys.verifyTeacherKey;
exports.verifyParentAccessKey = accessKeys.verifyParentKey;

/* ------------------------- Temp grant lifecycle (Phase 4) -------- */
const tempGrants = require('./lib/temp-grants');
exports.purgeExpiredTempGrantsScheduled = tempGrants.purgeExpiredTempGrantsScheduled;
exports.onStaffPermissionsWrite = tempGrants.onStaffPermissionsWrite;
exports.onParentPermissionsWrite = tempGrants.onParentPermissionsWrite;

/* ------------------------- Parent messaging (Phase 5) ------------ */
const parentMessages = require('./lib/parent-messages');
exports.submitParentMessage = parentMessages.submitParentMessage;
exports.getParentMessages = parentMessages.getParentMessages;
exports.listParentMessageThreads = parentMessages.listParentMessageThreads;

/* ------------------------- Access key expiry report (Phase 5) ---- */
const accessKeyExpiry = require('./lib/access-key-expiry');
exports.getAccessKeyExpiryReport = accessKeyExpiry.getAccessKeyExpiryReport;

/* ------------------------- Key rotation reminders (Phase 6) ---- */
const keyReminders = require('./lib/key-reminders');
exports.scheduledKeyRotationReminders = keyReminders.scheduledKeyRotationReminders;
exports.getKeyExpiryAlerts = keyReminders.getKeyExpiryAlerts;
exports.dismissKeyExpiryAlert = keyReminders.dismissKeyExpiryAlert;
exports.markParentMessagesRead = parentMessages.markParentMessagesRead;

/* ------------------------- Security audit export (Phase 7) ------- */
const securityAudit = require('./lib/security-audit');
exports.exportSecurityLog = securityAudit.exportSecurityLog;
exports.scheduledSecurityLogExport = securityAudit.scheduledSecurityLogExport;
exports.triggerSecurityLogExport = securityAudit.triggerSecurityLogExport;
exports.getAuditExportDownloadUrl = securityAudit.getAuditExportDownloadUrl;
exports.listAuditExportHistory = securityAudit.listAuditExportHistory;

/* ------------------------- Notification delivery (Phase 8) ----- */
const notificationDelivery = require('./lib/notification-delivery');
exports.scheduledDeliverKeyExpiryNotifications = notificationDelivery.scheduledDeliverKeyExpiryNotifications;

/* ------------------------- Notification retry (Phase 9) -------- */
const notificationRetry = require('./lib/notification-retry');
exports.getFailedNotifications = notificationRetry.getFailedNotifications;
exports.retryFailedNotification = notificationRetry.retryFailedNotification;
exports.retryAllFailedNotifications = notificationRetry.retryAllFailedNotifications;

/* ------------------------- Notification stats (Phase 10) ------- */
const notificationStats = require('./lib/notification-stats');
exports.getNotificationDeliveryStats = notificationStats.getNotificationDeliveryStats;

/* ------------------------- Compliance retention (Phase 10) --- */
const complianceRetention = require('./lib/compliance-retention');
exports.scheduledComplianceRetention = complianceRetention.scheduledComplianceRetention;

/* ------------------------- Push config (Phase 9) --------------- */
const pushConfig = require('./lib/push-config');
exports.getTenantPushConfig = pushConfig.getTenantPushConfig;

/* ------------------------- Parent push + device tokens (Phase 8) */
const parentPush = require('./lib/parent-push');
exports.onParentMessageCreated = parentPush.onParentMessageCreated;
exports.registerParentDeviceToken = parentPush.registerParentDeviceToken;
exports.registerOwnerDeviceToken = parentPush.registerOwnerDeviceToken;

/* ------------------------- Login sessions (Phase 11) ----------- */
const loginSessions = require('./lib/login-sessions');
exports.registerLoginSession = loginSessions.registerLoginSession;
exports.listLoginSessions = loginSessions.listLoginSessions;
exports.revokeLoginSession = loginSessions.revokeLoginSession;
exports.touchLoginSession = loginSessions.touchLoginSession;

/* ------------------------- Notification analytics (Phase 11) --- */
const notificationAnalytics = require('./lib/notification-analytics');
exports.scheduledNotificationAnalytics = notificationAnalytics.scheduledNotificationAnalytics;
exports.getNotificationAnalytics = notificationAnalytics.getNotificationAnalytics;

/* ------------------------- Trusted devices (Phase 12) ---------- */
const trustedDevices = require('./lib/trusted-devices');
exports.checkTrustedDevice = trustedDevices.checkTrustedDevice;
exports.requestTrustedDevice = trustedDevices.requestTrustedDevice;
exports.approveTrustedDevice = trustedDevices.approveTrustedDevice;
exports.rejectTrustedDevice = trustedDevices.rejectTrustedDevice;
exports.revokeTrustedDevice = trustedDevices.revokeTrustedDevice;
exports.listTrustedDevices = trustedDevices.listTrustedDevices;
exports.scheduledTrustedDeviceExpiry = trustedDevices.scheduledTrustedDeviceExpiry;
exports.approveAllPendingTrustedDevices = trustedDevices.approveAllPendingTrustedDevices;
exports.getTrustedDeviceStats = trustedDevices.getTrustedDeviceStats;

/* ------------------------- Security events feed (Phase 14) ----- */
const securityEventsFeed = require('./lib/security-events-feed');
exports.getRecentSecurityEvents = securityEventsFeed.getRecentSecurityEvents;
exports.exportSecurityEvents = securityEventsFeed.exportSecurityEvents;

/* ------------------------- Login security overview (Phase 17) -- */
const loginSecurityOverview = require('./lib/login-security-overview');
exports.getLoginSecurityOverview = loginSecurityOverview.getLoginSecurityOverview;

/* ------------------------- Security webhooks (Phase 18) -------- */
const securityWebhook = require('./lib/security-webhook');
exports.testSecurityWebhook = securityWebhook.testSecurityWebhook;
exports.getSecurityWebhookStatus = securityWebhook.getSecurityWebhookStatus;

/* ------------------------- Security alert digest (Phase 20) -- */
const securityAlertDigest = require('./lib/security-alert-digest');
exports.getSecurityAlertSummary = securityAlertDigest.getSecurityAlertSummary;
exports.scheduledSecurityAlertDigest = securityAlertDigest.scheduledSecurityAlertDigest;

/* ------------------------- Login IP allowlist (Phase 21) ------- */
const loginIpPolicy = require('./lib/login-ip-policy');
exports.validateLoginIpAddress = loginIpPolicy.validateLoginIpAddress;
exports.validateLoginCountry = loginIpPolicy.validateLoginCountry;
exports.getLoginIpPolicySummary = loginIpPolicy.getLoginIpPolicySummary;

/* ------------------------- Login security probe (Phase 23) ----- */
const loginSecurityProbe = require('./lib/login-security-probe');
exports.probeLoginSecurityBackend = loginSecurityProbe.probeLoginSecurityBackend;

/* ------------------------- Login brute-force (Phase 24) -------- */
const loginBruteForce = require('./lib/login-brute-force');
exports.checkTenantLoginAllowed = loginBruteForce.checkTenantLoginAllowed;
exports.recordTenantLoginFailure = loginBruteForce.recordTenantLoginFailure;
exports.clearTenantLoginSuccess = loginBruteForce.clearTenantLoginSuccess;
exports.getTenantLoginLockouts = loginBruteForce.getTenantLoginLockouts;
exports.unlockTenantLoginLockout = loginBruteForce.unlockTenantLoginLockout;

/* ------------------------- Session anomaly (Phase 25) ---------- */
const loginSessionAnomaly = require('./lib/login-session-anomaly');
exports.getSessionAnomalySummary = loginSessionAnomaly.getSessionAnomalySummary;
exports.listSessionAnomalies = loginSessionAnomaly.listSessionAnomalies;
exports.dismissSessionAnomaly = loginSessionAnomaly.dismissSessionAnomaly;

/* ------------------------- Login audit export (Phase 26) ------- */
const loginAuditExport = require('./lib/login-audit-export');
exports.getLoginAuditSummary = loginAuditExport.getLoginAuditSummary;
exports.exportLoginAudit = loginAuditExport.exportLoginAudit;

/* ------------------------- Bulk import registrations (Import P2) - */
const bulkImport = require('./lib/bulk-import-registrations');
exports.bulkImportRegistrations = bulkImport.bulkImportRegistrations;

/* ------------------------- Tenant dashboard stats (Perf S2) -------- */
const tenantDashboardStats = require('./lib/tenant-dashboard-stats');
exports.refreshTenantDashboardStats = tenantDashboardStats.refreshTenantDashboardStats;
exports.scheduledTenantDashboardStats = tenantDashboardStats.scheduledTenantDashboardStats;
exports.onRegistrationStatsWrite = tenantDashboardStats.onRegistrationStatsWrite;
exports.onFeeCollectionStatsWrite = tenantDashboardStats.onFeeCollectionStatsWrite;
exports.onLedgerStatsWrite = tenantDashboardStats.onLedgerStatsWrite;
exports.onAttendanceStatsWrite = tenantDashboardStats.onAttendanceStatsWrite;
exports.onAnnouncementStatsWrite = tenantDashboardStats.onAnnouncementStatsWrite;

/* ------------------------- Exam / Curriculum summaries (E9-S1) - */
const examCurSummaries = require('./lib/tenant-exam-curriculum-summaries');
exports.onModuleDataSummaryWrite = examCurSummaries.onModuleDataSummaryWrite;

/* ------------------------- Enterprise registration search (E9-S2) */
const tenantRegistrationSearch = require('./lib/tenant-registration-search');
exports.searchTenantRegistrations = tenantRegistrationSearch.searchTenantRegistrations;
exports.onRegistrationSearchIndexWrite = tenantRegistrationSearch.onRegistrationSearchIndexWrite;

/* ------------------------- Academic archive (E11-S1) ------------- */
const tenantAcademicArchive = require('./lib/tenant-academic-archive');
exports.archiveTenantAcademicYear = tenantAcademicArchive.archiveTenantAcademicYear;

/* ------------------------- Login security health (Phase 22) ---- */
const loginSecurityHealth = require('./lib/login-security-health');
exports.getLoginSecurityHealthCheck = loginSecurityHealth.getLoginSecurityHealthCheck;

/* ------------------------- SSO / email domain (Phase 12) ------- */
const ssoPolicy = require('./lib/sso-policy');
exports.getTenantSsoPolicy = ssoPolicy.getTenantSsoPolicy;
exports.validateStaffEmailDomain = ssoPolicy.validateStaffEmailDomain;

/* ------------------------- OIDC / SAML SSO hooks (Phase 19) ---- */
const ssoOidc = require('./lib/sso-oidc');
exports.validateOidcIssuerConfig = ssoOidc.validateOidcIssuerConfig;
exports.getSsoProviderSummary = ssoOidc.getSsoProviderSummary;

/* ------------------------- Super Admin access -------------------- */
exports.resolveSuperAdminAccess = saAccess.resolveSuperAdminAccess;

/* ------------------------- AI Assistant (Phase 0/1) -------------- */
const aiGateway = require('./lib/ai/gateway');
exports.aiAsk = aiGateway.aiAsk;
exports.getAiAssistantStatus = aiGateway.getAiAssistantStatus;

/* ------------------------- SA Platform Advisor (Phase 2 staging) - */
const saAdvisor = require('./lib/sa-advisor/gateway');
exports.saAdvisorAsk = saAdvisor.saAdvisorAsk;
exports.saAdvisorGetStatus = saAdvisor.saAdvisorGetStatus;
