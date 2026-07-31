'use strict';

const functions = require('firebase-functions');
const { requireAuth, getCallerRoles, getSuperAdminRolesFromFirestore } = require('../guard');

async function assertSuperAdminAccess(context) {
    requireAuth(context);
    var roles = getCallerRoles(context);
    if (roles.indexOf('super_admin') >= 0) {
        return {
            uid: context.auth.uid,
            email: (context.auth.token && context.auth.token.email) || '',
            roles: roles
        };
    }
    var email = (context.auth.token && context.auth.token.email) || '';
    var saRoles = await getSuperAdminRolesFromFirestore(context.auth.uid, email);
    if (saRoles && saRoles.indexOf('super_admin') >= 0) {
        return {
            uid: context.auth.uid,
            email: email,
            roles: saRoles
        };
    }
    throw new functions.https.HttpsError(
        'permission-denied',
        'Platform Advisor: صرف Super Admin کے لیے۔'
    );
}

module.exports = { assertSuperAdminAccess: assertSuperAdminAccess };
