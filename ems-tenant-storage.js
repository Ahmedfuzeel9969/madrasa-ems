// ============================================================================
// EMS Tenant Storage — tenant-scoped cache keys (Enterprise Directive P0/P5)
// Allowed: ems_repo_${tenantId}, ems_cache_${tenantId}
// Forbidden: ems_full_users, registrations_cache without tenant id
// ============================================================================
(function (global) {
    'use strict';

    var REGISTRATION_BASE_KEYS = [
        'ems_full_users', 'ems_rejected_users', 'ems_reg_repo_archive'
    ];

    global.EMS_ACTIVE_TENANT_ID = null;
    global.EMS_LITE_LOGIN = false;
    global.EMS_CACHE_RECORD_CAP = 0;

    global.emsRefreshCacheRecordCap = function () {
        if (typeof global.emsIsUnlimitedLocalCache === 'function' && global.emsIsUnlimitedLocalCache()) {
            global.EMS_CACHE_RECORD_CAP = 0;
            return 0;
        }
        global.EMS_CACHE_RECORD_CAP = typeof global.emsGetLocalCacheLimit === 'function'
            ? global.emsGetLocalCacheLimit()
            : 0;
        return global.EMS_CACHE_RECORD_CAP;
    };

    global.emsRepoKey = function (tenantId) {
        tenantId = tenantId || global.EMS_ACTIVE_TENANT_ID || global.CURRENT_MADRASA_TENANT_ID;
        return tenantId ? 'ems_repo_' + tenantId : null;
    };

    global.emsTenantCacheKey = function (tenantId) {
        tenantId = tenantId || global.EMS_ACTIVE_TENANT_ID || global.CURRENT_MADRASA_TENANT_ID;
        return tenantId ? 'ems_cache_' + tenantId : null;
    };

    global.emsDashboardCacheKey = function (tenantId) {
        tenantId = tenantId || global.EMS_ACTIVE_TENANT_ID || global.CURRENT_MADRASA_TENANT_ID;
        return tenantId ? 'ems_dashboard_' + tenantId : null;
    };

    global.emsScopedKey = function (baseKey, tenantId) {
        tenantId = tenantId || global.EMS_ACTIVE_TENANT_ID || global.CURRENT_MADRASA_TENANT_ID;
        if (!tenantId || !baseKey) return baseKey;
        if (baseKey === 'ems_full_users') return 'ems_repo_' + tenantId;
        if (baseKey === 'ems_rejected_users') return 'ems_repo_' + tenantId + '_rejected';
        if (baseKey === 'ems_reg_repo_archive') return 'ems_cache_' + tenantId + '_archive';
        if (REGISTRATION_BASE_KEYS.indexOf(baseKey) >= 0) {
            return 'ems_cache_' + tenantId + '__' + baseKey;
        }
        return baseKey;
    };

    global.emsResolveCacheKey = function (baseKey) {
        return global.emsScopedKey(baseKey);
    };

    global.emsIsRegistrationCacheKey = function (key) {
        if (!key) return false;
        if (REGISTRATION_BASE_KEYS.indexOf(key) >= 0) return true;
        return key.indexOf('ems_repo_') === 0 || key.indexOf('ems_cache_') === 0;
    };

    /** Remove only unscoped legacy keys — never delete tenant-scoped ems_repo_* IDB cache. */
    function removeLegacyGlobalKeys() {
        var legacy = REGISTRATION_BASE_KEYS.concat(['registrations_cache', 'ems_users']);
        legacy.forEach(function (base) {
            try { localStorage.removeItem(base); } catch (e) { /* ignore */ }
        });
        if (typeof global.emsIdbPurgeLegacyKeys === 'function') {
            global.emsIdbPurgeLegacyKeys(legacy);
        }
        if (typeof global.emsCacheInvalidate === 'function') {
            global.emsCacheInvalidate();
        }
    }

    global.emsPurgeLegacyRegistrationCaches = function () {
        removeLegacyGlobalKeys();
        var tid = global.EMS_ACTIVE_TENANT_ID || global.CURRENT_MADRASA_TENANT_ID;
        if (tid && typeof global.emsIdbPurgeLegacyKeys === 'function') {
            global.emsIdbPurgeLegacyKeys(REGISTRATION_BASE_KEYS.concat(['registrations_cache', 'ems_users']));
        }
    };

    global.emsActivateTenantStorage = function (tenantId) {
        if (!tenantId) return;
        var prev = global.EMS_ACTIVE_TENANT_ID;
        if (prev && prev !== tenantId) {
            if (typeof global.emsStopRegistrationLiveSync === 'function') {
                global.emsStopRegistrationLiveSync();
            }
            if (typeof global.emsRegRepoReset === 'function') {
                global.emsRegRepoReset();
            }
            if (typeof global.emsResetRepositoryReady === 'function') {
                global.emsResetRepositoryReady();
            }
            if (typeof global.emsResetRegistrationBoot === 'function') {
                global.emsResetRegistrationBoot();
            }
            removeLegacyGlobalKeys();
        } else if (!prev) {
            removeLegacyGlobalKeys();
        }
        global.EMS_ACTIVE_TENANT_ID = tenantId;
        if (!global.CURRENT_MADRASA_TENANT_ID) {
            global.CURRENT_MADRASA_TENANT_ID = tenantId;
        }
        try {
            localStorage.setItem('ems_persisted_tenant_id_v1', tenantId);
        } catch (persistErr) { /* ignore */ }
        if (typeof global.emsPersistOfflineSession === 'function') {
            global.emsPersistOfflineSession();
        }
        if (typeof global.emsRefreshCacheRecordCap === 'function') {
            global.emsRefreshCacheRecordCap();
        }
    };

    global.emsLiteLoginPrepare = function (tenantId) {
        tenantId = tenantId || global.CURRENT_MADRASA_TENANT_ID;
        if (!tenantId) return;
        global.emsActivateTenantStorage(tenantId);
        global.EMS_LITE_LOGIN = true;
        global.EMS_REPOSITORY_BOOT_COMPLETE = false;
        if (typeof global.emsRegRepoInit === 'function') {
            global.emsRegRepoInit(tenantId);
        }
        if (typeof global.emsBootMark === 'function') {
            global.emsBootMark('lite-login-prepared', tenantId);
        }
    };

    global.emsReadPersistedBootTenantId = function () {
        try {
            return localStorage.getItem('ems_persisted_tenant_id_v1') || null;
        } catch (e) {
            return null;
        }
    };

    /** Offline-only: create/persist a local tenant id (no cloud account). */
    global.emsEnsureLocalTenantId = function () {
        var existing = global.emsReadPersistedBootTenantId();
        if (existing) {
            // Keep the durable IDB copy in sync (so a localStorage wipe can recover it).
            if (typeof global.emsIdbKvSet === 'function') global.emsIdbKvSet('ems_persisted_tenant_id_v1', existing);
            return existing;
        }
        var id = 'local_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
        try {
            localStorage.setItem('ems_persisted_tenant_id_v1', id);
        } catch (e) { /* ignore */ }
        // Mirror to durable IndexedDB so the tenant id survives localStorage eviction.
        if (typeof global.emsIdbKvSet === 'function') global.emsIdbKvSet('ems_persisted_tenant_id_v1', id);
        return id;
    };

    global.emsClearPersistedBootTenantId = function () {
        try {
            localStorage.removeItem('ems_persisted_tenant_id_v1');
        } catch (e) { /* ignore */ }
    };

    global.emsAssertTenantIsolation = function () {
        var tenantId = typeof global.emsRequireTenantId === 'function'
            ? global.emsRequireTenantId()
            : global.CURRENT_MADRASA_TENANT_ID;
        if (!tenantId) return { ok: false, reason: 'NO_TENANT' };
        if (global.EMS_ACTIVE_TENANT_ID && global.EMS_ACTIVE_TENANT_ID !== tenantId) {
            return { ok: false, reason: 'TENANT_MISMATCH', active: global.EMS_ACTIVE_TENANT_ID, resolved: tenantId };
        }
        var repoKey = global.emsRepoKey(tenantId);
        var hasLegacy = false;
        REGISTRATION_BASE_KEYS.forEach(function (k) {
            try { if (localStorage.getItem(k)) hasLegacy = true; } catch (e) { /* ignore */ }
        });
        if (hasLegacy) return { ok: false, reason: 'LEGACY_GLOBAL_CACHE', cacheKey: repoKey };
        return { ok: true, cacheKey: repoKey, tenantId: tenantId };
    };

})(typeof window !== 'undefined' ? window : globalThis);
