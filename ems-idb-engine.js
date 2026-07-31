// ============================================================================
// EMS IndexedDB Durable Engine — hard-disk-persistent local storage
// ----------------------------------------------------------------------------
// Phase 1 (offline hardening): a real IndexedDB layer that survives browser
// restart / power-off / device reboot (like an MS Word file on disk) and is
// NOT limited by localStorage's ~5MB quota. This is the durable backbone for
// large datasets. navigator.storage.persist() asks the browser not to evict.
// ----------------------------------------------------------------------------
// Pure additive module — does not remove or replace any existing behavior.
// ============================================================================
(function (global) {
    'use strict';

    var DB_NAME = 'ems_durable_v1';
    var DB_VERSION = 4;
    var KV_STORE = 'kv';        // key/value mirror of ems_* localStorage keys
    var REC_STORE = 'records';  // record-level store (scale foundation, indexed)
    var COL_STORE = 'collections'; // generic collection store (Repository backend)
    var SEARCH_STORE = 'search_tokens'; // inverted token index for substring search
    var SEARCH_INDEX_VERSION = 3;

    global.emsSearchIndexVersion = function () { return SEARCH_INDEX_VERSION; };
    var dbPromise = null;

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
                if (!db.objectStoreNames.contains(KV_STORE)) {
                    db.createObjectStore(KV_STORE);
                }
                if (!db.objectStoreNames.contains(REC_STORE)) {
                    var os = db.createObjectStore(REC_STORE, { keyPath: '_pk' });
                    os.createIndex('tenant', 'tenantId', { unique: false });
                    os.createIndex('tenant_type', ['tenantId', 'type'], { unique: false });
                    os.createIndex('tenant_status', ['tenantId', 'status'], { unique: false });
                }
                if (!db.objectStoreNames.contains(COL_STORE)) {
                    var cos = db.createObjectStore(COL_STORE, { keyPath: '_pk' });
                    cos.createIndex('col', '_col', { unique: false });
                    cos.createIndex('col_ts_desc', ['_col', '_tsNeg'], { unique: false });
                    cos.createIndex('col_ts_asc', ['_col', '_ts'], { unique: false });
                    cos.createIndex('col_type_ts_desc', ['_col', 'type', '_tsNeg'], { unique: false });
                } else if (e.oldVersion < 3) {
                    var cosUp = e.target.transaction.objectStore(COL_STORE);
                    if (!cosUp.indexNames.contains('col_ts_desc')) {
                        cosUp.createIndex('col_ts_desc', ['_col', '_tsNeg'], { unique: false });
                    }
                    if (!cosUp.indexNames.contains('col_ts_asc')) {
                        cosUp.createIndex('col_ts_asc', ['_col', '_ts'], { unique: false });
                    }
                    if (!cosUp.indexNames.contains('col_type_ts_desc')) {
                        cosUp.createIndex('col_type_ts_desc', ['_col', 'type', '_tsNeg'], { unique: false });
                    }
                    var backfill = cosUp.openCursor();
                    backfill.onsuccess = function (ev) {
                        var cursor = ev.target.result;
                        if (!cursor) return;
                        var row = cursor.value;
                        var ts = Number(row.timestamp) || 0;
                        row._ts = ts;
                        row._tsNeg = -ts;
                        row.type = row.type || '';
                        cursor.update(row);
                        cursor.continue();
                    };
                }
                if (e.oldVersion < 4 && !db.objectStoreNames.contains(SEARCH_STORE)) {
                    var sos = db.createObjectStore(SEARCH_STORE, { keyPath: '_pk' });
                    sos.createIndex('col_token', ['_col', 'token'], { unique: false });
                    sos.createIndex('col_row', ['_col', 'rowId'], { unique: false });
                }
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error || new Error('idb_open_failed')); };
        });
        return dbPromise;
    }

    function withStore(storeName, mode) {
        return openDb().then(function (db) {
            return db.transaction(storeName, mode).objectStore(storeName);
        });
    }

    function reqToPromise(request) {
        return new Promise(function (resolve, reject) {
            request.onsuccess = function () { resolve(request.result); };
            request.onerror = function () { reject(request.error); };
        });
    }

    global.emsIdbReady = function () {
        return openDb().then(function () { return true; }).catch(function () { return false; });
    };

    /** Ask the browser to make this origin's storage durable (survive eviction). */
    global.emsIdbPersistRequest = function () {
        try {
            if (global.navigator && navigator.storage && navigator.storage.persist) {
                return navigator.storage.persisted().then(function (already) {
                    if (already) return true;
                    return navigator.storage.persist();
                }).catch(function () { return false; });
            }
        } catch (e) { /* ignore */ }
        return Promise.resolve(false);
    };

    /** Report whether storage is durable + rough usage/quota. */
    global.emsIdbStorageEstimate = function () {
        var out = { persisted: null, usage: null, quota: null };
        try {
            if (global.navigator && navigator.storage) {
                var pP = navigator.storage.persisted
                    ? navigator.storage.persisted().catch(function () { return null; })
                    : Promise.resolve(null);
                var eP = navigator.storage.estimate
                    ? navigator.storage.estimate().catch(function () { return null; })
                    : Promise.resolve(null);
                return Promise.all([pP, eP]).then(function (r) {
                    out.persisted = r[0];
                    if (r[1]) { out.usage = r[1].usage; out.quota = r[1].quota; }
                    return out;
                });
            }
        } catch (e) { /* ignore */ }
        return Promise.resolve(out);
    };

    // ---- Key/Value API (durable mirror of localStorage ems_* keys) ----------

    global.emsIdbKvSet = function (key, value) {
        return withStore(KV_STORE, 'readwrite').then(function (os) {
            return reqToPromise(os.put(value, key)).then(function () {
                if (typeof global.emsStorageQuotaMaybeCheckOnSave === 'function') {
                    global.emsStorageQuotaMaybeCheckOnSave();
                }
                return true;
            });
        }).catch(function (err) {
            if (typeof global.emsStorageQuotaOnWriteFailure === 'function') {
                global.emsStorageQuotaOnWriteFailure('idb_kv:' + key, err);
            }
            return false;
        });
    };

    global.emsIdbKvGet = function (key) {
        return withStore(KV_STORE, 'readonly').then(function (os) {
            return reqToPromise(os.get(key));
        }).catch(function () { return undefined; });
    };

    global.emsIdbKvDelete = function (key) {
        return withStore(KV_STORE, 'readwrite').then(function (os) {
            return reqToPromise(os.delete(key)).then(function () { return true; });
        }).catch(function () { return false; });
    };

    global.emsIdbKvKeys = function () {
        return withStore(KV_STORE, 'readonly').then(function (os) {
            if (os.getAllKeys) {
                return reqToPromise(os.getAllKeys()).then(function (k) { return k || []; });
            }
            return new Promise(function (resolve, reject) {
                var keys = [];
                var cur = os.openKeyCursor();
                cur.onsuccess = function (e) {
                    var c = e.target.result;
                    if (c) { keys.push(c.key); c.continue(); } else { resolve(keys); }
                };
                cur.onerror = function () { reject(cur.error); };
            });
        }).catch(function () { return []; });
    };

    /** Prefix scan on KV primary keys — O(matching) not O(all keys). */
    global.emsIdbKvKeysByPrefix = function (prefix) {
        if (!prefix) return Promise.resolve([]);
        return withStore(KV_STORE, 'readonly').then(function (os) {
            var range = IDBKeyRange.bound(prefix, prefix + '\uf8ff');
            return new Promise(function (resolve, reject) {
                var keys = [];
                var cur = os.openKeyCursor(range);
                cur.onsuccess = function (e) {
                    var c = e.target.result;
                    if (c) { keys.push(c.key); c.continue(); } else { resolve(keys); }
                };
                cur.onerror = function () { reject(cur.error); };
            });
        }).catch(function () { return []; });
    };

    global.emsIdbKvEntries = function () {
        return global.emsIdbKvKeys().then(function (keys) {
            return Promise.all(keys.map(function (k) {
                return global.emsIdbKvGet(k).then(function (v) { return { key: k, value: v }; });
            }));
        }).catch(function () { return []; });
    };

    var TENANT_KEY = 'ems_persisted_tenant_id_v1';

    /**
     * Restore the durable tenant id from IndexedDB into localStorage BEFORE
     * the offline boot resolves a tenant — otherwise a wiped localStorage would
     * generate a brand-new tenant and orphan the durable data. Resolves with the
     * effective tenant id (or null).
     */
    global.emsIdbRestoreTenantId = function () {
        return global.emsIdbKvGet(TENANT_KEY).then(function (v) {
            var current = null;
            try { current = localStorage.getItem(TENANT_KEY); } catch (e) { /* ignore */ }
            if (current) return current;
            if (v == null) return null;
            var id = typeof v === 'string' ? v.replace(/^"|"$/g, '') : String(v);
            try { localStorage.setItem(TENANT_KEY, id); } catch (e2) { /* quota */ }
            return id;
        }).catch(function () {
            try { return localStorage.getItem(TENANT_KEY); } catch (e) { return null; }
        });
    };

    // ---- Record-level API (scale foundation — indexed, paginated) -----------

    function pk(tenantId, id) { return String(tenantId || '') + '::' + String(id); }

    global.emsIdbRecordPut = function (tenantId, record) {
        if (!record || record.id == null) return Promise.resolve(false);
        var row = {};
        for (var k in record) { if (Object.prototype.hasOwnProperty.call(record, k)) row[k] = record[k]; }
        row.tenantId = tenantId;
        row.type = record.type || '';
        row.status = record.status || '';
        row._pk = pk(tenantId, record.id);
        return withStore(REC_STORE, 'readwrite').then(function (os) {
            return reqToPromise(os.put(row)).then(function () { return true; });
        }).catch(function () { return false; });
    };

    global.emsIdbRecordDelete = function (tenantId, id) {
        return withStore(REC_STORE, 'readwrite').then(function (os) {
            return reqToPromise(os.delete(pk(tenantId, id))).then(function () { return true; });
        }).catch(function () { return false; });
    };

    global.emsIdbRecordCount = function (tenantId) {
        return withStore(REC_STORE, 'readonly').then(function (os) {
            var idx = os.index('tenant');
            return reqToPromise(idx.count(IDBKeyRange.only(tenantId)));
        }).catch(function () { return 0; });
    };

    /** Page records by insertion cursor for a tenant (offset/limit). */
    global.emsIdbRecordPage = function (tenantId, offset, limit) {
        offset = offset || 0;
        limit = limit || 100;
        return withStore(REC_STORE, 'readonly').then(function (os) {
            var idx = os.index('tenant');
            return new Promise(function (resolve, reject) {
                var rows = [];
                var skipped = 0;
                var cur = idx.openCursor(IDBKeyRange.only(tenantId));
                cur.onsuccess = function (e) {
                    var c = e.target.result;
                    if (!c) { resolve(rows); return; }
                    if (skipped < offset) { skipped++; c.continue(); return; }
                    if (rows.length < limit) { rows.push(c.value); c.continue(); return; }
                    resolve(rows);
                };
                cur.onerror = function () { reject(cur.error); };
            });
        }).catch(function () { return []; });
    };

    // ---- Generic collection API (Repository backend: collection::id) --------

    function colPk(collection, id) { return String(collection) + '::' + String(id); }

    function stampSortFields(row) {
        if (!row || typeof row !== 'object') return row;
        var ts = Number(row.timestamp) || 0;
        row._ts = ts;
        row._tsNeg = -ts;
        if (row.type == null) row.type = '';
        return row;
    }

    function putSearchTokensSync(searchOs, collection, row) {
        if (!row || row.id == null) return;
        var stub = searchStubFromRow(row);
        var tokens = tokensForRow(row);
        searchOs.put({
            _pk: searchRowDocPk(collection, stub.rowId),
            _col: String(collection),
            rowId: stub.rowId,
            tokens: tokens,
            idxVer: SEARCH_INDEX_VERSION,
            type: stub.type,
            status: stub.status,
            class: stub.class,
            _ts: stub._ts,
            _tsNeg: stub._tsNeg
        });
    }

    function deleteRowTokensSync(searchOs, collection, rowId, done) {
        var idx = searchOs.index('col_row');
        var req = idx.openCursor(IDBKeyRange.only([String(collection), String(rowId)]));
        req.onsuccess = function (ev) {
            var c = ev.target.result;
            if (!c) { done(); return; }
            c.delete();
            c.continue();
        };
        req.onerror = function () { done(); };
    }

    global.emsIdbColPut = function (collection, record) {
        if (!record || record.id == null) return Promise.resolve(false);
        var row = {};
        for (var k in record) { if (Object.prototype.hasOwnProperty.call(record, k)) row[k] = record[k]; }
        row._col = String(collection);
        row._pk = colPk(collection, record.id);
        stampSortFields(row);
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction([COL_STORE, SEARCH_STORE], 'readwrite');
                var colOs = tx.objectStore(COL_STORE);
                var searchOs = tx.objectStore(SEARCH_STORE);
                deleteRowTokensSync(searchOs, collection, record.id, function () {
                    colOs.put(row);
                    putSearchTokensSync(searchOs, collection, row);
                });
                tx.oncomplete = function () { resolve(true); };
                tx.onerror = function () { reject(tx.error); };
            });
        }).catch(function () { return false; });
    };

    function flushSearchIndexBatch(collection, rows) {
        if (!rows || !rows.length) return Promise.resolve(0);
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction([SEARCH_STORE], 'readwrite');
                var searchOs = tx.objectStore(SEARCH_STORE);
                for (var i = 0; i < rows.length; i++) {
                    putSearchTokensSync(searchOs, collection, rows[i]);
                }
                tx.oncomplete = function () { resolve(rows.length); };
                tx.onerror = function () { reject(tx.error); };
            });
        }).catch(function () { return 0; });
    }

    global.emsIdbColBulkPut = function (collection, records) {
        if (!records || !records.length) return Promise.resolve(0);
        return withStore(COL_STORE, 'readwrite').then(function (os) {
            return new Promise(function (resolve, reject) {
                var n = 0;
                var normalized = [];
                records.forEach(function (record) {
                    if (!record || record.id == null) return;
                    var row = {};
                    for (var k in record) { if (Object.prototype.hasOwnProperty.call(record, k)) row[k] = record[k]; }
                    row._col = String(collection);
                    row._pk = colPk(collection, record.id);
                    stampSortFields(row);
                    os.put(row);
                    normalized.push(row);
                    n++;
                });
                os.transaction.oncomplete = function () {
                    var col = String(collection);
                    var resetMeta = {
                        version: SEARCH_INDEX_VERSION,
                        complete: false,
                        collection: col,
                        processed: 0,
                        total: n,
                        lastPk: null,
                        updatedAt: new Date().toISOString()
                    };
                    global.emsIdbSearchIndexClearCollection(col).catch(function () { /* ignore */ });
                    withStore(KV_STORE, 'readwrite').then(function (kvw) {
                        return reqToPromise(kvw.put(resetMeta, searchIndexMetaKey(col)));
                    }).finally(function () {
                        resolve(n);
                        if (global.EMS_IDB_INDEX_AUTO_SCHEDULE !== false
                            && typeof global.emsIdbSearchIndexSchedule === 'function') {
                            global.emsIdbSearchIndexSchedule(col, { force: true });
                        }
                    });
                };
                os.transaction.onerror = function () { reject(os.transaction.error); };
            });
        }).catch(function () { return 0; });
    };

    global.emsIdbColGet = function (collection, id) {
        return withStore(COL_STORE, 'readonly').then(function (os) {
            return reqToPromise(os.get(colPk(collection, id)));
        }).catch(function () { return undefined; });
    };

    global.emsIdbColDelete = function (collection, id) {
        return withStore(COL_STORE, 'readwrite').then(function (os) {
            return reqToPromise(os.delete(colPk(collection, id))).then(function () {
                return global.emsIdbSearchIndexDeleteRow(collection, id).then(function () { return true; });
            });
        }).catch(function () { return false; });
    };

    global.emsIdbColClear = function (collection) {
        return withStore(COL_STORE, 'readwrite').then(function (os) {
            var idx = os.index('col');
            return new Promise(function (resolve, reject) {
                var cur = idx.openCursor(IDBKeyRange.only(String(collection)));
                var n = 0;
                cur.onsuccess = function (e) {
                    var c = e.target.result;
                    if (!c) {
                        global.emsIdbSearchIndexClearCollection(collection).then(function () { resolve(n); }).catch(function () { resolve(n); });
                        return;
                    }
                    c.delete(); n++; c.continue();
                };
                cur.onerror = function () { reject(cur.error); };
            });
        }).catch(function () { return 0; });
    };

    /** Fetch all rows for a collection (cursor by index). Browser fallback backend. */
    global.emsIdbColAll = function (collection) {
        if (global.EMS_IDB_BENCH_TRACE) {
            global.EMS_IDB_BENCH_TRACE.colAllCalls = (global.EMS_IDB_BENCH_TRACE.colAllCalls || 0) + 1;
            global.EMS_IDB_BENCH_TRACE.colAllCollections = global.EMS_IDB_BENCH_TRACE.colAllCollections || [];
            global.EMS_IDB_BENCH_TRACE.colAllCollections.push(String(collection));
        }
        return withStore(COL_STORE, 'readonly').then(function (os) {
            var idx = os.index('col');
            if (idx.getAll) {
                return reqToPromise(idx.getAll(IDBKeyRange.only(String(collection)))).then(function (r) { return r || []; });
            }
            return new Promise(function (resolve, reject) {
                var rows = [];
                var cur = idx.openCursor(IDBKeyRange.only(String(collection)));
                cur.onsuccess = function (e) {
                    var c = e.target.result;
                    if (!c) { resolve(rows); return; }
                    rows.push(c.value); c.continue();
                };
                cur.onerror = function () { reject(cur.error); };
            });
        }).catch(function () { return []; });
    };

    function matchColFilter(val, filter) {
        if (!filter) return true;
        if (filter.type && val.type !== filter.type) return false;
        if (filter.className && val.class !== filter.className) return false;
        if (filter.statusActive === true || filter.statusActive === 'true' || filter.statusActive === '1') {
            if (global.EmsQueryUtils && typeof global.EmsQueryUtils.isActiveRegistrationStatus === 'function') {
                if (!global.EmsQueryUtils.isActiveRegistrationStatus(val.status)) return false;
            }
        }
        if (filter.status === '__active__' || filter.status === 'active') {
            if (global.EmsQueryUtils && typeof global.EmsQueryUtils.isActiveRegistrationStatus === 'function') {
                if (!global.EmsQueryUtils.isActiveRegistrationStatus(val.status)) return false;
            }
        } else if (filter.status && val.status !== filter.status) {
            return false;
        }
        return true;
    }

    function rowMatchesSearch(val, search) {
        if (!search) return true;
        var hay = [val.name, val.id, val.cnic, val.phone, val.class, val.fname, val.designation]
            .map(function (x) { return String(x || '').toLowerCase(); }).join(' ');
        return hay.indexOf(search) >= 0;
    }

    function idbCompoundRange(collection) {
        return IDBKeyRange.bound([collection, -Number.MAX_SAFE_INTEGER], [collection, Number.MAX_SAFE_INTEGER]);
    }

    function idbTypeCompoundRange(collection, type) {
        return IDBKeyRange.bound([collection, String(type), -Number.MAX_SAFE_INTEGER], [collection, String(type), Number.MAX_SAFE_INTEGER]);
    }

    function normalizeSearchInput(search) {
        if (global.emsSearchIndexNormalizeSearch) return global.emsSearchIndexNormalizeSearch(search);
        if (!search) return '';
        if (typeof search === 'string') return search.trim().toLowerCase();
        if (search.text != null) return String(search.text).trim().toLowerCase();
        return '';
    }

    function searchIndexMetaKey(collection) {
        return 'ems_sidx_meta_' + String(collection);
    }

    function searchTokenPk(collection, token, rowId) {
        return String(collection) + '::' + String(token) + '::' + String(rowId);
    }

    function searchRowDocPk(collection, rowId) {
        return String(collection) + '::@idx::' + String(rowId);
    }

    function rowDocHasAllTokens(doc, queryTokens) {
        if (!doc || !queryTokens || !queryTokens.length) return false;
        var rowTokens = doc.tokens;
        if (!rowTokens || !rowTokens.length) return false;
        for (var i = 0; i < queryTokens.length; i++) {
            if (rowTokens.indexOf(queryTokens[i]) < 0) return false;
        }
        return true;
    }

    function stubFromSearchDoc(doc) {
        return {
            rowId: String(doc.rowId),
            type: doc.type || '',
            status: doc.status || '',
            class: doc.class || '',
            _ts: Number(doc._ts) || 0,
            _tsNeg: Number(doc._tsNeg) || 0
        };
    }

    function searchStubFromRow(row) {
        return {
            rowId: String(row.id),
            type: row.type || '',
            status: row.status || '',
            class: row.class || '',
            _ts: Number(row._ts) || Number(row.timestamp) || 0,
            _tsNeg: Number(row._tsNeg) || -(Number(row.timestamp) || 0)
        };
    }

    function tokensForRow(row) {
        if (typeof global.emsSearchIndexTokensForRow === 'function') {
            return global.emsSearchIndexTokensForRow(row);
        }
        return [];
    }

    function tokensForQuery(query) {
        if (typeof global.emsSearchIndexTokensForQuery === 'function') {
            return global.emsSearchIndexTokensForQuery(query);
        }
        var q = String(query || '').trim().toLowerCase();
        return q ? [q] : [];
    }

    function deleteSearchTokensForRowInStore(os, collection, rowId) {
        var idx = os.index('col_row');
        return new Promise(function (resolve, reject) {
            var cur = idx.openCursor(IDBKeyRange.only([String(collection), String(rowId)]));
            cur.onsuccess = function (ev) {
                var c = ev.target.result;
                if (!c) { resolve(true); return; }
                c.delete();
                c.continue();
            };
            cur.onerror = function () { reject(cur.error); };
        });
    }

    function upsertSearchTokensForRowInStore(os, collection, row) {
        if (!row || row.id == null) return Promise.resolve(0);
        collection = String(collection);
        var tokens = tokensForRow(row);
        putSearchTokensSync(os, collection, row);
        return Promise.resolve(tokens.length);
    }

    global.emsIdbSearchIndexUpsertRow = function (collection, row) {
        if (!row || row.id == null) return Promise.resolve(0);
        collection = String(collection);
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction([SEARCH_STORE], 'readwrite');
                var os = tx.objectStore(SEARCH_STORE);
                deleteSearchTokensForRowInStore(os, collection, row.id).then(function () {
                    return upsertSearchTokensForRowInStore(os, collection, row);
                }).then(function (n) {
                    tx.oncomplete = function () { resolve(n); };
                    tx.onerror = function () { reject(tx.error); };
                }).catch(reject);
            });
        }).catch(function () { return 0; });
    };

    global.emsIdbSearchIndexDeleteRow = function (collection, rowId) {
        return withStore(SEARCH_STORE, 'readwrite').then(function (os) {
            return deleteSearchTokensForRowInStore(os, collection, rowId);
        }).catch(function () { return false; });
    };

    global.emsIdbSearchIndexClearCollection = function (collection) {
        collection = String(collection);
        return withStore(SEARCH_STORE, 'readwrite').then(function (os) {
            var idx = os.index('col_row');
            return new Promise(function (resolve, reject) {
                var cur = idx.openCursor(IDBKeyRange.bound([collection, ''], [collection, '\uffff']));
                var n = 0;
                cur.onsuccess = function (ev) {
                    var c = ev.target.result;
                    if (!c) { resolve(n); return; }
                    if (c.value && c.value._col === collection) { c.delete(); n++; }
                    c.continue();
                };
                cur.onerror = function () { reject(cur.error); };
            });
        }).catch(function () { return 0; });
    };

    function stubsForSearchQuery(collection, queryText) {
        var tokens = tokensForQuery(queryText);
        if (!tokens.length) return Promise.resolve([]);
        return withStore(SEARCH_STORE, 'readonly').then(function (os) {
            var idx = os.index('col_row');
            return new Promise(function (resolve, reject) {
                var list = [];
                var cur = idx.openCursor(IDBKeyRange.bound([String(collection), ''], [String(collection), '\uffff']));
                cur.onsuccess = function (ev) {
                    var c = ev.target.result;
                    if (!c) { resolve(list); return; }
                    var doc = c.value || {};
                    if (doc.tokens && rowDocHasAllTokens(doc, tokens)) {
                        list.push(stubFromSearchDoc(doc));
                    }
                    c.continue();
                };
                cur.onerror = function () { reject(cur.error); };
            });
        }).catch(function () { return []; });
    }

    function stubMatchesFilter(stub, filter) {
        return matchColFilter({
            type: stub.type,
            status: stub.status,
            class: stub.class
        }, filter);
    }

    function sortStubList(stubs, sort) {
        var field = sort && sort.field ? String(sort.field) : 'timestamp';
        var dir = sort && sort.dir ? String(sort.dir).toLowerCase() : 'desc';
        stubs.sort(function (a, b) {
            var av = field === 'timestamp' ? a._ts : a[field];
            var bv = field === 'timestamp' ? b._ts : b[field];
            if (av === bv) return 0;
            if (dir === 'asc') return av > bv ? 1 : -1;
            return av < bv ? 1 : -1;
        });
        return stubs;
    }

    function pageSearchViaIndex(collection, opts, offset, limit, filter, searchText, sort) {
        return stubsForSearchQuery(collection, searchText).then(function (stubs) {
            var filtered = [];
            for (var i = 0; i < stubs.length; i++) {
                if (stubMatchesFilter(stubs[i], filter)) filtered.push(stubs[i]);
            }
            filtered = sortStubList(filtered, sort);
            var total = filtered.length;
            var slice = filtered.slice(offset, offset + limit);
            if (!slice.length) {
                return { rows: [], total: total, offset: offset, limit: limit, hasMore: total > offset };
            }
            return Promise.all(slice.map(function (stub) {
                return global.emsIdbColGet(collection, stub.rowId);
            })).then(function (rows) {
                rows = rows.filter(function (r) { return !!r; });
                return {
                    rows: rows,
                    total: total,
                    offset: offset,
                    limit: limit,
                    hasMore: total > offset + rows.length
                };
            });
        });
    }

    function countSearchViaIndex(collection, filter, searchText) {
        return stubsForSearchQuery(collection, searchText).then(function (stubs) {
            var n = 0;
            for (var i = 0; i < stubs.length; i++) {
                if (stubMatchesFilter(stubs[i], filter)) n++;
            }
            return n;
        });
    }

    function countTypeFilterOnly(collection, filter) {
        if (!filter || !filter.type || filter.className || filter.status || filter.statusActive) {
            return null;
        }
        return withStore(COL_STORE, 'readonly').then(function (os) {
            var idx = os.index('col_type_ts_desc');
            return reqToPromise(idx.count(idbTypeCompoundRange(String(collection), filter.type)));
        }).catch(function () { return null; });
    }

    function readSearchIndexMeta(collection) {
        return withStore(KV_STORE, 'readonly').then(function (kv) {
            return reqToPromise(kv.get(searchIndexMetaKey(collection)));
        }).catch(function () { return null; });
    }

    function writeSearchIndexMeta(collection, meta) {
        return withStore(KV_STORE, 'readwrite').then(function (kvw) {
            return reqToPromise(kvw.put(meta, searchIndexMetaKey(collection)));
        });
    }

    global.emsIdbSearchIndexGetMeta = readSearchIndexMeta;

    function searchIndexMetaSnapshot(meta, collection, processed, total, complete, lastPk) {
        return {
            version: SEARCH_INDEX_VERSION,
            complete: !!complete,
            collection: String(collection),
            processed: processed || 0,
            total: total != null ? total : (processed || 0),
            lastPk: lastPk || null,
            updatedAt: new Date().toISOString()
        };
    }

    function emsIdbSearchIndexProcessChunkUnlocked(collection, opts) {
        opts = opts || {};
        collection = String(collection);
        var chunkSize = opts.chunkSize || opts.batchSize || 100;
        var force = !!opts.force;

        return readSearchIndexMeta(collection).then(function (meta) {
            if (meta && meta.complete && meta.version === SEARCH_INDEX_VERSION && !force) {
                return {
                    ok: true,
                    skipped: true,
                    complete: true,
                    processed: meta.processed || 0,
                    total: meta.total != null ? meta.total : (meta.processed || 0)
                };
            }

            var prep = (force || (meta && meta.version != null && meta.version !== SEARCH_INDEX_VERSION))
                ? global.emsIdbSearchIndexClearCollection(collection).then(function () {
                    return writeSearchIndexMeta(collection, searchIndexMetaSnapshot(null, collection, 0, null, false, null));
                }).then(function () { return null; })
                : Promise.resolve(meta);

            return prep.then(function (meta) {
                meta = meta || {};
                var lastPk = meta.lastPk || null;
                var processed = meta.processed || 0;
                var totalKnown = meta.total != null ? meta.total : null;
                var totalPromise = totalKnown != null
                    ? Promise.resolve(totalKnown)
                    : global.emsIdbColCount(collection).catch(function () { return null; });

                return totalPromise.then(function (total) {
                    return withStore(COL_STORE, 'readonly').then(function (os) {
                        var idx = os.index('col');
                        return new Promise(function (resolve, reject) {
                            var batch = [];
                            var cur = idx.openCursor(IDBKeyRange.only(collection));
                            cur.onsuccess = function (ev) {
                                var c = ev.target.result;
                                if (c && lastPk && c.primaryKey <= lastPk) {
                                    c.continue();
                                    return;
                                }
                                if (c && batch.length < chunkSize) {
                                    batch.push(c.value);
                                    c.continue();
                                    return;
                                }
                                var atEnd = !c;
                                if (!batch.length && atEnd) {
                                    writeSearchIndexMeta(
                                        collection,
                                        searchIndexMetaSnapshot(null, collection, processed, total || processed, true, lastPk)
                                    ).then(function () {
                                        resolve({
                                            ok: true,
                                            complete: true,
                                            processed: processed,
                                            total: total || processed,
                                            chunkRows: 0
                                        });
                                    }).catch(reject);
                                    return;
                                }
                                if (!batch.length) {
                                    if (c) c.continue();
                                    return;
                                }
                                var lastRowPk = batch[batch.length - 1]._pk;
                                flushSearchIndexBatch(collection, batch).then(function () {
                                    processed += batch.length;
                                    var done = atEnd;
                                    var nextTotal = total != null ? total : Math.max(processed, totalKnown || 0);
                                    return writeSearchIndexMeta(
                                        collection,
                                        searchIndexMetaSnapshot(null, collection, processed, nextTotal, done, lastRowPk)
                                    ).then(function () {
                                        resolve({
                                            ok: true,
                                            complete: done,
                                            processed: processed,
                                            total: nextTotal,
                                            chunkRows: batch.length,
                                            lastPk: lastRowPk
                                        });
                                    });
                                }).catch(reject);
                            };
                            cur.onerror = function () { reject(cur.error); };
                        });
                    });
                });
            });
        }).catch(function (err) {
            if (typeof global.emsStorageQuotaOnWriteFailure === 'function') {
                global.emsStorageQuotaOnWriteFailure('search_index:' + collection, err);
            }
            return { ok: false, error: err && err.message ? err.message : String(err) };
        });
    }

    /** Process one cursor chunk — no full-collection RAM load; persists lastPk after each chunk. */
    global.emsIdbSearchIndexProcessChunk = function (collection, opts) {
        collection = String(collection);
        opts = opts || {};
        var run = function () {
            var quotaP = (typeof global.emsStorageQuotaCheck === 'function' && !opts._quotaChecked)
                ? global.emsStorageQuotaCheck({ context: 'index_build', showWarning: true }).then(function (q) {
                    opts._quotaChecked = true;
                    if (q.level === 'block' && typeof global.emsStorageQuotaConfirmBulk === 'function') {
                        return global.emsStorageQuotaConfirmBulk({ context: 'index_build' }).then(function (gate) {
                            if (!gate.allowed) {
                                return { ok: false, blocked: true, reason: 'storage_quota_block', quota: q };
                            }
                            return emsIdbSearchIndexProcessChunkUnlocked(collection, opts);
                        });
                    }
                    return emsIdbSearchIndexProcessChunkUnlocked(collection, opts);
                })
                : Promise.resolve().then(function () {
                    return emsIdbSearchIndexProcessChunkUnlocked(collection, opts);
                });
            return quotaP;
        };
        if (typeof global.emsSearchIndexLeaderGateChunk === 'function') {
            return global.emsSearchIndexLeaderGateChunk(collection, run);
        }
        return run();
    };

    function scanUnindexedSearchStubs(collection, lastPk, searchText, filter) {
        return withStore(COL_STORE, 'readonly').then(function (os) {
            var idx = os.index('col');
            return new Promise(function (resolve, reject) {
                var stubs = [];
                var cur = idx.openCursor(IDBKeyRange.only(String(collection)));
                cur.onsuccess = function (e) {
                    var c = e.target.result;
                    if (!c) { resolve(stubs); return; }
                    if (lastPk && c.primaryKey <= lastPk) { c.continue(); return; }
                    var val = c.value;
                    if (matchColFilter(val, filter) && rowMatchesSearch(val, searchText)) {
                        stubs.push(searchStubFromRow(val));
                    }
                    c.continue();
                };
                cur.onerror = function () { reject(cur.error); };
            });
        }).catch(function () { return []; });
    }

    function mergeSearchStubMaps(indexedStubs, scannedStubs) {
        var map = Object.create(null);
        (indexedStubs || []).forEach(function (s) { map[String(s.rowId)] = s; });
        (scannedStubs || []).forEach(function (s) {
            if (!map[String(s.rowId)]) map[String(s.rowId)] = s;
        });
        var list = [];
        for (var id in map) {
            if (Object.prototype.hasOwnProperty.call(map, id)) list.push(map[id]);
        }
        return list;
    }

    function pageSearchPartial(collection, opts, offset, limit, filter, searchText, sort, meta) {
        var lastPk = meta && meta.lastPk ? meta.lastPk : null;
        return stubsForSearchQuery(collection, searchText).then(function (indexedStubs) {
            return scanUnindexedSearchStubs(collection, lastPk, searchText, filter).then(function (scannedStubs) {
                var merged = mergeSearchStubMaps(indexedStubs, scannedStubs);
                var filtered = [];
                for (var i = 0; i < merged.length; i++) {
                    if (stubMatchesFilter(merged[i], filter)) filtered.push(merged[i]);
                }
                filtered = sortStubList(filtered, sort);
                var total = filtered.length;
                var slice = filtered.slice(offset, offset + limit);
                if (!slice.length) {
                    return { rows: [], total: total, offset: offset, limit: limit, hasMore: total > offset };
                }
                return Promise.all(slice.map(function (stub) {
                    return global.emsIdbColGet(collection, stub.rowId);
                })).then(function (rows) {
                    rows = rows.filter(function (r) { return !!r; });
                    return {
                        rows: rows,
                        total: total,
                        offset: offset,
                        limit: limit,
                        hasMore: total > offset + rows.length,
                        searchPartial: true
                    };
                });
            });
        });
    }

    function countSearchPartial(collection, filter, searchText, meta) {
        var lastPk = meta && meta.lastPk ? meta.lastPk : null;
        return stubsForSearchQuery(collection, searchText).then(function (indexedStubs) {
            return scanUnindexedSearchStubs(collection, lastPk, searchText, filter).then(function (scannedStubs) {
                var merged = mergeSearchStubMaps(indexedStubs, scannedStubs);
                var n = 0;
                for (var i = 0; i < merged.length; i++) {
                    if (stubMatchesFilter(merged[i], filter)) n++;
                }
                return n;
            });
        });
    }

    global.emsIdbSearchIndexEnsure = function (collection, opts) {
        opts = opts || {};
        collection = String(collection);
        if (opts.background) {
            if (typeof global.emsIdbSearchIndexSchedule === 'function') {
                return global.emsIdbSearchIndexSchedule(collection, opts).then(function () {
                    return { ok: true, scheduled: true };
                });
            }
        }
        if (typeof global.emsIdbSearchIndexCancelSchedule === 'function') {
            global.emsIdbSearchIndexCancelSchedule(collection);
        }
        var force = !!opts.force;
        var start = force
            ? global.emsIdbSearchIndexClearCollection(collection).then(function () {
                return writeSearchIndexMeta(collection, searchIndexMetaSnapshot(null, collection, 0, null, false, null));
            })
            : Promise.resolve();

        return start.then(function () {
            function loop() {
                return global.emsIdbSearchIndexProcessChunk(collection, {
                    chunkSize: opts.chunkSize || opts.batchSize,
                    force: false
                }).then(function (res) {
                    if (!res || res.skipped || res.complete) return res;
                    return loop();
                });
            }
            return loop();
        }).catch(function (err) {
            return { ok: false, error: err && err.message ? err.message : String(err) };
        });
    };

    global.emsIdbSearchIndexWaitComplete = function (collection, timeoutMs) {
        timeoutMs = timeoutMs || 600000;
        var started = Date.now();
        function poll() {
            return readSearchIndexMeta(collection).then(function (meta) {
                if (meta && meta.complete && meta.version === SEARCH_INDEX_VERSION) {
                    return { ok: true, complete: true, processed: meta.processed || 0, total: meta.total || meta.processed || 0 };
                }
                if (Date.now() - started > timeoutMs) {
                    return { ok: false, timeout: true, processed: meta && meta.processed, total: meta && meta.total };
                }
                return new Promise(function (resolve) {
                    setTimeout(function () { resolve(poll()); }, 250);
                });
            });
        }
        return poll();
    };

    /**
     * Cursor-based page for a collection — sort/limit/offset at index level (no full RAM load).
     * opts: { offset, limit, filter, sort, search }
     */
    global.emsIdbColPage = function (collection, opts) {
        opts = opts || {};
        var offset = Math.max(0, opts.offset || 0);
        var limit = Math.max(1, opts.limit || 100);
        var filter = opts.filter || null;
        var searchText = normalizeSearchInput(opts.search);
        collection = String(collection);
        var sort = opts.sort || null;
        var sortField = sort && sort.field ? String(sort.field) : null;
        var sortDir = sort && sort.dir ? String(sort.dir).toLowerCase() : 'desc';

        if (searchText) {
            if (global.EMS_IDB_BENCH_TRACE) {
                global.EMS_IDB_BENCH_TRACE.pagePaths = global.EMS_IDB_BENCH_TRACE.pagePaths || [];
                global.EMS_IDB_BENCH_TRACE.pagePaths.push('searchIndex:rowDocs');
            }
            return readSearchIndexMeta(collection).then(function (meta) {
                if (meta && meta.complete && meta.version === SEARCH_INDEX_VERSION) {
                    return pageSearchViaIndex(collection, opts, offset, limit, filter, searchText, sort);
                }
                if (global.EMS_IDB_BENCH_TRACE) {
                    global.EMS_IDB_BENCH_TRACE.pagePaths.push('searchIndex:partial');
                }
                return pageSearchPartial(collection, opts, offset, limit, filter, searchText, sort, meta);
            });
        }

        var useTsIndex = !sortField || sortField === 'timestamp';
        if (useTsIndex && filter && filter.type && !filter.className && !filter.status && !filter.statusActive) {
            if (global.EMS_IDB_BENCH_TRACE) {
                global.EMS_IDB_BENCH_TRACE.pagePaths = global.EMS_IDB_BENCH_TRACE.pagePaths || [];
                global.EMS_IDB_BENCH_TRACE.pagePaths.push('pageIndexed:type_ts');
            }
            return pageIndexed(collection, opts, offset, limit, filter, sortDir, 'col_type_ts_desc', true);
        }
        if (useTsIndex) {
            if (global.EMS_IDB_BENCH_TRACE) {
                global.EMS_IDB_BENCH_TRACE.pagePaths = global.EMS_IDB_BENCH_TRACE.pagePaths || [];
                global.EMS_IDB_BENCH_TRACE.pagePaths.push('pageIndexed:ts');
            }
            return pageIndexed(collection, opts, offset, limit, filter, sortDir, sortDir === 'asc' ? 'col_ts_asc' : 'col_ts_desc', false);
        }

        if (global.EMS_IDB_BENCH_TRACE) {
            global.EMS_IDB_BENCH_TRACE.pagePaths = global.EMS_IDB_BENCH_TRACE.pagePaths || [];
            global.EMS_IDB_BENCH_TRACE.pagePaths.push('colScan:customSort');
        }
        return pageColScan(collection, opts, offset, limit, filter, '', sort);
    };

    function pageIndexed(collection, opts, offset, limit, filter, sortDir, indexName, typeIndex) {
        return withStore(COL_STORE, 'readonly').then(function (os) {
            var idx = os.index(indexName);
            var range = typeIndex && filter && filter.type
                ? idbTypeCompoundRange(collection, filter.type)
                : idbCompoundRange(collection);
            return new Promise(function (resolve, reject) {
                var skipped = 0;
                var rows = [];
                var matched = 0;
                var cur = idx.openCursor(range);
                cur.onsuccess = function (e) {
                    var c = e.target.result;
                    if (!c) {
                        var finish = function (total) {
                            resolve({
                                rows: rows,
                                total: total != null ? total : matched,
                                offset: offset,
                                limit: limit,
                                hasMore: (total != null ? total : matched) > offset + rows.length
                            });
                        };
                        if (!filter) {
                            global.emsIdbColCount(collection).then(finish);
                        } else {
                            var typeOnlyCount = countTypeFilterOnly(collection, filter);
                            if (typeOnlyCount != null) {
                                typeOnlyCount.then(finish);
                            } else {
                                finish(matched);
                            }
                        }
                        return;
                    }
                    var val = c.value;
                    if (!matchColFilter(val, filter)) { c.continue(); return; }
                    matched++;
                    if (skipped < offset) { skipped++; c.continue(); return; }
                    if (rows.length < limit) {
                        rows.push(val);
                        c.continue();
                        return;
                    }
                    var earlyTypeCount = countTypeFilterOnly(collection, filter);
                    if (earlyTypeCount != null) {
                        earlyTypeCount.then(function (total) {
                            resolve({
                                rows: rows,
                                total: total,
                                offset: offset,
                                limit: limit,
                                hasMore: total > offset + rows.length
                            });
                        });
                        return;
                    }
                    if (!filter) {
                        global.emsIdbColCount(collection).then(function (total) {
                            resolve({
                                rows: rows,
                                total: total,
                                offset: offset,
                                limit: limit,
                                hasMore: total > offset + rows.length
                            });
                        });
                        return;
                    }
                    c.continue();
                };
                cur.onerror = function () { reject(cur.error); };
            });
        }).catch(function () {
            return { rows: [], total: 0, offset: offset, limit: limit, hasMore: false };
        });
    }

    function pageColScan(collection, opts, offset, limit, filter, search, sort) {
        return withStore(COL_STORE, 'readonly').then(function (os) {
            var idx = os.index('col');
            return new Promise(function (resolve, reject) {
                var skipped = 0;
                var rows = [];
                var matched = 0;
                var cur = idx.openCursor(IDBKeyRange.only(collection));
                cur.onsuccess = function (e) {
                    var c = e.target.result;
                    if (!c) {
                        resolve({
                            rows: rows,
                            total: matched,
                            offset: offset,
                            limit: limit,
                            hasMore: matched > offset + rows.length
                        });
                        return;
                    }
                    if (!matchColFilter(c.value, filter) || !rowMatchesSearch(c.value, search)) {
                        c.continue();
                        return;
                    }
                    matched++;
                    if (skipped < offset) { skipped++; c.continue(); return; }
                    if (rows.length < limit) { rows.push(c.value); c.continue(); return; }
                    matched++;
                    c.continue();
                };
                cur.onerror = function () { reject(cur.error); };
            });
        }).catch(function () {
            return { rows: [], total: 0, offset: offset, limit: limit, hasMore: false };
        });
    }

    function countFiltered(collection, filter, search) {
        var searchText = normalizeSearchInput(search);
        if (searchText) {
            return readSearchIndexMeta(collection).then(function (meta) {
                if (meta && meta.complete && meta.version === SEARCH_INDEX_VERSION) {
                    return countSearchViaIndex(collection, filter, searchText);
                }
                return countSearchPartial(collection, filter, searchText, meta);
            });
        }
        var typeOnly = countTypeFilterOnly(collection, filter);
        if (typeOnly != null) return typeOnly;
        return withStore(COL_STORE, 'readonly').then(function (os) {
            var idx = os.index('col');
            return new Promise(function (resolve, reject) {
                var matched = 0;
                var cur = idx.openCursor(IDBKeyRange.only(String(collection)));
                cur.onsuccess = function (e) {
                    var c = e.target.result;
                    if (!c) { resolve(matched); return; }
                    if (matchColFilter(c.value, filter) && rowMatchesSearch(c.value, search)) matched++;
                    c.continue();
                };
                cur.onerror = function () { reject(cur.error); };
            });
        }).catch(function () { return 0; });
    }

    global.emsIdbColCountFiltered = countFiltered;

    global.emsIdbColCount = function (collection) {
        return withStore(COL_STORE, 'readonly').then(function (os) {
            var idx = os.index('col');
            return reqToPromise(idx.count(IDBKeyRange.only(String(collection))));
        }).catch(function () { return 0; });
    };

    // ---- Backup export/import (MS-Word-like file ownership) ------------------

    /** Collect all ems_* durable data (IDB kv + any localStorage-only ems_ keys). */
    global.emsBackupCollect = function () {
        var pre = (typeof global.emsStorageQuotaCheck === 'function')
            ? global.emsStorageQuotaCheck({ context: 'backup', showWarning: true })
            : Promise.resolve(null);
        return pre.then(function () {
            return global.emsIdbKvEntries();
        }).then(function (entries) {
            var data = {};
            entries.forEach(function (e) {
                if (e && typeof e.key === 'string' && e.key.indexOf('ems_') === 0) {
                    data[e.key] = e.value;
                }
            });
            try {
                for (var i = 0; i < localStorage.length; i++) {
                    var k = localStorage.key(i);
                    if (k && k.indexOf('ems_') === 0 && !(k in data)) {
                        data[k] = localStorage.getItem(k);
                    }
                }
            } catch (lsErr) { /* ignore */ }
            return {
                format: 'ems-backup',
                version: 1,
                exportedAt: new Date().toISOString(),
                keyCount: Object.keys(data).length,
                data: data
            };
        });
    };

    /** Merge a backup payload back into IDB + localStorage. */
    global.emsBackupApply = function (payload) {
        if (!payload || !payload.data || typeof payload.data !== 'object') {
            return Promise.resolve({ ok: false, reason: 'invalid_payload' });
        }
        var keys = Object.keys(payload.data);
        var applied = 0;
        var chain = Promise.resolve();
        var startP = (typeof global.emsStorageQuotaConfirmBulk === 'function')
            ? global.emsStorageQuotaConfirmBulk({ context: 'backup_restore' }).then(function (gate) {
                if (!gate.allowed) return { ok: false, reason: 'storage_quota_block', blocked: true };
                return null;
            })
            : Promise.resolve(null);
        return startP.then(function (blocked) {
            if (blocked && blocked.blocked) return blocked;
            keys.forEach(function (k) {
                if (k.indexOf('ems_') !== 0) return;
                var str = typeof payload.data[k] === 'string'
                    ? payload.data[k]
                    : JSON.stringify(payload.data[k]);
                try {
                    localStorage.setItem(k, str);
                    applied++;
                } catch (e) {
                    if (typeof global.emsStorageQuotaOnWriteFailure === 'function') {
                        global.emsStorageQuotaOnWriteFailure('backup_ls:' + k, e);
                    }
                }
                if (typeof global.emsCacheInvalidate === 'function') global.emsCacheInvalidate(k);
                chain = chain.then(function () { return global.emsIdbKvSet(k, str); });
            });
            return chain.then(function () { return { ok: true, applied: applied, total: keys.length }; });
        });
    };

    /** Save a full backup as a downloadable .json file (user-owned, like an MS Word file). */
    global.emsBackupDownloadFile = function (fileName) {
        return global.emsBackupCollect().then(function (payload) {
            try {
                var stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                var name = fileName || ('ems-backup-' + stamp + '.json');
                var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url;
                a.download = name;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
                return { ok: true, fileName: name, keyCount: payload.keyCount };
            } catch (e) {
                return { ok: false, error: e && e.message };
            }
        });
    };

    /** Restore from a user-selected backup file (File object from an <input type=file>). */
    global.emsBackupImportFromFile = function (file) {
        if (!file) return Promise.resolve({ ok: false, reason: 'no_file' });
        return new Promise(function (resolve) {
            var reader = new FileReader();
            reader.onload = function () {
                try {
                    var payload = JSON.parse(reader.result);
                    global.emsBackupApply(payload).then(resolve);
                } catch (e) {
                    resolve({ ok: false, reason: 'parse_error', error: e && e.message });
                }
            };
            reader.onerror = function () { resolve({ ok: false, reason: 'read_error' }); };
            reader.readAsText(file);
        });
    };

    // Request durability as early as possible.
    global.emsIdbPersistRequest();
})(typeof window !== 'undefined' ? window : globalThis);
