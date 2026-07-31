// ============================================================================
// EMS Repository — the single Database Interface for all persistent data
// ----------------------------------------------------------------------------
// The UI, state management and pagination logic talk ONLY to window.emsRepo.
// They never touch localStorage / IndexedDB / fs / SQLite directly. This is the
// seam that lets us swap the storage engine (IndexedDB in browser, fs-JSON on
// desktop today, better-sqlite3 tomorrow) WITHOUT changing application logic.
//
// Backends (auto-selected, best first):
//   1. NativeBackend  — window.emsNativeDb (Electron/Capacitor: real OS files)
//   2. IdbBackend     — IndexedDB collection store (browser durable)
//   3. MemoryBackend  — in-RAM fallback (no persistence; last resort)
//
// Public async API (Promise-based, collection-oriented):
//   emsRepo.ready()                         -> Promise<{backend}>
//   emsRepo.backendName()                   -> 'native' | 'indexeddb' | 'memory'
//   emsRepo.useTenant(tenantId)             -> void   (multi-institution isolation)
//   emsRepo.put(collection, record)         -> Promise   (record MUST have .id)
//   emsRepo.bulkPut(collection, records)    -> Promise<count>
//   emsRepo.get(collection, id)             -> Promise<record|null>
//   emsRepo.remove(collection, id)          -> Promise
//   emsRepo.clear(collection)               -> Promise
//   emsRepo.count(collection, filter, search) -> Promise<number>
//   emsRepo.page(collection, {offset,limit,filter,sort,search}) -> Promise<{rows,total,offset,limit}>
//   emsRepo.exportAll() / importAll(payload)
// ============================================================================
(function (global) {
    'use strict';

    var Q = global.EmsQueryUtils || {
        pageFromAll: function (a, o) { o = o || {}; return { rows: a.slice(o.offset || 0, (o.offset || 0) + (o.limit || 100)), total: a.length, offset: o.offset || 0, limit: o.limit || 100 }; },
        countFromAll: function (a) { return a.length; }
    };

    var currentTenant = null;

    function scoped(collection) {
        var t = currentTenant || 'default';
        return t + '__' + collection;
    }

    // ---- Backend: IndexedDB collection store --------------------------------
    // Snapshot cache: reading the WHOLE collection from IndexedDB on every render
    // (pagination click, keystroke search, users-changed refresh) was the main
    // render-time cost. We materialise the collection once and reuse it for all
    // page()/count() calls, invalidating the moment ANY write touches it. All
    // writes to this store go exclusively through this backend, so invalidation
    // is complete. pageFromAll/countFromAll never mutate the array (they build
    // new ones), so sharing the cached reference is safe.
    function IdbBackend() {
        var cache = Object.create(null);   // scopedCollection -> rows[]
        var version = Object.create(null); // scopedCollection -> generation number

        function ver(c) { return version[c] || 0; }
        function invalidate(c) { delete cache[c]; version[c] = ver(c) + 1; }

        function loadAll(c) {
            if (global.EMS_IDB_BENCH_TRACE) {
                global.EMS_IDB_BENCH_TRACE.loadAllCalls = (global.EMS_IDB_BENCH_TRACE.loadAllCalls || 0) + 1;
                global.EMS_IDB_BENCH_TRACE.loadAllCollections = global.EMS_IDB_BENCH_TRACE.loadAllCollections || [];
                global.EMS_IDB_BENCH_TRACE.loadAllCollections.push(String(c));
            }
            if (cache[c]) return Promise.resolve(cache[c]);
            var v = ver(c);
            return global.emsIdbColAll(c).then(function (rows) {
                rows = rows || [];
                // Only cache if no write invalidated this collection mid-read,
                // otherwise we'd persist a stale snapshot (missing the new write).
                if (ver(c) === v) cache[c] = rows;
                return rows;
            });
        }

        return {
            name: 'indexeddb',
            put: function (c, r) { invalidate(c); return global.emsIdbColPut(c, r); },
            bulkPut: function (c, rs) { invalidate(c); return global.emsIdbColBulkPut(c, rs); },
            get: function (c, id) { return global.emsIdbColGet(c, id).then(function (v) { return v || null; }); },
            remove: function (c, id) { invalidate(c); return global.emsIdbColDelete(c, id); },
            clear: function (c) { invalidate(c); return global.emsIdbColClear(c); },
            all: function (c) { return loadAll(c).then(function (rows) { return rows.slice(); }); },
            count: function (c, filter, search) {
                if (!filter && !search) {
                    if (cache[c]) return Promise.resolve(cache[c].length);
                    return global.emsIdbColCount(c);
                }
                if (typeof global.emsIdbColCountFiltered === 'function') {
                    return global.emsIdbColCountFiltered(c, filter, search);
                }
                return global.emsIdbColPage(c, {
                    offset: 0,
                    limit: 1,
                    filter: filter,
                    search: search
                }).then(function (res) { return res.total || 0; });
            },
            page: function (c, opts) {
                opts = opts || {};
                return global.emsIdbColPage(c, opts).then(function (res) {
                    return {
                        rows: res.rows,
                        total: res.total,
                        offset: res.offset,
                        limit: res.limit,
                        hasMore: res.hasMore
                    };
                });
            },
            _invalidateCache: function (c) {
                if (c == null) {
                    var keys = Object.keys(cache);
                    for (var i = 0; i < keys.length; i++) { invalidate(keys[i]); }
                } else {
                    invalidate(c);
                }
            }
        };
    }

    // ---- Backend: native OS engine (Electron/Capacitor over bridge) ---------
    function NativeBackend() {
        var db = global.emsNativeDb;
        return {
            name: 'native',
            put: function (c, r) { return db.put(c, r); },
            bulkPut: function (c, rs) { return db.bulkPut(c, rs); },
            get: function (c, id) { return db.get(c, id).then(function (v) { return v || null; }); },
            remove: function (c, id) { return db.remove(c, id); },
            clear: function (c) { return db.clear(c); },
            all: function (c) { return db.all(c); },
            // Native does filter/sort/paginate on its side (main process / SQL).
            count: function (c, filter, search) { return db.count(c, filter, search); },
            page: function (c, opts) { return db.page(c, opts); }
        };
    }

    // ---- Backend: in-memory (last-resort fallback) --------------------------
    function MemoryBackend() {
        var mem = Object.create(null);
        function map(c) { if (!mem[c]) mem[c] = Object.create(null); return mem[c]; }
        return {
            name: 'memory',
            put: function (c, r) { if (r && r.id != null) map(c)[r.id] = r; return Promise.resolve(true); },
            bulkPut: function (c, rs) { var m = map(c), n = 0; (rs || []).forEach(function (r) { if (r && r.id != null) { m[r.id] = r; n++; } }); return Promise.resolve(n); },
            get: function (c, id) { return Promise.resolve(map(c)[id] || null); },
            remove: function (c, id) { delete map(c)[id]; return Promise.resolve(true); },
            clear: function (c) { mem[c] = Object.create(null); return Promise.resolve(true); },
            all: function (c) { return Promise.resolve(Object.keys(map(c)).map(function (k) { return map(c)[k]; })); },
            count: function (c, filter, search) { return this.all(c).then(function (rows) { return Q.countFromAll(rows, filter, search); }); },
            page: function (c, opts) { return this.all(c).then(function (rows) { return Q.pageFromAll(rows, opts); }); }
        };
    }

    function selectBackend() {
        if (global.emsNativeDb && global.emsNativeDb.isNative === true) {
            return NativeBackend();
        }
        if (typeof global.emsIdbColPut === 'function') {
            return IdbBackend();
        }
        return MemoryBackend();
    }

    var backend = null;
    function be() {
        if (!backend) backend = selectBackend();
        return backend;
    }

    global.emsRepo = {
        ready: function () {
            var b = be();
            var chain = (typeof global.emsIdbReady === 'function' && b.name === 'indexeddb')
                ? global.emsIdbReady()
                : Promise.resolve(true);
            return chain.then(function () { return { backend: b.name }; });
        },
        backendName: function () { return be().name; },
        useTenant: function (tenantId) { currentTenant = tenantId || null; },
        getTenant: function () { return currentTenant; },

        /** Drop the IDB snapshot cache (all collections, or one scoped collection). */
        invalidateCache: function (collection) {
            var b = be();
            if (typeof b._invalidateCache === 'function') {
                b._invalidateCache(collection == null ? null : scoped(collection));
            }
        },

        put: function (collection, record) { return be().put(scoped(collection), record); },
        bulkPut: function (collection, records) { return be().bulkPut(scoped(collection), records); },
        get: function (collection, id) { return be().get(scoped(collection), id); },
        remove: function (collection, id) { return be().remove(scoped(collection), id); },
        clear: function (collection) { return be().clear(scoped(collection)); },
        count: function (collection, filter, search) { return be().count(scoped(collection), filter, search); },
        page: function (collection, opts) { return be().page(scoped(collection), opts || {}); },

        /** Escape hatch for small collections / migrations — avoid for large data. */
        all: function (collection) { return be().all(scoped(collection)); },

        exportAll: function () {
            if (typeof global.emsBackupCollect === 'function') return global.emsBackupCollect();
            return Promise.resolve({ format: 'ems-backup', version: 1, data: {} });
        },
        importAll: function (payload) {
            var self = this;
            if (typeof global.emsBackupApply === 'function') {
                return global.emsBackupApply(payload).then(function (res) {
                    self.invalidateCache();
                    return res;
                });
            }
            return Promise.resolve({ ok: false });
        }
    };
})(typeof window !== 'undefined' ? window : globalThis);
