// ============================================================================
// EMS Universal User Service — Single enterprise read API for all modules
// Firestore Registrations → Repository → IDB (cache only) → emsGetUsers()
// ============================================================================
(function (global) {
    'use strict';

    global.EMS_REPOSITORY_READY = false;
    global.EMS_REPOSITORY_BOOT_COMPLETE = false;

    function getTenantId() {
        if (typeof global.emsRequireTenantId === 'function') {
            var required = global.emsRequireTenantId();
            if (required) return required;
        }
        if (typeof global.emsGetTenantId === 'function') {
            var tid = global.emsGetTenantId();
            if (tid) return tid;
        }
        return null;
    }

    /** Default page size for explicit async pagination only — not applied to emsGetUsersMerged. */
    var DEFAULT_USER_PAGE_LIMIT = 1000;

    function repoList(opts) {
        opts = opts || {};
        if (typeof global.emsRegRepoGetList !== 'function') return [];

        if (opts.limit) {
            return global.emsRegRepoGetList({ limit: opts.limit }) || [];
        }

        // Full in-memory SSOT — no artificial export cap (uses cached order array).
        if (typeof global.emsRegRepoGetListReadonly === 'function') {
            var readonly = global.emsRegRepoGetListReadonly();
            if (readonly && readonly.length) return readonly;
        }

        var listOpts = opts.all === true ? { all: true } : {};
        return global.emsRegRepoGetList(listOpts) || [];
    }

    function applyOpts(list, opts) {
        opts = opts || {};
        list = (list || []).slice();
        if (opts.applyDeptFilter && typeof global.emsFilterByDepartment === 'function') {
            list = global.emsFilterByDepartment(list);
        }
        if (opts.type) list = list.filter(function (u) { return u.type === opts.type; });
        if (opts.className) list = list.filter(function (u) { return u.class === opts.className; });
        if (opts.limit) list = list.slice(0, opts.limit);
        return list;
    }

    function isDesktopUnlimited() {
        try {
            if (global.EMS_DESKTOP_UNLIMITED === true) return true;
            if (global.emsDesktop && global.emsDesktop.isDesktop) return true;
        } catch (e) { /* ignore */ }
        if (typeof global.emsIsUnlimitedLocalCache === 'function' && global.emsIsUnlimitedLocalCache()) {
            return true;
        }
        if (typeof global.emsIsDesktopApp === 'function' && global.emsIsDesktopApp()) {
            return true;
        }
        return false;
    }

    function desktopHydrateOnly() {
        if (!isDesktopUnlimited() || typeof global.emsRegRepoHydrateFullFromIdb !== 'function') {
            return Promise.resolve({ count: repoList().length, source: 'not_desktop' });
        }
        return global.emsRegRepoHydrateFullFromIdb(getTenantId()).then(function (hydrateRes) {
            var count = repoList().length || (hydrateRes && hydrateRes.count) || 0;
            if (count > 0) {
                global.EMS_REPOSITORY_BOOT_COMPLETE = true;
                global.EMS_REPOSITORY_READY = true;
            }
            return { count: count, source: (hydrateRes && hydrateRes.source) || 'idb_hydrate' };
        });
    }

    /**
     * Step 6 gate — await before any module render.
     * @returns {Promise<{ready:boolean,bootComplete:boolean,count:number}>}
     */
    global.emsEnsureRepositoryReady = function () {
        if (typeof global.emsCanRunEnterpriseBoot === 'function' && !global.emsCanRunEnterpriseBoot()) {
            return Promise.resolve({
                ready: false,
                bootComplete: false,
                count: 0,
                source: 'pre_auth'
            });
        }
        if (global.EMS_REPOSITORY_BOOT_COMPLETE && repoList().length > 0) {
            return Promise.resolve({
                ready: true,
                bootComplete: true,
                count: repoList().length,
                source: 'boot_complete'
            });
        }
        if (global.EMS_REPOSITORY_BOOT_COMPLETE && repoList().length === 0) {
            if (isDesktopUnlimited()) {
                return desktopHydrateOnly().then(function (hydrateRes) {
                    var count = hydrateRes.count || repoList().length;
                    global.EMS_REPOSITORY_BOOT_COMPLETE = count > 0;
                    global.EMS_REPOSITORY_READY = global.EMS_REPOSITORY_BOOT_COMPLETE;
                    return {
                        ready: count > 0,
                        bootComplete: global.EMS_REPOSITORY_BOOT_COMPLETE,
                        count: count,
                        source: hydrateRes.source || 'desktop_idb_retry'
                    };
                });
            }
            if (typeof global.emsBootRegistrationModule === 'function') {
                return global.emsBootRegistrationModule(getTenantId(), { force: true, startLiveSync: false }).then(function (res) {
                    var count = repoList().length;
                    global.EMS_REPOSITORY_BOOT_COMPLETE = count > 0 || (!!res && res.empty && !res.hydrationFailed);
                    global.EMS_REPOSITORY_READY = global.EMS_REPOSITORY_BOOT_COMPLETE;
                    return {
                        ready: count > 0,
                        bootComplete: global.EMS_REPOSITORY_BOOT_COMPLETE,
                        count: count,
                        hydrationFailed: !!(res && res.hydrationFailed),
                        source: 'empty_boot_retry'
                    };
                });
            }
        }
        if (global.EMS_REPOSITORY_BOOT_COMPLETE && repoList().length === 0
            && typeof global.emsEnsureDataConsistency === 'function') {
            return global.emsEnsureDataConsistency({}).then(function (check) {
                global.EMS_REPOSITORY_BOOT_COMPLETE = repoList().length > 0 || !check.hydrationFailed;
                global.EMS_REPOSITORY_READY = global.EMS_REPOSITORY_BOOT_COMPLETE;
                return {
                    ready: repoList().length > 0,
                    bootComplete: global.EMS_REPOSITORY_BOOT_COMPLETE,
                    count: repoList().length,
                    hydrationFailed: !!check.hydrationFailed,
                    source: 'consistency_retry'
                };
            });
        }
        if (global.EMS_REPOSITORY_BOOT_COMPLETE) {
            return Promise.resolve({
                ready: repoList().length > 0,
                bootComplete: global.EMS_REPOSITORY_BOOT_COMPLETE,
                count: repoList().length,
                source: repoList().length > 0 ? 'boot_complete' : 'boot_complete_empty'
            });
        }
        if (global.EMS_LITE_LOGIN) {
            if (isDesktopUnlimited() && typeof global.emsRegRepoHydrateFullFromIdb === 'function') {
                return global.emsRegRepoHydrateFullFromIdb(getTenantId()).then(function (hydrateRes) {
                    var count = repoList().length || (hydrateRes && hydrateRes.count) || 0;
                    global.EMS_REPOSITORY_BOOT_COMPLETE = count > 0;
                    global.EMS_REPOSITORY_READY = global.EMS_REPOSITORY_BOOT_COMPLETE;
                    return {
                        ready: count > 0,
                        bootComplete: global.EMS_REPOSITORY_BOOT_COMPLETE,
                        count: count,
                        source: (hydrateRes && hydrateRes.source) || 'idb_hydrate'
                    };
                });
            }
            if (typeof global.emsBootRegistrationModule === 'function') {
                return global.emsBootRegistrationModule(getTenantId(), { startLiveSync: false, force: false }).then(function (res) {
                    var count = repoList().length;
                    global.EMS_REPOSITORY_BOOT_COMPLETE = count > 0 || (!!res && res.empty && !res.hydrationFailed);
                    global.EMS_REPOSITORY_READY = global.EMS_REPOSITORY_BOOT_COMPLETE;
                    return {
                        ready: count > 0,
                        bootComplete: global.EMS_REPOSITORY_BOOT_COMPLETE,
                        count: count,
                        empty: !!(res && res.empty),
                        hydrationFailed: !!(res && res.hydrationFailed),
                        source: (res && res.source) || 'module_pagination'
                    };
                });
            }
        }
        if (typeof global.emsBootRegistrationData === 'function') {
            return global.emsBootRegistrationData(getTenantId(), { moduleOpen: true }).then(function (res) {
                global.EMS_REPOSITORY_BOOT_COMPLETE = !!(res && res.bootComplete);
                global.EMS_REPOSITORY_READY = global.EMS_REPOSITORY_BOOT_COMPLETE;
                return {
                    ready: global.EMS_REPOSITORY_BOOT_COMPLETE,
                    bootComplete: global.EMS_REPOSITORY_BOOT_COMPLETE,
                    count: repoList().length,
                    empty: !!(res && res.empty),
                    hydrationFailed: !!(res && res.hydrationFailed),
                    source: (res && res.source) || 'boot'
                };
            });
        }
        return Promise.resolve({ ready: false, bootComplete: false, count: 0, source: 'no_boot' });
    };

    /**
     * Universal async API — all modules should use this.
     * @param {{ type?: string, className?: string, limit?: number, applyDeptFilter?: boolean }} [opts]
     * @returns {Promise<Array>}
     */
    global.emsGetUsers = function (opts) {
        opts = opts || {};
        var pageLimit = opts.limit || DEFAULT_USER_PAGE_LIMIT;
        if (typeof global.emsRegRepoGetListAsync === 'function' && !opts.forceMemory) {
            return global.emsEnsureRepositoryReady().then(function () {
                if (repoList().length && !opts.offset) {
                    return applyOpts(repoList(opts), opts);
                }
                return global.emsRegRepoGetListAsync({
                    offset: opts.offset || 0,
                    limit: pageLimit,
                    type: opts.type,
                    search: opts.search
                }).then(function (res) {
                    return applyOpts(res.rows || [], opts);
                });
            });
        }
        return global.emsEnsureRepositoryReady().then(function () {
            var list = repoList(opts);
            if (list.length) {
                return applyOpts(list, opts);
            }
            if (typeof global.emsFetchUsersByFilter === 'function') {
                return global.emsFetchUsersByFilter({
                    type: opts.type,
                    className: opts.className,
                    limit: typeof global.emsResolveFetchLimit === 'function'
                        ? global.emsResolveFetchLimit(pageLimit)
                        : pageLimit,
                    source: 'server'
                }).then(function (rows) {
                    return applyOpts(rows, opts);
                });
            }
            return [];
        });
    };

    /** Sync read after module fetch — returns repo if populated even before boot flag. */
    global.emsGetUsersSync = function (opts) {
        var list = repoList();
        if (list.length) {
            return applyOpts(list, opts || {});
        }
        if (!global.EMS_REPOSITORY_BOOT_COMPLETE) {
            return [];
        }
        return applyOpts(list, opts || {});
    };

    /** Sync read — full local SSOT when no explicit limit; optional limit via options.limit. */
    global.emsGetUsersMerged = function (options) {
        options = options || {};
        var list = repoList(options);
        if (list.length) {
            return applyOpts(list, options);
        }
        if (typeof global.emsGetUsersSync === 'function') {
            return global.emsGetUsersSync(options);
        }
        return [];
    };

    /**
     * Paginated async read from IDB SSOT — use for dashboards/reports on large tenants.
     * @returns {Promise<{rows:Array,total:number,offset:number,limit:number,hasMore?:boolean}>}
     */
    global.emsGetUsersPage = function (opts) {
        opts = opts || {};
        return global.emsEnsureRepositoryReady().then(function () {
            if (typeof global.emsRegRepoGetListAsync === 'function') {
                return global.emsRegRepoGetListAsync({
                    offset: opts.offset || 0,
                    limit: opts.limit || 100,
                    type: opts.type,
                    q: opts.search || opts.q,
                    search: opts.search || opts.q
                }).then(function (res) {
                    var rows = res.rows || [];
                    if (opts.applyDeptFilter && typeof global.emsFilterByDepartment === 'function') {
                        rows = global.emsFilterByDepartment(rows);
                    }
                    if (opts.className) {
                        rows = rows.filter(function (u) { return u.class === opts.className; });
                    }
                    return {
                        rows: rows,
                        total: res.total || rows.length,
                        offset: res.offset || 0,
                        limit: res.limit || 100,
                        hasMore: res.hasMore
                    };
                });
            }
            var list = applyOpts(repoList(opts), opts);
            return {
                rows: list,
                total: list.length,
                offset: 0,
                limit: opts.limit || DEFAULT_USER_PAGE_LIMIT
            };
        });
    };

    global.emsMarkRepositoryReady = function (count, meta) {
        meta = meta || {};
        global.EMS_REPOSITORY_BOOT_COMPLETE = meta.bootComplete !== false;
        global.EMS_REPOSITORY_READY = global.EMS_REPOSITORY_BOOT_COMPLETE;
        if (typeof global.emsBroadcastUsersChanged === 'function') {
            global.emsBroadcastUsersChanged();
        }
        try {
            global.dispatchEvent(new CustomEvent('ems:repository-ready', {
                detail: {
                    count: count || repoList().length,
                    empty: !!meta.empty,
                    hydrationFailed: !!meta.hydrationFailed
                }
            }));
        } catch (e) { /* ignore */ }
    };

    global.emsResetRepositoryReady = function () {
        global.EMS_REPOSITORY_READY = false;
        global.EMS_REPOSITORY_BOOT_COMPLETE = false;
    };

    /**
     * True institution headcounts from local DB (IDB / SQLite) — never array.length.
     * @returns {Promise<{students:number,teachers:number,staff:number,total:number}>}
     */
    global.emsRegistrationHeadcounts = function () {
        if (typeof global.emsRepo === 'undefined' || !global.emsRepo
            || typeof global.emsRepo.count !== 'function') {
            return Promise.resolve({ students: 0, teachers: 0, staff: 0, total: 0 });
        }
        var tid = getTenantId();
        if (tid && typeof global.emsRepo.useTenant === 'function') {
            global.emsRepo.useTenant(tid);
        }
        return Promise.all([
            global.emsRepo.count('registrations', { type: 'student' }),
            global.emsRepo.count('registrations', { type: 'teacher' }),
            global.emsRepo.count('registrations', { type: 'staff' }),
            global.emsRepo.count('registrations')
        ]).then(function (nums) {
            return {
                students: nums[0] || 0,
                teachers: nums[1] || 0,
                staff: nums[2] || 0,
                total: nums[3] || 0
            };
        }).catch(function () {
            return { students: 0, teachers: 0, staff: 0, total: 0 };
        });
    };

    global.emsWithUsers = function (fn, opts) {
        return global.emsGetUsers(opts).then(function (users) {
            return fn(users);
        });
    };

    global.emsEnsureUsersReady = function () {
        return global.emsEnsureRepositoryReady().then(function () {
            return global.emsGetUsersSync();
        });
    };

})(typeof window !== 'undefined' ? window : globalThis);
