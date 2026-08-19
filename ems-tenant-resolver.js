// ============================================================================
// EMS Enterprise Tenant Resolver — hardened tenant ID for all Firestore access
// Delegates Firestore path tenant id to ems-firestore-paths.js (SSOT).
// ============================================================================
(function (global) {
    'use strict';

    var lastResolution = null;

    function authUid() {
        try {
            var u = firebase.auth().currentUser;
            return u ? u.uid : null;
        } catch (e) { /* ignore */ }
        return null;
    }

    function isLocalTenantId(id) {
        return !!id && String(id).indexOf('local_') === 0;
    }

    global.emsEnterpriseResolveTenant = function () {
        var authUidVal = authUid();

        /* Prefer already-known session tenant BEFORE firestore helper —
           emsResolveFirestoreTenantId → emsGetTenantId → emsRequireTenantId
           used to recurse infinitely when CURRENT was temporarily empty. */
        if (global.CURRENT_MADRASA_TENANT_ID) {
            lastResolution = {
                ok: true,
                tenantId: global.CURRENT_MADRASA_TENANT_ID,
                source: 'CURRENT_MADRASA_TENANT_ID',
                authUid: authUidVal,
                role: global.CURRENT_USER_TENANT_ROLE || null
            };
            return lastResolution;
        }

        if (global.EMS_ACTIVE_TENANT_ID) {
            lastResolution = {
                ok: true,
                tenantId: global.EMS_ACTIVE_TENANT_ID,
                source: 'EMS_ACTIVE_TENANT_ID',
                authUid: authUidVal,
                role: global.CURRENT_USER_TENANT_ROLE || null
            };
            return lastResolution;
        }

        if (typeof global.emsResolveFirestoreTenantId === 'function') {
            var firestoreTid = null;
            try {
                firestoreTid = global.emsResolveFirestoreTenantId({ skipLegacyGetTenantId: true });
            } catch (eFs) {
                firestoreTid = null;
            }
            if (firestoreTid) {
                lastResolution = {
                    ok: true,
                    tenantId: firestoreTid,
                    source: 'emsResolveFirestoreTenantId',
                    authUid: authUidVal,
                    role: global.CURRENT_USER_TENANT_ROLE || null
                };
                return lastResolution;
            }
        }

        if (authUidVal && global.CURRENT_USER_TENANT_ROLE === 'owner') {
            lastResolution = {
                ok: true,
                tenantId: authUidVal,
                source: 'owner_uid',
                authUid: authUidVal,
                role: 'owner'
            };
            return lastResolution;
        }

        if (authUidVal && global.CURRENT_MADRASA_DATA && global.CURRENT_USER_TENANT_ROLE !== 'staff') {
            lastResolution = {
                ok: true,
                tenantId: authUidVal,
                source: 'owner_profile_data',
                authUid: authUidVal,
                role: global.CURRENT_USER_TENANT_ROLE || 'owner'
            };
            return lastResolution;
        }

        // A persisted tenant is offline metadata, never authority over an
        // authenticated Gmail identity. Otherwise account B can momentarily
        // inherit account A's storage before context resolution finishes.
        if (!authUidVal && typeof global.emsReadPersistedBootTenantId === 'function') {
            var persisted = global.emsReadPersistedBootTenantId();
            if (persisted && !(authUidVal && isLocalTenantId(persisted))) {
                lastResolution = {
                    ok: true,
                    tenantId: persisted,
                    source: 'persisted_boot_tenant',
                    authUid: authUidVal,
                    role: global.CURRENT_USER_TENANT_ROLE || null
                };
                return lastResolution;
            }
            if (persisted && authUidVal && isLocalTenantId(persisted)) {
                lastResolution = {
                    ok: true,
                    tenantId: authUidVal,
                    source: 'auth_uid_over_local_persisted',
                    authUid: authUidVal,
                    role: global.CURRENT_USER_TENANT_ROLE || 'owner'
                };
                return lastResolution;
            }
        }

        if (authUidVal) {
            lastResolution = {
                ok: true,
                tenantId: authUidVal,
                source: 'auth_uid_fallback',
                authUid: authUidVal,
                role: global.CURRENT_USER_TENANT_ROLE || null
            };
            return lastResolution;
        }

        console.warn('[EMS] TENANT_RESOLUTION_PENDING', {
            authUid: authUidVal,
            role: global.CURRENT_USER_TENANT_ROLE
        });

        lastResolution = {
            ok: false,
            tenantId: null,
            source: 'TENANT_RESOLUTION_PENDING',
            authUid: authUidVal,
            role: global.CURRENT_USER_TENANT_ROLE || null
        };
        return lastResolution;
    };

    global.emsRequireTenantId = function () {
        var res = global.emsEnterpriseResolveTenant();
        if (res.ok && res.tenantId) return res.tenantId;
        if (global.CURRENT_MADRASA_TENANT_ID) return global.CURRENT_MADRASA_TENANT_ID;
        if (global.EMS_ACTIVE_TENANT_ID) return global.EMS_ACTIVE_TENANT_ID;
        return null;
    };

    global.emsGetTenantResolutionMeta = function () {
        return lastResolution;
    };

    var _origGetTenantId = global.emsGetTenantId;
    var _resolvingTenant = false;

    global.emsGetTenantId = function () {
        if (global.CURRENT_MADRASA_TENANT_ID) return global.CURRENT_MADRASA_TENANT_ID;
        if (global.EMS_ACTIVE_TENANT_ID) return global.EMS_ACTIVE_TENANT_ID;
        if (_resolvingTenant) {
            if (typeof _origGetTenantId === 'function') {
                try { return _origGetTenantId(); } catch (eOrig) { return null; }
            }
            return null;
        }
        _resolvingTenant = true;
        try {
            var required = global.emsRequireTenantId();
            if (required) return required;
            if (typeof _origGetTenantId === 'function') {
                return _origGetTenantId();
            }
            return null;
        } finally {
            _resolvingTenant = false;
        }
    };

})(typeof window !== 'undefined' ? window : globalThis);
