/**
 * Server-side Staff/Parent link activation — pending invite → active link
 * Prevents client self-elevation (Phase 0 security)
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const { assertMadrasaActive } = require('./tenant-kill-switch');

function normalizeEmail(email) {
    return (email || '').toLowerCase().trim();
}

function extractMadrasaId(ref) {
    if (!ref || !ref.parent || !ref.parent.parent) return null;
    return ref.parent.parent.id;
}

async function activatePendingDoc(pendingDoc, uid, email) {
    const db = admin.firestore();
    const data = pendingDoc.data() || {};
    const madrasaId = extractMadrasaId(pendingDoc.ref);
    const collectionName = pendingDoc.ref.parent.id;
    if (!madrasaId) {
        throw new functions.https.HttpsError('failed-precondition', 'ادارے کی شناخت نہیں ملی۔');
    }

    await assertMadrasaActive(db, madrasaId);

    const targetRef = db.collection('All_Madrasas').doc(madrasaId).collection(collectionName).doc(uid);
    const existingSnap = await targetRef.get();

    let studentIds = data.studentIds || (data.studentId ? [data.studentId] : []);
    if (collectionName === 'Parent_Links' && existingSnap.exists && existingSnap.data().studentIds) {
        studentIds = Array.from(new Set(existingSnap.data().studentIds.concat(studentIds)));
    }

    const activePayload = {
        authUid: uid,
        email: email || data.email,
        staffId: data.staffId || '',
        studentIds: studentIds,
        status: 'active',
        activatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (collectionName === 'Staff_Links' && !String(activePayload.staffId || '').trim()) {
        throw new functions.https.HttpsError(
            'failed-precondition',
            'Staff link میں staffId درکار ہے — Admin Panel سے دوبارہ بھیجیں۔'
        );
    }

    const batch = db.batch();
    batch.set(targetRef, activePayload, { merge: true });
    batch.delete(pendingDoc.ref);
    await batch.commit();

    if (collectionName === 'Staff_Links') {
        const staffClaims = require('./staff-claims');
        await staffClaims.syncStaffClaimsForUser(uid, madrasaId);
    }

    return {
        tenantId: madrasaId,
        role: collectionName === 'Parent_Links' ? 'parent' : 'staff',
        link: Object.assign({}, activePayload, { activatedAt: Date.now() })
    };
}

/**
 * Callable: activate pending Staff_Links or Parent_Links for the signed-in user.
 * data = { prefer?: 'staff' | 'parent' } optional
 */
const activateTenantLink = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }

    const uid = context.auth.uid;
    const email = normalizeEmail(context.auth.token && context.auth.token.email);
    if (!email) {
        throw new functions.https.HttpsError('failed-precondition', 'ای میل درکار ہے۔');
    }

    const db = admin.firestore();
    const prefer = (data && data.prefer) || 'staff';
    const order = prefer === 'parent'
        ? ['Parent_Links', 'Staff_Links']
        : ['Staff_Links', 'Parent_Links'];

    for (let i = 0; i < order.length; i++) {
        const collectionName = order[i];
        const snap = await db.collectionGroup(collectionName)
            .where('email', '==', email)
            .where('status', '==', 'pending')
            .limit(3)
            .get();

        if (snap.empty) continue;

        for (let j = 0; j < snap.docs.length; j++) {
            const pendingDoc = snap.docs[j];
            const pendingEmail = normalizeEmail(pendingDoc.data().email);
            if (pendingEmail !== email) continue;
            return activatePendingDoc(pendingDoc, uid, email);
        }
    }

    throw new functions.https.HttpsError('not-found', 'کوئی زیر التواء دعوت نامہ نہیں ملا۔');
});

/**
 * Callable: resolve active (or activate pending) Staff/Parent link for signed-in user.
 * Replaces client collectionGroup reads (TI-01).
 * data = { collection?: 'Staff_Links' | 'Parent_Links' }
 */
const resolveTenantLink = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }

    const uid = context.auth.uid;
    const email = normalizeEmail(context.auth.token && context.auth.token.email);
    const db = admin.firestore();
    const collectionName = (data && data.collection === 'Parent_Links') ? 'Parent_Links' : 'Staff_Links';

    const activeSnap = await db.collectionGroup(collectionName)
        .where('authUid', '==', uid)
        .where('status', '==', 'active')
        .limit(1)
        .get();

    if (!activeSnap.empty) {
        const d = activeSnap.docs[0];
        const tenantId = extractMadrasaId(d.ref);
        await assertMadrasaActive(db, tenantId);
        return {
            tenantId: tenantId,
            role: collectionName === 'Parent_Links' ? 'parent' : 'staff',
            link: d.data()
        };
    }

    if (!email) {
        return null;
    }

    const pendingSnap = await db.collectionGroup(collectionName)
        .where('email', '==', email)
        .where('status', '==', 'pending')
        .limit(1)
        .get();

    if (pendingSnap.empty) {
        return null;
    }

    const pendingDoc = pendingSnap.docs[0];
    const pendingEmail = normalizeEmail(pendingDoc.data().email);
    if (pendingEmail !== email) {
        return null;
    }

    return activatePendingDoc(pendingDoc, uid, email);
});

module.exports = {
    activateTenantLink,
    resolveTenantLink
};
