/**
 * Enterprise Login deploy readiness — static checks (Phase 22)
 * Usage: node scripts/enterprise-login-deploy-check.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let failed = 0;

function ok(msg) { console.log('[OK]', msg); }
function warn(msg) { console.warn('[WARN]', msg); }
function fail(msg) { console.error('[FAIL]', msg); failed++; }

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function exists(rel) {
    return fs.existsSync(path.join(ROOT, rel));
}

console.log('=== Enterprise Login Deploy Check (Phase 12–26) ===\n');

const requiredLib = [
    'functions/lib/trusted-devices.js',
    'functions/lib/sso-policy.js',
    'functions/lib/security-webhook.js',
    'functions/lib/security-alert-digest.js',
    'functions/lib/login-ip-policy.js',
    'functions/lib/login-security-health.js',
    'functions/lib/sso-oidc.js',
    'functions/lib/login-security-overview.js',
    'functions/lib/login-brute-force.js',
    'functions/lib/login-security-probe.js',
    'functions/lib/login-session-anomaly.js',
    'functions/lib/login-audit-export.js'
];

requiredLib.forEach(function (f) {
    if (exists(f)) ok('Lib: ' + f);
    else fail('Missing: ' + f);
});

const idx = read('functions/index.js');
[
    'checkTrustedDevice', 'validateStaffEmailDomain', 'getLoginSecurityOverview',
    'testSecurityWebhook', 'getSecurityAlertSummary', 'validateLoginIpAddress',
    'validateOidcIssuerConfig', 'getLoginSecurityHealthCheck', 'validateLoginCountry', 'probeLoginSecurityBackend',
    'checkTenantLoginAllowed', 'recordTenantLoginFailure', 'getTenantLoginLockouts',
    'getSessionAnomalySummary', 'listSessionAnomalies', 'dismissSessionAnomaly',
    'getLoginAuditSummary', 'exportLoginAudit'
].forEach(function (fn) {
    if (idx.indexOf(fn) >= 0) ok('CF export: ' + fn);
    else fail('CF export missing: ' + fn);
});

const html = read('index.html');
['identity-gate.js', 'tenant-security.js', 'tenant-sso.js', 'ems-trusted-device.js'].forEach(function (s) {
    if (html.indexOf(s) >= 0) ok('Script: ' + s);
    else fail('Script missing in index.html: ' + s);
});

const ig = read('identity-gate.js');
['runPortalSecurityGates', 'proceedParentTrustedGate', 'proceedTeacherMfaGate', 'proceedAdminMfaGate', 'runPortalCountryGate', 'withBruteForceCheck'].forEach(function (sym) {
    if (ig.indexOf(sym) >= 0) ok('Gate: ' + sym);
    else fail('Gate missing: ' + sym);
});

const indexes = JSON.parse(read('firestore.indexes.json'));
const groups = (indexes.indexes || []).map(function (i) { return i.collectionGroup; });
['TrustedDevices'].forEach(function (g) {
    if (groups.indexOf(g) >= 0) ok('Index: ' + g);
    else fail('Firestore index missing: ' + g);
});

console.log('\n[EMS] Running unit tests …');
try {
    execSync('npm test', { cwd: ROOT, stdio: 'inherit', shell: true });
    ok('Unit tests passed');
} catch (e) {
    fail('Unit tests failed');
}

console.log('\n--- Deploy commands (copy when ready) ---');
console.log('firebase deploy --only firestore:rules,firestore:indexes');
console.log('firebase deploy --only functions:checkTrustedDevice,functions:validateStaffEmailDomain,functions:getLoginSecurityOverview,functions:testSecurityWebhook,functions:getSecurityAlertSummary,functions:validateLoginIpAddress,functions:validateOidcIssuerConfig,functions:getLoginSecurityHealthCheck,functions:validateLoginCountry,functions:probeLoginSecurityBackend,functions:checkTenantLoginAllowed,functions:recordTenantLoginFailure,functions:clearTenantLoginSuccess,functions:getTenantLoginLockouts,functions:unlockTenantLoginLockout,functions:registerLoginSession,functions:getSessionAnomalySummary,functions:listSessionAnomalies,functions:dismissSessionAnomaly,functions:getLoginAuditSummary,functions:exportLoginAudit,functions:bulkImportRegistrations');
console.log('node scripts/prepare-hosting.js');
console.log('firebase deploy --only hosting\n');

if (failed) {
    console.error('=== Deploy check FAILED (' + failed + ' issues) ===');
    process.exit(1);
}
console.log('=== Deploy check PASSED — production-ready ===');
