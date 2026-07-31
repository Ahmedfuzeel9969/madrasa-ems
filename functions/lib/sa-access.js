/**
 * Resolve Super Admin access — link Gmail/uid + refresh custom claims
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');

async function findSuperAdminByEmail(db, email) {
    var trimmed = String(email || '').trim();
    if (!trimmed) return null;

    var emailKey = trimmed.toLowerCase().replace(/[@.]/g, '_');
    var keyDoc = await db.collection('SuperAdmins').doc(emailKey).get();
    if (keyDoc.exists) return keyDoc;

    var snap = await db.collection('SuperAdmins').where('email', '==', trimmed).limit(1).get();
    if (!snap.empty) return snap.docs[0];

    var lower = trimmed.toLowerCase();
    if (lower !== trimmed) {
        snap = await db.collection('SuperAdmins').where('email', '==', lower).limit(1).get();
        if (!snap.empty) return snap.docs[0];
    }
    return null;
}

async function applySuperAdminClaims(uid, role) {
    var roles = ['super_admin'];
    if (role === 'support') roles = ['admin', 'super_admin'];
    if (role === 'billing') roles = ['manager', 'super_admin'];

    await admin.auth().setCustomUserClaims(uid, {
        roles: roles,
        isSuperAdmin: true
    });

    await admin.firestore().collection('Platform_Users').doc(uid).set({
        globalRoles: ['super_admin'],
        claimsUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
}

const resolveSuperAdminAccess = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }

    var uid = context.auth.uid;
    var email = String(context.auth.token.email || '').trim();
    if (!email) {
        throw new functions.https.HttpsError('failed-precondition', 'ای میل درکار ہے۔');
    }

    var db = admin.firestore();
    var uidDoc = await db.collection('SuperAdmins').doc(uid).get();
    if (uidDoc.exists) {
        var role = uidDoc.data().role || 'owner';
        await applySuperAdminClaims(uid, role);
        return { ok: true, source: 'uid', role: role };
    }

    var legacy = await findSuperAdminByEmail(db, email);
    if (!legacy) {
        return { ok: false, reason: 'not_listed' };
    }

    var legacyData = legacy.data();
    var legacyRole = legacyData.role || 'owner';

    await db.collection('SuperAdmins').doc(uid).set({
        email: email,
        role: legacyRole,
        addedAt: legacyData.addedAt || admin.firestore.FieldValue.serverTimestamp(),
        addedBy: legacyData.addedBy || '',
        linkedFrom: legacy.id,
        provisionedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    await applySuperAdminClaims(uid, legacyRole);

    return { ok: true, source: 'email', role: legacyRole, linkedFrom: legacy.id };
});

module.exports = {
    resolveSuperAdminAccess,
    findSuperAdminByEmail,
    applySuperAdminClaims
};
