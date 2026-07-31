// ============================================================================
// EMS Enterprise Search — callable + local fallback + Sprint 2 search router
// UI: admission regListSearch uses emsRegSearchRouter (cloud-first when online).
// ============================================================================
(function (global) {
    'use strict';

    var SEARCH_MIN = 2;
    var CACHE_TTL_MS = 60000;
    var CACHE_MAX = 10;
    var lastSource = 'none';
    var queryCache = Object.create(null);
    var cacheOrder = [];

    function getTenantId() {
        if (typeof global.emsGetTenantId === 'function') {
            var tid = global.emsGetTenantId();
            if (tid) return tid;
        }
        try {
            var u = firebase.auth && firebase.auth().currentUser;
            return u ? u.uid : null;
        } catch (e) {
            return null;
        }
    }

    function applyRepoResults(rows) {
        if (typeof global.emsRegRepoSetSearchResults === 'function') {
            global.emsRegRepoSetSearchResults(rows);
        }
    }

    function clearRepoSearch() {
        if (typeof global.emsRegRepoClearSearch === 'function') {
            global.emsRegRepoClearSearch();
        }
    }

    function isOnlineSearchPreferred(opts) {
        opts = opts || {};
        if (opts.preferCloud === false) return false;
        if (global.EMS_REG_FORCE_LOCAL_SEARCH === true) return false;
        if (global.EMS_OFFLINE_ONLY === true) return false;
        try {
            if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
        } catch (e) { /* ignore */ }
        return true;
    }

    function cacheKey(tenantId, query) {
        return String(tenantId || '') + '|' + String(query || '').toLowerCase();
    }

    function readCache(tenantId, query) {
        var key = cacheKey(tenantId, query);
        var hit = queryCache[key];
        if (!hit) return null;
        if (Date.now() - hit.ts > CACHE_TTL_MS) {
            delete queryCache[key];
            return null;
        }
        return hit;
    }

    function writeCache(tenantId, query, rows, source) {
        var key = cacheKey(tenantId, query);
        queryCache[key] = { rows: (rows || []).slice(), source: source, ts: Date.now() };
        var idx = cacheOrder.indexOf(key);
        if (idx >= 0) cacheOrder.splice(idx, 1);
        cacheOrder.push(key);
        while (cacheOrder.length > CACHE_MAX) {
            var old = cacheOrder.shift();
            delete queryCache[old];
        }
    }

    function fallbackRepoSearch(query) {
        if (typeof global.emsRegRepoSearch === 'function') {
            return global.emsRegRepoSearch(query).then(function (rows) {
                lastSource = 'firestore-client';
                applyRepoResults(rows || []);
                return { rows: rows || [], source: lastSource };
            });
        }
        lastSource = 'local-index';
        clearRepoSearch();
        return Promise.resolve({ rows: null, source: lastSource, delegated: true });
    }

    function localIndexedSearch(query) {
        lastSource = 'local-index';
        clearRepoSearch();
        return Promise.resolve({ rows: null, source: lastSource, delegated: true });
    }

    function exactIdSearch(query) {
        if (!/^(STD|TCH|STF)-/i.test(query)) return Promise.resolve(null);
        var id = String(query).trim().toUpperCase();
        var loadFn = typeof global.emsRegGetRecordById === 'function'
            ? function () { return global.emsRegGetRecordById(id, { fromRejected: false }); }
            : (typeof global.emsGetUserById === 'function'
              ? function () { return global.emsGetUserById(id, false); }
              : null);
        if (!loadFn) return Promise.resolve(null);
        return loadFn().then(function (rec) {
            if (!rec) return null;
            lastSource = 'id-direct';
            applyRepoResults([rec]);
            return { rows: [rec], source: lastSource };
        });
    }

    global.emsEnterpriseSearchGetSource = function () {
        return lastSource;
    };

    global.emsEnterpriseSearchClear = function () {
        lastSource = 'none';
        clearRepoSearch();
    };

    global.emsEnterpriseSearchRegistrations = function (query) {
        query = String(query || '').trim();
        if (query.length < SEARCH_MIN) {
            global.emsEnterpriseSearchClear();
            return Promise.resolve([]);
        }

        var tid = getTenantId();
        if (!tid || !firebase.functions || typeof firebase.functions !== 'function') {
            return fallbackRepoSearch(query).then(function (res) { return res.rows || []; });
        }

        return firebase.functions().httpsCallable('searchTenantRegistrations')({
            tenantId: tid,
            query: query
        }).then(function (res) {
            var data = res && res.data ? res.data : {};
            var rows = data.results || [];
            lastSource = data.source || 'firestore';
            applyRepoResults(rows);
            return rows;
        }).catch(function () {
            return fallbackRepoSearch(query).then(function (r) { return r.rows || []; });
        });
    };

    /**
     * Sprint 2 router: exact ID → cache → cloud (online) → local indexed fallback.
     * @returns {Promise<{rows:Array|null, source:string, delegated?:boolean}>}
     */
    global.emsRegSearchRouter = function (query, opts) {
        query = String(query || '').trim();
        opts = opts || {};

        if (query.length < SEARCH_MIN) {
            global.emsEnterpriseSearchClear();
            return Promise.resolve({ rows: [], source: 'none' });
        }

        var tid = getTenantId();
        var cached = readCache(tid, query);
        if (cached) {
            lastSource = 'cache';
            applyRepoResults(cached.rows);
            return Promise.resolve({ rows: cached.rows, source: lastSource });
        }

        return exactIdSearch(query).then(function (idHit) {
            if (idHit) {
                writeCache(tid, query, idHit.rows, idHit.source);
                return idHit;
            }

            if (isOnlineSearchPreferred(opts)) {
                return global.emsEnterpriseSearchRegistrations(query).then(function (rows) {
                    var result = { rows: rows || [], source: lastSource };
                    writeCache(tid, query, result.rows, result.source);
                    return result;
                }).catch(function () {
                    return localIndexedSearch(query);
                });
            }

            if (typeof global.emsRegRepoSearch === 'function' && global.EMS_OFFLINE_ONLY === true) {
                return fallbackRepoSearch(query);
            }

            return localIndexedSearch(query);
        });
    };
})(typeof window !== 'undefined' ? window : globalThis);
