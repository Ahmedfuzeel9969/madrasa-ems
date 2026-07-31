/**
 * ============================================================================
 * Users — Central Platform_Users lifecycle (multi-tenant)
 * ----------------------------------------------------------------------------
 * Every authenticated identity gets ONE Platform_Users record. Tenant
 * membership (مدرسہ/ادارہ) is stored under `tenants`. Account status changes
 * are server-enforced and audited.
 * ============================================================================
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const RBAC = require('./rbac-config');
const guard = require('./guard');
const logger = require('./logger');

const COL_USERS = 'Platform_Users';

/**
 * Auth trigger: provision a central user profile on first sign-up.
 */
const onAuthCreate = functions.auth.user().onCreate(async (user) => {
    const db = admin.firestore();
    const ref = db.collection(COL_USERS).doc(user.uid);
    const snap = await ref.get();
    if (snap.exists) return null;

    let roles = [RBAC.DEFAULT_ROLE];
    let isSuperAdmin = false;
    if (user.email) {
        const saSnap = await db.collection('SuperAdmins')
            .where('email', '==', user.email).limit(1).get();
        if (!saSnap.empty) {
            roles = ['super_admin'];
            isSuperAdmin = true;
        }
    }
    const saDoc = await db.collection('SuperAdmins').doc(user.uid).get();
    if (saDoc.exists) {
        roles = ['super_admin'];
        isSuperAdmin = true;
    }

    await ref.set({
        uid: user.uid,
        fullName: user.displayName || '',
        email: user.email || '',
        phone: user.phoneNumber || '',
        photoURL: user.photoURL || '',
        provider: (user.providerData[0] && user.providerData[0].providerId) || 'password',
        accountStatus: 'active',
        globalRoles: roles,
        tenants: {},
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        lastLoginAt: admin.firestore.FieldValue.serverTimestamp()
    });

    await admin.auth().setCustomUserClaims(user.uid, {
        roles: roles,
        isSuperAdmin: isSuperAdmin
    });

    await logger.audit({
        action: 'users.create',
        actorUid: user.uid,
        actorEmail: user.email || '',
        targetUid: user.uid,
        details: { provider: 'auto-provision', roles }
    });
    return null;
});

/**
 * Auth trigger: clean up when an account is deleted.
 */
const onAuthDelete = functions.auth.user().onDelete(async (user) => {
    await admin.firestore().collection(COL_USERS).doc(user.uid).set({
        accountStatus: 'deleted',
        deletedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return null;
});

/**
 * Internal: apply a status change to one user + Auth disabled flag.
 */
async function applyStatus(uid, status) {
    const disabled = status === 'suspended' || status === 'banned' || status === 'inactive';
    await admin.auth().updateUser(uid, { disabled });
    await admin.firestore().collection(COL_USERS).doc(uid).set({
        accountStatus: status,
        statusUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    // Revoke sessions when locking the account.
    if (disabled) {
        await admin.auth().revokeRefreshTokens(uid);
    }
}

const STATUS_PERMISSION = {
    active: 'users.activate',
    inactive: 'users.suspend',
    suspended: 'users.suspend',
    banned: 'users.ban',
    restore: 'users.restore'
};

/**
 * Callable: change a single user's account status.
 * data = { targetUid, status, reason }
 */
const setUserStatus = functions.https.onCall(async (data, context) => {
    const status = guard.requireString(data && data.status, 'status');
    const perm = STATUS_PERMISSION[status === 'restore' ? 'restore' : status];
    if (!perm) {
        throw new functions.https.HttpsError('invalid-argument', 'غلط اسٹیٹس: ' + status);
    }
    const caller = await guard.requirePermission(context, perm);
    const targetUid = guard.requireString(data && data.targetUid, 'targetUid');
    const finalStatus = status === 'restore' ? 'active' : status;

    await applyStatus(targetUid, finalStatus);
    await logger.audit({
        action: 'users.status.' + finalStatus,
        actorUid: caller.uid,
        actorEmail: caller.email,
        targetUid: targetUid,
        reason: (data && data.reason) || '',
        details: { status: finalStatus },
        ip: caller.ip
    });
    return { ok: true, status: finalStatus };
});

/**
 * Callable: bulk status change (requires users.bulk).
 * data = { targetUids: string[], status, reason }
 */
const bulkSetStatus = functions.https.onCall(async (data, context) => {
    const caller = await guard.requirePermission(context, 'users.bulk');
    const status = guard.requireString(data && data.status, 'status');
    const uids = Array.isArray(data && data.targetUids) ? data.targetUids : [];
    if (!uids.length) {
        throw new functions.https.HttpsError('invalid-argument', 'کوئی صارف منتخب نہیں۔');
    }
    if (uids.length > 500) {
        throw new functions.https.HttpsError('invalid-argument', 'ایک بار میں زیادہ سے زیادہ 500 صارف۔');
    }
    const finalStatus = status === 'restore' ? 'active' : status;
    const results = [];
    for (const uid of uids) {
        try {
            await applyStatus(uid, finalStatus);
            results.push({ uid, ok: true });
        } catch (err) {
            await logger.logError('bulkSetStatus', err, { uid });
            results.push({ uid, ok: false, error: err.message });
        }
    }
    await logger.audit({
        action: 'users.bulk.' + finalStatus,
        actorUid: caller.uid,
        actorEmail: caller.email,
        reason: (data && data.reason) || '',
        details: { count: uids.length, status: finalStatus },
        ip: caller.ip
    });
    return { ok: true, results };
});

/**
 * Callable: force logout (revoke all refresh tokens).
 * data = { targetUid, reason }
 */
const forceLogout = functions.https.onCall(async (data, context) => {
    const caller = await guard.requirePermission(context, 'users.force_logout');
    const targetUid = guard.requireString(data && data.targetUid, 'targetUid');
    await admin.auth().revokeRefreshTokens(targetUid);
    await logger.audit({
        action: 'users.force_logout',
        actorUid: caller.uid,
        actorEmail: caller.email,
        targetUid: targetUid,
        reason: (data && data.reason) || '',
        ip: caller.ip
    });
    return { ok: true };
});

/**
 * Callable: link a user to a tenant (multi-tenant membership).
 * data = { targetUid, tenantId, role }
 */
const linkTenant = functions.https.onCall(async (data, context) => {
    const caller = await guard.requirePermission(context, 'users.edit');
    const targetUid = guard.requireString(data && data.targetUid, 'targetUid');
    const tenantId = guard.requireString(data && data.tenantId, 'tenantId');
    const role = (data && data.role) || 'teacher';
    await admin.firestore().collection(COL_USERS).doc(targetUid).set({
        ['tenants.' + tenantId]: {
            role: role,
            status: 'active',
            joinedAt: admin.firestore.FieldValue.serverTimestamp()
        }
    }, { merge: true });
    await logger.audit({
        action: 'users.link_tenant',
        actorUid: caller.uid,
        actorEmail: caller.email,
        targetUid: targetUid,
        details: { tenantId, role },
        ip: caller.ip
    });
    return { ok: true };
});

module.exports = {
    onAuthCreate,
    onAuthDelete,
    setUserStatus,
    bulkSetStatus,
    forceLogout,
    linkTenant
};
