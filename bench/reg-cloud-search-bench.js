// Registration cloud search benchmark — run while logged into EMS (Firebase auth required)
(function (global) {
    'use strict';

    var DEFAULT_QUERIES = [
        { label: 'exact-id', q: 'STD-000001' },
        { label: 'narrow-prefix', q: 'STD-00' },
        { label: 'broad-name', q: 'طالب' },
        { label: 'phone-prefix', q: '0300' },
        { label: 'cnic-prefix', q: '35202' }
    ];

    function nowMs() {
        return (global.performance && global.performance.now) ? global.performance.now() : Date.now();
    }

    function round(x) {
        return Math.round(x * 100) / 100;
    }

    function getTenantId() {
        if (typeof global.emsGetTenantId === 'function') {
            var tid = global.emsGetTenantId();
            if (tid) return tid;
        }
        try {
            var u = global.firebase && global.firebase.auth && global.firebase.auth().currentUser;
            return u ? u.uid : null;
        } catch (e) {
            return null;
        }
    }

    function runOne(query, opts) {
        opts = opts || {};
        var router = typeof global.emsRegSearchRouter === 'function'
            ? global.emsRegSearchRouter
            : (typeof global.emsEnterpriseSearchRegistrations === 'function'
                ? function (qq) {
                    return global.emsEnterpriseSearchRegistrations(qq).then(function (rows) {
                        return { rows: rows || [], source: global.emsEnterpriseSearchGetSource ? global.emsEnterpriseSearchGetSource() : 'cloud' };
                    });
                }
                : null);
        if (!router) {
            return Promise.resolve({ ok: false, error: 'emsRegSearchRouter not loaded', query: query });
        }
        if (typeof global.emsEnterpriseSearchClear === 'function') {
            global.emsEnterpriseSearchClear();
        }
        var t0 = nowMs();
        return router(String(query.q || query), opts).then(function (res) {
            var ms = round(nowMs() - t0);
            return {
                ok: true,
                label: query.label || query.q,
                query: query.q || query,
                ms: ms,
                source: (res && res.source) || (global.emsEnterpriseSearchGetSource ? global.emsEnterpriseSearchGetSource() : 'unknown'),
                count: res && res.rows ? res.rows.length : 0
            };
        }).catch(function (err) {
            return {
                ok: false,
                label: query.label || query.q,
                query: query.q || query,
                ms: round(nowMs() - t0),
                error: err && err.message ? err.message : String(err)
            };
        });
    }

    global.emsRegCloudSearchBench = function (opts) {
        opts = opts || {};
        var queries = opts.queries || DEFAULT_QUERIES;
        var tenantId = getTenantId();
        if (!tenantId) {
            return Promise.resolve({
                ok: false,
                error: 'No tenant / Firebase auth — login to EMS first, then re-run emsRegCloudSearchBench()',
                scheduled: true
            });
        }
        if (typeof global.navigator !== 'undefined' && global.navigator.onLine === false) {
            return Promise.resolve({
                ok: false,
                error: 'Offline — cloud benchmark requires network',
                tenantId: tenantId
            });
        }

        var chain = Promise.resolve([]);
        queries.forEach(function (q) {
            chain = chain.then(function (acc) {
                return runOne(q, opts.routerOpts).then(function (row) {
                    acc.push(row);
                    return acc;
                });
            });
        });

        return chain.then(function (results) {
            var cachePass = opts.repeatCache !== false;
            var out = {
                ok: true,
                generatedAt: new Date().toISOString(),
                tenantId: tenantId,
                online: true,
                queries: results,
                cacheRepeat: null
            };
            if (!cachePass || !results.length) return out;
            var first = results[0];
            return runOne({ label: first.label + '-cache', q: first.query }, opts.routerOpts).then(function (cached) {
                out.cacheRepeat = cached;
                return out;
            });
        });
    };

    global.emsRegCloudSearchBenchDownload = function (payload) {
        payload = payload || {};
        var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'reg-cloud-search-bench-' + Date.now() + '.json';
        a.click();
    };
})(typeof window !== 'undefined' ? window : globalThis);
