// ============================================================================
// EMS Production Diagnostic + Performance Report (Enterprise Directive P9)
// await emsProductionDiagnostic()
// window.emsPerformanceReport()
// ============================================================================
(function (global) {
    'use strict';

    var loginStartMs = null;
    var perfMarks = {
        loginMs: null,
        dashboardMs: null,
        registrationQueryMs: null,
        cacheHits: 0,
        cacheMisses: 0
    };

    global.emsMarkLoginStart = function () {
        loginStartMs = Date.now();
    };

    global.emsPerfMark = function (key, ms) {
        if (key && perfMarks.hasOwnProperty(key)) perfMarks[key] = ms;
    };

    global.emsPerfCacheHit = function () { perfMarks.cacheHits++; };
    global.emsPerfCacheMiss = function () { perfMarks.cacheMisses++; };

    function estimateMemoryMB() {
        if (global.performance && typeof global.performance.memory !== 'undefined') {
            return Math.round((global.performance.memory.usedJSHeapSize || 0) / 1048576);
        }
        return null;
    }

    function cacheHitRatio() {
        var total = perfMarks.cacheHits + perfMarks.cacheMisses;
        if (!total) return null;
        return Math.round((perfMarks.cacheHits / total) * 100) / 100;
    }

    function buildReport(tenantId, authUid, repoCount, cacheCount, cacheKey, idbBytes) {
        var stats = typeof global.emsGetDashboardStats === 'function'
            ? global.emsGetDashboardStats() : null;
        var dashboardCount = stats && stats.counts
            ? (stats.counts.students || 0) + (stats.counts.teachers || 0) + (stats.counts.staff || 0)
            : null;
        var activeListeners = 0;
        if (typeof global.emsGetRegistrationLiveSyncMeta === 'function') {
            var liveMeta = global.emsGetRegistrationLiveSyncMeta();
            if (liveMeta && liveMeta.listenerActive) activeListeners += 1;
        }
        if (typeof global.emsStartDashboardStatsListener === 'function') {
            activeListeners += 1;
        }
        var marks = typeof global.emsGetBootMarks === 'function' ? global.emsGetBootMarks() : [];
        var loginMark = marks.filter(function (m) {
            return m.stage === 'app-shell-unlocked' || m.stage === 'lite-login-prepared';
        }).pop();
        var regMark = marks.filter(function (m) {
            return m.stage === 'registration-module-ready' || m.stage === 'registration-boot-finished';
        }).pop();
        var loginTimeMs = loginMark ? loginMark.ms : (loginStartMs ? Date.now() - loginStartMs : perfMarks.loginMs);
        var registrationBootTimeMs = regMark ? regMark.ms : perfMarks.registrationQueryMs;

        var isolation = typeof global.emsAssertTenantIsolation === 'function'
            ? global.emsAssertTenantIsolation()
            : { ok: !!tenantId, cacheKey: cacheKey };

        var visibilityStatus = 'OK';
        var tenantIsolationStatus = isolation.ok ? 'PASS' : 'FAIL';
        if (!tenantId) visibilityStatus = 'NO_TENANT';
        else if (!isolation.ok) visibilityStatus = isolation.reason || 'ISOLATION_FAIL';
        else if (repoCount > 0 && dashboardCount != null && repoCount > dashboardCount + 200) {
            visibilityStatus = 'REPO_EXCEEDS_STATS';
        } else if (cacheKey && tenantId && cacheKey.indexOf(tenantId) < 0) {
            visibilityStatus = 'CACHE_NOT_TENANT_SCOPED';
            tenantIsolationStatus = 'FAIL';
        }

        var cacheSizeMB = idbBytes != null ? Math.round(idbBytes / 1048576 * 100) / 100 : null;

        return {
            authUid: authUid,
            tenantId: tenantId,
            cacheKey: cacheKey || (typeof global.emsRepoKey === 'function' ? global.emsRepoKey(tenantId) : null),
            repositoryCount: repoCount,
            dashboardCount: dashboardCount,
            activeListeners: activeListeners,
            loginTimeMs: loginTimeMs,
            memoryUsageMB: estimateMemoryMB(),
            cacheSizeMB: cacheSizeMB,
            visibilityStatus: visibilityStatus,
            tenantIsolationStatus: tenantIsolationStatus,
            liteLogin: !!global.EMS_LITE_LOGIN,
            bootComplete: !!global.EMS_REPOSITORY_BOOT_COMPLETE,
            registrationBootTimeMs: registrationBootTimeMs,
            role: global.CURRENT_USER_TENANT_ROLE || null,
            repoCount: repoCount,
            cacheCount: cacheCount,
            listenerCount: activeListeners,
            bootMarks: marks
        };
    }

    global.emsProductionDiagnostic = function () {
        var tenantId = typeof global.emsRequireTenantId === 'function'
            ? global.emsRequireTenantId()
            : (global.CURRENT_MADRASA_TENANT_ID || null);
        var authUid = null;
        try {
            var u = firebase.auth().currentUser;
            authUid = u ? u.uid : null;
        } catch (e) { /* ignore */ }

        var repoCount = typeof global.emsRegRepoGetList === 'function'
            ? global.emsRegRepoGetList().length : 0;
        var cacheKey = typeof global.emsRepoKey === 'function'
            ? global.emsRepoKey(tenantId)
            : (typeof global.emsScopedKey === 'function' ? global.emsScopedKey('ems_full_users', tenantId) : 'ems_full_users');

        var cacheCount = 0;
        var idbPromise = typeof global.emsIdbGet === 'function'
            ? global.emsIdbGet('ems_full_users').then(function (val) {
                if (Array.isArray(val)) cacheCount = val.length;
                return null;
            }).catch(function () { return null; })
            : Promise.resolve(null);

        return idbPromise.then(function () {
            return buildReport(tenantId, authUid, repoCount, cacheCount, cacheKey, null);
        });
    };

    global.emsPerformanceReport = function () {
        var marks = typeof global.emsGetBootMarks === 'function' ? global.emsGetBootMarks() : [];
        var loginMark = marks.find(function (m) { return m.stage === 'app-shell-unlocked'; });
        var dashMark = marks.find(function (m) { return m.stage === 'post-auth-critical-done'; });
        var regMark = marks.find(function (m) { return m.stage === 'registration-module-ready'; });
        return {
            bootTimeMs: loginMark ? loginMark.ms : perfMarks.loginMs,
            dashboardLoadTimeMs: dashMark ? dashMark.ms : perfMarks.dashboardMs,
            registrationQueryTimeMs: regMark ? regMark.ms : perfMarks.registrationQueryMs,
            cacheHitRatio: cacheHitRatio(),
            cacheHits: perfMarks.cacheHits,
            cacheMisses: perfMarks.cacheMisses,
            memoryUsageMB: estimateMemoryMB(),
            liteLogin: !!global.EMS_LITE_LOGIN,
            marks: marks
        };
    };
})(typeof window !== 'undefined' ? window : globalThis);
