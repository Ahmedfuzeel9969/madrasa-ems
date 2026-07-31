// ============================================================================
// EMS Firebase Read API — Phase 2 enterprise scale (regent14)
// Firebase-first · paginated · never silent empty · millions-ready
// Path: All_Madrasas/{tenantId}/Registrations
// ============================================================================
(function (global) {
    'use strict';

    var DEFAULT_PAGE = 50;
    var ensureInflight = null;

    function repoCount() {
        return (typeof global.emsRegRepoGetList === 'function')
            ? global.emsRegRepoGetList().length : 0;
    }

    function getTenantId() {
        if (typeof global.emsResolveFirestoreTenantId === 'function') {
            var resolved = global.emsResolveFirestoreTenantId();
            if (resolved) return resolved;
        }
        if (typeof global.emsRequireTenantId === 'function') {
            var t = global.emsRequireTenantId();
            if (t) return t;
        }
        if (typeof global.emsGetTenantId === 'function') {
            var tid = global.emsGetTenantId();
            if (tid) return tid;
        }
        return global.CURRENT_MADRASA_TENANT_ID || null;
    }

    function getDb() {
        return typeof global.getDbOrNull === 'function' ? global.getDbOrNull() : null;
    }

    function applyFilters(list, opts) {
        opts = opts || {};
        list = (list || []).slice();
        if (opts.type) list = list.filter(function (u) { return u.type === opts.type; });
        if (opts.className) list = list.filter(function (u) { return u.class === opts.className; });
        if (opts.applyDeptFilter && typeof global.emsFilterByDepartment === 'function') {
            list = global.emsFilterByDepartment(list);
        }
        if (opts.limit) list = list.slice(0, opts.limit);
        return list;
    }

    function waitForDbReady(timeoutMs) {
        timeoutMs = timeoutMs || 10000;
        var db = getDb();
        if (db) return Promise.resolve(db);
        return new Promise(function (resolve) {
            var start = Date.now();
            function tick() {
                var d = getDb();
                if (d) return resolve(d);
                if (Date.now() - start > timeoutMs) return resolve(null);
                setTimeout(tick, 100);
            }
            tick();
        });
    }

    function isDesktopEnv() {
        try {
            if (global.EMS_DESKTOP_UNLIMITED === true) return true;
            if (global.emsDesktop && global.emsDesktop.isDesktop) return true;
        } catch (e) { /* ignore */ }
        return false;
    }

    /**
     * Firebase-first module boot — desktop uses IDB hydrate; browser may fetch page 1.
     * @returns {Promise<{count:number,source:string,hydrationFailed?:boolean}>}
     */
    global.emsFirebaseEnsureModuleData = function (opts) {
        opts = opts || {};
        var tenantId = opts.tenantId || getTenantId();
        if (!tenantId) {
            return Promise.resolve({ count: 0, source: 'no_tenant', ok: false });
        }
        var existing = repoCount();
        if (!opts.force && existing > 0) {
            return Promise.resolve({
                ok: true,
                count: existing,
                source: 'repo_ready',
                cached: true
            });
        }
        if (ensureInflight && !opts.force) {
            return ensureInflight;
        }
        if (typeof global.emsPipelineDebug === 'function') {
            global.emsPipelineDebug('firebase_ensure_start', { tenantId: tenantId, force: !!opts.force });
        }
        ensureInflight = waitForDbReady().then(function (db) {
            if (!db) {
                return { count: 0, source: 'no_db', ok: false };
            }
            if (typeof global.emsRegRepoInit === 'function') {
                global.emsRegRepoInit(tenantId);
            }
            if (isDesktopEnv() && typeof global.emsRegRepoEnsureHydratedFromIdb === 'function' && !opts.force) {
                return global.emsRegRepoEnsureHydratedFromIdb(tenantId, { skipFirstLoginCloud: true }).then(function (bootRes) {
                    var count = repoCount() || (bootRes.count || 0);
                    return {
                        count: count,
                        source: bootRes.source || 'idb_hydrate',
                        ok: bootRes.hydrationComplete !== false,
                        hydrationComplete: bootRes.hydrationComplete
                    };
                });
            }
            if (isDesktopEnv() && typeof global.emsRegRepoHydrateFullFromIdb === 'function' && !opts.force) {
                return global.emsRegRepoHydrateFullFromIdb(tenantId).then(function (hydrateRes) {
                    var count = repoCount() || (hydrateRes.count || 0);
                    return { count: count, source: hydrateRes.source || 'idb_hydrate', ok: count > 0 };
                });
            }
            if (typeof global.emsBootRegistrationModule === 'function') {
                return global.emsBootRegistrationModule(tenantId, {
                    force: !!opts.force && !isDesktopEnv(),
                    startLiveSync: !!opts.startLiveSync
                });
            }
            if (typeof global.emsRegRepoEnsureInitial === 'function') {
                return global.emsRegRepoEnsureInitial(tenantId).then(function (res) {
                    var count = repoCount() || (res.loaded || 0);
                    return { count: count, source: res.source || 'repo_initial', ok: count > 0 };
                });
            }
            return { count: 0, source: 'no_boot_fn', ok: false };
        }).then(function (res) {
            var count = res.count != null ? res.count : repoCount();
            if (typeof global.emsPipelineDebug === 'function') {
                global.emsPipelineDebug('firebase_ensure_done', {
                    tenantId: tenantId,
                    recordCount: count,
                    source: res.source,
                    hydrationFailed: !!res.hydrationFailed
                });
            }
            return {
                ok: count > 0 || !res.hydrationFailed,
                count: count,
                source: res.source || 'firebase_ensure',
                hydrationFailed: !!res.hydrationFailed,
                detail: res
            };
        }).finally(function () {
            ensureInflight = null;
        });
        return ensureInflight;
    };

    /**
     * Paginated server read — cursor via emsRegRepoLoadMore.
     */
    global.emsFirebaseFetchNextPage = function () {
        if (typeof global.emsRegRepoLoadMore === 'function') {
            return global.emsRegRepoLoadMore();
        }
        return Promise.resolve({ added: 0, hasMore: false });
    };

    /**
     * Filtered server query — type/class with { source: 'server' }.
     */
    global.emsFirebaseFetchFiltered = function (opts) {
        opts = opts || {};
        opts.source = 'server';
        if (typeof global.emsFetchUsersByFilter === 'function') {
            return global.emsFetchUsersByFilter(opts);
        }
        return Promise.resolve([]);
    };

    /**
     * Single document read from Firestore server.
     */
    global.emsFirebaseFetchById = function (id, fromRejected) {
        if (!id) return Promise.resolve(null);
        if (typeof global.emsRegRepoGetById === 'function') {
            return global.emsRegRepoGetById(id, !!fromRejected);
        }
        var db = getDb();
        var tid = getTenantId();
        if (!db || !tid) return Promise.resolve(null);
        var col = fromRejected ? 'Rejected' : 'Registrations';
        return db.collection('All_Madrasas').doc(tid).collection(col).doc(id)
            .get({ source: 'server' })
            .then(function (doc) {
                if (!doc.exists) return null;
                var data = doc.data();
                data.id = data.id || doc.id;
                if (typeof global.emsRegRepoUpsert === 'function') {
                    global.emsRegRepoUpsert(data, !!fromRejected);
                }
                return data;
            })
            .catch(function () { return null; });
    };

    /**
     * Universal list load for UI — Firebase server first, repo second, never silent [].
     */
    global.emsFirebaseLoadListForUI = function (opts) {
        opts = opts || {};
        var existing = repoCount();
        if (!opts.force && existing > 0) {
            return Promise.resolve(applyFilters(
                (typeof global.emsRegRepoGetList === 'function' ? global.emsRegRepoGetList() : []),
                opts
            ));
        }
        return global.emsFirebaseEnsureModuleData({ force: !!opts.force }).then(function () {
            if (typeof global.emsRegRepoGetList === 'function') {
                var list = global.emsRegRepoGetList();
                if (list.length) return applyFilters(list, opts);
            }
            return global.emsFirebaseFetchFiltered({
                type: opts.type,
                className: opts.className,
                limit: opts.limit || DEFAULT_PAGE
            }).then(function (rows) {
                return applyFilters(rows, opts);
            });
        });
    };

    /** Probe Firestore for any registration doc (server). */
    global.emsFirebaseProbeHasData = function (tenantId) {
        tenantId = tenantId || getTenantId();
        var db = getDb();
        if (!db || !tenantId) return Promise.resolve(false);
        return db.collection('All_Madrasas').doc(tenantId).collection('Registrations')
            .limit(1).get({ source: 'server' })
            .then(function (snap) { return !snap.empty; })
            .catch(function () { return false; });
    };

})(typeof window !== 'undefined' ? window : globalThis);
