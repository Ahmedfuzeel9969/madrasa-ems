/**
 * Server-side Access Key verification (Phase 2–3)
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const crypto = require('crypto');

function hashAccessKey(plainKey) {
    const key = String(plainKey || '').trim().toUpperCase();
    return crypto.createHash('sha256').update('ems-ak-v1:' + key).digest('hex');
}

function isKeyExpired(data) {
    if (!data || !data.accessKeyExpiresAt) return false;
    return Date.now() > data.accessKeyExpiresAt;
}

async function assertSignedIn(context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    return context.auth.uid;
}

async function verifyTeacherAccessKey(data, context) {
    await assertSignedIn(context);
    const tenantId = String((data && data.tenantId) || '').trim();
    const staffId = String((data && data.staffId) || '').trim();
    const plainKey = String((data && data.plainKey) || '').trim();
    if (!tenantId || !staffId || !plainKey) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId, staffId, plainKey درکار ہیں۔');
    }

    const db = admin.firestore();
    const linkSnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('Staff_Links').doc(context.auth.uid).get();
    if (!linkSnap.exists || linkSnap.data().status !== 'active' || linkSnap.data().staffId !== staffId) {
        throw new functions.https.HttpsError('permission-denied', 'Staff Link تصدیق ناکام۔');
    }

    const permSnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('StaffPermissions').doc(staffId).get();
    if (!permSnap.exists || !permSnap.data().accessKeyHash) {
        return { ok: false, reason: 'no_key' };
    }

    const keyData = permSnap.data();
    if (isKeyExpired(keyData)) {
        return { ok: false, reason: 'expired' };
    }

    const hash = hashAccessKey(plainKey);
    return { ok: hash === keyData.accessKeyHash };
}

async function verifyParentAccessKey(data, context) {
    await assertSignedIn(context);
    const tenantId = String((data && data.tenantId) || '').trim();
    const plainKey = String((data && data.plainKey) || '').trim();
    const studentIds = (data && data.studentIds) || [];
    if (!tenantId || !plainKey || !studentIds.length) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId, studentIds, plainKey درکار ہیں۔');
    }

    const db = admin.firestore();
    const linkSnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('Parent_Links').doc(context.auth.uid).get();
    if (!linkSnap.exists || linkSnap.data().status !== 'active') {
        throw new functions.https.HttpsError('permission-denied', 'Parent Link تصدیق ناکام۔');
    }

    const hash = hashAccessKey(plainKey);
    for (let i = 0; i < studentIds.length; i++) {
        const sid = String(studentIds[i] || '').trim();
        if (!sid) continue;
        const keySnap = await db.collection('All_Madrasas').doc(tenantId)
            .collection('ParentAccessKeys').doc(sid).get();
        if (!keySnap.exists) continue;
        const keyData = keySnap.data();
        if (isKeyExpired(keyData)) continue;
        if (keyData.accessKeyHash === hash) {
            return { ok: true, matchedStudentId: sid };
        }
    }
    return { ok: false, reason: 'invalid_key' };
}

const verifyTeacherKey = functions.https.onCall(verifyTeacherAccessKey);
const verifyParentKey = functions.https.onCall(verifyParentAccessKey);

module.exports = {
    hashAccessKey,
    isKeyExpired,
    verifyTeacherAccessKey,
    verifyParentAccessKey,
    verifyTeacherKey,
    verifyParentKey
};
