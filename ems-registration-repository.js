// ============================================================================
// EMS Registration Repository — Paginated Firestore access (Enterprise E7-S1)
// No full-collection onSnapshot. Initial 100 · Load More · Prefix search.
// ============================================================================
(function (global) {
    'use strict';

    var CLOUD_QUERY_LIMIT = 500;
    var PAGE_SIZE = 500;
    /** Network page size per Firestore request — batched for offline sync. */
    var INSTALLED_PAGE_SIZE = 500;
    var DESKTOP_FETCH_BATCH = 500;
    var ARCHIVE_KEY = 'ems_reg_repo_archive';
    var REJECTED_PAGE_SIZE = 500;
    var SEARCH_MIN = 2;
    var USERS_KEY = global.DB && global.DB.users ? global.DB.users : 'ems_full_users';
    var REJECTED_KEY = 'ems_rejected_users';
    var REG_CACHE_V2_PREFIX = 'ems_reg_full_v2_';
    var LEGACY_BLOB_MIGRATED_PREFIX = 'ems_reg_mirror_migrated_v1_';
    var IDB_MIRROR_BATCH = 500;
    var HYDRATE_RETRY_MAX = 3;
    /** Chunk size for disaster-recovery bulk download (web-safe). */
    var RECOVERY_PAGE_SIZE = 500;
    var RECOVERY_FULL_GET_TIMEOUT_MS = 120000;

    /** SSOT offline-first registration (Phase P1). Set false or EMS_REGISTRATION_LEGACY_FIRESTORE=true to revert. */
    if (global.EMS_REGISTRATION_SSOT_OFFLINE == null) {
        global.EMS_REGISTRATION_SSOT_OFFLINE = true;
    }

    /** Sprint 1: legacy localStorage read fallback disabled by default. */
    if (global.EMS_REG_LEGACY_READ_FALLBACK == null) {
        global.EMS_REG_LEGACY_READ_FALLBACK = false;
    }

    /** WhatsApp-style offline-first: local IDB is UI SSOT; cloud only via manual recovery or first empty IDB. */
    if (global.EMS_OFFLINE_FIRST_SSOT !== true) {
        try {
            global.EMS_OFFLINE_FIRST_SSOT = true;
        } catch (assignErr) {
            /* preload contextBridge may expose this as read-only — desktop already true */
        }
    }

    function isIdbOnlyBoot() {
        try {
            if (global.EMS_REGISTRATION_IDB_ONLY_BOOT === true) return true;
            if (isDesktopEnvironment()) return true;
        } catch (e) { /* ignore */ }
        return false;
    }

    function getRecoveryPageSize() {
        return RECOVERY_PAGE_SIZE;
    }

    function isRecoveryFetch(opts) {
        if (opts && opts.recoveryMode) return true;
        return global.EMS_FORCE_CLOUD_RECOVERY_SYNC === true || global.EMS_REBUILD_IN_PROGRESS === true;
    }

    function logFetchError(label, err, meta) {
        console.error('[EMS] ' + label, err && err.message ? err.message : err, meta || {});
    }

    function mayFetchFromServer() {
        if (global.EMS_FORCE_CLOUD_RECOVERY_SYNC === true) return true;
        if (global.EMS_ALLOW_FIRST_LOGIN_CLOUD_FETCH === true) return true;
        if (global.EMS_REGISTRATION_ALLOW_SERVER_FETCH === true) return true;
        if (global.EMS_OFFLINE_FIRST_SSOT === true || isIdbOnlyBoot()) return false;
        return true;
    }

    function regCacheV2Key(tenantId) {
        tenantId = tenantId || state.tenantId;
        return tenantId ? REG_CACHE_V2_PREFIX + tenantId : null;
    }

    function readLegacyBlobFromCache(tenantId) {
        var keys = [];
        var v2 = regCacheV2Key(tenantId);
        if (v2) keys.push(v2);
        var legacy = typeof global.emsRepoKey === 'function'
            ? global.emsRepoKey(tenantId || state.tenantId) : null;
        if (legacy) keys.push(legacy);
        for (var i = 0; i < keys.length; i++) {
            var data = typeof global.emsCacheGet === 'function'
                ? global.emsCacheGet(keys[i], null) : null;
            if (Array.isArray(data) && data.length) {
                return { key: keys[i], rows: data };
            }
        }
        return { key: null, rows: [] };
    }

    function clearLegacyBlob(tenantId) {
        var v2 = regCacheV2Key(tenantId);
        var legacy = typeof global.emsRepoKey === 'function'
            ? global.emsRepoKey(tenantId || state.tenantId) : null;
        [v2, legacy].forEach(function (key) {
            if (!key) return;
            if (typeof global.emsCacheInvalidate === 'function') {
                global.emsCacheInvalidate(key);
            }
            try {
                if (global._emsOriginalRemoveItem) {
                    global._emsOriginalRemoveItem.call(localStorage, key);
                } else {
                    localStorage.removeItem(key);
                }
            } catch (e) { /* ignore */ }
            if (typeof global.emsIdbKvDelete === 'function') {
                global.emsIdbKvDelete(key);
            }
        });
    }

    /** Paginated read from IDB mirror — never materializes the full tenant in RAM. */
    function idbGetRepoPage(tenantId, offset, limit) {
        if (!repoMirrorAvailable()) return Promise.resolve([]);
        if (tenantId && state.tenantId !== tenantId && typeof global.emsRegRepoInit === 'function') {
            global.emsRegRepoInit(tenantId);
        } else {
            repoMirrorScope();
        }
        return global.emsRepo.page(REPO_MIRROR_COLLECTION, {
            offset: offset || 0,
            limit: limit || IDB_MIRROR_BATCH
        }).then(function (res) { return (res && res.rows) || []; });
    }

    /** Legacy name — returns at most one batch (never the full collection). */
    function idbGetRepo(tenantId) {
        var cap = getMemoryCap();
        var limit = cap > 0 ? Math.min(cap, IDB_MIRROR_BATCH) : IDB_MIRROR_BATCH;
        return idbGetRepoPage(tenantId, 0, limit);
    }

    /** SSOT writes go to the IDB mirror (collections store), not localStorage blobs. */
    function idbSetRepo(tenantId, list) {
        if (!list || !list.length) return Promise.resolve();
        if (tenantId && state.tenantId !== tenantId && typeof global.emsRegRepoInit === 'function') {
            global.emsRegRepoInit(tenantId);
        }
        return repoMirrorBulk(list);
    }

    /** One-time migration: legacy localStorage blob → IDB mirror table. */
    var _legacyMigrationInflight = null;
    function migrateLegacyRegistrationBlob(tenantId) {
        tenantId = tenantId || state.tenantId;
        if (!tenantId) return Promise.resolve({ migrated: 0, source: 'no_tenant' });
        if (_legacyMigrationInflight) return _legacyMigrationInflight;
        if (state.tenantId !== tenantId) {
            state.tenantId = tenantId;
            repoMirrorScope();
        }
        var migKey = LEGACY_BLOB_MIGRATED_PREFIX + tenantId;
        if (typeof global.emsCacheGet === 'function' && global.emsCacheGet(migKey, false)) {
            return Promise.resolve({ migrated: 0, source: 'already_migrated' });
        }
        _legacyMigrationInflight = repoMirrorCount().then(function (mirrorCount) {
            if (mirrorCount > 0) {
                clearLegacyBlob(tenantId);
                if (typeof global.emsCacheSet === 'function') {
                    global.emsCacheSet(migKey, true, { noSync: true });
                }
                return { migrated: 0, source: 'mirror_already_populated', mirrorCount: mirrorCount };
            }
            var legacy = readLegacyBlobFromCache(tenantId);
            if (!legacy.rows.length) {
                if (typeof global.emsCacheSet === 'function') {
                    global.emsCacheSet(migKey, true, { noSync: true });
                }
                return { migrated: 0, source: 'no_legacy_blob' };
            }
            var offset = 0;
            var total = 0;
            function nextBatch() {
                var batch = legacy.rows.slice(offset, offset + IDB_MIRROR_BATCH);
                if (!batch.length) {
                    clearLegacyBlob(tenantId);
                    if (typeof global.emsCacheSet === 'function') {
                        global.emsCacheSet(migKey, true, { noSync: true });
                    }
                    if (typeof global.emsPipelineDebug === 'function') {
                        global.emsPipelineDebug('legacy_blob_migrated', {
                            tenantId: tenantId,
                            count: total,
                            key: legacy.key
                        });
                    }
                    return Promise.resolve({ migrated: total, source: 'legacy_blob_migrated', key: legacy.key });
                }
                return repoMirrorBulk(batch).then(function () {
                    total += batch.length;
                    offset += IDB_MIRROR_BATCH;
                    return nextBatch();
                });
            }
            return nextBatch();
        }).finally(function () {
            _legacyMigrationInflight = null;
        });
        return _legacyMigrationInflight;
    }

    global.emsRegRepoMigrateLegacyBlob = migrateLegacyRegistrationBlob;

    function verifyRepoIdbWrite(tenantId, expectedCount) {
        return repoMirrorCount().then(function (idbCount) {
            idbCount = idbCount >= 0 ? idbCount : 0;
            var ok = expectedCount === 0 ? idbCount === 0 : idbCount >= expectedCount;
            return {
                ok: ok,
                idbCount: idbCount,
                key: 'idb_mirror:' + REPO_MIRROR_COLLECTION,
                legacyKey: null
            };
        });
    }

    function isDesktopEnvironment() {
        try {
            if (global.EMS_DESKTOP_UNLIMITED === true) return true;
            if (global.emsDesktop && global.emsDesktop.isDesktop) return true;
            if (global.emsDesktop && global.emsDesktop.unlimitedCache) return true;
            if (typeof global.emsIsDesktopApp === 'function' && global.emsIsDesktopApp()) return true;
            if (typeof global.emsGetOfflineMode === 'function' && global.emsGetOfflineMode() === 'installed') return true;
            if (global.location && global.location.search) {
                if (global.location.search.indexOf('desktop=1') >= 0) return true;
                if (global.location.search.indexOf('localBundle=1') >= 0) return true;
            }
        } catch (e) { /* ignore */ }
        return false;
    }

    global.emsIsDesktopEnvironment = isDesktopEnvironment;

    function isUnlimited() {
        if (isDesktopEnvironment()) return true;
        return typeof global.emsIsUnlimitedLocalCache === 'function' && global.emsIsUnlimitedLocalCache();
    }

    function getMemoryCap() {
        if (isUnlimited()) return 0;
        if (typeof global.emsGetLocalCacheLimit === 'function') {
            return global.emsGetLocalCacheLimit();
        }
        if (typeof global.EMS_CACHE_RECORD_CAP === 'number') {
            return global.EMS_CACHE_RECORD_CAP;
        }
        return 0;
    }

    function getPageSize() {
        if (isUnlimited()) {
            return DESKTOP_FETCH_BATCH;
        }
        return PAGE_SIZE;
    }

    /** Max records for bulk server hydrate — 0 / Infinity = entire institution on desktop. */
    function getBulkMaxCount(requested) {
        if (requested != null && Number(requested) > 0) {
            return Number(requested);
        }
        if (isUnlimited()) return Infinity;
        return getPageSize();
    }

    function archiveStorageKey(tenantId) {
        if (typeof global.emsScopedKey === 'function') {
            return global.emsScopedKey('ems_reg_repo_archive', tenantId || state.tenantId);
        }
        return ARCHIVE_KEY;
    }

    global.emsRegRepoPageSize = function () {
        return getPageSize();
    };

    var state = {
        tenantId: null,
        byId: Object.create(null),
        order: [],
        lastDoc: null,
        hasMore: true,
        loading: false,
        searchActive: false,
        searchResults: null,
        rejectedById: Object.create(null),
        rejectedOrder: [],
        rejectedLastDoc: null,
        rejectedHasMore: true,
        rejectedLoading: false,
        rejectedLoaded: false,
        metaUnsub: null,
        bootVerified: false,
        metaInitialized: false
    };

    function lean(data) {
        return typeof global.emsLeanUserForLocalStorage === 'function'
            ? global.emsLeanUserForLocalStorage(data)
            : data;
    }

    // ========================================================================
    // Incremental mirror → window.emsRepo ('registrations' collection)
    // ------------------------------------------------------------------------
    // The Repository (window.emsRepo) is the decoupled permanent storage layer
    // that the registration UI paginates through (emsRepo.page()). We keep it in
    // sync PER RECORD: a single add/edit/delete performs a single put/remove —
    // never a full-collection rewrite. Batch loads (hydrate / load-more) use
    // bulkPut of ONLY the freshly loaded rows. This is the prerequisite for
    // dropping in better-sqlite3 (Option B) to scale to 1,000,000 records.
    // Every helper is best-effort: failures are logged, never thrown, so the
    // primary IDB SSOT path is never blocked by the mirror.
    // ========================================================================
    var REPO_MIRROR_COLLECTION = 'registrations';

    function repoMirrorAvailable() {
        return typeof global.emsRepo !== 'undefined'
            && global.emsRepo
            && typeof global.emsRepo.put === 'function';
    }

    function repoMirrorScope() {
        if (repoMirrorAvailable()
            && state.tenantId
            && typeof global.emsRepo.useTenant === 'function') {
            global.emsRepo.useTenant(state.tenantId);
        }
    }

    function repoMirrorDebug(evt, payload) {
        if (typeof global.emsPipelineDebug === 'function') {
            global.emsPipelineDebug(evt, payload || {});
        }
    }

    /** Single approved record → insert/update in place (one write). */
    function repoMirrorPut(record) {
        if (!repoMirrorAvailable() || !record || !record.id) return Promise.resolve(false);
        repoMirrorScope();
        return Promise.resolve(global.emsRepo.put(REPO_MIRROR_COLLECTION, record))
            .then(function () { return true; })
            .catch(function (e) {
                repoMirrorDebug('repo_mirror_put_failed', { id: record.id, error: e && e.message });
                return false;
            });
    }

    /** Single record → delete in place (one write). */
    function repoMirrorRemove(id) {
        if (!repoMirrorAvailable() || !id || typeof global.emsRepo.remove !== 'function') {
            return Promise.resolve(false);
        }
        repoMirrorScope();
        return Promise.resolve(global.emsRepo.remove(REPO_MIRROR_COLLECTION, id))
            .then(function () { return true; })
            .catch(function (e) {
                repoMirrorDebug('repo_mirror_remove_failed', { id: id, error: e && e.message });
                return false;
            });
    }

    /** Single approved record read from IDB mirror (offline SSOT). */
    function repoMirrorGetById(id) {
        if (!repoMirrorAvailable() || !id || typeof global.emsRepo.get !== 'function') {
            return Promise.resolve(null);
        }
        repoMirrorScope();
        return Promise.resolve(global.emsRepo.get(REPO_MIRROR_COLLECTION, id))
            .then(function (rec) { return rec || null; })
            .catch(function (e) {
                repoMirrorDebug('repo_mirror_get_failed', { id: id, error: e && e.message });
                return null;
            });
    }

    /** Batch upsert of ONLY the given rows (never rewrites the whole set). */
    function repoMirrorBulk(rows) {
        if (!repoMirrorAvailable() || typeof global.emsRepo.bulkPut !== 'function') {
            return Promise.resolve(false);
        }
        if (!rows || !rows.length) return Promise.resolve(false);
        repoMirrorScope();
        return Promise.resolve(global.emsRepo.bulkPut(REPO_MIRROR_COLLECTION, rows))
            .then(function () { return true; })
            .catch(function (e) {
                repoMirrorDebug('repo_mirror_bulk_failed', { count: rows.length, error: e && e.message });
                return false;
            });
    }

    /** Exact re-sync (clear + bulk) — only for explicit recovery/rebuild flows. */
    function repoMirrorReset(rows) {
        if (!repoMirrorAvailable() || typeof global.emsRepo.clear !== 'function') {
            return Promise.resolve(false);
        }
        repoMirrorScope();
        return Promise.resolve(global.emsRepo.clear(REPO_MIRROR_COLLECTION))
            .then(function () {
                if (rows && rows.length && typeof global.emsRepo.bulkPut === 'function') {
                    return global.emsRepo.bulkPut(REPO_MIRROR_COLLECTION, rows);
                }
                return null;
            })
            .then(function () { return true; })
            .catch(function (e) {
                repoMirrorDebug('repo_mirror_reset_failed', { count: rows ? rows.length : 0, error: e && e.message });
                return false;
            });
    }

    /** Cheap count of the mirror collection (index count, not a full read). */
    function repoMirrorCount() {
        if (!repoMirrorAvailable() || typeof global.emsRepo.count !== 'function') {
            return Promise.resolve(-1);
        }
        repoMirrorScope();
        return Promise.resolve(global.emsRepo.count(REPO_MIRROR_COLLECTION))
            .then(function (n) { return (typeof n === 'number') ? n : -1; })
            .catch(function () { return -1; });
    }

    global.emsRegRepoMirrorPut = repoMirrorPut;
    global.emsRegRepoMirrorRemove = repoMirrorRemove;
    global.emsRegRepoMirrorBulk = repoMirrorBulk;
    global.emsRegRepoMirrorReset = repoMirrorReset;
    global.emsRegRepoMirrorCount = repoMirrorCount;

    function getDb() {
        if (typeof global.emsFirestoreGetDb === 'function') {
            var sharedDb = global.emsFirestoreGetDb();
            if (sharedDb) return sharedDb;
        }
        return typeof global.getDbOrNull === 'function' ? global.getDbOrNull() : (typeof db !== 'undefined' ? db : null);
    }

    function toast(msg, type) {
        if (typeof global.showToast === 'function') global.showToast(msg, type || 'success');
    }

    function enforceMemoryCap() {
        if (isUnlimited()) return;
        var cap = getMemoryCap();
        if (!cap || cap <= 0 || state.order.length <= cap) return;
        var toArchiveIds = state.order.slice(cap);
        var archiveRecords = [];
        toArchiveIds.forEach(function (id) {
            if (state.byId[id]) archiveRecords.push(state.byId[id]);
            delete state.byId[id];
        });
        state.order = state.order.slice(0, cap);
        if (archiveRecords.length && typeof global.emsCacheGet === 'function' && typeof global.emsCacheSet === 'function') {
            var archKey = archiveStorageKey();
            var existing = global.emsCacheGet(archKey, []);
            var merged = (Array.isArray(existing) ? existing : []).concat(archiveRecords);
            global.emsCacheSet(archKey, merged, { noSync: true });
        }
        syncPartialCache();
    }

    function mergeRecord(rec, opts) {
        opts = opts || {};
        if (!rec || !rec.id) return;
        if (!state.byId[rec.id]) state.order.push(rec.id);
        state.byId[rec.id] = rec;
        state._listCacheVersion = (state._listCacheVersion || 0) + 1;
        if (!opts.deferCap) enforceMemoryCap();
    }

    function mergeRecordsBatch(rows, opts) {
        opts = opts || {};
        if (!rows || !rows.length) return;
        rows.forEach(function (rec) { mergeRecord(rec, { deferCap: true }); });
        enforceMemoryCap();
        if (!opts.deferPersist) {
            syncPartialCache().catch(function () { /* ignore */ });
        }
    }

    function mergeRejected(rec) {
        if (!rec || !rec.id) return;
        if (!state.rejectedById[rec.id]) state.rejectedOrder.push(rec.id);
        state.rejectedById[rec.id] = rec;
    }

    function repoListFromState() {
        return state.order.map(function (id) { return state.byId[id]; }).filter(Boolean);
    }

    function repoIdbKey() {
        return typeof global.emsRepoKey === 'function' ? global.emsRepoKey(state.tenantId) : null;
    }

    var idbPersistChain = Promise.resolve();

    global.emsRegRepoAwaitPersistIdle = function () {
        // Flush any pending debounced snapshot first so callers that await
        // persistence (tests, sync layer) always observe the latest write.
        var flush = (typeof global.emsRegRepoFlushSnapshotNow === 'function')
            ? global.emsRegRepoFlushSnapshotNow()
            : Promise.resolve();
        return flush.then(function () { return idbPersistChain || Promise.resolve(); });
    };

    /** Force flush RAM → IDB (desktop quit / X-close). */
    global.emsRegRepoFlushAllToIdb = function (opts) {
        opts = opts || {};
        if (!state.tenantId) {
            var tid = (typeof global.emsRequireTenantId === 'function' && global.emsRequireTenantId())
                || (typeof global.emsReadPersistedBootTenantId === 'function' && global.emsReadPersistedBootTenantId())
                || global.CURRENT_MADRASA_TENANT_ID;
            if (tid && typeof global.emsRegRepoInit === 'function') {
                global.emsRegRepoInit(tid);
            }
        }
        // Cancel any pending debounced snapshot — we persist the full list now.
        if (_snapshotTimer) { clearTimeout(_snapshotTimer); _snapshotTimer = null; }
        _snapshotPending = false;
        return persistRepoToIdb(Object.assign({ allowShrink: false }, opts));
    };

    /** Persist in-memory window — mirror is SSOT; verify only (no localStorage blob). */
    function persistRepoToIdb(opts) {
        opts = opts || {};
        var memCount = state.order.length;
        var tenantId = state.tenantId;
        if (!tenantId) {
            return Promise.resolve({ saved: false, count: memCount });
        }
        idbPersistChain = idbPersistChain.then(function () {
            if (opts.allowShrink && memCount === 0) {
                return repoMirrorReset([]).then(function () {
                    return verifyRepoIdbWrite(tenantId, 0);
                });
            }
            return verifyRepoIdbWrite(tenantId, memCount);
        }).then(function (verify) {
            if (!verify.ok) {
                return Promise.reject(new Error(
                    'idb_verify_mismatch memory=' + memCount + ' idb=' + verify.idbCount + ' key=' + (verify.key || '')
                ));
            }
            if (typeof global.emsPipelineDebug === 'function') {
                global.emsPipelineDebug('repo_idb_persisted', {
                    tenantId: tenantId,
                    count: memCount,
                    idbCount: verify.idbCount,
                    key: verify.key,
                    legacyKey: verify.legacyKey
                });
            }
            return { saved: true, count: memCount, idbCount: verify.idbCount, key: verify.key };
        }).catch(function (err) {
            if (typeof global.emsPipelineDebug === 'function') {
                global.emsPipelineDebug('repo_idb_persist_failed', {
                    tenantId: tenantId,
                    count: memCount,
                    error: err && err.message
                });
            }
            return { saved: false, count: memCount, error: err && err.message };
        });
        return idbPersistChain;
    }

    global.emsRegRepoPersistToIdb = function (opts) {
        return persistRepoToIdb(opts || {});
    };

    function flushRepoToIdb(opts) {
        if (state.order.length === 0) return Promise.resolve({ saved: false, count: 0 });
        return persistRepoToIdb(opts || { allowShrink: false });
    }

    global.emsRegRepoFlushToIdb = flushRepoToIdb;

    // ========================================================================
    // Legacy blob snapshot writer — DISABLED (Phase A refactor)
    // ------------------------------------------------------------------------
    // Per-record durability is via emsRepo mirror (IndexedDB collections store).
    // Full-array localStorage blobs are no longer written — avoids 5MB cliff and
    // synchronous JSON.stringify on tab close.
    // ========================================================================
    var SNAPSHOT_DEBOUNCE_MS = 600;
    var _snapshotTimer = null;
    var _snapshotPending = false;

    function scheduleRepoSnapshot() {
        return Promise.resolve({ scheduled: false, mirrorSsot: true });
    }

    /** Force mirror verify (async) — no synchronous blob write on unload. */
    function flushRepoSnapshotNow() {
        if (_snapshotTimer) { clearTimeout(_snapshotTimer); _snapshotTimer = null; }
        _snapshotPending = false;
        if (state.order.length === 0 && !state.tenantId) {
            return Promise.resolve({ saved: false, count: 0 });
        }
        return persistRepoToIdb({ allowShrink: false });
    }
    global.emsRegRepoFlushSnapshotNow = flushRepoSnapshotNow;

    /** Uniform persist hook — mirror already durable; no blob coalescing needed. */
    function syncPartialCache() {
        return Promise.resolve({ scheduled: false, mirrorSsot: true });
    }

    function syncRejectedCache() {
        var list = state.rejectedOrder.map(function (id) { return state.rejectedById[id]; });
        var tenantId = state.tenantId;
        if (!tenantId || typeof global.emsCacheSet !== 'function') {
            return Promise.resolve({ saved: false, count: list.length });
        }
        var rejKey = typeof global.emsScopedKey === 'function'
            ? global.emsScopedKey(REJECTED_KEY, tenantId)
            : REJECTED_KEY;
        global.emsCacheSet(rejKey, list, { noSync: true });
        return Promise.resolve({ saved: true, count: list.length });
    }

    function mergeArchiveFromIdb(tenantId) {
        if (typeof global.emsCacheGet !== 'function' || typeof global.emsCacheSet !== 'function') {
            return Promise.resolve(0);
        }
        var aKey = archiveStorageKey(tenantId);
        var archived = global.emsCacheGet(aKey, []);
        if (!Array.isArray(archived) || !archived.length) return Promise.resolve(0);
        var before = state.order.length;
        mergeRecordsBatch(archived);
        global.emsCacheSet(aKey, [], { noSync: true });
        return Promise.resolve(state.order.length - before);
    }

    function verifyHydrationMatch(tenantId) {
        tenantId = tenantId || state.tenantId;
        var memoryCount = state.order.length;
        return repoMirrorCount().then(function (idbCount) {
            idbCount = idbCount >= 0 ? idbCount : 0;
            var matched = (idbCount === 0 && memoryCount === 0)
                || (idbCount > 0 && memoryCount > 0)
                || memoryCount === idbCount;
            return {
                tenantId: tenantId,
                memoryCount: memoryCount,
                idbCount: idbCount,
                matched: matched,
                key: 'idb_mirror:' + REPO_MIRROR_COLLECTION
            };
        });
    }

    global.emsRegRepoVerifyHydration = verifyHydrationMatch;

    function hydrateFromIdb(tenantId, opts) {
        opts = opts || {};
        tenantId = tenantId || state.tenantId;
        return new Promise(function (resolve, reject) {
            if (!opts.forceFull && state.order.length > 0) {
                return resolve(state.order.length);
            }

            if (opts.forceFull) {
                state.byId = Object.create(null);
                state.order = [];
            }

            migrateLegacyRegistrationBlob(tenantId).then(function () {
                var offset = 0;
                var batchSize = IDB_MIRROR_BATCH;
                var maxLoad = opts.fullMirror || isUnlimited()
                    ? Infinity
                    : (getMemoryCap() || batchSize);
                var loaded = 0;

                function loadNextPage() {
                    if (loaded >= maxLoad && maxLoad !== Infinity) {
                        return Promise.resolve(loaded);
                    }
                    var limit = maxLoad === Infinity
                        ? batchSize
                        : Math.min(batchSize, maxLoad - loaded);
                    return idbGetRepoPage(tenantId, offset, limit).then(function (rows) {
                        if (!rows.length) return loaded;
                        mergeRecordsBatch(rows, { deferPersist: true });
                        loaded += rows.length;
                        offset += rows.length;
                        if (rows.length < limit) return loaded;
                        if (loaded >= maxLoad && maxLoad !== Infinity) return loaded;
                        return loadNextPage();
                    });
                }

                return loadNextPage();
            }).then(function (count) {
                if (typeof global.emsPipelineDebug === 'function') {
                    global.emsPipelineDebug('repo_idb_hydrate_read', {
                        tenantId: tenantId,
                        key: 'idb_mirror:' + REPO_MIRROR_COLLECTION,
                        memoryCount: count
                    });
                }
                return mergeArchiveFromIdb(tenantId).then(function () {
                    if (state.order.length === 0
                        && global.EMS_OFFLINE_FIRST_SSOT !== true
                        && typeof global.emsCacheGet === 'function'
                        && tenantId) {
                        var legacyUsers = global.emsCacheGet(USERS_KEY, []);
                        if (Array.isArray(legacyUsers) && legacyUsers.length) {
                            mergeRecordsBatch(legacyUsers, { deferPersist: true });
                        }
                    }
                    return state.order.length;
                });
            }).then(function (count) {
                if (count > 0) {
                    return persistRepoToIdb().then(function () { return count; });
                }
                return count;
            }).then(function (count) {
                resolve(count);
            }).catch(function (err) {
                if (typeof global.emsPipelineDebug === 'function') {
                    global.emsPipelineDebug('repo_idb_hydrate_failed', {
                        tenantId: tenantId,
                        error: err && err.message
                    });
                }
                reject(err);
            });
        });
    }

    function hydrateFromIdbWithRetry(tenantId, opts) {
        opts = opts || {};
        var attempt = 0;
        var RETRY_DELAY_MS = 200;
        function run() {
            attempt += 1;
            return hydrateFromIdb(tenantId, { forceFull: true, fullMirror: isUnlimited() }).then(function () {
                return verifyHydrationMatch(tenantId).then(function (verify) {
                    if (!verify.matched && verify.idbCount > 0 && attempt < HYDRATE_RETRY_MAX) {
                        return new Promise(function (resolve) {
                            setTimeout(resolve, RETRY_DELAY_MS * attempt);
                        }).then(run);
                    }
                    return verify;
                });
            });
        }
        var warm = Promise.resolve({ supported: true, backend: 'localStorage' });
        return warm.then(run);
    }

    /** Phase B1 — full IDB → in-memory repository at boot (desktop / offline-first). */
    global.emsRegRepoHydrateFullFromIdb = function (tenantId) {
        if (tenantId) {
            if (state.tenantId && state.tenantId !== tenantId) {
                global.emsRegRepoReset();
            }
            state.tenantId = tenantId;
        }
        if (!state.tenantId) {
            return Promise.resolve({
                count: 0,
                source: 'no_tenant',
                hydrationComplete: false,
                matched: false
            });
        }
        return hydrateFromIdbWithRetry(state.tenantId).then(function (verify) {
            var count = verify.memoryCount;
            if (count > 0) {
                state.bootVerified = true;
                state.hasMore = true;
                if (typeof global.emsMarkRepositoryReady === 'function') {
                    global.emsMarkRepositoryReady(count, {
                        bootComplete: true,
                        source: 'idb_hydrate'
                    });
                }
            }
            startMetaListener();
            // Seed the permanent Repository from the hydrated set ONLY when it is
            // out of sync. On a normal boot the incremental mirror already holds
            // every record, so re-writing all N rows each launch is pure waste —
            // we skip it when emsRepo already reports the same count.
            var mirrorChain;
            if (count <= 0) {
                mirrorChain = Promise.resolve(false);
            } else {
                mirrorChain = repoMirrorCount().then(function (mirrorCount) {
                    if (mirrorCount === count) {
                        // Mirror already in sync — skip the O(N) boot rewrite.
                        return false;
                    }
                    return repoMirrorBulk(repoListFromState());
                }).catch(function () {
                    return repoMirrorBulk(repoListFromState());
                });
            }
            return mirrorChain.then(function () {
                if (count > 0 && typeof global.emsBroadcastUsersChanged === 'function') {
                    global.emsBroadcastUsersChanged();
                }
                return {
                    count: count,
                    idbCount: verify.idbCount,
                    matched: verify.matched,
                    hydrationComplete: verify.matched,
                    source: count > 0 ? 'idb_full' : 'idb_empty',
                    key: verify.key
                };
            });
        });
    };

    /**
     * Guaranteed offline-first boot hydrate — blocks UI unlock until RAM matches IDB
     * (or both empty). Optional one-shot cloud bootstrap when IDB is absolutely empty.
     */
    global.emsRegRepoEnsureHydratedFromIdb = function (tenantId, options) {
        options = options || {};
        tenantId = tenantId || state.tenantId;
        if (!tenantId && typeof global.emsReadPersistedBootTenantId === 'function') {
            tenantId = global.emsReadPersistedBootTenantId();
        }
        if (!tenantId) {
            return Promise.resolve({
                ready: false,
                hydrationComplete: false,
                count: 0,
                idbCount: 0,
                source: 'no_tenant'
            });
        }
        if (typeof global.emsRegRepoInit === 'function') {
            global.emsRegRepoInit(tenantId);
        }
        if (typeof global.emsActivateTenantStorage === 'function') {
            global.emsActivateTenantStorage(tenantId);
        }

        function finish(verify, extra) {
            extra = extra || {};
            var count = verify.memoryCount;
            global.EMS_REPOSITORY_BOOT_COMPLETE = verify.matched || (verify.idbCount === 0 && count === 0);
            return Object.assign({
                ready: true,
                hydrationComplete: verify.matched || (verify.idbCount === 0 && count === 0),
                count: count,
                idbCount: verify.idbCount,
                matched: verify.matched,
                tenantId: tenantId,
                key: verify.key
            }, extra);
        }

        return global.emsRegRepoHydrateFullFromIdb(tenantId).then(function (hydrateRes) {
            return verifyHydrationMatch(tenantId).then(function (verify) {
                if (verify.matched) {
                    return finish(verify, { source: hydrateRes.source || 'idb_hydrate' });
                }
                if (verify.idbCount > 0) {
                    return finish(verify, {
                        source: 'idb_hydrate_mismatch',
                        hydrationComplete: false,
                        ready: false
                    });
                }
                if (options.skipFirstLoginCloud === true || global.EMS_OFFLINE_FIRST_SSOT !== true) {
                    return finish(verify, { source: 'idb_empty' });
                }
                if (typeof global.emsRegRepoBulkHydrate !== 'function') {
                    return finish(verify, { source: 'idb_empty_no_cloud_fn' });
                }
                global.EMS_ALLOW_FIRST_LOGIN_CLOUD_FETCH = true;
                return global.emsRegRepoBulkHydrate(tenantId, Infinity, { allowShrink: true })
                    .then(function () {
                        return persistRepoToIdb({ allowShrink: true });
                    })
                    .then(function () {
                        return hydrateFromIdbWithRetry(tenantId);
                    })
                    .then(function (afterCloud) {
                        return finish(afterCloud, { source: 'first_login_cloud_bootstrap' });
                    })
                    .catch(function (err) {
                        return finish(verify, {
                            source: 'first_login_cloud_failed',
                            hydrationComplete: false,
                            ready: false,
                            error: err && err.message
                        });
                    })
                    .finally(function () {
                        global.EMS_ALLOW_FIRST_LOGIN_CLOUD_FETCH = false;
                    });
            });
        });
    };

    function colRef(collectionName) {
        var db = getDb();
        var tid = state.tenantId;
        if (!tid && typeof global.emsResolveFirestoreTenantId === 'function') {
            tid = global.emsResolveFirestoreTenantId();
            if (tid && typeof global.emsRegRepoInit === 'function') {
                global.emsRegRepoInit(tid);
            }
        }
        if (typeof global.emsFirestoreCollectionColRef === 'function') {
            var sharedRef = global.emsFirestoreCollectionColRef(db, tid, collectionName);
            if (sharedRef) return sharedRef;
        }
        if (!db || !tid) return null;
        return db.collection('All_Madrasas').doc(tid).collection(collectionName);
    }

    var BULK_HYDRATE_TIMEOUT_MS = 180000;
    var BULK_HYDRATE_MAX_PAGES = 500;
    var FIRESTORE_FETCH_TIMEOUT_MS = 45000;

    function withTimeout(promise, ms, label) {
        return new Promise(function (resolve, reject) {
            var settled = false;
            var timer = setTimeout(function () {
                if (settled) return;
                settled = true;
                reject(new Error((label || 'operation') + '_timeout'));
            }, ms);
            Promise.resolve(promise).then(function (res) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(res);
            }).catch(function (err) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                reject(err);
            });
        });
    }

    function fetchEntireCollectionFromServer(collectionName) {
        var col = colRef(collectionName);
        if (!col) {
            return Promise.resolve({ rows: [], last: null, hasMore: false, error: 'no_tenant_or_db' });
        }
        var getOpts = { source: 'server' };
        function firestoreGetRaw() {
            return col.get(getOpts).catch(function () { return col.get(); });
        }
        return withTimeout(firestoreGetRaw(), RECOVERY_FULL_GET_TIMEOUT_MS, 'recovery_full_get').then(function (snap) {
            var rows = [];
            snap.forEach(function (doc) {
                var data = doc.data();
                data.id = data.id || doc.id;
                rows.push(lean(data));
            });
            if (typeof global.emsPipelineDebug === 'function') {
                global.emsPipelineDebug('recovery_full_get_done', {
                    tenantId: state.tenantId,
                    recordCount: rows.length
                });
            }
            return {
                rows: rows,
                last: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
                hasMore: false,
                mode: 'full_get'
            };
        }).catch(function (err) {
            logFetchError('recovery_full_get_failed', err, { tenantId: state.tenantId, collection: collectionName });
            throw err;
        });
    }

    function fetchPageFromServer(collectionName, pageSize, lastDoc, opts) {
        opts = opts || {};
        pageSize = Math.max(1, pageSize || 50);
        var recovery = isRecoveryFetch(opts);
        var col = colRef(collectionName);
        if (!col) {
            if (typeof global.emsPipelineDebugQuery === 'function') {
                global.emsPipelineDebugQuery({
                    stage: 'repo_fetch_no_col',
                    collection: collectionName,
                    recordCount: 0,
                    source: 'none',
                    error: 'no_tenant_or_db',
                    tenantId: state.tenantId
                });
            }
            logFetchError('fetchPageFromServer_no_col', new Error('no_tenant_or_db'), {
                collection: collectionName,
                tenantId: state.tenantId
            });
            return Promise.resolve({ rows: [], last: null, hasMore: false, error: 'no_tenant_or_db' });
        }
        var getOpts = { source: 'server' };
        var docIdPath = (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldPath)
            ? firebase.firestore.FieldPath.documentId()
            : null;

        function firestoreGet(query, preferServer) {
            var chain = Promise.reject(new Error('skip'));
            if (preferServer !== false) {
                chain = chain.catch(function () { return query.get(getOpts); });
            }
            return chain.catch(function () { return query.get(); });
        }

        function mapSnap(snap, path, mode) {
            var rows = [];
            snap.forEach(function (doc) {
                var data = doc.data();
                data.id = data.id || doc.id;
                rows.push(lean(data));
            });
            var last = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
            if (typeof global.emsPipelineDebugQuery === 'function') {
                global.emsPipelineDebugQuery({
                    stage: 'repo_fetch_done',
                    collection: collectionName,
                    queryPath: path,
                    recordCount: rows.length,
                    source: 'server',
                    cacheHit: false,
                    mode: mode,
                    tenantId: state.tenantId
                });
            }
            return { rows: rows, last: last, hasMore: snap.size >= pageSize, mode: mode };
        }

        function runQuery(mode) {
            var q;
            var filters;
            if (mode === 'docId' && docIdPath) {
                q = col.orderBy(docIdPath).limit(pageSize);
                if (lastDoc) q = q.startAfter(lastDoc);
                filters = { orderBy: 'documentId' };
            } else if (mode === 'timestamp') {
                q = col.orderBy('timestamp', 'desc').limit(pageSize);
                if (lastDoc) q = q.startAfter(lastDoc);
                filters = { orderBy: 'timestamp desc' };
            } else {
                if (lastDoc && docIdPath) {
                    q = col.orderBy(docIdPath).limit(pageSize).startAfter(lastDoc);
                    filters = { orderBy: 'documentId_paginate' };
                } else if (lastDoc) {
                    return Promise.resolve({
                        rows: [],
                        last: null,
                        hasMore: false,
                        mode: 'plain_blocked',
                        fallbackEnd: true
                    });
                } else {
                    q = col.limit(pageSize);
                    filters = { fallback: 'plain_first_page' };
                }
            }
            var path = typeof global.emsPipelineDebugQuery === 'function'
                ? global.emsPipelineDebugQuery({
                    stage: 'repo_fetch_start',
                    collection: collectionName,
                    filters: filters,
                    limit: pageSize,
                    source: 'server',
                    tenantId: state.tenantId
                })
                : null;
            return withTimeout(firestoreGet(q), FIRESTORE_FETCH_TIMEOUT_MS, 'firestore_get').then(function (snap) {
                return mapSnap(snap, path, mode);
            }).catch(function (err) {
                logFetchError('fetchPageFromServer_query_' + mode, err, {
                    collection: collectionName,
                    tenantId: state.tenantId,
                    pageSize: pageSize,
                    hasLastDoc: !!lastDoc
                });
                throw err;
            });
        }

        function runRecoveryFallbacks() {
            return runQuery('plain').then(function (res) {
                if (res.rows.length > 0 || lastDoc) return res;
                return runQuery('docId');
            }).then(function (res) {
                if (res.rows.length > 0 || lastDoc) return res;
                return runQuery('timestamp');
            });
        }

        function runWithFallbacks() {
            if (recovery) {
                return runRecoveryFallbacks();
            }
            return runQuery('docId').then(function (res) {
                if (res.rows.length === 0 && !lastDoc) {
                    return runQuery('plain').then(function (plainRes) {
                        if (plainRes.rows.length > 0) return plainRes;
                        return runQuery('timestamp');
                    });
                }
                return res;
            });
        }

        return runWithFallbacks().catch(function (err) {
            logFetchError('fetchPageFromServer_all_modes_failed', err, {
                collection: collectionName,
                tenantId: state.tenantId,
                recovery: recovery
            });
            return runQuery('plain').catch(function (err2) {
                return runQuery('timestamp').catch(function (err3) {
                    return { rows: [], last: null, hasMore: false, error: err3 && err3.message };
                });
            });
        });
    }

    /** Force server bulk hydrate — module-only, never at login (regent10). */
    global.emsRegRepoBulkHydrate = function (tenantId, maxCount, opts) {
        opts = opts || {};
        if (tenantId) {
            if (state.tenantId && state.tenantId !== tenantId) {
                global.emsRegRepoReset();
            }
            state.tenantId = tenantId;
        }
        if (!state.tenantId) {
            return Promise.resolve({ count: 0, source: 'no_tenant' });
        }
        maxCount = getBulkMaxCount(maxCount);
        if (maxCount !== Infinity && state.order.length >= maxCount && state.bootVerified) {
            return Promise.resolve({ count: state.order.length, source: 'already_hydrated' });
        }

        var loaded = 0;
        var lastDoc = null;
        var recoveryMode = isRecoveryFetch(opts);
        var pageSize = recoveryMode ? getRecoveryPageSize() : getPageSize();
        var pageNum = 0;

        function finishBulk(source, extra) {
            state.bootVerified = true;
            state.hasMore = false;
            startMetaListener();
            var out = {
                count: state.order.length,
                source: source || 'bulk_server',
                pages: pageNum,
                fetched: loaded,
                ok: state.order.length > 0
            };
            if (extra) Object.assign(out, extra);
            return out;
        }

        function fetchRecoveryBatch() {
            return fetchPageFromServer('Registrations', pageSize, lastDoc, { recoveryMode: true });
        }

        function nextPage() {
            if (maxCount !== Infinity && state.order.length >= maxCount) {
                return Promise.resolve(finishBulk('bulk_server_cap'));
            }
            if (pageNum >= BULK_HYDRATE_MAX_PAGES) {
                return Promise.resolve(finishBulk('bulk_server_page_cap'));
            }
            pageNum += 1;
            var orderBefore = state.order.length;
            var fetchFn = recoveryMode ? fetchRecoveryBatch : function () {
                return fetchPageFromServer('Registrations', pageSize, lastDoc);
            };
            return fetchFn().then(function (res) {
                if (res.error && (!res.rows || !res.rows.length)) {
                    logFetchError('bulk_hydrate_page_empty', new Error(res.error), {
                        tenantId: state.tenantId,
                        page: pageNum,
                        mode: res.mode
                    });
                }
                mergeRecordsBatch(res.rows, { deferPersist: true });
                var added = state.order.length - orderBefore;
                loaded += res.rows.length;
                lastDoc = res.last;
                var stuck = res.rows.length > 0 && added === 0;
                if (stuck) {
                    logFetchError('bulk_hydrate_merge_stuck', new Error('rows_fetched_but_none_merged'), {
                        tenantId: state.tenantId,
                        page: pageNum,
                        fetchedRows: res.rows.length,
                        sampleId: res.rows[0] && res.rows[0].id
                    });
                }
                var bulkDone = !res.hasMore || res.rows.length === 0 || stuck || res.fallbackEnd;
                return repoMirrorBulk(res.rows).then(function () {
                    return verifyRepoIdbWrite(state.tenantId, loaded);
                }).then(function (verifyRes) {
                    try {
                        global.dispatchEvent(new CustomEvent('ems:cloud-pull-progress', {
                            detail: {
                                message: 'Firebase سے ریکارڈز…',
                                records: state.order.length,
                                page: pageNum,
                                percent: Math.min(92, 18 + pageNum * 3)
                            }
                        }));
                    } catch (progErr) { /* ignore */ }
                    if (typeof global.emsPipelineDebug === 'function') {
                        global.emsPipelineDebug('bulk_hydrate_page_persisted', {
                            tenantId: state.tenantId,
                            page: pageNum,
                            pageRows: res.rows.length,
                            memoryCount: state.order.length,
                            saved: !!(verifyRes && verifyRes.ok),
                            idbCount: verifyRes && verifyRes.idbCount
                        });
                    }
                    if (bulkDone) {
                        return finishBulk(
                            stuck ? 'bulk_server_stuck' : (res.fallbackEnd ? 'bulk_server_fallback_end' : 'bulk_server'),
                            { ok: state.order.length > 0, error: stuck ? 'merge_stuck' : (res.error || null) }
                        );
                    }
                    if (maxCount !== Infinity && state.order.length >= maxCount) {
                        return finishBulk('bulk_server_max');
                    }
                    return nextPage();
                });
            });
        }

        return withTimeout(
            nextPage().then(function (res) {
                return persistRepoToIdb({ allowShrink: !!(opts && opts.allowShrink) }).then(function () {
                    return res;
                });
            }),
            BULK_HYDRATE_TIMEOUT_MS,
            'bulk_hydrate'
        ).catch(function (err) {
            logFetchError('bulk_hydrate_failed', err, {
                tenantId: state.tenantId,
                memoryCount: state.order.length
            });
            if (typeof global.emsPipelineDebug === 'function') {
                global.emsPipelineDebug('bulk_hydrate_failed', {
                    error: err && err.message,
                    tenantId: state.tenantId,
                    memoryCount: state.order.length
                });
            }
            return persistRepoToIdb({ allowShrink: !!(opts && opts.allowShrink) }).then(function () {
                return {
                    count: state.order.length,
                    source: 'bulk_server_error',
                    ok: false,
                    error: err && err.message
                };
            });
        });
    };

    function fetchPage(collectionName, pageSize, lastDoc) {
        if (!mayFetchFromServer()) {
            if (typeof global.emsPipelineDebug === 'function') {
                global.emsPipelineDebug('repo_fetch_blocked_idb_only', {
                    collection: collectionName,
                    tenantId: state.tenantId
                });
            }
            return Promise.resolve({ rows: [], last: null, hasMore: false, blocked: true });
        }
        return fetchPageFromServer(collectionName, pageSize, lastDoc);
    }

    function invalidateLocalQueryCache() {
        if (typeof global.emsInvalidateUserQueryCache === 'function') {
            global.emsInvalidateUserQueryCache();
        }
    }

    function applyRemoteChange(change) {
        if (!change || !change.id) return Promise.resolve();
        var fromRejected = change.collection === 'Rejected';
        if (change.op === 'delete') {
            return Promise.resolve(global.emsRegRepoRemove(change.id, fromRejected));
        }
        return global.emsRegRepoGetById(change.id, fromRejected, true).then(function () {
            // getById already mirrored + scheduled a snapshot; persist once more
            // (immediate) for remote-change durability, then broadcast. No extra
            // syncPartialCache() — that was a redundant double write.
            return persistRepoToIdb().then(function () {
                if (typeof global.emsBroadcastUsersChanged === 'function') {
                    global.emsBroadcastUsersChanged();
                }
            });
        });
    }

    function handleMetaDoc(doc) {
        if (!doc.exists) {
            state.metaInitialized = true;
            return;
        }
        var d = doc.data() || {};
        if (!state.metaInitialized) {
            state._metaVersion = d.version || null;
            state.metaInitialized = true;
            return;
        }
        if (!d.version || d.version === state._metaVersion) return;
        state._metaVersion = d.version;
        invalidateLocalQueryCache();
        if (isIdbOnlyBoot()) {
            var change = d.change;
            if (change && change.id && change.op !== 'refresh') {
                applyRemoteChange(change);
            }
            return;
        }
        var change = d.change;
        if (change && change.op === 'refresh') {
            global.emsRegRepoRefreshFirstPage().then(function () {
                if (typeof global.emsBroadcastUsersChanged === 'function') {
                    global.emsBroadcastUsersChanged();
                }
            });
            return;
        }
        if (change && change.id) {
            applyRemoteChange(change);
            return;
        }
        if (typeof global.emsBroadcastUsersChanged === 'function') {
            global.emsBroadcastUsersChanged();
        }
    }

    function startMetaListener() {
        if (!mayFetchFromServer()) return;
        if (typeof global.emsIsNetworkAvailable === 'function' && !global.emsIsNetworkAvailable()) return;
        if (state.metaUnsub) return;
        var col = colRef('RegistrationMeta');
        if (!col) return;
        try {
            state.metaUnsub = col.doc('current').onSnapshot(function (doc) {
                handleMetaDoc(doc);
            }, function () { /* permission */ });
        } catch (e) { /* ignore */ }
    }

    /** Client-only cache bust — local upsert/remove. */
    function bumpMetaLocal() {
        invalidateLocalQueryCache();
    }

    function bumpMeta(change) {
        var col = colRef('RegistrationMeta');
        if (!col) return Promise.resolve();
        var version = Date.now();
        var payload = {
            version: version,
            updatedAt: new Date().toISOString()
        };
        if (change) {
            payload.change = {
                collection: change.collection || 'Registrations',
                id: change.id || null,
                op: change.op || 'upsert'
            };
        } else {
            payload.change = { op: 'refresh' };
        }
        state._metaVersion = version;
        return col.doc('current').set(payload, { merge: true }).catch(function () { return null; });
    }

    /** Notify other clients after a successful cloud write (Phase A4). */
    global.emsRegRepoNotifyRemoteWrite = function (change) {
        if (!state.tenantId && change && change.tenantId) {
            global.emsRegRepoInit(change.tenantId);
        }
        return bumpMeta(change);
    };

    /** Apply meta version locally after atomic batch commit (meta already written in batch). */
    global.emsRegRepoApplyMetaFromAtomic = function (metaPayload) {
        if (metaPayload && metaPayload.version) {
            state._metaVersion = metaPayload.version;
        }
        invalidateLocalQueryCache();
    };

    /** Bulk change — refresh first page on all clients. */
    global.emsRegRepoNotifyRemoteRefresh = function () {
        return bumpMeta({ op: 'refresh' });
    };

    global.emsRegRepoEnsureMetaListener = function (tenantId) {
        if (tenantId) {
            if (state.tenantId && state.tenantId !== tenantId) {
                global.emsRegRepoReset();
            }
            state.tenantId = tenantId;
        }
        startMetaListener();
        return Promise.resolve({ listening: !!state.metaUnsub, tenantId: state.tenantId });
    };

    global.emsRegRepoInit = function (tenantId) {
        if (tenantId && state.tenantId && state.tenantId !== tenantId) {
            global.emsRegRepoReset();
        }
        state.tenantId = tenantId;
        repoMirrorScope();
        migrateLegacyRegistrationBlob(tenantId).catch(function () { /* best-effort */ });
        if (typeof global.emsIdbSearchIndexMaybeSchedule === 'function' && tenantId) {
            global.emsIdbSearchIndexMaybeSchedule(tenantId + '__registrations');
        }
    };

    global.emsRegRepoReset = function () {
        if (state.metaUnsub) {
            try { state.metaUnsub(); } catch (e) { /* ignore */ }
            state.metaUnsub = null;
        }
        state.byId = Object.create(null);
        state.order = [];
        state.lastDoc = null;
        state.hasMore = true;
        state.searchActive = false;
        state.searchResults = null;
        state.rejectedById = Object.create(null);
        state.rejectedOrder = [];
        state.rejectedLastDoc = null;
        state.rejectedHasMore = true;
        state.rejectedLoading = false;
        state.rejectedLoaded = false;
        state._metaVersion = null;
        state.bootVerified = false;
        state.metaInitialized = false;
        state.tenantId = null;
        state._listCacheVersion = (state._listCacheVersion || 0) + 1;
    };

    function regRepoListCacheTouch() {
        var gen = state._listCacheVersion || 0;
        if (state._listCacheArr && state._listCacheGen === gen) {
            return state._listCacheArr;
        }
        state._listCacheArr = state.order.map(function (id) { return state.byId[id]; }).filter(Boolean);
        state._listCacheGen = gen;
        return state._listCacheArr;
    }

    global.emsRegRepoGetCount = function () {
        return state.order.length;
    };

    /** Total durable count from IDB mirror (cheap index count). */
    global.emsRegRepoGetIdbCount = function () {
        return repoMirrorCount();
    };

    /** Paginated read from IDB SSOT — preferred for large tenants. */
    global.emsRegRepoGetListAsync = function (opts) {
        opts = opts || {};
        if (!repoMirrorAvailable()) {
            return Promise.resolve({
                rows: global.emsRegRepoGetList(opts),
                total: global.emsRegRepoGetCount(),
                offset: opts.offset || 0,
                limit: opts.limit || 100
            });
        }
        repoMirrorScope();
        return global.emsRepo.page(REPO_MIRROR_COLLECTION, {
            offset: opts.offset || 0,
            limit: opts.limit || 100,
            filter: opts.type && opts.type !== 'all' ? { type: opts.type } : null,
            search: opts.q || opts.search || ''
        });
    };

    global.emsRegRepoGetCacheGeneration = function () {
        return state._listCacheVersion || 0;
    };

    /** Iterate all registrations without allocating a new array (perf). */
    global.emsRegRepoForEach = function (fn) {
        if (typeof fn !== 'function') return;
        for (var i = 0; i < state.order.length; i++) {
            var u = state.byId[state.order[i]];
            if (u) fn(u, i);
        }
    };

    /** Collect distinct class names without materializing full user list. */
    global.emsRegRepoCollectClasses = function () {
        var seen = Object.create(null);
        var out = [];
        global.emsRegRepoForEach(function (u) {
            if (!u) return;
            var c = String(u.class || u.className || u.grade || u.section || '').trim();
            if (!c || c === 'نامعلوم' || seen[c]) return;
            seen[c] = true;
            out.push(c);
        });
        out.sort();
        return out;
    };

    /**
     * Paginated slice for legacy UI — delegates to EmsQueryUtils (Priority 4).
     * opts: { offset, limit, type, q }
     */
    global.emsRegRepoGetListPage = function (opts) {
        opts = opts || {};
        var offset = Math.max(0, opts.offset || 0);
        var limit = opts.limit == null ? 25 : opts.limit;
        var Q = global.EmsQueryUtils;
        if (Q && typeof Q.pageFromAll === 'function') {
            return Q.pageFromAll(repoListFromState(), {
                offset: offset,
                limit: limit,
                filter: (opts.type && opts.type !== 'all') ? { type: opts.type } : null,
                search: (opts.q && String(opts.q).length >= 2)
                    ? {
                        text: opts.q,
                        fields: ['name', 'id', 'cnic', 'phone', 'class', 'designation', 'position', 'fname']
                    }
                    : null,
                sort: { field: 'timestamp', dir: 'desc' }
            });
        }
        var matched = [];
        var i, u, hay;
        var q = (opts.q || '').trim().toLowerCase();
        var typeFilter = opts.type && opts.type !== 'all' ? opts.type : null;
        for (i = 0; i < state.order.length; i++) {
            u = state.byId[state.order[i]];
            if (!u) continue;
            if (typeFilter && u.type !== typeFilter) continue;
            if (q) {
                hay = [u.name, u.id, u.cnic, u.phone, u.class, u.designation, u.position, u.fname]
                    .map(function (x) { return String(x || '').toLowerCase(); }).join(' ');
                if (hay.indexOf(q) < 0) continue;
            }
            matched.push(u);
        }
        return {
            rows: matched.slice(offset, offset + limit),
            total: matched.length
        };
    };

    global.emsRegRepoIsReady = function () {
        return !!state.tenantId && (state.order.length > 0 || state.bootVerified);
    };

    /** Boot-time ensure: IDB hydrate on desktop — never overwrite with Firestore page 1. */
    global.emsRegRepoEnsureReady = function (tenantId) {
        if (tenantId) state.tenantId = tenantId;
        if (!state.tenantId) {
            return Promise.resolve({ ready: false, count: 0, source: 'no_tenant' });
        }
        if (!isDesktopEnvironment() && state.order.length > 0) {
            state.bootVerified = true;
            return Promise.resolve({ ready: true, count: state.order.length, source: 'repo' });
        }
        return global.emsRegRepoEnsureInitial(tenantId).then(function () {
            if (state.order.length > 0) {
                state.bootVerified = true;
                return { ready: true, count: state.order.length, source: 'idb' };
            }
            if (isDesktopEnvironment()) {
                state.bootVerified = true;
                startMetaListener();
                return Promise.resolve({
                    ready: state.order.length > 0,
                    count: state.order.length,
                    source: 'desktop_idb_empty'
                });
            }
            if (state.loading) {
                return waitForLoad().then(function () {
                    state.bootVerified = true;
                    return { ready: true, count: state.order.length, source: 'firestore_wait' };
                });
            }
            state.loading = true;
            return fetchPage('Registrations', getPageSize(), null).then(function (res) {
                mergeRecordsBatch(res.rows);
                state.lastDoc = res.last;
                state.hasMore = res.hasMore;
                return persistRepoToIdb().then(function () {
                    syncPartialCache();
                    startMetaListener();
                    state.bootVerified = true;
                    return { ready: true, count: state.order.length, source: 'firestore_fallback' };
                });
            }).finally(function () {
                state.loading = false;
            });
        });
    };

    function waitForLoad() {
        return new Promise(function (resolve) {
            var tries = 0;
            function tick() {
                if (!state.loading || tries > 50) return resolve();
                tries++;
                setTimeout(tick, 100);
            }
            tick();
        });
    }

    global.emsRegRepoEnsureInitial = function (tenantId) {
        if (tenantId) state.tenantId = tenantId;
        if (!state.tenantId) {
            if (typeof global.emsPipelineDebug === 'function') {
                global.emsPipelineDebug('repo_ensure_initial_no_tenant', { recordCount: 0 });
            }
            return Promise.resolve({ loaded: 0, hasMore: false, reason: 'no_tenant' });
        }
        if (state.loading) {
            return waitForLoad().then(function () {
                return { loaded: state.order.length, hasMore: state.hasMore, source: 'wait' };
            });
        }
        if (!isDesktopEnvironment() && state.order.length > 0) {
            return Promise.resolve({ loaded: state.order.length, hasMore: state.hasMore, source: 'repo' });
        }
        state.loading = true;
        if (typeof global.emsPipelineDebug === 'function') {
            global.emsPipelineDebug('repo_ensure_initial_start', { tenantId: state.tenantId, desktop: isDesktopEnvironment() });
        }
        var hydrateOpts = isDesktopEnvironment() ? { forceFull: true } : {};
        return hydrateFromIdb(tenantId, hydrateOpts).then(function () {
            if (state.order.length > 0) {
                state.bootVerified = true;
                state.hasMore = true;
                return persistRepoToIdb().then(function () {
                    syncPartialCache();
                    startMetaListener();
                    return { loaded: state.order.length, hasMore: state.hasMore, source: 'idb' };
                });
            }
            if (isDesktopEnvironment()) {
                state.hasMore = true;
                startMetaListener();
                return { loaded: 0, hasMore: true, source: 'desktop_idb_empty' };
            }
            return fetchPage('Registrations', getPageSize(), null);
        }).then(function (res) {
            if (res && (res.source === 'idb' || res.source === 'desktop_idb_empty')) return res;
            mergeRecordsBatch(res.rows);
            state.lastDoc = res.last;
            state.hasMore = res.hasMore;
            state.bootVerified = state.order.length > 0;
            return persistRepoToIdb().then(function () {
                syncPartialCache();
                startMetaListener();
                return { loaded: state.order.length, hasMore: state.hasMore, source: 'firestore' };
            });
        }).catch(function (err) {
            if (typeof global.emsPipelineDebug === 'function') {
                global.emsPipelineDebug('repo_ensure_initial_failed', {
                    tenantId: state.tenantId,
                    error: err && err.message
                });
            }
            return { loaded: state.order.length, hasMore: false, source: 'error', error: err && err.message };
        }).finally(function () {
            state.loading = false;
        });
    };

    /** Lazy load rejected — only when مسترد شدہ tab opens (E7-S3) */
    global.emsRegRepoEnsureRejectedInitial = function () {
        if (!state.tenantId) {
            return Promise.resolve({ loaded: state.rejectedOrder.length, hasMore: state.rejectedHasMore });
        }
        if (state.rejectedLoaded || state.rejectedOrder.length > 0) {
            return Promise.resolve({ loaded: state.rejectedOrder.length, hasMore: state.rejectedHasMore });
        }
        if (state.rejectedLoading) {
            return Promise.resolve({ loaded: state.rejectedOrder.length, hasMore: state.rejectedHasMore });
        }
        state.rejectedLoading = true;
        return fetchPage('Rejected', REJECTED_PAGE_SIZE, null).then(function (res) {
            res.rows.forEach(mergeRejected);
            state.rejectedLastDoc = res.last;
            state.rejectedHasMore = res.hasMore;
            state.rejectedLoaded = true;
            return syncRejectedCache().then(function () {
                return { loaded: state.rejectedOrder.length, hasMore: state.rejectedHasMore };
            });
        }).finally(function () {
            state.rejectedLoading = false;
        });
    };

    global.emsRegRepoLoadMore = function () {
        if (!state.hasMore || state.loading || state.searchActive) {
            return Promise.resolve({ added: 0, hasMore: state.hasMore });
        }
        state.loading = true;
        var prevAllow = global.EMS_REGISTRATION_ALLOW_SERVER_FETCH;
        global.EMS_REGISTRATION_ALLOW_SERVER_FETCH = true;
        return fetchPage('Registrations', getPageSize(), state.lastDoc).then(function (res) {
            var before = state.order.length;
            mergeRecordsBatch(res.rows);
            state.lastDoc = res.last;
            state.hasMore = res.hasMore;
            syncPartialCache();
            return persistRepoToIdb().then(function () {
                return repoMirrorBulk(res.rows);
            }).then(function () {
                return { added: state.order.length - before, hasMore: state.hasMore };
            });
        }).finally(function () {
            global.EMS_REGISTRATION_ALLOW_SERVER_FETCH = prevAllow;
            state.loading = false;
        });
    };

    global.emsRegRepoLoadMoreRejected = function () {
        if (!state.rejectedHasMore || state.rejectedLoading) {
            return Promise.resolve({ added: 0, hasMore: state.rejectedHasMore });
        }
        state.rejectedLoading = true;
        return fetchPage('Rejected', REJECTED_PAGE_SIZE, state.rejectedLastDoc).then(function (res) {
            var before = state.rejectedOrder.length;
            res.rows.forEach(mergeRejected);
            state.rejectedLastDoc = res.last;
            state.rejectedHasMore = res.hasMore;
            syncRejectedCache();
            state.rejectedLoaded = true;
            return { added: state.rejectedOrder.length - before, hasMore: state.rejectedHasMore };
        }).finally(function () {
            state.rejectedLoading = false;
        });
    };

    global.emsRegRepoHasMoreRejected = function () {
        return state.rejectedHasMore;
    };

    global.emsRegRepoIsRejectedLoading = function () {
        return state.rejectedLoading;
    };

    /** Paginated batch delete — no full collection .get() (E7-S3) */
    global.emsRegRepoClearAllRejected = function () {
        var col = colRef('Rejected');
        var db = getDb();
        if (!col || !db) return Promise.resolve({ deleted: 0 });

        function deleteChunk(lastDoc) {
            var q = col.orderBy('timestamp', 'desc').limit(450);
            if (lastDoc) q = q.startAfter(lastDoc);
            return q.get().then(function (snap) {
                if (snap.empty) return 0;
                var batch = db.batch();
                snap.docs.forEach(function (doc) { batch.delete(doc.ref); });
                return batch.commit().then(function () {
                    var n = snap.size;
                    if (snap.size < 450) return n;
                    return n + deleteChunk(snap.docs[snap.docs.length - 1]);
                });
            });
        }

        return deleteChunk(null).then(function (deleted) {
            state.rejectedById = Object.create(null);
            state.rejectedOrder = [];
            state.rejectedLastDoc = null;
            state.rejectedHasMore = false;
            state.rejectedLoaded = true;
            syncRejectedCache();
            return bumpMeta({ op: 'refresh' }).then(function () { return { deleted: deleted }; });
        });
    };

    /** Desktop diagnostic + manual recovery — bulk-hydrate all Firestore pages into IDB. */
    global.emsRegRepoRebuildLocalCacheFromServer = function (tenantId) {
        tenantId = tenantId || state.tenantId;
        if (!tenantId) {
            return Promise.resolve({ count: 0, source: 'no_tenant', ok: false });
        }
        if (state._rebuildInflight) {
            return state._rebuildInflight;
        }
        if (typeof global.emsRegRepoInit === 'function') {
            global.emsRegRepoInit(tenantId);
        }
        if (typeof global.emsActivateTenantStorage === 'function') {
            global.emsActivateTenantStorage(tenantId);
        }
        var prevAllow = global.EMS_REGISTRATION_ALLOW_SERVER_FETCH;
        global.EMS_REGISTRATION_ALLOW_SERVER_FETCH = true;
        global.EMS_REBUILD_IN_PROGRESS = true;
        state.searchActive = false;
        state.searchResults = null;
        if (typeof global.showToast === 'function') {
            global.showToast('سرور سے مکمل کیش بحال ہو رہی ہے…', 'info');
        }
        state._rebuildInflight = global.emsRegRepoBulkHydrate(tenantId, Infinity, { allowShrink: true }).then(function (res) {
            return persistRepoToIdb({ allowShrink: true }).then(function (persistRes) {
                if (!persistRes || !persistRes.saved) {
                    var persistErr = (persistRes && persistRes.error) || 'idb_persist_failed';
                    if (typeof global.showToast === 'function') {
                        global.showToast('❌ IndexedDB محفوظ نہیں ہوا: ' + persistErr, 'error');
                    }
                    return Object.assign({}, res, {
                        ok: false,
                        error: persistErr,
                        count: state.order.length,
                        memoryCount: state.order.length,
                        idbCount: persistRes && persistRes.idbCount
                    });
                }
                var count = res.count != null ? res.count : state.order.length;
                var ok = count > 0 && res.source !== 'bulk_server_error' && persistRes.saved;
                // Disaster recovery replaces the local set — re-sync the permanent
                // Repository EXACTLY (clear + bulk) so server-side deletions are
                // reflected. This is an explicit recovery action, not a per-change
                // write, so a full re-sync here is intentional and correct.
                return repoMirrorReset(repoListFromState()).then(function () {
                    if (typeof global.emsBroadcastUsersChanged === 'function') {
                        global.emsBroadcastUsersChanged();
                    }
                    if (typeof global.showToast === 'function') {
                        if (ok) {
                            global.showToast('✅ مقامی کیش بحال: ' + count + ' ریکارڈ (IDB: ' + persistRes.idbCount + ')', 'success');
                        } else if (res.error) {
                            global.showToast('❌ کیش بحالی ناکام: ' + res.error, 'error');
                        } else {
                            global.showToast('⚠️ سرور سے کوئی ریکارڈ نہیں ملا', 'warning');
                        }
                    }
                    return Object.assign({}, res, {
                        ok: ok,
                        count: count,
                        memoryCount: state.order.length,
                        idbCount: persistRes.idbCount,
                        idbKey: persistRes.key
                    });
                });
            });
        }).catch(function (err) {
            console.error('[EMS] rebuildLocalCacheFromServer failed', err);
            if (typeof global.showToast === 'function') {
                global.showToast('❌ کیش بحالی ناکام: ' + (err && err.message ? err.message : 'unknown'), 'error');
            }
            return { count: state.order.length, ok: false, error: err && err.message, source: 'rebuild_failed' };
        }).finally(function () {
            global.EMS_REGISTRATION_ALLOW_SERVER_FETCH = prevAllow;
            global.EMS_REBUILD_IN_PROGRESS = false;
            state._rebuildInflight = null;
        });
        return state._rebuildInflight;
    };

    /**
     * Manual disaster recovery — Firestore master → overwrite local IDB + RAM.
     * Only for explicit user-triggered cloud sync (not boot).
     */
    global.emsForceCloudDisasterRecoverySync = function (tenantId, opts) {
        opts = opts || {};
        if (typeof global.emsResolveFirestoreTenantId === 'function') {
            tenantId = tenantId || global.emsResolveFirestoreTenantId();
        } else {
            tenantId = tenantId || state.tenantId;
            if (!tenantId && typeof global.emsGetTenantId === 'function') tenantId = global.emsGetTenantId();
            if (!tenantId) {
                try {
                    var u = firebase.auth().currentUser;
                    if (u && u.uid) tenantId = u.uid;
                } catch (e) { /* ignore */ }
            }
        }
        if (!tenantId) {
            return Promise.resolve({ ok: false, source: 'no_tenant', count: 0 });
        }

        function runRecovery(resolvedTenantId, pathMeta) {
            function ensureFirestoreReady() {
                if (getDb()) return Promise.resolve(true);
                var chain = Promise.resolve();
                if (typeof global.emsEnableOnlineMode === 'function') {
                    chain = global.emsEnableOnlineMode();
                } else if (typeof global.emsLoadCloudStack === 'function') {
                    chain = global.emsLoadCloudStack();
                }
                return chain.then(function () {
                    if (typeof global.emsEnsureFirebaseAuthReady === 'function') {
                        return global.emsEnsureFirebaseAuthReady();
                    }
                    if (typeof global.emsInitFirebase === 'function') {
                        global.emsInitFirebase();
                    }
                    if (typeof global.emsFirestoreEnsureAuthToken === 'function') {
                        return global.emsFirestoreEnsureAuthToken().then(function () { return !!getDb(); });
                    }
                    return !!getDb();
                });
            }
            return ensureFirestoreReady().then(function (dbReady) {
                if (!dbReady) {
                    console.error('[EMS] disaster recovery: Firestore not ready', { tenantId: resolvedTenantId, path: pathMeta });
                    return { ok: false, source: 'firestore_unavailable', count: 0, error: 'Firestore not ready', tenantId: resolvedTenantId, path: pathMeta };
                }
                if (typeof global.emsActivateTenantStorage === 'function') {
                    global.emsActivateTenantStorage(resolvedTenantId);
                }
                global.emsRegRepoReset();
                if (typeof global.emsRegRepoInit === 'function') {
                    global.emsRegRepoInit(resolvedTenantId);
                }
                global.EMS_FORCE_CLOUD_RECOVERY_SYNC = true;
                if (typeof global.showToast === 'function') {
                    global.showToast('کلاؤڈ سے مکمل ڈیٹا ڈاؤن لوڈ: ' + (pathMeta || resolvedTenantId), 'info');
                }
                return global.emsRegRepoRebuildLocalCacheFromServer(resolvedTenantId).then(function (res) {
                    return verifyHydrationMatch(resolvedTenantId).then(function (verify) {
                        if (typeof global.emsPipelineDebug === 'function') {
                            global.emsPipelineDebug('disaster_recovery_sync_done', {
                                tenantId: resolvedTenantId,
                                firestorePath: pathMeta,
                                memoryCount: verify.memoryCount,
                                idbCount: verify.idbCount,
                                matched: verify.matched,
                                ok: !!(res && res.ok)
                            });
                        }
                        if (!verify.matched || verify.memoryCount === 0) {
                            console.error('[EMS] disaster recovery hydration mismatch', verify, res);
                        }
                        return Object.assign({}, res, {
                            memoryCount: verify.memoryCount,
                            idbCount: verify.idbCount,
                            matched: verify.matched,
                            hydrationComplete: verify.matched,
                            source: 'disaster_recovery_sync',
                            tenantId: resolvedTenantId,
                            firestorePath: pathMeta,
                            ok: !!(res && res.ok !== false && verify.memoryCount > 0)
                        });
                    });
                }).catch(function (err) {
                    console.error('[EMS] disaster recovery sync failed', err);
                    return { ok: false, source: 'disaster_recovery_error', count: state.order.length, error: err && err.message, tenantId: resolvedTenantId, firestorePath: pathMeta };
                }).finally(function () {
                    global.EMS_FORCE_CLOUD_RECOVERY_SYNC = false;
                });
            });
        }

        var pathMeta = (typeof global.emsFirestoreRegistrationsPath === 'function')
            ? global.emsFirestoreRegistrationsPath(tenantId)
            : ('All_Madrasas/' + tenantId + '/Registrations');

        if (opts.skipProbe) {
            return runRecovery(tenantId, pathMeta);
        }

        if (typeof global.emsFirestoreFindTenantWithRegistrationData === 'function') {
            return global.emsFirestoreFindTenantWithRegistrationData().then(function (found) {
                var pullTenant = (found && found.hasData && found.tenantId) ? found.tenantId : tenantId;
                var pullPath = (found && found.path) || global.emsFirestoreRegistrationsPath(pullTenant);
                if (found && found.error && !found.hasData) {
                    return { ok: false, source: 'firestore_probe_error', count: 0, error: found.error, tenantId: pullTenant, firestorePath: pullPath };
                }
                if (found && !found.hasData && typeof global.emsPipelineDebug === 'function') {
                    global.emsPipelineDebug('disaster_recovery_empty_probe', {
                        triedTenant: tenantId,
                        resolvedTenant: pullTenant,
                        firestorePath: pullPath,
                        source: found.source
                    });
                }
                return runRecovery(pullTenant, pullPath);
            });
        }

        return runRecovery(tenantId, pathMeta);
    };

    /** Wired alias — replaces offline stub from ems-runtime-mode.js for Pull / DR buttons. */
    global.emsForceFullTenantDownload = function (tenantIdOrOpts) {
        var tenantId = null;
        if (typeof tenantIdOrOpts === 'string') {
            tenantId = tenantIdOrOpts;
        } else if (tenantIdOrOpts && typeof tenantIdOrOpts === 'object') {
            tenantId = tenantIdOrOpts.tenantId || null;
        }
        if (!tenantId && typeof global.emsGetTenantId === 'function') {
            tenantId = global.emsGetTenantId();
        }
        if (!tenantId) {
            try {
                var u = firebase.auth().currentUser;
                if (u && u.uid) tenantId = u.uid;
            } catch (e) { /* ignore */ }
        }
        if (typeof global.emsForceCloudDisasterRecoverySync === 'function') {
            return global.emsForceCloudDisasterRecoverySync(tenantId);
        }
        return Promise.resolve({ ok: false, source: 'offline_only', count: 0 });
    };

    global.emsRegRepoRefreshFirstPage = function () {
        if (!mayFetchFromServer()) {
            return Promise.resolve({ loaded: state.order.length, source: 'refresh_blocked_idb_only' });
        }
        if (isUnlimited()) {
            state.searchActive = false;
            state.searchResults = null;
            state.loading = true;
            return fetchPage('Registrations', getPageSize(), null).then(function (res) {
                if (res.rows.length > 0) {
                    mergeRecordsBatch(res.rows);
                    state.lastDoc = res.last;
                    state.hasMore = res.hasMore;
                    return syncPartialCache().then(function () {
                        return repoMirrorBulk(res.rows);
                    }).then(function () {
                        return { loaded: state.order.length, source: 'refresh_merge' };
                    });
                }
                return { loaded: state.order.length, source: 'refresh_merge' };
            }).catch(function (err) {
                if (typeof global.emsPipelineDebug === 'function') {
                    global.emsPipelineDebug('repo_refresh_failed', { error: err && err.message, kept: state.order.length });
                }
                return { loaded: state.order.length, source: 'refresh_failed' };
            }).finally(function () {
                state.loading = false;
            });
        }

        var backupOrder = state.order.slice();
        var backupById = Object.create(null);
        backupOrder.forEach(function (id) {
            if (state.byId[id]) backupById[id] = state.byId[id];
        });
        state.lastDoc = null;
        state.hasMore = true;
        state.searchActive = false;
        state.searchResults = null;
        state.loading = true;
        return fetchPage('Registrations', getPageSize(), null).then(function (res) {
            if (res.rows.length > 0) {
                state.byId = Object.create(null);
                state.order = [];
                res.rows.forEach(mergeRecord);
                state.lastDoc = res.last;
                state.hasMore = res.hasMore;
                return syncPartialCache().then(function () {
                    // Limited-mode refresh REPLACES the local set with page 1 —
                    // re-sync the Repository exactly to match.
                    return repoMirrorReset(repoListFromState());
                }).then(function () {
                    return { loaded: state.order.length, source: 'refresh' };
                });
            } else if (backupOrder.length > 0) {
                state.byId = backupById;
                state.order = backupOrder;
            }
            return { loaded: state.order.length, source: res.rows.length > 0 ? 'refresh' : 'refresh_kept_backup' };
        }).catch(function (err) {
            if (backupOrder.length > 0) {
                state.byId = backupById;
                state.order = backupOrder;
            }
            if (typeof global.emsPipelineDebug === 'function') {
                global.emsPipelineDebug('repo_refresh_failed', { error: err && err.message, kept: backupOrder.length });
            }
            return { loaded: state.order.length, source: 'refresh_failed' };
        }).finally(function () {
            state.loading = false;
        });
    };

    function searchLocalFromState(query) {
        var q = String(query || '').trim();
        if (q.length < SEARCH_MIN) return [];
        var Q = global.EmsQueryUtils;
        if (Q && typeof Q.pageFromAll === 'function') {
            return Q.pageFromAll(repoListFromState(), {
                offset: 0,
                limit: -1,
                search: {
                    text: q,
                    fields: ['name', 'id', 'cnic', 'phone', 'class', 'fname', 'designation', 'position']
                },
                sort: { field: 'timestamp', dir: 'desc' }
            }).rows;
        }
        var lower = q.toLowerCase();
        var all = state.order.map(function (id) { return state.byId[id]; }).filter(Boolean);
        return all.filter(function (u) {
            var hay = [u.name, u.id, u.cnic, u.phone, u.class, u.fname, u.designation, u.position]
                .map(function (x) { return String(x || '').toLowerCase(); }).join(' ');
            return hay.indexOf(lower) >= 0;
        });
    }

    /** Prefix search — local IDB state when SSOT offline; Firestore when legacy/cloud. */
    global.emsRegRepoSearch = function (query) {
        var q = String(query || '').trim();
        if (q.length < SEARCH_MIN) {
            state.searchActive = false;
            state.searchResults = null;
            return Promise.resolve(null);
        }
        var col = colRef('Registrations');
        if (isRegistrationSsotOffline() || !col) {
            state.searchActive = true;
            var localRows = searchLocalFromState(q);
            state.searchResults = localRows;
            return Promise.resolve(localRows);
        }

        state.searchActive = true;
        var lower = q.toLowerCase();
        var promises = [];

        if (/^(std|tch|stf)-/i.test(q)) {
            promises.push(col.doc(q.toUpperCase()).get().then(function (doc) {
                if (!doc.exists) return [];
                var data = doc.data();
                data.id = data.id || doc.id;
                return [lean(data)];
            }).catch(function () { return []; }));
        }

        promises.push(
            col.orderBy('name').startAt(q).endAt(q + '\uf8ff').limit(CLOUD_QUERY_LIMIT).get()
                .then(function (snap) {
                    var rows = [];
                    snap.forEach(function (doc) {
                        var data = doc.data();
                        data.id = data.id || doc.id;
                        rows.push(lean(data));
                    });
                    return rows;
                }).catch(function () { return []; })
        );

        return Promise.all(promises).then(function (parts) {
            var seen = Object.create(null);
            var merged = [];
            parts.forEach(function (arr) {
                arr.forEach(function (r) {
                    if (!seen[r.id]) {
                        seen[r.id] = true;
                        merged.push(r);
                    }
                });
            });
            merged = merged.filter(function (u) {
                var hay = [u.name, u.id, u.cnic, u.phone, u.class, u.fname]
                    .map(function (x) { return String(x || '').toLowerCase(); }).join(' ');
                return hay.indexOf(lower) >= 0;
            });
            state.searchResults = merged;
            return merged;
        });
    };

    global.emsRegRepoClearSearch = function () {
        state.searchActive = false;
        state.searchResults = null;
    };

    global.emsRegRepoSetSearchResults = function (rows) {
        state.searchActive = true;
        state.searchResults = Array.isArray(rows) ? rows.slice() : [];
    };

    global.emsRegRepoIsSearchActive = function () {
        return !!(state.searchActive && state.searchResults != null);
    };

    global.emsRegRepoGetSearchResults = function () {
        return state.searchResults ? state.searchResults.slice() : [];
    };

    global.emsRegRepoGetList = function (opts) {
        opts = opts || {};
        if (state.searchActive && state.searchResults != null) {
            var sr = state.searchResults;
            if (opts.all === true && isUnlimited()) return sr.slice();
            if (opts.limit) return sr.slice(0, opts.limit);
            if (sr.length > IDB_MIRROR_BATCH && !isUnlimited()) {
                return sr.slice(0, IDB_MIRROR_BATCH);
            }
            return sr.slice();
        }
        var list = regRepoListCacheTouch();
        if (opts.all === true && isUnlimited()) return list.slice();
        if (opts.limit) return list.slice(0, opts.limit);
        if (list.length > IDB_MIRROR_BATCH && !isUnlimited()) {
            return list.slice(0, IDB_MIRROR_BATCH);
        }
        return list.slice();
    };

    /** Read-only cached view — do not mutate returned array. */
    global.emsRegRepoGetListReadonly = function () {
        if (state.searchActive && state.searchResults != null) return state.searchResults;
        return regRepoListCacheTouch();
    };

    global.emsRegRepoGetRejectedList = function () {
        return state.rejectedOrder.map(function (id) { return state.rejectedById[id]; });
    };

    global.emsRegRepoHasMore = function () {
        return state.hasMore && !state.searchActive;
    };

    global.emsRegRepoIsLoading = function () {
        return state.loading;
    };

    function fetchRegRecordFromCloud(id, fromRejected, forceRefresh) {
        if (fromRejected) {
            var rcol = colRef('Rejected');
            if (!rcol) return Promise.resolve(null);
            var rOpts = forceRefresh ? { source: 'server' } : undefined;
            return rcol.doc(id).get(rOpts).then(function (doc) {
                if (!doc.exists) return null;
                var data = doc.data();
                data.id = data.id || doc.id;
                var rec = lean(data);
                mergeRejected(rec);
                syncRejectedCache();
                return rec;
            });
        }
        var col = colRef('Registrations');
        if (!col) return Promise.resolve(null);
        var opts = forceRefresh ? { source: 'server' } : undefined;
        return col.doc(id).get(opts).then(function (doc) {
            if (!doc.exists) return null;
            var data = doc.data();
            data.id = data.id || doc.id;
            var rec = lean(data);
            mergeRecord(rec);
            return syncPartialCache().then(function () {
                return repoMirrorPut(rec).then(function () { return rec; });
            });
        });
    }

    function legacyRegRecordFallback(id, fromRejected) {
        if (global.EMS_REG_LEGACY_READ_FALLBACK !== true) return Promise.resolve(null);
        try {
            var key = fromRejected ? REJECTED_KEY : USERS_KEY;
            var raw = typeof global.emsCacheGet === 'function'
                ? global.emsCacheGet(key, [])
                : JSON.parse(localStorage.getItem(key) || '[]');
            if (!Array.isArray(raw)) return Promise.resolve(null);
            for (var i = 0; i < raw.length; i++) {
                if (raw[i] && raw[i].id === id) return Promise.resolve(raw[i]);
            }
        } catch (e) { /* ignore */ }
        return Promise.resolve(null);
    }

    global.emsRegRepoGetById = function (id, fromRejected, forceRefresh) {
        if (!id) return Promise.resolve(null);
        if (fromRejected) {
            if (!forceRefresh && state.rejectedById[id]) return Promise.resolve(state.rejectedById[id]);
            if (isRegistrationSsotOffline() && global.EMS_OFFLINE_ONLY === true) {
                return legacyRegRecordFallback(id, true);
            }
            return fetchRegRecordFromCloud(id, true, forceRefresh)
                .then(function (rec) { return rec || legacyRegRecordFallback(id, true); });
        }
        if (!forceRefresh && state.byId[id]) return Promise.resolve(state.byId[id]);
        if (isRegistrationSsotOffline() && !forceRefresh) {
            return repoMirrorGetById(id).then(function (rec) {
                if (rec) {
                    mergeRecord(rec);
                    return rec;
                }
                if (global.EMS_OFFLINE_ONLY === true) {
                    return legacyRegRecordFallback(id, false);
                }
                return fetchRegRecordFromCloud(id, false, forceRefresh)
                    .then(function (cloudRec) { return cloudRec || legacyRegRecordFallback(id, false); });
            });
        }
        return fetchRegRecordFromCloud(id, false, forceRefresh)
            .then(function (rec) { return rec || legacyRegRecordFallback(id, false); });
    };

    /** Unified SSOT read — RAM → IDB mirror → cloud (legacy only if EMS_REG_LEGACY_READ_FALLBACK). */
    global.emsRegGetRecordById = function (id, opts) {
        opts = opts || {};
        var fromRejected = !!opts.fromRejected;
        if (!id) return Promise.resolve(null);
        if (fromRejected && state.rejectedById[id]) return Promise.resolve(state.rejectedById[id]);
        if (!fromRejected && state.byId[id]) return Promise.resolve(state.byId[id]);
        return global.emsRegRepoGetById(id, fromRejected, !!opts.forceRefresh);
    };

    global.emsRegRepoUpsert = function (user, fromRejected) {
        if (!user || !user.id) return Promise.resolve({ saved: false });
        if (!state.tenantId) {
            var tid = typeof global.emsGetTenantId === 'function' ? global.emsGetTenantId() : null;
            if (!tid && typeof global.emsRequireTenantId === 'function') {
                tid = global.emsRequireTenantId();
            }
            if (tid) global.emsRegRepoInit(tid);
        }
        var chain;
        if (fromRejected) {
            mergeRejected(user);
            chain = syncRejectedCache();
            // A record moving into the rejected set must not linger in the
            // approved mirror — one targeted remove (no full rewrite).
            chain = chain.then(function (res) {
                return repoMirrorRemove(user.id).then(function () { return res; });
            });
        } else {
            mergeRecord(user);
            chain = syncPartialCache();
            // Single approved record → single put into the permanent Repository.
            chain = chain.then(function (res) {
                return repoMirrorPut(state.byId[user.id] || user).then(function () { return res; });
            });
        }
        return chain.then(function (res) {
            bumpMetaLocal();
            if (typeof global.emsBroadcastUsersChanged === 'function') {
                global.emsBroadcastUsersChanged();
            }
            return res;
        });
    };

    global.emsRegRepoRemove = function (id, fromRejected) {
        if (!id) return Promise.resolve({ saved: false });
        var chain;
        if (fromRejected) {
            delete state.rejectedById[id];
            state.rejectedOrder = state.rejectedOrder.filter(function (x) { return x !== id; });
            chain = syncRejectedCache();
        } else {
            delete state.byId[id];
            state.order = state.order.filter(function (x) { return x !== id; });
            chain = syncPartialCache();
            // Single approved record → single remove from the permanent Repository.
            chain = chain.then(function (res) {
                return repoMirrorRemove(id).then(function () { return res; });
            });
        }
        return chain.then(function (res) {
            bumpMetaLocal();
            if (typeof global.emsBroadcastUsersChanged === 'function') {
                global.emsBroadcastUsersChanged();
            }
            return res;
        });
    };

    function isRegistrationSsotOffline() {
        if (global.EMS_REGISTRATION_LEGACY_FIRESTORE === true) return false;
        if (global.EMS_REGISTRATION_SSOT_OFFLINE === false) return false;
        return true;
    }

    global.emsRegRepoIsSsotOffline = isRegistrationSsotOffline;

    function maxIdNumFromState(type) {
        var prefix = type === 'student' ? 'STD' : type === 'teacher' ? 'TCH' : 'STF';
        var maxNum = 0;
        function scanRec(rec) {
            if (!rec || rec.type !== type) return;
            var id = rec.id;
            if (!id) return;
            var parts = String(id).split('-');
            if (parts.length > 1 && parts[0] === prefix) {
                var num = parseInt(parts[1], 10);
                if (!isNaN(num) && num > maxNum) maxNum = num;
            }
        }
        state.order.forEach(function (id) { scanRec(state.byId[id]); });
        state.rejectedOrder.forEach(function (id) { scanRec(state.rejectedById[id]); });
        return maxNum;
    }

    global.emsRegRepoFetchMaxIdNum = function (type) {
        var prefix = type === 'student' ? 'STD' : type === 'teacher' ? 'TCH' : 'STF';
        var localMax = maxIdNumFromState(type);
        if (isRegistrationSsotOffline()) {
            return Promise.resolve(localMax);
        }
        var col = colRef('Registrations');
        if (!col) return Promise.resolve(localMax);
        return col.where('type', '==', type).orderBy('timestamp', 'desc').limit(200).get()
            .then(function (snap) {
                var maxNum = localMax;
                snap.forEach(function (doc) {
                    var data = doc.data();
                    var id = data.id || doc.id;
                    var parts = String(id).split('-');
                    if (parts.length > 1 && parts[0] === prefix) {
                        var num = parseInt(parts[1], 10);
                        if (!isNaN(num) && num > maxNum) maxNum = num;
                    }
                });
                return maxNum;
            }).catch(function () { return localMax; });
    };

    /**
     * SSOT save — IndexedDB (repo) first, then sync queue → Firebase.
     * admission.js must use this when EMS_REGISTRATION_SSOT_OFFLINE is enabled.
     */
    global.emsRegRepoPersistRegistration = function (user, opts) {
        opts = opts || {};
        var tenantId = opts.tenantId || state.tenantId;
        if (!user || !user.id) {
            return Promise.resolve({ ok: false, reason: 'invalid_user' });
        }
        if (tenantId && !state.tenantId && typeof global.emsRegRepoInit === 'function') {
            global.emsRegRepoInit(tenantId);
        }
        var leanUser = lean(user);
        var status = opts.status;
        var currentEditingId = opts.currentEditingId;
        var isEditingRejected = opts.isEditingRejected;
        var chain = Promise.resolve();

        if (status === 'approved') {
            chain = global.emsRegRepoUpsert(leanUser, false);
            if (currentEditingId && isEditingRejected) {
                chain = chain.then(function () {
                    return global.emsRegRepoRemove(currentEditingId, true);
                });
            } else if (currentEditingId && currentEditingId !== user.id) {
                chain = chain.then(function () {
                    return global.emsRegRepoRemove(currentEditingId, false);
                });
            }
        } else {
            chain = global.emsRegRepoUpsert(leanUser, true);
            if (currentEditingId && !isEditingRejected) {
                chain = chain.then(function () {
                    return global.emsRegRepoRemove(currentEditingId, false);
                });
            }
        }

        return chain.then(function (idbRes) {
            if (typeof global.emsOfflinePersistRegistration !== 'function') {
                return {
                    ok: true,
                    idb: idbRes,
                    synced: false,
                    offline: true,
                    source: 'repo_idb_only'
                };
            }
            var firestoreDoc = typeof global.emsPrepareFirestoreUserDoc === 'function'
                ? global.emsPrepareFirestoreUserDoc(user)
                : user;
            return global.emsOfflinePersistRegistration(firestoreDoc, {
                enqueueOnly: true,
                status: status,
                type: opts.type,
                tenantId: tenantId,
                currentEditingId: currentEditingId,
                isEditingRejected: isEditingRejected,
                merge: !!(currentEditingId && !isEditingRejected && status === 'approved')
            }).then(function (syncRes) {
                return Object.assign({ ok: !!(syncRes && syncRes.ok !== false), idb: idbRes }, syncRes || {});
            });
        });
    };

    /** SSOT delete — repo/IDB first, then sync queue. */
    global.emsRegRepoDeleteRegistration = function (id, fromRejected) {
        if (!id) return Promise.resolve({ ok: false, reason: 'invalid_id' });
        return global.emsRegRepoRemove(id, !!fromRejected).then(function (idbRes) {
            if (typeof global.emsOfflineDeleteRegistration !== 'function') {
                return { ok: true, idb: idbRes, synced: false, offline: true };
            }
            return global.emsOfflineDeleteRegistration(id, !!fromRejected).then(function (syncRes) {
                return Object.assign({ ok: !!(syncRes && syncRes.ok !== false), idb: idbRes }, syncRes || {});
            });
        });
    };

    /** Level-2 class roster — lean fields only (P3). */
    global.emsRegRepoFetchClassRoster = function (className, opts) {
        opts = opts || {};
        var limit = Math.max(1, opts.limit || getPageSize());
        var col = colRef('Registrations');
        if (!col || !className) return Promise.resolve([]);
        var q = col.where('type', '==', 'student').where('class', '==', className).limit(limit);
        return q.get().then(function (snap) {
            var rows = [];
            snap.forEach(function (doc) {
                var data = doc.data();
                rows.push({
                    id: data.id || doc.id,
                    name: data.name || '',
                    rollNo: data.rollNo || data.roll || '',
                    class: data.class || className
                });
            });
            return rows;
        }).catch(function () { return []; });
    };

    global.emsRegRepoStop = function () {
        global.emsRegRepoReset();
        state.tenantId = null;
    };

})(typeof window !== 'undefined' ? window : globalThis);
