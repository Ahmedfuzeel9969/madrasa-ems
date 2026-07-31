/**
 * ============================================================================
 * Platform_Users — Client helper (central multi-tenant user registry)
 * ----------------------------------------------------------------------------
 * Bridges the existing Firebase Auth + All_Madrasas flow into the new central
 * Platform_Users model. On the server, onAuthCreate provisions this record;
 * this client helper ensures legacy/existing users are linked too, and exposes
 * the current user's roles/permissions to the SPA.
 * ============================================================================
 */
(function () {
    'use strict';

    window.PLATFORM_USER = null;        // current Platform_Users doc
    window.PLATFORM_PERMISSIONS = {};   // resolved permission map

    function db() {
        return typeof window.getDbOrNull === 'function' ? window.getDbOrNull() : null;
    }

    /**
     * Ensure a Platform_Users record exists for the signed-in user.
     * Safe to call repeatedly; only writes missing fields (merge).
     */
    window.ensurePlatformUser = function (user) {
        var firestore = db();
        if (!firestore || !user) return Promise.resolve(null);

        var ref = firestore.collection('Platform_Users').doc(user.uid);
        return ref.get().then(function (snap) {
            if (snap.exists) {
                // Refresh lastLoginAt without clobbering server-managed fields.
                ref.set({ lastLoginAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
                return snap.data();
            }
            // Legacy/first-time link. Roles default conservatively on the client;
            // the server (onAuthCreate / assignRoles) is the authority for roles.
            var profile = {
                uid: user.uid,
                fullName: user.displayName || '',
                email: user.email || '',
                phone: user.phoneNumber || '',
                photoURL: user.photoURL || '',
                provider: (user.providerData && user.providerData[0] && user.providerData[0].providerId) || 'password',
                accountStatus: 'active',
                globalRoles: ['student'],
                tenants: {},
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                lastLoginAt: firebase.firestore.FieldValue.serverTimestamp(),
                linkedFromLegacy: true
            };
            return ref.set(profile, { merge: true }).then(function () { return profile; });
        }).catch(function (err) {
            console.warn('ensurePlatformUser:', err && err.message);
            return null;
        });
    };

    /**
     * Load the current user's Platform profile + resolve permissions from the
     * shared RBAC config. Populates window.PLATFORM_USER / PLATFORM_PERMISSIONS.
     */
    window.loadPlatformUser = function (user) {
        var firestore = db();
        if (!firestore || !user) return Promise.resolve(null);

        return firestore.collection('Platform_Users').doc(user.uid).get().then(function (snap) {
            var data = snap.exists ? snap.data() : null;
            window.PLATFORM_USER = data;
            var roles = (data && data.globalRoles) || [];
            window.PLATFORM_PERMISSIONS = (window.RBAC && window.RBAC.resolvePermissions)
                ? window.RBAC.resolvePermissions(roles)
                : {};
            return data;
        }).catch(function (err) {
            console.warn('loadPlatformUser:', err && err.message);
            return null;
        });
    };

    /**
     * Client-side permission check (UI gating only — server re-validates).
     */
    window.can = function (permissionId) {
        var p = window.PLATFORM_PERMISSIONS || {};
        return p['*'] === true || p[permissionId] === true;
    };

    /**
     * Current user's effective global roles.
     */
    window.currentRoles = function () {
        var u = window.PLATFORM_USER;
        return (u && u.globalRoles) ? u.globalRoles.slice() : [];
    };
})();
