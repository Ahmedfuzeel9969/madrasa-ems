/**
 * ============================================================================
 * Guard — Authentication & Permission Enforcement for Callable Functions
 * ----------------------------------------------------------------------------
 * Centralised security checks. No callable performs a sensitive action
 * without passing through requirePermission(). This prevents privilege
 * escalation paths and keeps authorization logic in one place.
 * ============================================================================
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const RBAC = require('./rbac-config');

/**
 * Ensure the caller is authenticated. Returns the auth context.
 * @param {functions.https.CallableContext} context
 */
function requireAuth(context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    return context.auth;
}

/**
 * Resolve the effective roles for a caller from custom claims + SuperAdmins doc claim.
 */
function getCallerRoles(context) {
    const auth = context.auth || {};
    const token = auth.token || {};
    let roles = [];
    if (Array.isArray(token.roles)) {
        roles = token.roles.slice();
    } else if (typeof token.role === 'string') {
        roles = [token.role];
    }
    if (token.isSuperAdmin === true && roles.indexOf('super_admin') === -1) {
        roles.push('super_admin');
    }
    return roles;
}

/**
 * Resolve Super Admin roles from Firestore when JWT claims are not synced yet.
 */
async function getSuperAdminRolesFromFirestore(uid, email) {
    const db = admin.firestore();
    const uidDoc = await db.collection('SuperAdmins').doc(uid).get();
    if (uidDoc.exists) {
        const role = uidDoc.data().role || 'owner';
        if (role === 'billing') return ['manager', 'super_admin'];
        if (role === 'support') return ['admin', 'super_admin'];
        return ['super_admin'];
    }
    if (email) {
        const emailKey = String(email).trim().toLowerCase().replace(/[@.]/g, '_');
        const emailDoc = await db.collection('SuperAdmins').doc(emailKey).get();
        if (emailDoc.exists) return ['super_admin'];
        const snap = await db.collection('SuperAdmins').where('email', '==', email).limit(1).get();
        if (!snap.empty) return ['super_admin'];
    }
    const pu = await db.collection('Platform_Users').doc(uid).get();
    if (pu.exists && (pu.data().globalRoles || []).indexOf('super_admin') >= 0) {
        return ['super_admin'];
    }
    return null;
}

/**
 * Throw unless the caller holds the given permission.
 * Falls back to Firestore SuperAdmins when JWT claims lag behind.
 * @returns {Promise<{uid:string, email:string, roles:string[], ip:string}>}
 */
async function requirePermission(context, permissionId) {
    requireAuth(context);
    let roles = getCallerRoles(context);
    if (!RBAC.hasPermission(roles, permissionId)) {
        const email = (context.auth.token && context.auth.token.email) || '';
        const saRoles = await getSuperAdminRolesFromFirestore(context.auth.uid, email);
        if (saRoles && RBAC.hasPermission(saRoles, permissionId)) {
            roles = saRoles;
        } else {
            throw new functions.https.HttpsError(
                'permission-denied',
                'اس عمل کی اجازت نہیں: ' + permissionId
            );
        }
    }
    return {
        uid: context.auth.uid,
        email: (context.auth.token && context.auth.token.email) || '',
        roles: roles,
        ip: (context.rawRequest && context.rawRequest.ip) || ''
    };
}

/**
 * Validate that a value is a non-empty string (input validation helper).
 */
function requireString(value, fieldName) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'لازمی فیلڈ غائب یا غلط: ' + fieldName
        );
    }
    return value.trim();
}

module.exports = {
    requireAuth,
    getCallerRoles,
    getSuperAdminRolesFromFirestore,
    requirePermission,
    requireString
};

