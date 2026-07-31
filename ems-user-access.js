// ============================================================================
// EMS User Access — Universal Registration Data Layer (Final Integration)
// Single read path: Firestore Registrations → Repository → IDB cache
// ============================================================================
(function (global) {
    'use strict';

    var USERS_KEY = global.DB && global.DB.users ? global.DB.users : 'ems_full_users';
    var REJECTED_KEY = 'ems_rejected_users';
    var QUERY_CACHE = Object.create(null);
    var CACHE_TTL_MS = 120000;

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

    function scopedQueryKey(opts) {
        var tid = getTenantId() || 'none';
        return tid + '|' + cacheKey(opts);
    }

    function getDb() {
        return typeof global.getDbOrNull === 'function' ? global.getDbOrNull() : (typeof db !== 'undefined' ? db : null);
    }

    function lean(data) {
        return typeof global.emsLeanUserForLocalStorage === 'function'
            ? global.emsLeanUserForLocalStorage(data)
            : data;
    }

    function filterActiveUsers(list, opts) {
        opts = opts || {};
        if (opts.activeOnly === false) return list || [];
        var Q = typeof global.EmsQueryUtils !== 'undefined' ? global.EmsQueryUtils : null;
        if (Q && typeof Q.filterActiveRegistrations === 'function') {
            return Q.filterActiveRegistrations(list || []);
        }
        return (list || []).filter(function (u) {
            if (!u) return false;
            var s = String(u.status == null ? '' : u.status).trim().toLowerCase();
            if (!s) return true;
            return s !== 'pending' && s !== 'rejected' && s !== 'suspended'
                && s !== 'withdrawn' && s !== 'inactive' && s !== 'deleted';
        });
    }

    function cacheKey(opts) {
        return [opts.type || '', opts.className || '', opts.limit || ''].join('|');
    }

    function readQueryCache(key) {
        var hit = QUERY_CACHE[key];
        if (!hit) return null;
        if (Date.now() - hit.at > CACHE_TTL_MS) {
            delete QUERY_CACHE[key];
            return null;
        }
        return hit.data.slice();
    }

    function writeQueryCache(key, data) {
        QUERY_CACHE[key] = { at: Date.now(), data: data.slice() };
    }

    function readIdbHydratedCache(key) {
        key = key || USERS_KEY;
        if (typeof global.emsCacheGet !== 'function') return [];
        var arr = global.emsCacheGet(key, []);
        if (!arr || !arr.length) return [];
        if (arr.length === 1 && arr[0] && arr[0].__emsIdb) return [];
        return arr;
    }

    function applyDepartmentFilter(list) {
        if (!list || !list.length) return [];
        list = list.slice();
        if (typeof global.emsFilterByDepartment === 'function') {
            list = global.emsFilterByDepartment(list);
        }
        return list;
    }

    function getRepoUsersSync() {
        if (typeof global.emsRegRepoGetList !== 'function') return [];
        var list = global.emsRegRepoGetList();
        if (!list || !list.length) return [];
        return list.slice();
    }

    /**
     * Legacy IDB cache-key read — does NOT overwrite emsGetUsers(opts) from user-service.
     * @param {string} [key]
     */
    global.emsGetUsersByCacheKey = function (key) {
        key = key || USERS_KEY;
        if (key === REJECTED_KEY) {
            return global.emsUserRepository.getRejected();
        }
        if (key !== USERS_KEY) {
            return Promise.resolve(readIdbHydratedCache(key));
        }
        return global.emsUserRepository.getUsers();
    };

    global.emsUserRepository = {
        isReady: function () {
            return typeof global.emsIsRegistrationRepositoryReady === 'function'
                && global.emsIsRegistrationRepositoryReady();
        },

        ensureReady: function () {
            if (typeof global.emsBootRegistrationModule === 'function') {
                return global.emsBootRegistrationModule(getTenantId(), { startLiveSync: false, force: true });
            }
            if (typeof global.emsBootRegistrationData === 'function') {
                return global.emsBootRegistrationData(getTenantId(), { moduleOpen: true });
            }
            if (typeof global.emsRegRepoEnsureReady === 'function') {
                return global.emsRegRepoEnsureReady(getTenantId());
            }
            return Promise.resolve({ ready: false, count: 0 });
        },

        getUsers: function (opts) {
            opts = opts || {};
            var self = this;
            return this.ensureReady().then(function () {
                var list = getRepoUsersSync();
                if (list.length) {
                    return self._applyOpts(list, opts);
                }
                return global.emsFetchUsersByFilter({ limit: opts.limit || 50 }).then(function (rows) {
                    return self._applyOpts(rows, opts);
                });
            });
        },

        getUsersSync: function () {
            return global.emsGetUsersMerged();
        },

        getRejected: function () {
            return this.ensureReady().then(function () {
                if (typeof global.emsRegRepoGetRejectedList === 'function') {
                    return global.emsRegRepoGetRejectedList();
                }
                return readIdbHydratedCache(REJECTED_KEY);
            });
        },

        getById: function (id, fromRejected) {
            return global.emsGetUserById(id, fromRejected);
        },

        _applyOpts: function (list, opts) {
            if (opts.applyDeptFilter && typeof global.emsFilterByDepartment === 'function') {
                list = global.emsFilterByDepartment(list);
            }
            if (opts.type) list = list.filter(function (u) { return u.type === opts.type; });
            if (opts.className) list = list.filter(function (u) { return u.class === opts.className; });
            if (opts.limit) list = list.slice(0, opts.limit);
            return list;
        }
    };

    global.emsGetStudentCount = function () {
        if (typeof global.emsGetDashboardStats === 'function') {
            var stats = global.emsGetDashboardStats();
            if (stats && stats.counts && stats.counts.students != null) {
                return Number(stats.counts.students) || 0;
            }
        }
        return global.emsGetUsersMerged().filter(function (u) { return u.type === 'student'; }).length;
    };

    function normUserId(v) {
        if (v == null) return '';
        return String(v).trim();
    }

    function normUserIdUpper(v) {
        return normUserId(v).toUpperCase();
    }

    /** Canonical registration ID — matches attendance module resolution order. */
    global.emsResolveCanonicalUserId = function (userOrId) {
        if (userOrId && typeof userOrId === 'object') {
            return normUserId(userOrId.id || userOrId.regId || userOrId.uid || userOrId.docId);
        }
        return normUserId(userOrId);
    };

    /** All known ID aliases for a user record (legacy + cloud). */
    global.emsCollectUserIdAliases = function (user) {
        var seen = Object.create(null);
        var out = [];
        function add(v) {
            var s = normUserId(v);
            if (!s || seen[s]) return;
            seen[s] = true;
            out.push(s);
            var u = normUserIdUpper(s);
            if (u && !seen[u]) { seen[u] = true; out.push(u); }
        }
        if (!user) return out;
        add(user.id);
        add(user.regId);
        add(user.uid);
        add(user.docId);
        return out;
    };

    global.emsIdsEquivalent = function (a, b) {
        var ca = normUserIdUpper(a);
        var cb = normUserIdUpper(b);
        return !!(ca && cb && ca === cb);
    };

    /** Match module rows (fees, exams, complaints) against a user via alias fields. */
    global.emsRecordMatchesUserId = function (record, userOrId, fields) {
        fields = fields || ['studentId', 'individualId', 'id', 'regId', 'uid', 'docId'];
        if (!record) return false;
        var aliases = (userOrId && typeof userOrId === 'object')
            ? global.emsCollectUserIdAliases(userOrId)
            : [normUserId(userOrId), normUserIdUpper(userOrId)].filter(Boolean);
        if (!aliases.length) return false;
        for (var i = 0; i < fields.length; i++) {
            var val = record[fields[i]];
            if (val == null || val === '') continue;
            for (var j = 0; j < aliases.length; j++) {
                if (global.emsIdsEquivalent(val, aliases[j])) return true;
            }
        }
        return false;
    };

    global.emsFindUserInList = function (list, id) {
        if (!id || !list || !list.length) return null;
        var target = normUserIdUpper(id);
        for (var i = 0; i < list.length; i++) {
            var u = list[i];
            if (!u) continue;
            var aliases = global.emsCollectUserIdAliases(u);
            for (var j = 0; j < aliases.length; j++) {
                if (normUserIdUpper(aliases[j]) === target) return u;
            }
        }
        return null;
    };

    function localUserFallback(id, fromRejected) {
        var list;
        if (fromRejected) {
            list = typeof global.emsRegRepoGetRejectedList === 'function'
                ? global.emsRegRepoGetRejectedList()
                : readIdbHydratedCache(REJECTED_KEY);
        } else {
            list = global.emsGetUsersMerged();
        }
        return global.emsFindUserInList(list, id);
    }

    global.emsGetUserById = function (id, fromRejected) {
        if (!id) return Promise.resolve(null);
        if (typeof global.emsRegRepoGetById === 'function') {
            return global.emsRegRepoGetById(id, fromRejected).then(function (user) {
                if (user) return user;
                return localUserFallback(id, fromRejected);
            }).catch(function () {
                return localUserFallback(id, fromRejected);
            });
        }
        return Promise.resolve(localUserFallback(id, fromRejected));
    };

    function resolveFetchLimit(requested) {
        if (typeof global.emsResolveFirestoreLimit === 'function') {
            return global.emsResolveFirestoreLimit(requested, 50);
        }
        var lim = typeof global.emsResolveFetchLimit === 'function'
            ? global.emsResolveFetchLimit(requested)
            : (requested || 50);
        return Math.max(1, lim || 50);
    }

    /**
     * On-demand Firestore query — type / class filter (server-side for scale).
     * @param {{ type?: string, className?: string, limit?: number }} opts
     */
    global.emsFetchUsersByFilter = function (opts) {
        opts = opts || {};
        var key = scopedQueryKey(opts);
        var cached = readQueryCache(key);
        if (cached) return Promise.resolve(cached);

        if (typeof firebase === 'undefined' || global.EMS_OFFLINE_ONLY === true) {
            return Promise.resolve(global.emsFilterUsersLocal(opts));
        }

        var db = getDb();
        var tid = getTenantId();
        if (!db || !tid) {
            return Promise.resolve(global.emsFilterUsersLocal(opts));
        }

        var pageLimit = resolveFetchLimit(opts.limit);
        var col = db.collection('All_Madrasas').doc(tid).collection('Registrations');
        var q;
        if (opts.type && opts.className) {
            q = col.where('type', '==', opts.type).where('class', '==', opts.className).limit(pageLimit);
        } else if (opts.type) {
            q = col.where('type', '==', opts.type).orderBy('timestamp', 'desc').limit(pageLimit);
        } else {
            q = col.orderBy('timestamp', 'desc').limit(pageLimit);
        }

        var getOpts = { source: 'server' };
        return q.get(getOpts).then(function (snap) {
            var rows = [];
            snap.forEach(function (doc) {
                var data = doc.data();
                data.id = data.id || doc.id;
                var rec = lean(data);
                rows.push(rec);
                if (typeof global.emsRegRepoUpsert === 'function') {
                    global.emsRegRepoUpsert(rec);
                }
            });
            if (typeof global.emsFilterByDepartment === 'function') {
                rows = global.emsFilterByDepartment(rows);
            }
            rows = filterActiveUsers(rows, opts);
            writeQueryCache(key, rows);
            return rows;
        }).catch(function () {
            return global.emsFilterUsersLocal(opts);
        });
    };

    global.emsFilterUsersLocal = function (opts) {
        opts = opts || {};
        var list = global.emsGetUsersMerged();
        if (opts.type) list = list.filter(function (u) { return u.type === opts.type; });
        if (opts.className) list = list.filter(function (u) { return u.class === opts.className; });
        list = filterActiveUsers(list, opts);
        if (typeof global.emsFilterByDepartment === 'function') {
            list = global.emsFilterByDepartment(list);
        }
        if (opts.limit > 0) list = list.slice(0, opts.limit);
        return list;
    };

    function resolveLocalFetchLimit(requested) {
        return typeof global.emsResolveFetchLimit === 'function'
            ? global.emsResolveFetchLimit(requested)
            : (requested || 50);
    }

    global.emsFetchStudentsForClass = function (className) {
        return global.emsFetchUsersByFilter({
            type: 'student',
            className: className,
            limit: resolveFetchLimit()
        });
    };

    /** Phase B0 — local roster first; Firestore only when local cache is empty. */
    global.emsFetchStudentsLocalFirst = function (className) {
        var limit = resolveLocalFetchLimit();
        var localOpts = { type: 'student', className: className };
        if (limit > 0) localOpts.limit = limit;
        var local = global.emsFilterUsersLocal(localOpts);
        if (local.length) return Promise.resolve(local);
        return global.emsFetchUsersByFilter({ type: 'student', className: className, limit: resolveFetchLimit() });
    };

    global.emsFetchStaffByType = function (type) {
        return global.emsFetchUsersByFilter({
            type: type,
            limit: resolveFetchLimit()
        });
    };

    /** Phase B0 — local roster first for teachers/staff. */
    global.emsFetchStaffLocalFirst = function (type) {
        var limit = resolveLocalFetchLimit();
        var localOpts = { type: type };
        if (limit > 0) localOpts.limit = limit;
        var local = global.emsFilterUsersLocal(localOpts);
        if (local.length) return Promise.resolve(local);
        return global.emsFetchUsersByFilter({ type: type, limit: resolveFetchLimit() });
    };

    global.emsInvalidateUserQueryCache = function () {
        QUERY_CACHE = Object.create(null);
    };

    global.emsBroadcastUsersChanged = function () {
        try {
            global.dispatchEvent(new CustomEvent('ems:users-changed'));
        } catch (e) { /* ignore */ }
    };

})(typeof window !== 'undefined' ? window : globalThis);
