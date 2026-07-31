// ============================================================================
// EMS Hybrid Offline-First — central configuration (Phase 1)
// Non-destructive: wraps existing stack; no UI/workflow changes.
// ============================================================================
(function (global) {
    'use strict';

    var SETTINGS_KEY = 'ems_offline_admin_settings';

    var DEFAULTS = {
        LOCAL_BROWSER_CACHE_LIMIT: 100000,
        /** 0 = unlimited (desktop / installed apps use system memory). */
        INSTALLED_CACHE_LIMIT: 0,
        SYNC_INTERVAL_MS: 5 * 60 * 1000,
        SYNC_RETRY_MAX: 8,
        SYNC_DEBOUNCE_MS: 2000,
        CONFLICT_REVIEW_MODULES: ['fees', 'accounting', 'payroll'],
        ENTITY_PREFIX: 'INST'
    };

    function readAdminSettings() {
        try {
            var raw = localStorage.getItem(SETTINGS_KEY);
            if (!raw) return {};
            return JSON.parse(raw) || {};
        } catch (e) {
            return {};
        }
    }

    global.EMS_OFFLINE_CONFIG = Object.assign({}, DEFAULTS);

    global.emsOfflineConfigGet = function () {
        var admin = readAdminSettings();
        return Object.assign({}, DEFAULTS, admin);
    };

    /** True when local record cap is disabled (desktop / installed). */
    global.emsIsUnlimitedLocalCache = function () {
        try {
            if (global.EMS_DESKTOP_UNLIMITED === true) return true;
            if (global.emsDesktop && global.emsDesktop.isDesktop) return true;
            if (global.emsDesktop && global.emsDesktop.unlimitedCache) return true;
            if (typeof global.emsIsDesktopApp === 'function' && global.emsIsDesktopApp()) return true;
            if (typeof global.emsGetOfflineMode === 'function' && global.emsGetOfflineMode() === 'installed') return true;
            if (global.location && global.location.search) {
                if (global.location.search.indexOf('desktop=1') >= 0) return true;
                if (global.location.search.indexOf('localBundle=1') >= 0) return true;
            }
        } catch (e) { /* ignore */ }
        var limit = global.emsGetLocalCacheLimit();
        return !limit || limit <= 0;
    };

    /** Browser vs installed cache record cap. 0 = unlimited. */
    global.emsGetLocalCacheLimit = function () {
        try {
            if (global.EMS_DESKTOP_UNLIMITED === true) return 0;
            if (global.emsDesktop && global.emsDesktop.isDesktop) return 0;
        } catch (e) { /* ignore */ }
        var cfg = global.emsOfflineConfigGet();
        if (typeof global.emsGetOfflineMode === 'function' && global.emsGetOfflineMode() === 'installed') {
            var installed = cfg.INSTALLED_CACHE_LIMIT;
            if (installed == null || installed <= 0) return 0;
            return installed;
        }
        if (typeof global.emsIsDesktopApp === 'function' && global.emsIsDesktopApp()) {
            return 0;
        }
        var adminLimit = readAdminSettings().LOCAL_BROWSER_CACHE_LIMIT;
        if (adminLimit != null && !isNaN(Number(adminLimit))) {
            return Math.max(1, Number(adminLimit));
        }
        return cfg.LOCAL_BROWSER_CACHE_LIMIT;
    };

    /** Firestore/page fetch size — desktop uses bulk cap; never 0 (Firebase rejects limit(0)). */
    global.emsResolveFetchLimit = function (requested) {
        if (requested != null && Number(requested) > 0) {
            return Number(requested);
        }
        if (typeof global.emsIsUnlimitedLocalCache === 'function' && global.emsIsUnlimitedLocalCache()) {
            return 0;
        }
        var cfgLimit = global.emsOfflineConfigGet().LOCAL_BROWSER_CACHE_LIMIT;
        return Math.max(1, cfgLimit || 50);
    };

    /** Positive Firestore query limit — maps unlimited (0) to bulk cap. */
    global.emsResolveFirestoreLimit = function (requested, fallback) {
        var fb = fallback == null ? 50 : Number(fallback) || 50;
        var raw = global.emsResolveFetchLimit(requested);
        if (!raw || raw < 1) return Math.max(1, fb === 0 ? 100000 : fb);
        return raw;
    };

    /** Admin Settings hook — future UI; safe to call now. */
    global.emsOfflineConfigSetAdmin = function (patch) {
        patch = patch || {};
        var next = Object.assign(readAdminSettings(), patch);
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
        } catch (e) { /* quota */ }
        Object.assign(global.EMS_OFFLINE_CONFIG, global.emsOfflineConfigGet());
        if (typeof global.emsPipelineDebug === 'function') {
            global.emsPipelineDebug('offline_config_updated', { patch: patch });
        }
        return global.emsOfflineConfigGet();
    };

    global.emsOfflineConfigRequiresConflictReview = function (entityType) {
        var cfg = global.emsOfflineConfigGet();
        var t = String(entityType || '').toLowerCase();
        return (cfg.CONFLICT_REVIEW_MODULES || []).indexOf(t) >= 0;
    };

    Object.assign(global.EMS_OFFLINE_CONFIG, global.emsOfflineConfigGet());
})(typeof window !== 'undefined' ? window : globalThis);
