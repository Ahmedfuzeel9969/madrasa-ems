/**
 * ============================================================================
 * RBAC — Role assignment + Custom Claims synchronisation
 * ----------------------------------------------------------------------------
 * Roles live in Firestore (Platform_Users.globalRoles) AND are mirrored into
 * the Auth token as custom claims so Firestore rules and callables can check
 * them cheaply and securely.
 * ============================================================================
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const RBAC = require('./rbac-config');
const guard = require('./guard');
const logger = require('./logger');

/**
 * Sync a user's roles into custom claims. Keeps the token small by storing
 * roles only; permissions are resolved from rbac-config at check time.
 */
async function syncClaims(uid, roles) {
    const safeRoles = Array.isArray(roles) ? roles.filter((r) => RBAC.ROLES[r]) : [];
    await admin.auth().setCustomUserClaims(uid, {
        roles: safeRoles,
        isSuperAdmin: safeRoles.indexOf('super_admin') !== -1
    });
    // Touch the user doc so the client can detect a claims refresh is needed.
    await admin.firestore().collection('Platform_Users').doc(uid).set({
        globalRoles: safeRoles,
        claimsUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return safeRoles;
}

/**
 * Callable: assign roles to a user (requires rbac.assign).
 * data = { targetUid, roles: string[], reason }
 */
const assignRoles = functions.https.onCall(async (data, context) => {
    const caller = await guard.requirePermission(context, 'rbac.assign');
    const targetUid = guard.requireString(data && data.targetUid, 'targetUid');
    const roles = Array.isArray(data && data.roles) ? data.roles : [];

    // Only a super_admin may grant the super_admin role.
    if (roles.indexOf('super_admin') !== -1 && caller.roles.indexOf('super_admin') === -1) {
        throw new functions.https.HttpsError('permission-denied', 'صرف سپر ایڈمن یہ کردار دے سکتا ہے۔');
    }

    const applied = await syncClaims(targetUid, roles);
    await logger.audit({
        action: 'rbac.assign',
        actorUid: caller.uid,
        actorEmail: caller.email,
        targetUid: targetUid,
        reason: (data && data.reason) || '',
        details: { roles: applied },
        ip: caller.ip
    });
    return { ok: true, roles: applied };
});

/**
 * Callable: return the role/permission catalogue (requires rbac.view).
 */
const getRbacCatalogue = functions.https.onCall(async (data, context) => {
    await guard.requirePermission(context, 'rbac.view');
    return {
        roles: RBAC.ROLES,
        permissions: RBAC.PERMISSIONS
    };
});

module.exports = { syncClaims, assignRoles, getRbacCatalogue };
