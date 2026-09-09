/**
 * Server-side Staff/Parent link activation — pending invite → active link
 * Prevents client self-elevation (Phase 0 security)
 * Phase 3: Parent multi-child — merge ALL pending invites for same email+tenant
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const { assertMadrasaActive } = require('./tenant-kill-switch');
const { assertSharedPortalSessionActive, isSharedPortalContext } = require('./shared-portal-session');
const { directoryDocId } = require('./shared-portal-gateway');

async function assertNotConfiguredRawGateway(db, email, context) {
    if (!email || isSharedPortalContext(context)) return;
    const snap = await db.collection('SharedPortalGatewayDirectory').doc(directoryDocId(email)).get();
    if (snap.exists && (snap.data() || {}).status === 'active') {
        throw new functions.https.HttpsError(
            'failed-precondition',
            'یہ گوگل کھاتہ مشترک پورٹل دروازہ ہے؛ اسے براہِ راست فرد سے منسلک نہیں کیا جا سکتا۔'
        );
    }
}

function normalizeEmail(email) {
    return (email || '').toLowerCase().trim();
}

function extractMadrasaId(ref) {
    if (!ref || !ref.parent || !ref.parent.parent) return null;
    return ref.parent.parent.id;
}

function collectStudentIds(data) {
    if (!data) return [];
    if (Array.isArray(data.studentIds) && data.studentIds.length) {
        return data.studentIds.map(function (id) { return String(id || '').trim(); }).filter(Boolean);
    }
    if (data.studentId) return [String(data.studentId).trim()].filter(Boolean);
    return [];
}

async function activatePendingDoc(pendingDoc, uid, email) {
    return activatePendingDocs([pendingDoc], uid, email);
}

/**
 * Activate one or more pending docs (same collection). Parent_Links in the same
 * madrasa are merged into one active link with combined studentIds.
 */
