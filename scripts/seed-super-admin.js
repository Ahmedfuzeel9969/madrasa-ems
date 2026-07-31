/**
 * One-time: add Super Admin by email (Firestore SuperAdmins collection)
 * Usage: node scripts/seed-super-admin.js fuzail1158@gmail.com
 * Requires: gcloud auth application-default login  OR  GOOGLE_APPLICATION_CREDENTIALS
 */
'use strict';

var email = (process.argv[2] || 'fuzail1158@gmail.com').trim().toLowerCase();
if (email.indexOf('@') < 0) {
    console.error('Usage: node scripts/seed-super-admin.js user@example.com');
    process.exit(1);
}

var admin = require('../functions/node_modules/firebase-admin');

if (!admin.apps.length) {
    admin.initializeApp({ projectId: 'madrasa-mangment-app' });
}

var db = admin.firestore();
var docId = email.replace(/[@.]/g, '_');

var payload = {
    email: email,
    role: 'owner',
    addedAt: admin.firestore.FieldValue.serverTimestamp(),
    addedBy: 'seed-super-admin.js',
    note: 'Primary platform super admin'
};

async function linkAuthUserIfExists() {
    try {
        var user = await admin.auth().getUserByEmail(email);
        await db.collection('SuperAdmins').doc(user.uid).set(Object.assign({}, payload, {
            linkedFrom: docId,
            provisionedAt: admin.firestore.FieldValue.serverTimestamp()
        }), { merge: true });
        await admin.auth().setCustomUserClaims(user.uid, {
            roles: ['super_admin'],
            isSuperAdmin: true
        });
        await db.collection('Platform_Users').doc(user.uid).set({
            globalRoles: ['super_admin'],
            email: email,
            claimsUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        console.log('[OK] Linked Auth uid:', user.uid);
        return user.uid;
    } catch (e) {
        if (e.code === 'auth/user-not-found') {
            console.log('[INFO] Auth user not found yet — login once with Google, then re-run script.');
            return null;
        }
        throw e;
    }
}

db.collection('SuperAdmins').doc(docId).set(payload, { merge: true })
    .then(function () {
        console.log('[OK] SuperAdmins/' + docId);
        console.log('     email:', email, '| role: owner');
        return linkAuthUserIfExists();
    })
    .then(function () {
        process.exit(0);
    })
    .catch(function (err) {
        console.error('[FAIL]', err.message || err);
        console.error('\nManual: Firebase Console → Firestore → SuperAdmins → Add document');
        console.error('  Document ID: ' + docId);
        console.error('  Fields: email=' + email + ', role=owner');
        process.exit(1);
    });
