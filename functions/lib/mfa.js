/**
 * MFA compliance — admin + staff + parent login gates (Phase 3, 15, 16)
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const { writeSecurityLog } = require('./security-log-write');

async function isActiveStaff(db, tenantId, uid) {
    const linkSnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('Staff_Links').doc(uid).get();
    if (!linkSnap.exists) return false;
    const d = linkSnap.data() || {};
    return d.status === 'active' || d.status === 'Active';
}

async function isActiveParent(db, tenantId, uid) {
    const linkSnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('Parent_Links').doc(uid).get();
    if (!linkSnap.exists) return false;
    const d = linkSnap.data() || {};
    return d.status === 'active' || d.status === 'Active';
}

function resolvePortalFlags(portal) {
    const p = String(portal || 'admin').trim().toLowerCase();
    return {
        portal: p,
        isStaffPortal: p === 'staff' || p === 'teacher',
        isParentPortal: p === 'parent'
    };
}

function resolveRequired(mfa, flags) {
    if (flags.isParentPortal) return !!mfa.requireMfaForParent;
    if (flags.isStaffPortal) return !!mfa.requireMfaForStaff;
    return !!mfa.requireMfaForAdmin;
}

const checkMfaCompliance = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }

    const tenantId = String((data && data.tenantId) || '').trim();
    const flags = resolvePortalFlags(data && data.portal);
    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId درکار ہے۔');
    }

    const db = admin.firestore();
    const mfaSnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('SecuritySettings').doc('mfa').get();
    const mfa = mfaSnap.exists ? mfaSnap.data() : {};
    const required = resolveRequired(mfa, flags);

    const userRecord = await admin.auth().getUser(context.auth.uid);
    const enrolled = !!(userRecord.multiFactor
        && userRecord.multiFactor.enrolledFactors
        && userRecord.multiFactor.enrolledFactors.length > 0);

    const token = context.auth.token || {};
    const sessionMfa = !!(token.firebase && token.firebase.sign_in_second_factor);

    const isOwner = context.auth.uid === tenantId;
    const isStaff = flags.isStaffPortal ? await isActiveStaff(db, tenantId, context.auth.uid) : false;
    const isParent = flags.isParentPortal ? await isActiveParent(db, tenantId, context.auth.uid) : false;
    const subjectToMfa = flags.isParentPortal ? isParent : (flags.isStaffPortal ? isStaff : isOwner);
    const compliant = !required || !subjectToMfa || (enrolled && sessionMfa);

    if (required && subjectToMfa && enrolled && !sessionMfa) {
        await writeSecurityLog(db, tenantId, {
            action: 'mfa_session_required',
            uid: context.auth.uid,
            email: context.auth.token.email || '',
            details: { portal: flags.portal, enrolled: true, sessionMfa: false }
        });
    }

    return {
        required: required,
        enrolled: enrolled,
        sessionMfa: sessionMfa,
        isOwner: isOwner,
        isStaff: isStaff,
        isParent: isParent,
        portal: flags.portal,
        compliant: compliant
    };
});

const getMfaPolicySummary = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId درکار ہے۔');
    }
    const db = admin.firestore();
    const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    if (!madrasaSnap.exists || madrasaSnap.data().ownerUid !== context.auth.uid) {
        throw new functions.https.HttpsError('permission-denied', 'صرف مالک policy summary دیکھ سکتا ہے۔');
    }
    const mfaSnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('SecuritySettings').doc('mfa').get();
    const mfa = mfaSnap.exists ? mfaSnap.data() : {};
    const sinceMs = Date.now() - 7 * 86400000;
    const logSnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('SecurityLog')
        .orderBy('clientTs', 'desc')
        .limit(100)
        .get();
    let mfaBlocks = 0;
    logSnap.forEach(function (doc) {
        const e = doc.data() || {};
        if (e.action === 'mfa_session_required' && e.clientTs >= sinceMs) mfaBlocks++;
    });
    return {
        policy: {
            requireMfaForAdmin: !!mfa.requireMfaForAdmin,
            requireMfaForStaff: !!mfa.requireMfaForStaff,
            requireMfaForParent: !!mfa.requireMfaForParent
        },
        mfaSessionBlocks7d: mfaBlocks,
        generatedAt: Date.now()
    };
});

module.exports = {
    checkMfaCompliance,
    getMfaPolicySummary,
    isActiveStaff,
    isActiveParent,
    resolvePortalFlags,
    resolveRequired
};
