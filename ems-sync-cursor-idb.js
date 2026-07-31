// ============================================================================
// EMS Sync Cursor IDB — per-key atomic pull cursors (Phase 4 Priority 2)
// Replaces localStorage read-modify-write on ems_cache_meta.pullCursor fields.
// IndexedDB transactions serialize cross-tab writes per origin.
// ============================================================================
(function (global) {
    'use strict';

    var DB_NAME = 'ems_sync_cursors_v1';
    var DB_VERSION = 1;
    var STORE = 'cursors';
    var MIGRATE_FLAG = 'ems_sync_cursor_idb_migrated_v1';
    var LEGACY_META_KEY = 'ems_cache_meta';

    var dbPromise = null;
    var initPromise = null;
    var memoryCache = Object.create(null);
    var bc = null;

    function getBroadcastChannel() {
        if (typeof BroadcastChannel === 'undefined') return null;
        if (!bc) {
            try { bc = new BroadcastChannel('ems-sync-cursor-v1'); } catch (e) { bc = null; }
        }
        return bc;
    }

    function listenCursorChanges() {
        var channel = getBroadcastChannel();
        if (!channel) return;
        channel.onmessage = function (ev) {
            var data = ev && ev.data;
            if (!data || data.type !== 'cursor' || !data.key || !data.row) return;
            memoryCache[data.key] = data.row;
        };
    }

    function broadcastCursor(key, row) {
        var channel = getBroadcastChannel();
        if (!channel || !key || !row) return;
        try {
            channel.postMessage({ type: 'cursor', key: key, row: row });
        } catch (e) { /* ignore */ }
    }

    function openDb() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise(function (resolve, reject) {
            if (!global.indexedDB) {
                reject(new Error('indexeddb_unavailable'));
                return;
            }
            var req;
            try {
                req = global.indexedDB.open(DB_NAME, DB_VERSION);
            } catch (e) {
                reject(e);
                return;
            }
            req.onupgradeneeded = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    db.createObjectStore(STORE, { keyPath: 'key' });
                }
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error || new Error('idb_open_failed')); };
        });
        return dbPromise;
    }

    function hydrateMemoryCache() {
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE, 'readonly');
                var req = tx.objectStore(STORE).getAll();
                req.onsuccess = function () {
                    (req.result || []).forEach(function (row) {
                        if (row && row.key) memoryCache[row.key] = row;
                    });
                    resolve(Object.keys(memoryCache).length);
                };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    function readLegacyMeta() {
        try {
            return JSON.parse(global.localStorage.getItem(LEGACY_META_KEY)) || {};
        } catch (e) {
            return {};
        }
    }

    function writeLegacyMeta(meta) {
        try {
            global.localStorage.setItem(LEGACY_META_KEY, JSON.stringify(meta));
        } catch (e) {
            console.warn('[EMS] sync cursor legacy meta write failed', e);
        }
    }

    function persistCursorRecord(key, buildNext) {
        if (!key) return Promise.resolve(null);
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE, 'readwrite');
                var os = tx.objectStore(STORE);
                var getReq = os.get(key);
                var nextRow = null;
                getReq.onsuccess = function () {
                    var cur = getReq.result || { key: key, pullCursor: 0, version: 0 };
                    var built = buildNext(cur);
                    if (!built) {
                        nextRow = cur;
                        memoryCache[key] = cur;
                        return;
                    }
                    nextRow = {
                        key: key,
                        pullCursor: built.pullCursor != null ? built.pullCursor : (cur.pullCursor || 0),
                        remoteUpdatedAt: built.remoteUpdatedAt != null ? built.remoteUpdatedAt : cur.remoteUpdatedAt,
                        version: (cur.version || 0) + 1,
                        updatedAt: Date.now()
                    };
                    os.put(nextRow);
                    memoryCache[key] = nextRow;
                };
                getReq.onerror = function () { reject(getReq.error); };
                tx.oncomplete = function () {
                    if (nextRow && nextRow.key) broadcastCursor(nextRow.key, nextRow);
                    resolve(nextRow || memoryCache[key] || null);
                };
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    function migrateFromLocalStorageOnce() {
        try {
            if (global.localStorage.getItem(MIGRATE_FLAG) === '1') {
                return Promise.resolve({ skipped: true, migrated: 0 });
            }
        } catch (e) { /* ignore */ }

        var meta = readLegacyMeta();
        var keys = Object.keys(meta);
        var chain = Promise.resolve({ migrated: 0, keys: [] });
        keys.forEach(function (key) {
            chain = chain.then(function (acc) {
                var entry = meta[key];
                if (!entry || entry.pullCursor == null) return acc;
                return persistCursorRecord(key, function (cur) {
                    var incoming = Number(entry.pullCursor) || 0;
                    if (incoming <= (cur.pullCursor || 0)) return null;
                    return { pullCursor: incoming, remoteUpdatedAt: entry.remoteUpdatedAt || incoming };
                }).then(function () {
                    acc.migrated++;
                    acc.keys.push(key);
                    return acc;
                });
            });
        });

        return chain.then(function (acc) {
            keys.forEach(function (key) {
                if (meta[key] && meta[key].pullCursor != null) {
                    delete meta[key].pullCursor;
                }
            });
            writeLegacyMeta(meta);
            try {
                global.localStorage.setItem(MIGRATE_FLAG, '1');
            } catch (e2) { /* ignore */ }
            return acc;
        });
    }

    function init() {
        if (initPromise) return initPromise;
        listenCursorChanges();
        if (typeof global.document !== 'undefined' && global.document.addEventListener) {
            global.document.addEventListener('visibilitychange', function () {
                if (global.document.visibilityState === 'visible') {
                    hydrateMemoryCache().catch(function () { /* ignore */ });
                }
            });
        }
        initPromise = openDb()
            .then(function () { return hydrateMemoryCache(); })
            .then(function () { return migrateFromLocalStorageOnce(); })
            .then(function () { return hydrateMemoryCache(); })
            .catch(function (err) {
                console.warn('[EMS] sync cursor IDB init failed', err);
                return { ok: false, error: String(err && err.message ? err.message : err) };
            });
        return initPromise;
    }

    /** Synchronous read — memory cache hydrated at init and updated on every write. */
    function getPullCursor(key) {
        if (!key) return 0;
        var row = memoryCache[key];
        return row && row.pullCursor ? Number(row.pullCursor) : 0;
    }

    function setPullCursor(key, ms, opts) {
        opts = opts || {};
        if (!key) return Promise.resolve(0);
        ms = Number(ms) || 0;
        return persistCursorRecord(key, function (cur) {
            if (opts.force === true) {
                if ((cur.pullCursor || 0) === ms) return null;
                return { pullCursor: ms, remoteUpdatedAt: ms || cur.remoteUpdatedAt };
            }
            var next = Math.max(cur.pullCursor || 0, ms);
            if (next === (cur.pullCursor || 0)) return null;
            return { pullCursor: next, remoteUpdatedAt: next };
        }).then(function (row) {
            return row ? row.pullCursor : getPullCursor(key);
        });
    }

    function markSyncedCursor(key, remoteUpdatedAtMs) {
        if (!key || !remoteUpdatedAtMs) return Promise.resolve(getPullCursor(key));
        return setPullCursor(key, remoteUpdatedAtMs, {});
    }

    global.EmsSyncCursorIdb = {
        DB_NAME: DB_NAME,
        STORE: STORE,
        MIGRATE_FLAG: MIGRATE_FLAG,
        init: init,
        getPullCursor: getPullCursor,
        setPullCursor: setPullCursor,
        markSyncedCursor: markSyncedCursor,
        migrateFromLocalStorageOnce: migrateFromLocalStorageOnce,
        refreshFromIdb: hydrateMemoryCache,
        /** Test/diagnostic — all cached cursor keys. */
        dumpMemoryCache: function () {
            var out = Object.create(null);
            Object.keys(memoryCache).forEach(function (k) {
                out[k] = {
                    pullCursor: memoryCache[k].pullCursor,
                    version: memoryCache[k].version
                };
            });
            return out;
        },
        resetForTests: function () {
            memoryCache = Object.create(null);
            dbPromise = null;
            initPromise = null;
            try { global.localStorage.removeItem(MIGRATE_FLAG); } catch (e) { /* ignore */ }
            return new Promise(function (resolve) {
                var req = global.indexedDB.deleteDatabase(DB_NAME);
                req.onsuccess = req.onerror = req.onblocked = function () { resolve(true); };
            });
        }
    };

    init();
})(typeof window !== 'undefined' ? window : globalThis);