async function activatePendingDocs(pendingDocs, uid, email) {
    if (!pendingDocs || !pendingDocs.length) {
        throw new functions.https.HttpsError('not-found', 'کوئی زیر التواء دعوت نامہ نہیں ملا۔');
    }
    const db = admin.firestore();
    const first = pendingDocs[0];
    const collectionName = first.ref.parent.id;
    const madrasaId = extractMadrasaId(first.ref);
    if (!madrasaId) {
        throw new functions.https.HttpsError('failed-precondition', 'ادارے کی شناخت نہیں ملی۔');
    }

    // Only merge pendings that belong to this madrasa + collection.
    const sameTenant = pendingDocs.filter(function (doc) {
        return extractMadrasaId(doc.ref) === madrasaId && doc.ref.parent.id === collectionName;
    });
    if (!sameTenant.length) {
        throw new functions.https.HttpsError('failed-precondition', 'ادارے کی شناخت نہیں ملی۔');
    }

    await assertMadrasaActive(db, madrasaId);

    const targetRef = db.collection('All_Madrasas').doc(madrasaId).collection(collectionName).doc(uid);
    const existingSnap = await targetRef.get();

    let studentIds = [];
    let staffId = '';
    sameTenant.forEach(function (doc) {
        const data = doc.data() || {};
        studentIds = studentIds.concat(collectStudentIds(data));
        if (!staffId && data.staffId) staffId = String(data.staffId).trim();
    });
    if (collectionName === 'Parent_Links' && existingSnap.exists && existingSnap.data().studentIds) {
        studentIds = studentIds.concat(existingSnap.data().studentIds || []);
    }
    studentIds = Array.from(new Set(studentIds.filter(Boolean)));

    if (collectionName === 'Staff_Links' && existingSnap.exists && existingSnap.data().staffId && !staffId) {
        staffId = String(existingSnap.data().staffId || '').trim();
    }

    const emailFromPending = normalizeEmail((sameTenant[0].data() || {}).email);
    const activePayload = {
        authUid: uid,
        email: email || emailFromPending,
        staffId: staffId || '',
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
    sameTenant.forEach(function (doc) {
        batch.delete(doc.ref);
    });
    await batch.commit();

    if (collectionName === 'Staff_Links') {
        const staffClaims = require('./staff-claims');
        await staffClaims.syncStaffClaimsForUser(uid, madrasaId);
    }

    return {
        tenantId: madrasaId,
        role: collectionName === 'Parent_Links' ? 'parent' : 'staff',
        link: Object.assign({}, activePayload, { activatedAt: Date.now() }),
        mergedPending: sameTenant.length
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
    await assertNotConfiguredRawGateway(db, email, context);
    const prefer = (data && data.prefer) || 'staff';
    const order = prefer === 'parent'
        ? ['Parent_Links', 'Staff_Links']
        : ['Staff_Links', 'Parent_Links'];

    for (let i = 0; i < order.length; i++) {
        const collectionName = order[i];
        const limitN = collectionName === 'Parent_Links' ? 25 : 5;
        const snap = await db.collectionGroup(collectionName)
            .where('email', '==', email)
            .where('status', '==', 'pending')
            .limit(limitN)
            .get();

        if (snap.empty) continue;

        const matched = snap.docs.filter(function (doc) {
            return normalizeEmail(doc.data().email) === email;
        });
        if (!matched.length) continue;

        if (collectionName === 'Parent_Links') {
            // Group by madrasa; activate the largest pending group first.
            const byTenant = {};
            matched.forEach(function (doc) {
                const tid = extractMadrasaId(doc.ref);
                if (!tid) return;
                if (!byTenant[tid]) byTenant[tid] = [];
                byTenant[tid].push(doc);
            });
            const tenants = Object.keys(byTenant).sort(function (a, b) {
                return byTenant[b].length - byTenant[a].length;
            });
            if (!tenants.length) continue;
            return activatePendingDocs(byTenant[tenants[0]], uid, email);
        }

        // Staff: first matching pending only.
        return activatePendingDocs([matched[0]], uid, email);
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

    await assertNotConfiguredRawGateway(db, email, context);

    const activeSnap = await db.collectionGroup(collectionName)
        .where('authUid', '==', uid)
        .where('status', '==', 'active')
        .limit(1)
        .get();

    if (!activeSnap.empty) {
        const d = activeSnap.docs[0];
        const tenantId = extractMadrasaId(d.ref);
        await assertMadrasaActive(db, tenantId);
        await assertSharedPortalSessionActive(
            db,
            tenantId,
            context,
            d.data() || {},
            collectionName === 'Parent_Links' ? 'parent' : 'teacher'
        );

        // Still merge any leftover Parent pendings for this email into the active link.
        if (collectionName === 'Parent_Links' && email) {
            const leftover = await db.collection('All_Madrasas').doc(tenantId)
                .collection('Parent_Links')
                .where('email', '==', email)
                .where('status', '==', 'pending')
                .limit(25)
                .get();
            if (!leftover.empty) {
                return activatePendingDocs(leftover.docs, uid, email);
            }
        }

        return {
            tenantId: tenantId,
            role: collectionName === 'Parent_Links' ? 'parent' : 'staff',
            link: d.data()
        };
    }

    if (!email) {
        return null;
    }

    const pendingLimit = collectionName === 'Parent_Links' ? 25 : 5;
    const pendingSnap = await db.collectionGroup(collectionName)
        .where('email', '==', email)
        .where('status', '==', 'pending')
        .limit(pendingLimit)
        .get();

    if (pendingSnap.empty) {
        return null;
    }

    const matched = pendingSnap.docs.filter(function (doc) {
        return normalizeEmail(doc.data().email) === email;
    });
    if (!matched.length) {
        return null;
    }

    if (collectionName === 'Parent_Links') {
        const byTenant = {};
        matched.forEach(function (doc) {
            const tid = extractMadrasaId(doc.ref);
            if (!tid) return;
            if (!byTenant[tid]) byTenant[tid] = [];
            byTenant[tid].push(doc);
        });
        const tenants = Object.keys(byTenant).sort(function (a, b) {
            return byTenant[b].length - byTenant[a].length;
        });
        if (!tenants.length) return null;
        return activatePendingDocs(byTenant[tenants[0]], uid, email);
    }

    return activatePendingDocs([matched[0]], uid, email);
});

module.exports = {
    activateTenantLink,
    resolveTenantLink,
    activatePendingDocs,
    activatePendingDoc
};
