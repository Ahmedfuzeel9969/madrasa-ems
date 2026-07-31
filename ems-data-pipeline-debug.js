// ============================================================================
// EMS Data Pipeline Debug — tenant-scoped query tracing (consistency audit)
// ============================================================================
(function (global) {
    'use strict';

    var ENABLED = false;
    try {
        if (global.location && global.location.search && global.location.search.indexOf('debug=1') >= 0) {
            ENABLED = true;
        }
        if (global.localStorage && global.localStorage.getItem('ems_debug') === '1') {
            ENABLED = true;
        }
    } catch (e) { /* ignore */ }
    var LOG_PREFIX = '[EMS Pipeline]';
    var recentLogs = [];
    var MAX_LOGS = 200;

    function authContext() {
        var uid = null;
        var email = null;
        try {
            var u = firebase.auth().currentUser;
            uid = u ? u.uid : null;
            email = u ? u.email : null;
        } catch (e) { /* ignore */ }
        return {
            authUid: uid,
            email: email,
            tenantId: typeof global.emsRequireTenantId === 'function'
                ? global.emsRequireTenantId()
                : (global.CURRENT_MADRASA_TENANT_ID || null),
            role: global.CURRENT_USER_TENANT_ROLE || null,
            activeTenant: global.EMS_ACTIVE_TENANT_ID || null,
            cacheKey: typeof global.emsRepoKey === 'function'
                ? global.emsRepoKey(global.CURRENT_MADRASA_TENANT_ID)
                : null
        };
    }

    function pushLog(entry) {
        if (!ENABLED) return;
        entry.at = new Date().toISOString();
        recentLogs.push(entry);
        if (recentLogs.length > MAX_LOGS) recentLogs.shift();
        console.log(LOG_PREFIX, entry.stage, entry);
    }

    global.emsPipelineDebug = function (stage, detail) {
        detail = detail || {};
        var ctx = authContext();
        pushLog(Object.assign({
            stage: stage,
            authUid: ctx.authUid,
            email: ctx.email,
            tenantId: ctx.tenantId,
            role: ctx.role,
            activeTenant: ctx.activeTenant,
            cacheKey: ctx.cacheKey
        }, detail));
    };

    global.emsPipelineDebugQuery = function (opts) {
        opts = opts || {};
        var tenantId = opts.tenantId || (typeof global.emsRequireTenantId === 'function'
            ? global.emsRequireTenantId() : global.CURRENT_MADRASA_TENANT_ID);
        var path = tenantId
            ? 'All_Madrasas/' + tenantId + '/' + (opts.collection || 'Registrations')
            : 'UNKNOWN';
        global.emsPipelineDebug(opts.stage || 'firestore_query', {
            queryPath: path,
            collection: opts.collection || 'Registrations',
            filters: opts.filters || null,
            limit: opts.limit || null,
            recordCount: opts.recordCount != null ? opts.recordCount : null,
            source: opts.source || 'server',
            cacheHit: !!opts.cacheHit,
            error: opts.error || null
        });
        return path;
    };

    global.emsPipelineDebugGetLogs = function () {
        return recentLogs.slice();
    };

    global.emsPipelineDebugSetEnabled = function (on) {
        ENABLED = !!on;
    };

})(typeof window !== 'undefined' ? window : globalThis);
