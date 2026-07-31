/**
 * Seed Firestore emulator with enterprise login demo tenant (Phase 7)
 * Usage:
 *   firebase emulators:start --only firestore,auth
 *   set FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
 *   set FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
 *   node scripts/seed-emulator-login.js
 */
'use strict';

var admin = require('../functions/node_modules/firebase-admin');

var TENANT_ID = 'emulator-tenant-1';
var OWNER_UID = 'emu-owner-001';
var TEACHER_UID = 'emu-teacher-001';
var PARENT_UID = 'emu-parent-001';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

if (!admin.apps.length) {
    admin.initializeApp({ projectId: 'demo-madrasa-ems' });
}

var db = admin.firestore();
var now = Date.now();

var madrasa = {
    madrasaName: 'Emulator Demo Madrasa',
    ownerUid: OWNER_UID,
    ownerEmail: 'owner@emulator.test',
    adminEmail: 'owner@emulator.test',
    subStatus: 'active',
    seededAt: now,
    seededBy: 'seed-emulator-login.js'
};

var securityPolicy = {
    requireAccessKey: true,
    keyRotationReminderDays: 30,
    enableKeyExpiryAlerts: true,
    notifyOwnerOnKeyExpiry: true,
    enableLoginSessionRegistry: true,
    maxActiveSessionsPerUser: 5,
    requireTrustedDeviceForStaff: false,
    requireTrustedDeviceForParents: false,
    trustedDeviceExpiryDays: 0,
    notifyOwnerOnTrustedDeviceRequest: true,
    trustedDeviceMaxRequestsPerDay: 5,
    enableSecurityWebhooks: false,
    enableSecurityAlertDigest: false,
    securityAlertThreshold7d: 5,
    notifyOwnerOnSecurityAlert: true,
    enableIpAllowlist: false,
    allowedIpRanges: ['127.0.0.1', '10.0.0.0/8'],
    enableCountryAllowlist: false,
    allowedCountries: ['PK', 'SA'],
    enableLoginBruteForceProtection: false,
    maxLoginFailuresPerEmail: 5,
    loginLockoutMinutes: 15,
    enableSessionAnomalyDetection: false,
    notifyOwnerOnSessionAnomaly: true,
    sessionAnomalyMaxPerHour: 3,
    parentDataCfOnly: true,
    parentMessagingCfOnly: true,
    enforceStaffRbac: true,
    updatedAt: now
};

var ssoPolicy = {
    enforceStaffEmailDomain: false,
    enforceParentEmailDomain: false,
    enforceGoogleSignInOnly: false,
    allowedEmailDomains: ['emulator.test'],
    oidcEnabled: false,
    samlEnabled: false,
    updatedAt: now
};

var staffLink = {
    staffId: 'STF-EMU-01',
    email: 'teacher@emulator.test',
    name: 'Emulator Teacher',
    status: 'active',
    linkedUid: TEACHER_UID
};

var parentLink = {
    studentIds: ['STD-EMU-01'],
    email: 'parent@emulator.test',
    status: 'active',
    linkedUid: PARENT_UID
};

async function seedAuthUsers() {
    var users = [
        { uid: OWNER_UID, email: 'owner@emulator.test', displayName: 'Emu Owner' },
        { uid: TEACHER_UID, email: 'teacher@emulator.test', displayName: 'Emu Teacher' },
        { uid: PARENT_UID, email: 'parent@emulator.test', displayName: 'Emu Parent' }
    ];
    for (var i = 0; i < users.length; i++) {
        var u = users[i];
        try {
            await admin.auth().getUser(u.uid);
        } catch (e) {
            if (e.code === 'auth/user-not-found') {
                await admin.auth().createUser({
                    uid: u.uid,
                    email: u.email,
                    displayName: u.displayName,
                    emailVerified: true
                });
            } else {
                throw e;
            }
        }
    }
}

async function seedFirestore() {
    var batch = db.batch();
    var madrasaRef = db.collection('All_Madrasas').doc(TENANT_ID);
    batch.set(madrasaRef, madrasa, { merge: true });
    batch.set(madrasaRef.collection('TenantSettings').doc('securityPolicy'), securityPolicy, { merge: true });
    batch.set(madrasaRef.collection('TenantSettings').doc('ssoPolicy'), ssoPolicy, { merge: true });
    batch.set(madrasaRef.collection('StaffLinks').doc(TEACHER_UID), staffLink, { merge: true });
    batch.set(madrasaRef.collection('ParentLinks').doc(PARENT_UID), parentLink, { merge: true });
    batch.set(madrasaRef.collection('StaffPermissions').doc('STF-EMU-01'), {
        staffId: 'STF-EMU-01',
        modules: { attendance: true, exams: true },
        updatedAt: now
    }, { merge: true });
    batch.set(db.collection('ParentPermissions').doc('STD-EMU-01'), {
        tenantId: TENANT_ID,
        studentId: 'STD-EMU-01',
        parentUid: PARENT_UID,
        status: 'active',
        updatedAt: now
    }, { merge: true });
    batch.set(madrasaRef.collection('SecurityLog').doc('seed-' + now), {
        action: 'emulator_seed',
        uid: OWNER_UID,
        email: 'owner@emulator.test',
        clientTs: now,
        details: { script: 'seed-emulator-login.js' }
    }, { merge: true });
    await batch.commit();
}

module.exports = {
    TENANT_ID: TENANT_ID,
    OWNER_UID: OWNER_UID,
    TEACHER_UID: TEACHER_UID,
    PARENT_UID: PARENT_UID,
    securityPolicy: securityPolicy,
    ssoPolicy: ssoPolicy
};

async function main() {
    console.log('[seed] Firestore emulator:', process.env.FIRESTORE_EMULATOR_HOST);
    await seedAuthUsers();
    await seedFirestore();
    console.log('[OK] Tenant:', TENANT_ID);
    console.log('     Owner:', OWNER_UID, 'owner@emulator.test');
    console.log('     Teacher:', TEACHER_UID, 'teacher@emulator.test / STF-EMU-01');
    console.log('     Parent:', PARENT_UID, 'parent@emulator.test / STD-EMU-01');
}

if (require.main === module) {
    main().then(function () { process.exit(0); }).catch(function (err) {
        console.error('[FAIL]', err.message || err);
        process.exit(1);
    });
}
