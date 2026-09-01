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

    /*
     * Every business-data blob must be scoped, not merely hidden at render time.
     * The old global names are deliberately treated as legacy imports only.
     */
    var TENANT_DATA_KEYS = [
        'ems_full_users', 'ems_rejected_users', 'ems_reg_repo_archive',
        'ems_full_exams', 'ems_exam_types', 'ems_library_books', 'ems_exam_templates',
        'ems_exam_locks', 'ems_master_sheet_meta',
        'ems_curriculum_plans', 'ems_curriculum_daily', 'ems_curriculum_settings', 'ems_curriculum_audit',
        'ems_tar_prayer', 'ems_tar_ethics', 'ems_tar_discipline', 'ems_tar_reform',
        'ems_tar_awards', 'ems_tar_warnings', 'ems_tar_settings', 'ems_tar_audit',
        'ems_fee_categories', 'ems_class_fee_structure', 'ems_student_fee_setup',
        'ems_fee_collections', 'ems_fee_bills',
        'ems_full_ledger', 'ems_ledger_master_categories', 'ems_ledger_blackouts',
        'ems_payroll_history', 'ems_full_salary', 'ems_ledger_funds', 'ems_ledger_budgets',
        'ems_ledger_audit_log', 'ems_ledger_settings', 'ems_ledger_liabilities',
        'ems_ledger_employee_dues', 'ems_payroll_special', 'ems_ledger_archive',
        'ems_announcements', 'ems_full_announcements', 'ems_ann_categories', 'ems_ann_programs',
        'ems_ann_poster_templates', 'ems_ann_audit_log', 'ems_ann_settings', 'ems_ann_groups',
        'ems_full_complaints', 'ems_ledger_db', 'ems_exams_db', 'ems_classes',
        'ems_att_periods', 'ems_att_symbols', 'ems_att_settings', 'ems_att_holidays',
        'ems_att_custom_teachers', 'ems_att_audit', 'ems_att_recycle', 'ems_att_keys_index'
    ];
    var TENANT_KEY_EXCLUSIONS = {
        ems_att_canonical_unified: true,
        ems_persisted_tenant_id_v1: true,
        ems_sys_theme: true,
        ems_sys_dict: true,
        ems_sys_config_v2: true,
        ems_sys_settings_audit: true,
        ems_sys_config_backup: true,
        ems_cache_meta: true,
        ems_offline_session_v1: true,
        ems_online_mode: true,
        ems_debug: true
    };
    var TENANT_DATA_SET = Object.create(null);
    TENANT_DATA_KEYS.forEach(function (key) { TENANT_DATA_SET[key] = true; });
    var TENANT_KEY_PREFIX = 'ems_t_';
    var LEGACY_MIGRATION_PREFIX = 'ems_tenant_blob_migration_v2__';

    global.EMS_ACTIVE_TENANT_ID = null;
    global.EMS_LITE_LOGIN = false;
    global.EMS_CACHE_RECORD_CAP = 0;
    /** Monotonic generation — bumped on every tenant transition/logout. */
    global.EMS_TENANT_GENERATION = 0;
    /** True while switching; business-data access must fail closed. */
    global.EMS_TENANT_TRANSITION_IN_PROGRESS = false;

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
        tenantId = tenantId || global.emsGetCanonicalTenantId();
        return tenantId ? 'ems_repo_' + tenantId : null;
    };

    global.emsTenantCacheKey = function (tenantId) {
        tenantId = tenantId || global.emsGetCanonicalTenantId();
        return tenantId ? 'ems_cache_' + tenantId : null;
    };

    global.emsDashboardCacheKey = function (tenantId) {
        tenantId = tenantId || global.emsGetCanonicalTenantId();
        return tenantId ? 'ems_dashboard_' + tenantId : null;
    };

    global.emsGetTenantGeneration = function () {
        return Number(global.EMS_TENANT_GENERATION) || 0;
    };

    global.emsIsTenantTransitionInProgress = function () {
        return global.EMS_TENANT_TRANSITION_IN_PROGRESS === true;
    };

    /**
     * ONE authoritative tenant for business-data reads/writes.
     * Fail closed when:
     * - tenant transition is in progress, or
     * - EMS_ACTIVE_TENANT_ID and CURRENT_MADRASA_TENANT_ID disagree.
     * Never silently picks one side of a mismatch.
     * Never uses auth UID / persisted boot as authority here.
     */
    global.emsGetCanonicalTenantId = function () {
        if (global.EMS_TENANT_TRANSITION_IN_PROGRESS === true) {
            return null;
        }
        var active = global.EMS_ACTIVE_TENANT_ID ? String(global.EMS_ACTIVE_TENANT_ID) : null;
        var current = global.CURRENT_MADRASA_TENANT_ID ? String(global.CURRENT_MADRASA_TENANT_ID) : null;
        if (active && current && active !== current) {
            try {
                console.error('[EMS] TENANT_IDENTITY_MISMATCH — fail closed', {
                    active: active,
                    current: current,
                    generation: global.EMS_TENANT_GENERATION
                });
            } catch (eLog) { /* ignore */ }
            if (typeof global.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
                try {
                    global.dispatchEvent(new CustomEvent('ems:tenant-identity-mismatch', {
                        detail: { active: active, current: current }
                    }));
                } catch (eEvt) { /* ignore */ }
            }
            return null;
        }
        return active || current || null;
    };

    /**
     * Guard async/listener mutations: source tenant must match canonical active tenant
     * and listener generation must match current (when provided).
     */
    global.emsAssertTenantBoundMutation = function (sourceTenantId, listenerGeneration) {
        if (!sourceTenantId) {
            return { ok: false, reason: 'NO_SOURCE_TENANT' };
        }
        if (global.EMS_TENANT_TRANSITION_IN_PROGRESS === true) {
            return { ok: false, reason: 'TENANT_TRANSITION' };
        }
        var gen = Number(global.EMS_TENANT_GENERATION) || 0;
        if (listenerGeneration != null && Number(listenerGeneration) !== gen) {
            return {
                ok: false,
                reason: 'STALE_GENERATION',
                expected: Number(listenerGeneration),
                actual: gen
            };
        }
        var canonical = global.emsGetCanonicalTenantId();
        if (!canonical || String(canonical) !== String(sourceTenantId)) {
            return {
                ok: false,
                reason: 'TENANT_MISMATCH',
                source: String(sourceTenantId),
                canonical: canonical
            };
        }
        return { ok: true, tenantId: canonical, generation: gen };
    };

    global.emsVerifiedTenantId = function () {
        return global.emsGetCanonicalTenantId();
    };

    global.emsIsTenantDataKey = function (baseKey) {
        if (!baseKey || typeof baseKey !== 'string') return false;
        if (baseKey.indexOf(TENANT_KEY_PREFIX) === 0 || baseKey.indexOf('att_rec_') === 0) return false;
        if (TENANT_KEY_EXCLUSIONS[baseKey]) return false;
        if (TENANT_DATA_SET[baseKey]) return true;
        return /^(ems_fee_|ems_ledger_|ems_payroll_|ems_exam_|ems_ann_|ems_curriculum_|ems_tar_|ems_att_|ems_class)/.test(baseKey);
    };

    /** Physical IndexedDB/localStorage key belongs to this madrasa partition. */
    global.emsPhysicalKeyBelongsToTenant = function (key, tenantId) {
        tenantId = tenantId || global.emsVerifiedTenantId();
        if (!key || typeof key !== 'string') return false;
        if (TENANT_KEY_EXCLUSIONS[key] || key.indexOf('ems_sys_') === 0 || key.indexOf('ems_persisted_') === 0) {
            return true;
        }
        if (!tenantId) return false;
        if (key.indexOf(TENANT_KEY_PREFIX + tenantId + '__') === 0) return true;
        if (key.indexOf('att_rec_' + tenantId + '_') === 0) return true;
        if (key.indexOf('ems_repo_' + tenantId) === 0) return true;
        if (key.indexOf('ems_cache_' + tenantId) === 0) return true;
        if (key.indexOf('ems_dashboard_' + tenantId) === 0) return true;
        if (key.indexOf(TENANT_KEY_PREFIX) === 0 || key.indexOf('att_rec_') === 0) return false;
        if (key.indexOf('ems_repo_') === 0 || key.indexOf('ems_cache_') === 0) return false;
        if (global.emsIsTenantDataKey(key)) return false;
        return true;
    };

    global.emsTenantDataKey = function (baseKey, tenantId) {
        tenantId = tenantId || global.emsGetCanonicalTenantId();
        if (!baseKey || !tenantId || !global.emsIsTenantDataKey(baseKey)) return null;
        return TENANT_KEY_PREFIX + String(tenantId) + '__' + baseKey;
    };

    global.emsTenantStorageReady = function () {
        if (global.EMS_TENANT_TRANSITION_IN_PROGRESS === true) return false;
        var tid = global.emsGetCanonicalTenantId();
        return !!(tid && global.EMS_TENANT_STORAGE_READY === true);
    };

    global.emsScopedKey = function (baseKey, tenantId) {
        tenantId = tenantId || global.emsGetCanonicalTenantId();
        if (!baseKey) return null;
        if (tenantId && baseKey === 'ems_full_users') return 'ems_repo_' + tenantId;
        if (tenantId && baseKey === 'ems_rejected_users') return 'ems_repo_' + tenantId + '_rejected';
        if (tenantId && baseKey === 'ems_reg_repo_archive') return 'ems_cache_' + tenantId + '_archive';
        if (global.emsIsTenantDataKey(baseKey)) {
            // Fail closed: no identity means no cache read/write and no old data flash.
            return global.emsTenantDataKey(baseKey, tenantId);
        }
        if (!tenantId) return baseKey;
        if (REGISTRATION_BASE_KEYS.indexOf(baseKey) >= 0) {
            return 'ems_cache_' + tenantId + '__' + baseKey;
        }
        return baseKey;
    };

    global.emsResolveCacheKey = function (baseKey) {
        return global.emsScopedKey(baseKey);
    };

    /**
     * Resolve logical business key → physical localStorage/IDB partition.
     * Tenant-data keys fail closed (null) when no verified tenant is active.
     * Already-physical keys (ems_t_*, att_rec_*, ems_repo_*, …) pass through.
     */
    global.emsResolvePhysicalWriteKey = function (key, tenantId) {
        if (!key || typeof key !== 'string') return null;
        if (key.indexOf(TENANT_KEY_PREFIX) === 0) return key;
        if (key.indexOf('att_rec_') === 0) return key;
        if (key.indexOf('ems_repo_') === 0 || key.indexOf('ems_cache_') === 0) return key;
        if (key.indexOf('ems_dashboard_') === 0) return key;
        if (global.emsIsTenantDataKey(key)) {
            return global.emsScopedKey(key, tenantId);
        }
        return key;
    };

    global.emsIsRegistrationCacheKey = function (key) {
        if (!key) return false;
        if (REGISTRATION_BASE_KEYS.indexOf(key) >= 0) return true;
        return key.indexOf('ems_repo_') === 0 || key.indexOf('ems_cache_') === 0;
    };

    function rawLocalGet(key) {
        try {
            return global._emsOriginalGetItem
                ? global._emsOriginalGetItem.call(localStorage, key)
                : localStorage.getItem(key);
        } catch (e) { return null; }
    }

    function legacyMigrationSafeFor(tenantId, persistedBeforeActivation) {
        if (!tenantId) return false;
        // Without a matching pre-existing tenant marker there is no reliable
        // owner for a legacy global blob. Keep it quarantined rather than
        // assigning it to whichever Gmail happened to log in first.
        if (!persistedBeforeActivation) return String(tenantId).indexOf('local_') === 0;
        return String(persistedBeforeActivation) === String(tenantId);
    }

    var EXAM_MIGRATION_GUARD_KEYS = {
        'ems_full_exams': true,
        'ems_exam_types': true,
        'ems_library_books': true,
        'ems_exam_templates': true,
        'ems_exam_locks': true,
        'ems_master_sheet_meta': true
    };

    /**
     * Copy (never delete) legacy global data to a tenant key once its ownership is
     * known. A mismatched prior tenant is quarantined in place for manual recovery,
     * never guessed or exposed to the newly signed-in madrasa.
     */
    global.emsMigrateLegacyTenantData = function (tenantId, persistedBeforeActivation) {
        if (!tenantId || !legacyMigrationSafeFor(tenantId, persistedBeforeActivation)) {
            return Promise.resolve({ migrated: 0, deferred: true });
        }
        var flag = LEGACY_MIGRATION_PREFIX + tenantId;
        if (rawLocalGet(flag) === '1') return Promise.resolve({ migrated: 0, done: true });
        var migrated = 0;
        var chain = Promise.resolve();
        TENANT_DATA_KEYS.forEach(function (baseKey) {
            chain = chain.then(function () {
                var target = global.emsScopedKey(baseKey, tenantId);
                if (!target) return null;
                var localValue = rawLocalGet(baseKey);
                var idbRead = typeof global.emsIdbKvGet === 'function'
                    ? global.emsIdbKvGet(baseKey)
                    : Promise.resolve(null);
                return idbRead.then(function (idbValue) {
                    var source = localValue != null ? localValue : idbValue;
                    if (source == null) return null;
                    if (EXAM_MIGRATION_GUARD_KEYS[baseKey] && localValue != null) {
                        var owner = rawLocalGet('ems_blob_owner__' + baseKey);
                        if (owner && String(owner) !== String(tenantId)) return null;
                    }
                    var targetExists = rawLocalGet(target);
                    var targetRead = targetExists != null || typeof global.emsIdbKvGet !== 'function'
                        ? Promise.resolve(targetExists)
                        : global.emsIdbKvGet(target);
                    return targetRead.then(function (existing) {
                        if (existing != null) return null;
                        var str = typeof source === 'string' ? source : JSON.stringify(source);
                        migrated++;
                        if (typeof global.emsDurableWriteRaw === 'function') {
                            global.emsDurableWriteRaw(target, str);
                        } else if (typeof global.emsIdbKvSet === 'function') {
                            global.emsIdbKvSet(target, str);
                        } else {
                            localStorage.setItem(target, str);
                        }
                        if (EXAM_MIGRATION_GUARD_KEYS[baseKey]) {
                            try { localStorage.setItem('ems_blob_owner__' + baseKey, String(tenantId)); } catch (eOwn) { /* ignore */ }
                        }
                        return null;
                    });
                });
            });
        });
        return chain.then(function () {
            try { localStorage.setItem(flag, '1'); } catch (e) { /* ignore */ }
            return { migrated: migrated, done: true };
        });
    };

    /** Remove only unscoped legacy registration keys — tenant data is retained. */
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

    function stopTenantBoundListenersForTransition() {
        var stops = [
            'emsStopAttendanceSync',
            'emsStopRegistrationLiveSync',
            'emsStopDashboardLive',
            'emsStopDashboardStatsListener',
            'emsStopModuleSummariesListener'
        ];
        stops.forEach(function (fnName) {
            if (typeof global[fnName] === 'function') {
                try { global[fnName](); } catch (e) { /* ignore */ }
            }
        });
    }

    /**
     * Atomic tenant activation — ACTIVE and CURRENT always set together.
     * Transition order: freeze → bump generation → stop listeners → clear old
     * in-memory hooks → set both identities → partition ready.
     */
    global.emsActivateTenantStorage = function (tenantId) {
        if (!tenantId) return;
        var prevActive = global.EMS_ACTIVE_TENANT_ID;
        var prevCurrent = global.CURRENT_MADRASA_TENANT_ID;
        var switching = (prevActive && prevActive !== tenantId)
            || (prevCurrent && prevCurrent !== tenantId);

        global.EMS_TENANT_TRANSITION_IN_PROGRESS = true;
        global.EMS_TENANT_STORAGE_READY = false;
        global.EMS_TENANT_GENERATION = (Number(global.EMS_TENANT_GENERATION) || 0) + 1;
        var generation = global.EMS_TENANT_GENERATION;

        // Invalidate old tenant async work BEFORE identity flip.
        stopTenantBoundListenersForTransition();

        var persistedBeforeActivation = global.emsReadPersistedBootTenantId
            ? global.emsReadPersistedBootTenantId()
            : null;
        global.EMS_TENANT_LEGACY_MIGRATION_ALLOWED =
            legacyMigrationSafeFor(tenantId, persistedBeforeActivation);

        if (switching) {
            if (typeof global.emsRegRepoReset === 'function') {
                global.emsRegRepoReset();
            }
            if (typeof global.emsResetRepositoryReady === 'function') {
                global.emsResetRepositoryReady();
            }
            if (typeof global.emsResetRegistrationBoot === 'function') {
                global.emsResetRegistrationBoot();
            }
            if (typeof global.emsAttOfflineKeyIndexInvalidate === 'function') {
                global.emsAttOfflineKeyIndexInvalidate();
            }
            if (typeof global.emsInvalidateAttDashboardCache === 'function') {
                global.emsInvalidateAttDashboardCache();
            }
            if (typeof global.emsDurableReleaseInactiveTenants === 'function') {
                global.emsDurableReleaseInactiveTenants(tenantId);
            }
            if (typeof global.emsRepo === 'object' && global.emsRepo) {
                if (typeof global.emsRepo.useTenant === 'function') global.emsRepo.useTenant(tenantId);
                if (typeof global.emsRepo.invalidateCache === 'function') global.emsRepo.invalidateCache();
            }
            removeLegacyGlobalKeys();
        } else if (!prevActive) {
            removeLegacyGlobalKeys();
        }

        // Canonical identity: never leave ACTIVE ≠ CURRENT after activation.
        global.EMS_ACTIVE_TENANT_ID = tenantId;
        global.CURRENT_MADRASA_TENANT_ID = tenantId;

        if (typeof global.emsRepo === 'object' && global.emsRepo && typeof global.emsRepo.useTenant === 'function') {
            global.emsRepo.useTenant(tenantId);
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
        global.emsMigrateLegacyTenantData(tenantId, persistedBeforeActivation).finally(function () {
            if (global.EMS_TENANT_GENERATION !== generation) {
                return; // superseded by a newer activation
            }
            global.EMS_TENANT_STORAGE_READY = true;
            global.EMS_TENANT_TRANSITION_IN_PROGRESS = false;
            if (typeof global.emsCacheInvalidate === 'function') global.emsCacheInvalidate();
            if (typeof global.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
                global.dispatchEvent(new CustomEvent('ems:tenant-storage-ready', {
                    detail: { tenantId: tenantId, generation: generation }
                }));
            }
        });
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
