// ============================================================================
// EMS Offline Write — local-first persist + mutation outbox (Phase B)
// Attendance keys: att_rec_*  |  Cloud push via emsCloudEmitMutation only
// ============================================================================
(function (global) {
    'use strict';

    var IDB_NAME = 'EMS_OfflineWriteDB';
    var IDB_VER = 3;
    var STORE = 'queue';
    var DEAD_LETTER_STORE = 'dead_letter';
    var MAX_FLUSH_RETRIES = 5;
    var BACKOFF_BASE_MS = 2000;
    var BACKOFF_MAX_MS = 120000;
    var LEGACY_MIGRATE_FLAG = 'ems_unified_outbox_migrated_v2';
    var ATT_INDEX_KEY = 'ems_att_keys_index';
    var _queueDocIdMap = Object.create(null);
    var _queueMapLoaded = false;
    var _syncFailureState = { failed: 0, pending: 0, deadLetter: 0, lastError: null };

    function computeBackoffMs(retryCount) {
        var n = Math.max(0, (retryCount || 1) - 1);
        return Math.min(BACKOFF_BASE_MS * Math.pow(2, n), BACKOFF_MAX_MS);
    }

    function isSoftCloudCode(code) {
        return code === 'TENANT_PENDING' || code === 'TENANT_MISMATCH' || code === 'TENANT_REQUIRED';
    }

    function isHardCloudCode(code) {
        return code === 'PERMISSION_DENIED' || code === 'permission-denied'
            || code === 'VERSION_CONFLICT' || code === 'FLUSH_ERROR' || code === 'INVALID_ROW';
    }

    /**
     * Explicit save/cloud result contract.
     * localSaved, cloudState, synced, queued, offline, error, code
     * Never reports synced without confirmation. Never drops error/code.
     */
    function normalizeCloudResult(res, extras) {
        extras = extras || {};
        res = res || {};
        var code = res.code || '';
        var error = res.error || res.reason || '';
        var synced = !!res.synced;
        var skipped = !!res.skipped;
        var localSaved = extras.localSaved != null
            ? !!extras.localSaved
            : (res.localSaved != null ? !!res.localSaved : res.local !== false);
        var cloudState;
        if (synced) {
            cloudState = 'synced';
        } else if (code === 'VERSION_CONFLICT') {
            cloudState = 'conflict';
        } else if (isHardCloudCode(code) && !isSoftCloudCode(code)) {
            cloudState = code === 'VERSION_CONFLICT' ? 'conflict' : 'failed';
        } else if (res.ok === false && !isSoftCloudCode(code) && !res.queued && !res.offline && !skipped) {
            cloudState = 'failed';
        } else if (res.offline && !isHardCloudCode(code)) {
            cloudState = 'offline';
        } else {
            cloudState = 'queued';
        }
        return {
            localSaved: localSaved,
            cloudState: cloudState,
            synced: cloudState === 'synced',
            queued: cloudState === 'queued',
            offline: cloudState === 'offline',
            error: error,
            code: code,
            ok: localSaved,
            reason: res.reason || error,
            docId: extras.docId || res.docId,
            type: extras.type || res.type
        };
    }

    global.emsNormalizeCloudResult = normalizeCloudResult;

    function isAttendanceQueueType(type) {
        return type === 'attendance' || type === 'attendance_patch';
    }

    function defaultQueueTenantId(type) {
        return isAttendanceQueueType(type) ? getVerifiedAttendanceTenantId() : getTenantId();
    }

    function queueMapKey(type, docId, tenantId) {
        return String(tenantId || '') + '|' + String(type) + '|' + String(docId);
    }

    function queueRowsSameIdentity(a, b) {
        if (!a || !b) return false;
        return String(a.type) === String(b.type)
            && String(a.docId) === String(b.docId)
            && String(a.tenantId || '') === String(b.tenantId || '');
    }

    function rowBelongsToActiveTenant(row) {
        if (!row || !row.tenantId) return false;
        var isAtt = isAttendanceQueueType(row.type);
        var active = isAtt ? getVerifiedAttendanceTenantId() : getTenantId();
        if (!active) return false;
        return String(row.tenantId) === String(active);
    }

    function rowEligibleForFlush(row, opts) {
        opts = opts || {};
        if (!row) return false;
        if (!rowBelongsToActiveTenant(row)) return false;
        if (opts.force === true) return true;
        if (row.deadLetter === true) return false;
        if (row.failed && row.nextRetryAt && row.nextRetryAt > Date.now()) return false;
        return true;
    }

    function stampCloudVersion(payload) {
        if (global.EmsUtils && typeof global.EmsUtils.stampCloudVersion === 'function') {
            return global.EmsUtils.stampCloudVersion(payload);
        }
        if (!payload || typeof payload !== 'object') return payload;
        var out = Object.assign({}, payload);
        out.clientUpdatedAt = Date.now();
        out._version = (typeof out._version === 'number' ? out._version : 0) + 1;
        return out;
    }

    function flushOp(promise, ctx) {
        return promise.then(function () { return { ok: true }; }).catch(function (err) {
            var msg = err && err.message ? err.message : String(err);
            var code = err && err.code ? err.code : 'FLUSH_ERROR';
            console.error('[EMS] cloud flush failed', ctx, { code: code, message: msg });
            return { ok: false, error: msg, code: code };
        });
    }

    function checkRemoteVersion(ref, payload, opts) {
        opts = opts || {};
        if (opts.forceLocal) return Promise.resolve({ ok: true, proceed: true });
        return ref.get({ source: 'server' }).then(function (snap) {
            if (!snap.exists) return { ok: true, proceed: true };
            var remote = snap.data() || {};
            var remoteAt = remote.clientUpdatedAt || 0;
            var localAt = (payload && payload.clientUpdatedAt) || 0;
            if (remoteAt > localAt) {
                return {
                    ok: false,
                    proceed: false,
                    error: 'Cloud copy is newer (clientUpdatedAt ' + remoteAt + ' > ' + localAt + ')',
                    code: 'VERSION_CONFLICT'
                };
            }
            return { ok: true, proceed: true };
        }).catch(function (err) {
            return {
                ok: false,
                proceed: false,
                error: err && err.message ? err.message : String(err),
                code: err && err.code ? err.code : 'VERSION_READ_ERROR'
            };
        });
    }

    function notifySyncFailureUI(detail) {
        if (typeof global.emsSyncFailureRefreshUi === 'function') {
            try { global.emsSyncFailureRefreshUi(detail || {}); } catch (eUi) { /* ignore */ }
        }
        try {
            global.dispatchEvent(new CustomEvent('ems:sync-failure', { detail: detail || {} }));
        } catch (eEv) { /* ignore */ }
    }

    function refreshSyncFailureCounts() {
        return Promise.all([listQueue(), listDeadLetter()]).then(function (parts) {
            var rows = (parts[0] || []).filter(rowBelongsToActiveTenant);
            var deadRows = (parts[1] || []).filter(rowBelongsToActiveTenant);
            var failed = 0;
            rows.forEach(function (r) { if (r && r.failed) failed++; });
            _syncFailureState.failed = failed;
            _syncFailureState.pending = rows.length;
            _syncFailureState.deadLetter = deadRows.length;
            return { failed: failed, pending: rows.length, deadLetter: deadRows.length, rows: rows };
        });
    }

    function moveToDeadLetter(row, res) {
        if (!row) return Promise.resolve();
        var entry = Object.assign({}, row, {
            deadLetter: true,
            deadLetterAt: Date.now(),
            lastError: (res && res.error) || row.lastError || 'flush_failed',
            lastErrorCode: (res && res.code) || row.lastErrorCode || 'FLUSH_ERROR'
        });
        return openQueueIdb().then(function (idb) {
            return new Promise(function (resolve, reject) {
                var tx = idb.transaction([STORE, DEAD_LETTER_STORE], 'readwrite');
                tx.objectStore(DEAD_LETTER_STORE).add(entry);
                if (row.id != null) tx.objectStore(STORE).delete(row.id);
                tx.oncomplete = function () {
                    if (row.type && row.docId != null) {
                        delete _queueDocIdMap[queueMapKey(row.type, row.docId, row.tenantId)];
                    }
                    resolve();
                };
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    function markRowFailed(row, res) {
        if (!row) return Promise.resolve();
        row.retryCount = (row.retryCount || 0) + 1;
        row.failed = true;
        row.lastError = (res && res.error) || 'flush_failed';
        row.lastErrorCode = (res && res.code) || 'FLUSH_ERROR';
        row.failedAt = Date.now();
        _syncFailureState.lastError = row.lastError;
        if (row.retryCount >= MAX_FLUSH_RETRIES) {
            console.error('[EMS] row moved to dead-letter after max retries', row.type, row.docId, row.lastError);
            return moveToDeadLetter(row, res).then(function () {
                return refreshSyncFailureCounts().then(function (counts) {
                    notifySyncFailureUI({
                        failed: counts.failed,
                        pending: counts.pending,
                        deadLetter: counts.deadLetter,
                        docId: row.docId,
                        type: row.type,
                        error: row.lastError,
                        code: row.lastErrorCode,
                        deadLettered: true
                    });
                });
            });
        }
        row.nextRetryAt = Date.now() + computeBackoffMs(row.retryCount);
        return upsertQueueByDocId(row.type, row.docId, row);
    }

    function getTenantId() {
        if (global.CURRENT_MADRASA_TENANT_ID) return global.CURRENT_MADRASA_TENANT_ID;
        if (typeof global.emsGetTenantId === 'function') {
            var t = global.emsGetTenantId();
            if (t) return t;
        }
        try {
            if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) {
                return firebase.auth().currentUser.uid;
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    /** Attendance only — never substitute auth.uid for linked teacher/staff Gmail accounts. */
    function getVerifiedAttendanceTenantId() {
        if (typeof global.emsGetTenantId === 'function') {
            var t = global.emsGetTenantId();
            if (t) return t;
        }
        if (global.CURRENT_MADRASA_TENANT_ID) return global.CURRENT_MADRASA_TENANT_ID;
        if (global.EMS_ACTIVE_TENANT_ID) return global.EMS_ACTIVE_TENANT_ID;
        return null;
    }

    global.emsGetVerifiedAttendanceTenantId = getVerifiedAttendanceTenantId;

    function getDb() {
        return typeof global.getDbOrNull === 'function' ? global.getDbOrNull() : null;
    }

    function tenantDocRef(db, tid) {
        tid = tid || getTenantId();
        if (typeof global.emsFirestoreTenantDocRef === 'function') {
            return global.emsFirestoreTenantDocRef(db, tid);
        }
        if (!db || !tid) return null;
        var root = typeof global.emsGetTenantRootCollection === 'function'
            ? global.emsGetTenantRootCollection()
            : 'All_Madrasas';
        return db.collection(root).doc(tid);
    }

    function canCloudWrite(opts) {
        opts = opts || {};
        if (global.EMS_OFFLINE_ONLY === true) return false;
        if (!getDb() || !getTenantId()) return false;
        if (typeof global.emsMayPushToCloud === 'function') {
            if (opts.manual) return global.emsMayPushToCloud({ manual: true });
            if (opts.force) return global.emsMayPushToCloud({ force: true });
            return global.emsMayPushToCloud({ mutation: true });
        }
        if (typeof global.emsIsNetworkAvailable === 'function') {
            return global.emsIsNetworkAvailable();
        }
        return !!(global.navigator && global.navigator.onLine);
    }

    global.emsOfflineCanMutationPush = canCloudWrite;

    function readRaw(key) {
        if (typeof global.emsIsLargeBlobKey === 'function' && global.emsIsLargeBlobKey(key)) {
            if (typeof global.emsDurableReadRaw === 'function') {
                return global.emsDurableReadRaw(key);
            }
        }
        if (typeof global.emsSafeLocalGet === 'function') return global.emsSafeLocalGet(key);
        if (global._emsOriginalGetItem) return global._emsOriginalGetItem.call(localStorage, key);
        return localStorage.getItem(key);
    }

    function attIndexStorageKey() {
        if (typeof global.emsResolveCacheKey === 'function') {
            return global.emsResolveCacheKey('ems_att_keys_index');
        }
        var tid = getVerifiedAttendanceTenantId();
        return tid ? ('ems_t_' + tid + '__ems_att_keys_index') : null;
    }

    function attIndexRead() {
        try {
            var storageKey = attIndexStorageKey();
            if (!storageKey) return [];
            var raw = readRaw(storageKey);
            if (!raw) return [];
            var parsed = JSON.parse(raw);
            var keys = Array.isArray(parsed) ? parsed : [];
            var tid = getVerifiedAttendanceTenantId();
            if (!tid) return [];
            return keys.filter(function (key) {
                return key && key.indexOf('att_rec_' + tid + '_') === 0;
            });
        } catch (e) { return []; }
    }

    function attIndexWrite(keys) {
        var storageKey = attIndexStorageKey();
        if (!storageKey) return;
        try {
            var str = JSON.stringify(keys || []);
            if (typeof global.emsDurableWriteRaw === 'function') {
                global.emsDurableWriteRaw(storageKey, str);
            } else if (global._emsOriginalSetItem) {
                global._emsSuppressSync = true;
                global._emsOriginalSetItem.call(localStorage, storageKey, str);
                global._emsSuppressSync = false;
            } else {
                localStorage.setItem(storageKey, str);
            }
        } catch (e) { /* quota */ }
    }

    /** Local att_rec index — invalidate helper SSOT cache when a new key is tracked. */
    function attIndexAddKey(key) {
        var invalidateHelper = global.emsAttOfflineKeyIndexInvalidate;
        if (!key || key.indexOf('att_rec_') !== 0) return;
        if (!getVerifiedAttendanceTenantId()) return;
        if (typeof global.emsIsActiveTenantAttendanceKey === 'function'
            && !global.emsIsActiveTenantAttendanceKey(key)) return;
        var idx = attIndexRead();
        if (idx.indexOf(key) >= 0) return;
        idx.push(key);
        attIndexWrite(idx);
        if (typeof invalidateHelper === 'function') invalidateHelper();
    }

    function attIndexRebuildFromStorage() {
        var tid = getVerifiedAttendanceTenantId();
        var keys = [];
        if (!tid) return keys;
        var prefix = 'att_rec_' + tid + '_';
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k && k.indexOf(prefix) === 0) keys.push(k);
            }
        } catch (e) { /* ignore */ }
        if (keys.length) attIndexWrite(keys);
        return keys;
    }

    function resolveOfflinePhysicalKey(key) {
        if (!key) return null;
        if (typeof global.emsResolvePhysicalWriteKey === 'function') {
            return global.emsResolvePhysicalWriteKey(key);
        }
        if (typeof global.emsIsTenantDataKey === 'function'
            && global.emsIsTenantDataKey(key)
            && typeof global.emsResolveCacheKey === 'function') {
            return global.emsResolveCacheKey(key) || null;
        }
        return key;
    }

    function writeLocal(key, data) {
        var physicalKey = resolveOfflinePhysicalKey(key);
        if (!physicalKey) {
            return Promise.resolve({ ok: false, reason: 'NO_TENANT_PARTITION', key: key });
        }
        var str = typeof data === 'string' ? data : JSON.stringify(data);
        if (typeof global.emsIsLargeBlobKey === 'function' && global.emsIsLargeBlobKey(key)) {
            if (typeof global.emsDurableWriteRaw === 'function') {
                global.emsDurableWriteRaw(physicalKey, str);
                if (typeof global.emsCacheInvalidate === 'function') global.emsCacheInvalidate(key);
                return Promise.resolve({ ok: true, key: key, physicalKey: physicalKey });
            }
        }
        if (global._emsOriginalSetItem) {
            global._emsSuppressSync = true;
            global._emsOriginalSetItem.call(localStorage, physicalKey, str);
            global._emsSuppressSync = false;
        } else {
            try { localStorage.setItem(physicalKey, str); } catch (e) { /* quota */ }
        }
        if (typeof global.emsCacheInvalidate === 'function') global.emsCacheInvalidate(key);
        var idb = (typeof global.emsIdbKvSet === 'function')
            ? global.emsIdbKvSet(physicalKey, str)
            : Promise.resolve(false);
        return idb.then(function () { return { ok: true, key: key, physicalKey: physicalKey }; });
    }

    /** Synchronous local write — survives immediate tab/app close. */
    global.emsOfflineWriteLocalSync = function (key, data) {
        if (!key) return false;
        var physicalKey = resolveOfflinePhysicalKey(key);
        if (!physicalKey) {
            console.warn('[EMS] offline local sync write blocked — no tenant partition for', key);
            return false;
        }
        var str = typeof data === 'string' ? data : JSON.stringify(data);
        try {
            if (typeof global.emsIsLargeBlobKey === 'function' && global.emsIsLargeBlobKey(key)) {
                if (typeof global.emsDurableWriteRaw === 'function') {
                    global.emsDurableWriteRaw(physicalKey, str);
                }
            } else if (global._emsOriginalSetItem) {
                global._emsSuppressSync = true;
                global._emsOriginalSetItem.call(localStorage, physicalKey, str);
                global._emsSuppressSync = false;
            } else {
                localStorage.setItem(physicalKey, str);
            }
            if (typeof global.emsCacheInvalidate === 'function') global.emsCacheInvalidate(key);
            if (typeof global.emsInvalidateAttDashboardCache === 'function') {
                global.emsInvalidateAttDashboardCache();
            }
            if (physicalKey.indexOf('att_rec_') === 0) {
                attIndexAddKey(physicalKey);
            }
            if (typeof global.emsIdbKvSet === 'function' && !(typeof global.emsIsLargeBlobKey === 'function' && global.emsIsLargeBlobKey(key))) {
                global.emsIdbKvSet(physicalKey, str);
            }
            return true;
        } catch (e) {
            console.warn('[EMS] offline local sync write failed', key, e);
            return false;
        }
    };

    global.emsAttCloudDocId = function (month, type, classId, period) {
        var s = attOfflineNormalizeScope(month, type, classId, period);
        return 'att_rec_' + s.month + '_' + s.type + '_' + s.classId + '_' + (s.period || 'all');
    };

    global.emsAttLocalStorageKey = function (tenantId, month, type, classId, period) {
        var tid = tenantId || getVerifiedAttendanceTenantId();
        if (!tid) return null;
        var s = attOfflineNormalizeScope(month, type, classId, period);
        return 'att_rec_' + tid + '_' + s.month + '_' + s.type + '_' + s.classId + '_' + (s.period || 'all');
    };

    function attOfflineNormalizeScope(month, type, classId, period) {
        if (typeof global.attNormalizeStorageScope === 'function') {
            return global.attNormalizeStorageScope(month, type, classId, period);
        }
        type = type || 'students';
        classId = classId != null ? String(classId) : '';
        period = period || 'all';
        if (type === 'teachers' || type === 'staff') {
            return { month: month, type: type, classId: '', period: 'all' };
        }
        return { month: month, type: type, classId: classId, period: period };
    }

    global.emsAttResolveLocalKey = function (tenantId, month, type, classId, period) {
        var scoped = global.emsAttLocalStorageKey(tenantId, month, type, classId, period);
        if (!scoped) return null;
        return scoped;
    };

    global.emsIsActiveTenantAttendanceKey = function (key, tenantId) {
        tenantId = tenantId || getVerifiedAttendanceTenantId();
        return !!(key && tenantId && key.indexOf('att_rec_' + tenantId + '_') === 0);
    };

    /**
     * Safe one-time import of pre-isolation attendance. It runs only when the
     * persisted tenant already matched the verified active tenant at activation.
     * Unknown legacy sheets are retained but never read by any live screen.
     */
    global.emsMigrateLegacyAttendanceForTenant = function (tenantId) {
        tenantId = tenantId || getVerifiedAttendanceTenantId();
        if (!tenantId || global.EMS_TENANT_LEGACY_MIGRATION_ALLOWED !== true) {
            return Promise.resolve({ migrated: 0, deferred: true });
        }
        var flag = 'ems_att_tenant_migration_v2__' + tenantId;
        if (readRaw(flag) === '1') return Promise.resolve({ migrated: 0, done: true });
        var list = typeof global.emsIdbKvKeysByPrefix === 'function'
            ? global.emsIdbKvKeysByPrefix('att_rec_')
            : Promise.resolve([]);
        return list.then(function (keys) {
            var legacy = (keys || []).filter(function (key) {
                return /^att_rec_\d{4}-\d{2}_/.test(key);
            });
            return Promise.all(legacy.map(function (oldKey) {
                return Promise.resolve(readRaw(oldKey)).then(function (raw) {
                    if (raw == null) return false;
                    var scoped = 'att_rec_' + tenantId + '_' + oldKey.slice('att_rec_'.length);
                    if (readRaw(scoped) != null) return false;
                    return writeLocal(scoped, raw).then(function () { return true; });
                });
            }));
        }).then(function (results) {
            var migrated = (results || []).filter(Boolean).length;
            writeLocal(flag, '1');
            if (typeof global.emsAttOfflineKeyIndexInvalidate === 'function') {
                global.emsAttOfflineKeyIndexInvalidate();
            }
            return { migrated: migrated, done: true };
        });
    };

    if (global.addEventListener) {
        global.addEventListener('ems:tenant-storage-ready', function (event) {
            var tenantId = event && event.detail && event.detail.tenantId;
            global.emsMigrateLegacyAttendanceForTenant(tenantId);
        });
    }

    function parseLocal(raw) {
        if (raw == null) return null;
        if (typeof raw !== 'string') return raw;
        try { return JSON.parse(raw); } catch (e) { return null; }
    }

    function ensureQueueStoreIndexes(store) {
        if (!store.indexNames.contains('type')) store.createIndex('type', 'type', { unique: false });
        if (!store.indexNames.contains('docId')) store.createIndex('docId', 'docId', { unique: false });
        if (!store.indexNames.contains('tenantId')) store.createIndex('tenantId', 'tenantId', { unique: false });
        if (!store.indexNames.contains('tenantTypeDoc')) {
            store.createIndex('tenantTypeDoc', ['tenantId', 'type', 'docId'], { unique: false });
        }
    }

    function openQueueIdb() {
        return new Promise(function (resolve, reject) {
            var req = indexedDB.open(IDB_NAME, IDB_VER);
            req.onupgradeneeded = function (e) {
                var idb = e.target.result;
                var tx = e.target.transaction;
                if (!idb.objectStoreNames.contains(STORE)) {
                    ensureQueueStoreIndexes(idb.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true }));
                } else {
                    ensureQueueStoreIndexes(tx.objectStore(STORE));
                }
                if (!idb.objectStoreNames.contains(DEAD_LETTER_STORE)) {
                    ensureQueueStoreIndexes(idb.createObjectStore(DEAD_LETTER_STORE, { keyPath: 'id', autoIncrement: true }));
                } else {
                    ensureQueueStoreIndexes(tx.objectStore(DEAD_LETTER_STORE));
                }
            };
            req.onsuccess = function (e) { resolve(e.target.result); };
            req.onerror = function () { reject(req.error); };
        });
    }

    function ensureQueueDocIdMap() {
        if (_queueMapLoaded) return listQueue().then(function () { return _queueDocIdMap; });
        _queueMapLoaded = true;
        return listQueue().then(function (rows) {
            (rows || []).forEach(function (r) {
                if (r && r.type && r.docId != null && r.id != null) {
                    _queueDocIdMap[queueMapKey(r.type, r.docId, r.tenantId)] = r.id;
                }
            });
            return _queueDocIdMap;
        });
    }

    function findQueueRowByDocId(type, docId, tenantId) {
        var hitId = _queueDocIdMap[queueMapKey(type, docId, tenantId)];
        if (hitId != null) {
            return openQueueIdb().then(function (idb) {
                return new Promise(function (resolve, reject) {
                    var tx = idb.transaction(STORE, 'readonly');
                    var req = tx.objectStore(STORE).get(hitId);
                    req.onsuccess = function () {
                        var row = req.result || null;
                        if (row && queueRowsSameIdentity(row, { type: type, docId: docId, tenantId: tenantId })) {
                            resolve(row);
                            return;
                        }
                        resolve(null);
                    };
                    req.onerror = function () { reject(req.error); };
                });
            }).catch(function () {
                return { id: hitId, type: type, docId: docId, tenantId: tenantId };
            });
        }
        return openQueueIdb().then(function (idb) {
            return new Promise(function (resolve, reject) {
                var tx = idb.transaction(STORE, 'readonly');
                var store = tx.objectStore(STORE);
                var finish = function (rows) {
                    var tid = String(tenantId || '');
                    var match = (rows || []).filter(function (r) {
                        return r.type === type && String(r.tenantId || '') === tid;
                    });
                    resolve(match[0] || null);
                };
                if (tenantId && store.indexNames.contains('tenantTypeDoc')) {
                    var creq = store.index('tenantTypeDoc').getAll([String(tenantId), String(type), String(docId)]);
                    creq.onsuccess = function () { finish(creq.result || []); };
                    creq.onerror = function () { reject(creq.error); };
                    return;
                }
                var idx = store.index('docId');
                var req = idx.getAll(String(docId));
                req.onsuccess = function () { finish(req.result || []); };
                req.onerror = function () { reject(req.error); };
            });
        }).catch(function () { return null; });
    }

    function enqueue(row) {
        row = Object.assign({ ts: Date.now() }, row);
        if (!row.tenantId) row.tenantId = defaultQueueTenantId(row.type);
        return openQueueIdb().then(function (idb) {
            return new Promise(function (resolve, reject) {
                var tx = idb.transaction(STORE, 'readwrite');
                var req = tx.objectStore(STORE).put(row);
                req.onsuccess = function () {
                    if (row.id == null && req.result != null) row.id = req.result;
                    if (row.type && row.docId != null && row.id != null) {
                        _queueDocIdMap[queueMapKey(row.type, row.docId, row.tenantId)] = row.id;
                    }
                };
                tx.oncomplete = function () { resolve(row); };
                tx.onerror = function () { reject(tx.error); };
            });
        }).catch(function (err) {
            console.warn('[EMS] offline queue enqueue failed', err);
            return row;
        });
    }

    function listQueueForActiveTenant() {
        return listQueue().then(function (rows) {
            return (rows || []).filter(rowBelongsToActiveTenant);
        });
    }

    function listDeadLetterForActiveTenant() {
        return listDeadLetter().then(function (rows) {
            return (rows || []).filter(rowBelongsToActiveTenant);
        });
    }

    function listDeadLetter() {
        return openQueueIdb().then(function (idb) {
            if (!idb.objectStoreNames.contains(DEAD_LETTER_STORE)) return [];
            return new Promise(function (resolve, reject) {
                var tx = idb.transaction(DEAD_LETTER_STORE, 'readonly');
                var req = tx.objectStore(DEAD_LETTER_STORE).getAll();
                req.onsuccess = function () { resolve(req.result || []); };
                req.onerror = function () { reject(req.error); };
            });
        }).catch(function () { return []; });
    }

    function listQueue() {
        return openQueueIdb().then(function (idb) {
            return new Promise(function (resolve, reject) {
                var tx = idb.transaction(STORE, 'readonly');
                var req = tx.objectStore(STORE).getAll();
                req.onsuccess = function () { resolve(req.result || []); };
                req.onerror = function () { reject(req.error); };
            });
        }).catch(function () { return []; });
    }

    function deleteQueueRow(id) {
        return openQueueIdb().then(function (idb) {
            return new Promise(function (resolve, reject) {
                var tx = idb.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).delete(id);
                tx.oncomplete = function () {
                    Object.keys(_queueDocIdMap).forEach(function (k) {
                        if (_queueDocIdMap[k] === id) delete _queueDocIdMap[k];
                    });
                    resolve();
                };
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    function mergeAttendancePatchPayload(existing, incoming) {
        existing = existing || {};
        incoming = incoming || {};
        if (typeof global.attMergeCloudPatches === 'function') {
            return global.attMergeCloudPatches(existing, incoming);
        }
        var merged = Object.assign({}, existing, incoming);
        ['periodRecords', 'records', 'remarks', 'late'].forEach(function (field) {
            if (!merged[field]) return;
            var hasGranular = Object.keys(merged).some(function (k) {
                return k.indexOf(field + '.') === 0;
            });
            if (hasGranular) delete merged[field];
        });
        return merged;
    }

    function upsertQueueByDocId(type, docId, row) {
        row = row || {};
        row.type = row.type || type;
        row.docId = row.docId != null ? row.docId : docId;
        if (!row.tenantId) row.tenantId = defaultQueueTenantId(type);
        return ensureQueueDocIdMap().then(function () {
            return findQueueRowByDocId(type, docId, row.tenantId).then(function (existing) {
                if (existing && existing.id != null) row.id = existing.id;
                // Merge attendance field patches so unrelated period marks are not dropped.
                if (existing && type === 'attendance_patch'
                    && existing.payload && typeof existing.payload === 'object'
                    && row.payload && typeof row.payload === 'object'
                    && queueRowsSameIdentity(existing, row)) {
                    row.payload = mergeAttendancePatchPayload(existing.payload, row.payload);
                }
                return enqueue(row);
            });
        });
    }

    function flushAttendanceRow(row) {
        var db = getDb();
        var tid = row.tenantId;
        var activeTid = getVerifiedAttendanceTenantId();
        if (!tid || !activeTid || String(tid) !== String(activeTid)) {
            return Promise.resolve({ ok: false, error: 'tenant_mismatch', code: 'TENANT_MISMATCH', skip: true });
        }
        if (!db || !tid || !row.docId) {
            return Promise.resolve({ ok: false, error: 'missing_db_or_doc', code: 'INVALID_ROW' });
        }
        var payload = stampCloudVersion(row.payload || {});
        var ref = tenantDocRef(db, tid).collection('Attendance').doc(row.docId);
        var forceLocal = !!(row.meta && row.meta.forceLocal);
        return checkRemoteVersion(ref, payload, { forceLocal: forceLocal }).then(function (gate) {
            if (!gate.proceed) return gate;
            // merge:false — cleared days must not survive Firestore deep-merge
            return flushOp(ref.set(payload, { merge: false }), {
                type: 'attendance', docId: row.docId, tenantId: tid
            });
        });
    }

    function flushAttendancePatchRow(row) {
        var db = getDb();
        var tid = row.tenantId;
        var activeTid = getVerifiedAttendanceTenantId();
        if (!tid || !activeTid || String(tid) !== String(activeTid)) {
            return Promise.resolve({ ok: false, error: 'tenant_mismatch', code: 'TENANT_MISMATCH', skip: true });
        }
        if (!db || !tid || !row.docId) {
            return Promise.resolve({ ok: false, error: 'missing_db_or_doc', code: 'INVALID_ROW' });
        }
        var patch = Object.assign({}, row.payload || row.patch || {});
        if (!patch || !Object.keys(patch).length) {
            return Promise.resolve({ ok: false, error: 'empty_patch', code: 'INVALID_ROW' });
        }
        // If a top-level map is replaced, drop conflicting nested delete paths.
        ['records', 'remarks', 'late', 'periodRecords'].forEach(function (field) {
            if (!patch[field] || typeof patch[field] !== 'object') return;
            Object.keys(patch).forEach(function (k) {
                if (k.indexOf(field + '.') === 0) delete patch[k];
            });
        });
        // Firestore rejects parent + child paths in one update — prefer granular periodRecords paths.
        var hasGranularPeriod = Object.keys(patch).some(function (k) {
            return k.indexOf('periodRecords.') === 0;
        });
        if (hasGranularPeriod && patch.periodRecords) delete patch.periodRecords;
        // null sentinel → FieldValue.delete() so cleared cells are removed.
        try {
            if (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue) {
                Object.keys(patch).forEach(function (path) {
                    if (patch[path] === null) {
                        patch[path] = firebase.firestore.FieldValue.delete();
                    }
                });
                patch.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
            }
        } catch (eTs) { /* ignore */ }
        patch.clientUpdatedAt = Date.now();
        patch._version = (typeof patch._version === 'number' ? patch._version : 0) + 1;
        var ref = tenantDocRef(db, tid).collection('Attendance').doc(row.docId);
        var forceLocal = !!(row.meta && row.meta.forceLocal);
        return checkRemoteVersion(ref, patch, { forceLocal: forceLocal }).then(function (gate) {
            if (!gate.proceed) return gate;
            return flushOp(ref.update(patch), { type: 'attendance_patch', docId: row.docId }).then(function (res) {
                if (res && res.ok) return res;
                return flushOp(ref.set(patch, { merge: true }), {
                    type: 'attendance_patch', docId: row.docId, fallback: 'set'
                });
            });
        });
    }

    function flushModuleItemRow(row) {
        var db = getDb();
        var tid = row.tenantId;
        var meta = row.meta || {};
        var col = meta.collection;
        if (!db || !tid || !row.docId || !col) {
            return Promise.resolve({ ok: false, error: 'missing_module_ref', code: 'INVALID_ROW' });
        }
        var ref = tenantDocRef(db, tid).collection(col).doc(String(row.docId));
        if (meta.op === 'delete') {
            return flushOp(ref.delete(), { type: 'module_item', docId: row.docId, op: 'delete' });
        }
        var doc = stampCloudVersion(Object.assign({}, row.payload || {}));
        try {
            if (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue) {
                doc.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
            }
        } catch (eTs2) { /* ignore */ }
        return flushOp(ref.set(doc, { merge: true }), { type: 'module_item', docId: row.docId });
    }

    function flushModuleBlobRow(row) {
        var db = getDb();
        var tid = row.tenantId;
        var meta = row.meta || {};
        if (!db || !tid || !meta.collection || !meta.blobDocId) {
            return Promise.resolve({ ok: false, error: 'missing_blob_ref', code: 'INVALID_ROW' });
        }
        var jsonStr = typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload || '');
        var ref = tenantDocRef(db, tid).collection(meta.collection).doc(meta.blobDocId);
        var doc = {
            key: meta.moduleKey || row.docId,
            data: jsonStr,
            clientUpdatedAt: Date.now(),
            updatedAt: (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue)
                ? firebase.firestore.FieldValue.serverTimestamp()
                : new Date().toISOString()
        };
        if (meta.moduleName) doc.module = meta.moduleName;
        return flushOp(ref.set(doc, { merge: true }), { type: 'module_blob', docId: row.docId });
    }

    function flushModuleMapRow(row) {
        var db = getDb();
        var tid = row.tenantId;
        var meta = row.meta || {};
        if (!db || !tid || !meta.collection || !row.docId) {
            return Promise.resolve({ ok: false, error: 'missing_map_ref', code: 'INVALID_ROW' });
        }
        var ref = tenantDocRef(db, tid).collection(meta.collection).doc(String(row.docId));
        if (meta.op === 'delete') {
            return flushOp(ref.delete(), { type: 'module_map', docId: row.docId, op: 'delete' });
        }
        var doc = stampCloudVersion(Object.assign({}, row.payload || {}, { _mapKey: String(row.docId) }));
        try {
            if (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue) {
                doc.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
            }
        } catch (eTs3) { /* ignore */ }
        return flushOp(ref.set(doc, { merge: true }), { type: 'module_map', docId: row.docId });
    }

    function flushRegistrationRow(row) {
        var db = getDb();
        var tid = row.tenantId;
        if (!db || !tid || !row.docId) {
            return Promise.resolve({ ok: false, error: 'missing_registration_ref', code: 'INVALID_ROW' });
        }
        var meta = row.meta || {};
        if (row.type === 'registration_delete') {
            var colDel = meta.fromRejected ? 'Rejected' : 'Registrations';
            return flushOp(
                tenantDocRef(db, tid).collection(colDel).doc(row.docId).delete(),
                { type: 'registration_delete', docId: row.docId }
            );
        }
        var col = meta.fromRejected ? 'Rejected' : 'Registrations';
        var payload = stampCloudVersion(row.payload || {});
        var ref = tenantDocRef(db, tid).collection(col).doc(row.docId);
        return checkRemoteVersion(ref, payload).then(function (gate) {
            if (!gate.proceed) return gate;
            return flushOp(ref.set(payload, { merge: !!meta.merge }), {
                type: 'registration', docId: row.docId, collection: col
            });
        });
    }

    function buildRegistrationAtomicPayload(doc, opts) {
        opts = opts || {};
        var approved = opts.status === 'approved';
        var currentEditingId = opts.currentEditingId;
        var isEditingRejected = opts.isEditingRejected;
        var targetCol = approved ? 'Registrations' : 'Rejected';
        var deletes = [];

        if (currentEditingId) {
            if (approved && isEditingRejected) {
                deletes.push({ collection: 'Rejected', docId: String(currentEditingId) });
            } else if (approved && currentEditingId !== doc.id) {
                deletes.push({ collection: 'Registrations', docId: String(currentEditingId) });
            } else if (!approved && !isEditingRejected) {
                deletes.push({ collection: 'Registrations', docId: String(currentEditingId) });
            }
        }

        var version = Date.now();
        return {
            upsert: {
                collection: targetCol,
                docId: String(doc.id),
                data: stampCloudVersion(doc),
                merge: !!(currentEditingId && !isEditingRejected && approved)
            },
            deletes: deletes,
            meta: {
                version: version,
                updatedAt: new Date().toISOString(),
                change: {
                    collection: targetCol,
                    id: String(doc.id),
                    op: 'upsert'
                }
            }
        };
    }

    function buildRegistrationAtomicDelete(id, fromRejected) {
        var col = fromRejected ? 'Rejected' : 'Registrations';
        var version = Date.now();
        return {
            upsert: null,
            deletes: [{ collection: col, docId: String(id) }],
            meta: {
                version: version,
                updatedAt: new Date().toISOString(),
                change: {
                    collection: col,
                    id: String(id),
                    op: 'delete'
                }
            }
        };
    }

    function applyAtomicMetaLocal(atomic) {
        if (atomic && atomic.meta && typeof global.emsRegRepoApplyMetaFromAtomic === 'function') {
            try {
                global.emsRegRepoApplyMetaFromAtomic(atomic.meta);
            } catch (eMeta) { /* ignore */ }
        }
    }

    function flushRegistrationAtomicRow(row) {
        var db = getDb();
        var tid = row.tenantId;
        if (!db || !tid || !row.docId) {
            return Promise.resolve({ ok: false, error: 'missing_registration_atomic_ref', code: 'INVALID_ROW' });
        }
        var atomic = row.payload || {};
        var baseRef = tenantDocRef(db, tid);

        function runBatch() {
            var batch = db.batch();
            (atomic.deletes || []).forEach(function (d) {
                if (!d || !d.docId) return;
                batch.delete(baseRef.collection(d.collection).doc(String(d.docId)));
            });
            if (atomic.upsert && atomic.upsert.docId) {
                var u = atomic.upsert;
                var data = stampCloudVersion(u.data || {});
                batch.set(baseRef.collection(u.collection).doc(String(u.docId)), data, { merge: !!u.merge });
            }
            if (atomic.meta) {
                batch.set(baseRef.collection('RegistrationMeta').doc('current'), atomic.meta, { merge: true });
            }
            return flushOp(batch.commit(), { type: 'registration_atomic', docId: row.docId }).then(function (res) {
                if (res && res.ok) applyAtomicMetaLocal(atomic);
                return res;
            });
        }

        if (atomic.upsert && atomic.upsert.docId) {
            var upsert = atomic.upsert;
            var upsertRef = baseRef.collection(upsert.collection).doc(String(upsert.docId));
            var payload = stampCloudVersion(Object.assign({}, upsert.data || {}));
            return checkRemoteVersion(upsertRef, payload).then(function (gate) {
                if (!gate.proceed) return gate;
                atomic.upsert.data = payload;
                return runBatch();
            });
        }
        return runBatch();
    }

    function flushFeeRow(row) {
        var db = getDb();
        var tid = row.tenantId;
        if (!db || !tid || !row.docId) {
            return Promise.resolve({ ok: false, error: 'missing_fee_ref', code: 'INVALID_ROW' });
        }
        var payload = stampCloudVersion(row.payload || {});
        var ref = tenantDocRef(db, tid).collection('FeeCollections').doc(row.docId);
        return checkRemoteVersion(ref, payload).then(function (gate) {
            if (!gate.proceed) return gate;
            return flushOp(ref.set(payload, { merge: true }), { type: 'fee', docId: row.docId });
        });
    }

    function flushSyncModuleRow(row) {
        var tid = row.tenantId;
        var payload = row.payload || {};
        var key = payload.key || row.docId;
        var value = payload.value;
        if (!tid || !key || value == null) {
            return Promise.resolve({ ok: false, error: 'invalid_sync_module', code: 'INVALID_ROW' });
        }
        if (global.EmsSyncEngine && typeof global.EmsSyncEngine.writeModuleKey === 'function') {
            return flushOp(global.EmsSyncEngine.writeModuleKey(tid, key, value), {
                type: 'sync_module', docId: key, tenantId: tid
            });
        }
        return Promise.resolve({ ok: false, error: 'sync_engine_unavailable', code: 'NO_HANDLER' });
    }

    function flushDirectPersistRow(row) {
        var payload = row.payload || {};
        var key = payload.key || row.docId;
        var jsonStr = payload.value;
        var cfg = row.meta && row.meta.cfg;
        if (!key || jsonStr == null || !cfg) {
            return Promise.resolve({ ok: false, error: 'invalid_direct_persist', code: 'INVALID_ROW' });
        }
        if (global.EmsDirect && typeof global.EmsDirect.executePersistQueued === 'function') {
            return flushOp(global.EmsDirect.executePersistQueued(key, jsonStr, cfg), {
                type: 'direct_persist', docId: key
            });
        }
        return Promise.resolve({ ok: false, error: 'direct_firestore_unavailable', code: 'NO_HANDLER' });
    }

    function flushRow(row) {
        if (!row) return Promise.resolve({ ok: false, error: 'no_row', code: 'INVALID_ROW' });
        if (!row.tenantId) {
            return Promise.resolve({ ok: false, error: 'missing_tenant', code: 'TENANT_REQUIRED', skip: true });
        }
        if (!rowBelongsToActiveTenant(row)) {
            return Promise.resolve({ ok: false, error: 'tenant_mismatch', code: 'TENANT_MISMATCH', skip: true });
        }
        if (row.type === 'attendance') return flushAttendanceRow(row);
        if (row.type === 'attendance_patch') return flushAttendancePatchRow(row);
        if (row.type === 'module_item') return flushModuleItemRow(row);
        if (row.type === 'module_blob') return flushModuleBlobRow(row);
        if (row.type === 'module_map') return flushModuleMapRow(row);
        if (row.type === 'registration' || row.type === 'registration_delete') return flushRegistrationRow(row);
        if (row.type === 'registration_atomic') return flushRegistrationAtomicRow(row);
        if (row.type === 'fee') return flushFeeRow(row);
        if (row.type === 'sync_module') return flushSyncModuleRow(row);
        if (row.type === 'direct_persist') return flushDirectPersistRow(row);
        return Promise.resolve({ ok: false, error: 'unknown_row_type', code: 'INVALID_ROW' });
    }

    function flushMutationRowAndDequeueUnlocked(row) {
        return flushRow(row).then(function (res) {
            if (res && res.skip) {
                return { synced: false, skipped: true, code: res.code };
            }
            if (!res || !res.ok) {
                return markRowFailed(row, res).then(function () {
                    return refreshSyncFailureCounts().then(function (counts) {
                        notifySyncFailureUI({
                            failed: counts.failed,
                            pending: counts.pending,
                            docId: row.docId,
                            type: row.type,
                            error: res && res.error,
                            code: res && res.code
                        });
                        if (row.type === 'attendance' || row.type === 'attendance_patch') {
                            try {
                                global.dispatchEvent(new CustomEvent('ems:att-save-status', {
                                    detail: {
                                        source: 'outbox',
                                        docId: row.docId,
                                        type: row.type,
                                        cloud: (normalizeCloudResult(res, { localSaved: true }).cloudState),
                                        error: res && res.error,
                                        code: res && res.code
                                    }
                                }));
                            } catch (eAtt) { /* ignore */ }
                        }
                        return { synced: false, error: res && res.error, code: res && res.code };
                    });
                });
            }
            row.failed = false;
            delete row.lastError;
            delete row.lastErrorCode;
            delete row.failedAt;
            return listQueue().then(function (rows) {
                var hit = rows.find(function (r) {
                    return queueRowsSameIdentity(r, row);
                });
                if (hit && hit.id != null) {
                    return deleteQueueRow(hit.id).then(function () {
                        return refreshSyncFailureCounts().then(function (counts) {
                            if (counts.failed === 0) notifySyncFailureUI({ failed: 0, pending: counts.pending, cleared: true });
                            if (row.type === 'attendance' || row.type === 'attendance_patch') {
                                try {
                                    global.dispatchEvent(new CustomEvent('ems:att-save-status', {
                                        detail: { source: 'outbox', docId: row.docId, type: row.type, synced: true, cloud: 'synced' }
                                    }));
                                } catch (eAttOk) { /* ignore */ }
                            }
                            return { synced: true };
                        });
                    });
                }
                return refreshSyncFailureCounts().then(function () { return { synced: true }; });
            });
        });
    }

    function flushMutationRowAndDequeue(row) {
        if (typeof global.emsWithOutboxFlushLock === 'function') {
            return global.emsWithOutboxFlushLock(function () {
                return flushMutationRowAndDequeueUnlocked(row);
            });
        }
        return flushMutationRowAndDequeueUnlocked(row);
    }

    global.emsOfflineQueueUpsert = upsertQueueByDocId;
    global.emsOfflineListQueue = listQueueForActiveTenant;
    global.emsOfflineListQueueAll = listQueue;
    global.emsOfflineFlushMutationRow = flushMutationRowAndDequeue;
    global.emsOfflineFlushRowInternal = flushRow;
    global.emsOutboxQueueMapKey = queueMapKey;
    global.emsOutboxQueueRowsSameIdentity = queueRowsSameIdentity;

    function emitCloudMutation(envelope) {
        if (typeof global.emsCloudEmitMutation === 'function') {
            return global.emsCloudEmitMutation(envelope);
        }
        var env = envelope || {};
        var domain = String(env.domain || '').toLowerCase();
        var op = String(env.op || 'update').toLowerCase();
        var qType = env.type;
        if (!qType) {
            if (domain === 'registration') {
                qType = op === 'atomic' ? 'registration_atomic' : (op === 'delete' ? 'registration_delete' : 'registration');
            } else if (domain === 'attendance') qType = 'attendance';
            else if (domain === 'fee') qType = 'fee';
            else qType = domain || 'mutation';
        }
        var isAttQueue = qType === 'attendance' || qType === 'attendance_patch' || domain === 'attendance';
        var tenantId = env.tenantId;
        if (isAttQueue) {
            tenantId = tenantId || getVerifiedAttendanceTenantId();
            if (!tenantId) {
                return Promise.resolve({ ok: false, reason: 'no_tenant', code: 'TENANT_PENDING', docId: env.docId });
            }
        } else {
            tenantId = tenantId || getTenantId();
        }
        var queueRow = {
            type: qType,
            docId: env.docId,
            payload: env.payload,
            localKey: env.localKey,
            tenantId: tenantId,
            meta: env.meta
        };
        return upsertQueueByDocId(qType, env.docId, queueRow).then(function () {
            if (!canCloudWrite()) {
                return normalizeCloudResult({
                    synced: false,
                    offline: true,
                    queued: true,
                    docId: env.docId
                }, { localSaved: true, docId: env.docId, type: qType });
            }
            return flushMutationRowAndDequeue(queueRow).then(function (res) {
                return normalizeCloudResult(res, { localSaved: true, docId: env.docId, type: qType });
            });
        });
    }

    /** SSOT delegator — attendance-helper.js owns IDB month index + async listing. */
    global.emsOfflineListAttendanceKeys = function (monthStr) {
        if (typeof global.__emsAttKeyListFromHelper === 'function') {
            return global.__emsAttKeyListFromHelper(monthStr);
        }
        return null;
    };

    global.emsOfflineListAttendanceKeysAsync = global.emsOfflineListAttendanceKeysAsync || function (monthStr) {
        if (typeof global.__emsAttKeyListAsyncFromHelper === 'function') {
            return global.__emsAttKeyListAsyncFromHelper(monthStr);
        }
        return Promise.resolve([]);
    };

    // ---- Attendance (att_rec_* local SSOT) ----------------------------------

    global.emsOfflineGetCachedAttendance = function (dbKey, opts) {
        opts = opts || {};
        var localKey = opts.localKey || dbKey;
        if (!localKey && !dbKey) return Promise.resolve(null);

        var local = parseLocal(readRaw(localKey));
        if (local) return Promise.resolve(local);

        if (dbKey && dbKey !== localKey) {
            local = parseLocal(readRaw(dbKey));
            if (local) {
                global.emsOfflineWriteLocalSync(localKey, local);
                return Promise.resolve(local);
            }
        }

        if (typeof global.emsIdbKvGet !== 'function') return Promise.resolve(null);

        function readIdb(key) {
            return global.emsIdbKvGet(key).then(function (v) {
                if (v == null) return null;
                return parseLocal(v);
            });
        }

        return readIdb(localKey).then(function (parsed) {
            if (parsed) {
                global.emsOfflineWriteLocalSync(localKey, parsed);
                return parsed;
            }
            if (dbKey && dbKey !== localKey) {
                return readIdb(dbKey).then(function (legacy) {
                    if (legacy) global.emsOfflineWriteLocalSync(localKey, legacy);
                    return legacy;
                });
            }
            return null;
        }).catch(function () { return null; });
    };

    /** Cache pulled cloud sheet locally — does NOT enqueue cloud write. */
    global.emsOfflineCacheAttendanceFromRemote = function (cloudDocId, data, opts) {
        opts = opts || {};
        if (!cloudDocId) return Promise.resolve({ ok: false, reason: 'no_key' });
        var localKey = opts.localKey || cloudDocId;
        if (typeof global.emsOfflineWriteLocalSync === 'function') {
            global.emsOfflineWriteLocalSync(localKey, data);
        }
        return writeLocal(localKey, data).then(function () {
            return { ok: true, cached: true, key: cloudDocId, localKey: localKey };
        });
    };

    global.emsOfflinePersistAttendance = function (cloudDocId, data, opts) {
        opts = opts || {};
        if (!cloudDocId) {
            return Promise.resolve(normalizeCloudResult({
                ok: false,
                reason: 'no_key'
            }, { localSaved: false }));
        }
        var tenantId = getVerifiedAttendanceTenantId();
        if (!tenantId) {
            return Promise.resolve(normalizeCloudResult({
                ok: false,
                reason: 'no_tenant',
                code: 'TENANT_PENDING',
                queued: true
            }, { localSaved: !!opts.skipLocalSync, docId: cloudDocId }));
        }
        var localKey = opts.localKey || cloudDocId;

        if (!opts.skipLocalSync && typeof global.emsOfflineWriteLocalSync === 'function') {
            global.emsOfflineWriteLocalSync(localKey, data);
        }

        return writeLocal(localKey, data).then(function () {
            if (opts.patch && typeof global.emsCloudEmitAttendancePatch === 'function') {
                return global.emsCloudEmitAttendancePatch(cloudDocId, opts.patch, {
                    localKey: localKey,
                    tenantId: tenantId
                }).then(function (syncRes) {
                    return Object.assign(normalizeCloudResult(syncRes, { localSaved: true, docId: cloudDocId }), {
                        local: true,
                        key: cloudDocId,
                        localKey: localKey,
                        patch: true
                    });
                });
            }
            return emitCloudMutation({
                domain: 'attendance',
                op: 'update',
                docId: cloudDocId,
                payload: data,
                localKey: localKey,
                tenantId: tenantId
            }).then(function (syncRes) {
                return Object.assign(normalizeCloudResult(syncRes, { localSaved: true, docId: cloudDocId }), {
                    local: true,
                    key: cloudDocId,
                    localKey: localKey
                });
            });
        }).catch(function (err) {
            console.error('[EMS] offline persist attendance failed', err);
            return normalizeCloudResult({
                ok: false,
                error: err && err.message ? err.message : String(err)
            }, { localSaved: false, docId: cloudDocId });
        });
    };

    // ---- Registration cloud queue (IDB via emsRegRepo*) ---------------------

    global.emsOfflinePersistRegistration = function (doc, opts) {
        opts = opts || {};
        if (!doc || !doc.id) return Promise.resolve({ ok: false, reason: 'invalid_doc' });

        var chain = Promise.resolve({ ok: true });
        if (!opts.enqueueOnly && typeof global.emsRegRepoPersistRegistration === 'function') {
            chain = global.emsRegRepoPersistRegistration(doc, opts);
        } else if (!opts.enqueueOnly && typeof global.emsRegRepoUpsert === 'function') {
            var lean = doc;
            var rejected = opts.status !== 'approved';
            chain = global.emsRegRepoUpsert(lean, rejected).then(function (r) { return { ok: true, idb: r }; });
        }

        var tenantId = opts.tenantId || getTenantId();

        return chain.then(function (localRes) {
            return emitCloudMutation({
                domain: 'registration',
                op: 'atomic',
                docId: String(doc.id),
                payload: buildRegistrationAtomicPayload(doc, {
                    status: opts.status,
                    currentEditingId: opts.currentEditingId,
                    isEditingRejected: opts.isEditingRejected
                }),
                tenantId: tenantId,
                meta: { atomicMove: true }
            }).then(function (syncRes) {
                return Object.assign({
                    ok: true,
                    local: true,
                    synced: !!(syncRes && syncRes.synced),
                    offline: !!(syncRes && syncRes.offline)
                }, localRes || {}, syncRes || {});
            });
        });
    };

    global.emsOfflineDeleteRegistration = function (id, fromRejected) {
        if (!id) return Promise.resolve({ ok: false, reason: 'invalid_id' });
        var chain = Promise.resolve({ ok: true });
        if (typeof global.emsRegRepoRemove === 'function') {
            chain = global.emsRegRepoRemove(id, !!fromRejected).then(function (r) { return { ok: true, idb: r }; });
        }
        return chain.then(function (localRes) {
            return emitCloudMutation({
                domain: 'registration',
                op: 'atomic',
                docId: String(id),
                payload: buildRegistrationAtomicDelete(id, fromRejected),
                tenantId: getTenantId(),
                meta: { atomicMove: true }
            }).then(function (syncRes) {
                return Object.assign({
                    ok: true,
                    local: true,
                    synced: !!(syncRes && syncRes.synced),
                    offline: !!(syncRes && syncRes.offline)
                }, localRes || {}, syncRes || {});
            });
        });
    };

    // ---- Finance fee row queue ------------------------------------------------

    global.emsOfflinePersistFeeRecord = function (record) {
        if (!record || !record.id) return Promise.resolve({ ok: false, reason: 'invalid_record' });
        return emitCloudMutation({
            domain: 'fee',
            op: 'update',
            docId: String(record.id),
            payload: record,
            tenantId: getTenantId()
        }).then(function (syncRes) {
            return {
                ok: true,
                local: true,
                synced: !!(syncRes && syncRes.synced),
                offline: !!(syncRes && syncRes.offline),
                id: record.id
            };
        });
    };

    // ---- Queue flush (manual cloud push) --------------------------------------

    global.emsOfflineFlushRow = function (rowId) {
        var run = function () {
            return listQueue().then(function (rows) {
                var row = rows.find(function (r) { return r.id === rowId; });
                if (!row) return { ok: false, reason: 'not_found' };
                return flushRow(row).then(function (res) {
                    if (!res || !res.ok) {
                        return markRowFailed(row, res).then(function () {
                            notifySyncFailureUI({ docId: row.docId, type: row.type, error: res && res.error, code: res && res.code });
                            return { ok: false, reason: 'flush_failed', id: rowId, error: res && res.error, code: res && res.code };
                        });
                    }
                    return deleteQueueRow(rowId).then(function () {
                        return refreshSyncFailureCounts().then(function () {
                            return { ok: true, flushed: 1, id: rowId };
                        });
                    });
                });
            });
        };
        if (typeof global.emsWithOutboxFlushLock === 'function') {
            return global.emsWithOutboxFlushLock(run);
        }
        return run();
    };

    function flushAllUnlocked(opts) {
        opts = opts || {};
        if (!canCloudWrite({ manual: true, force: opts.force })) {
            return listQueue().then(function (rows) {
                var scoped = (rows || []).filter(rowBelongsToActiveTenant);
                return { ok: true, flushed: 0, pending: scoped.length, failed: scoped.filter(function (r) { return r.failed; }).length, reason: 'offline_or_no_db' };
            });
        }
        return listQueue().then(function (rows) {
            var flushed = 0;
            var failed = 0;
            var skipped = 0;
            var chain = Promise.resolve();
            rows.forEach(function (row) {
                chain = chain.then(function () {
                    if (!rowEligibleForFlush(row, opts)) {
                        skipped++;
                        return;
                    }
                    return flushRow(row).then(function (res) {
                        if (res && res.skip) {
                            skipped++;
                            return;
                        }
                        if (!res || !res.ok) {
                            failed++;
                            return markRowFailed(row, res);
                        }
                        flushed++;
                        row.failed = false;
                        row.retryCount = 0;
                        delete row.nextRetryAt;
                        return deleteQueueRow(row.id);
                    });
                });
            });
            return chain.then(function () {
                return refreshSyncFailureCounts().then(function (counts) {
                    if (failed > 0 || counts.deadLetter > 0) {
                        notifySyncFailureUI({
                            failed: counts.failed,
                            pending: counts.pending,
                            deadLetter: counts.deadLetter,
                            batchFailed: failed,
                            skippedBackoff: skipped
                        });
                    } else if (counts.failed === 0) {
                        notifySyncFailureUI({ failed: 0, pending: counts.pending, deadLetter: counts.deadLetter, cleared: true });
                    }
                    return {
                        ok: true,
                        flushed: flushed,
                        failed: failed,
                        skipped: skipped,
                        pending: Math.max(0, (rows || []).filter(rowBelongsToActiveTenant).length - flushed),
                        queueFailed: counts.failed,
                        deadLetter: counts.deadLetter
                    };
                });
            });
        });
    }

    global.emsOfflineFlushAll = function (opts) {
        if (typeof global.emsWithOutboxFlushLock === 'function') {
            return global.emsWithOutboxFlushLock(function () {
                return flushAllUnlocked(opts);
            });
        }
        return flushAllUnlocked(opts);
    };

    global.emsOfflineGetSyncFailureState = function () {
        return refreshSyncFailureCounts().then(function (counts) {
            return {
                failed: counts.failed,
                pending: counts.pending,
                deadLetter: counts.deadLetter,
                lastError: _syncFailureState.lastError
            };
        });
    };

    function clearDeadLetterQueue() {
        return openQueueIdb().then(function (idb) {
            if (!idb.objectStoreNames.contains(DEAD_LETTER_STORE)) {
                return { ok: true, cleared: 0 };
            }
            return new Promise(function (resolve, reject) {
                var tx = idb.transaction(DEAD_LETTER_STORE, 'readwrite');
                var store = tx.objectStore(DEAD_LETTER_STORE);
                var req = store.getAll();
                req.onsuccess = function () {
                    var cleared = 0;
                    (req.result || []).forEach(function (row) {
                        if (!rowBelongsToActiveTenant(row)) return;
                        if (row.id != null) {
                            store.delete(row.id);
                            cleared++;
                        }
                    });
                    tx.oncomplete = function () { resolve({ ok: true, cleared: cleared }); };
                    tx.onerror = function () { reject(tx.error); };
                };
                req.onerror = function () { reject(req.error); };
            });
        }).then(function (res) {
            return refreshSyncFailureCounts().then(function (counts) {
                return Object.assign({ counts: counts }, res);
            });
        });
    }

    global.emsOfflineListDeadLetter = listDeadLetterForActiveTenant;
    global.emsOfflineClearDeadLetterQueue = clearDeadLetterQueue;

    global.emsUnifiedOutboxEnqueue = function (type, docId, row) {
        return upsertQueueByDocId(type, docId, row);
    };

    global.emsOfflineEnqueueSyncModule = function (key, value, opts) {
        opts = opts || {};
        var moduleName = opts.module
            || (global.EmsSyncEngine && typeof global.EmsSyncEngine.getRegistryModule === 'function'
                ? global.EmsSyncEngine.getRegistryModule(key) : 'General');
        return upsertQueueByDocId('sync_module', String(key), {
            type: 'sync_module',
            docId: String(key),
            payload: { key: String(key), value: value },
            tenantId: opts.tenantId || getTenantId(),
            meta: { module: moduleName },
            retryCount: 0
        });
    };

    global.emsOfflineEnqueueDirectPersist = function (key, jsonStr, cfg) {
        return upsertQueueByDocId('direct_persist', String(key), {
            type: 'direct_persist',
            docId: String(key),
            payload: { key: String(key), value: jsonStr },
            tenantId: getTenantId(),
            meta: { cfg: cfg },
            retryCount: 0
        });
    };

    function readLegacyIdbStore(dbName, storeName, indexName, indexValue) {
        return new Promise(function (resolve) {
            var req = indexedDB.open(dbName, 1);
            req.onerror = function () { resolve([]); };
            req.onsuccess = function (e) {
                var idb = e.target.result;
                if (!idb.objectStoreNames.contains(storeName)) {
                    idb.close();
                    resolve([]);
                    return;
                }
                var tx = idb.transaction(storeName, 'readonly');
                var store = tx.objectStore(storeName);
                var readReq = indexName
                    ? store.index(indexName).getAll(indexValue)
                    : store.getAll();
                readReq.onsuccess = function () {
                    idb.close();
                    resolve(readReq.result || []);
                };
                readReq.onerror = function () {
                    idb.close();
                    resolve([]);
                };
            };
        });
    }

    function migrateLegacyQueuesOnce() {
        try {
            if (localStorage.getItem(LEGACY_MIGRATE_FLAG) === '1') {
                return Promise.resolve({ migrated: 0, skipped: true });
            }
        } catch (e) { /* ignore */ }
        return readLegacyIdbStore('EMS_SyncDB', 'sync_queue', 'status', 'pending').then(function (syncItems) {
            return readLegacyIdbStore('EMS_DirectSyncDB', 'queue').then(function (directItems) {
                var chain = Promise.resolve();
                var migrated = 0;
                (syncItems || []).forEach(function (item) {
                    if (!item || !item.key || item.value == null) return;
                    chain = chain.then(function () {
                        migrated++;
                        return global.emsOfflineEnqueueSyncModule(item.key, item.value, { tenantId: getTenantId() });
                    });
                });
                (directItems || []).forEach(function (op) {
                    if (!op || !op.key || op.value == null || !op.cfg) return;
                    chain = chain.then(function () {
                        migrated++;
                        return global.emsOfflineEnqueueDirectPersist(op.key, op.value, op.cfg);
                    });
                });
                return chain.then(function () {
                    try { localStorage.setItem(LEGACY_MIGRATE_FLAG, '1'); } catch (e2) { /* ignore */ }
                    if (migrated > 0) {
                        console.info('[EMS] unified outbox migrated legacy rows:', migrated);
                    }
                    return { migrated: migrated };
                });
            });
        });
    }

    global.emsUnifiedOutboxMigrateLegacy = migrateLegacyQueuesOnce;

    global.emsOfflineRetryFailedSync = function () {
        return listQueue().then(function (rows) {
            var failedRows = (rows || []).filter(function (r) {
                return r && r.failed && rowBelongsToActiveTenant(r);
            });
            if (!failedRows.length) {
                return refreshSyncFailureCounts().then(function (counts) {
                    return { ok: true, retried: 0, failed: counts.failed, pending: counts.pending };
                });
            }
            var retried = 0;
            var stillFailed = 0;
            var chain = Promise.resolve();
            failedRows.forEach(function (row) {
                chain = chain.then(function () {
                    row.failed = false;
                    row.retryCount = 0;
                    delete row.lastError;
                    delete row.lastErrorCode;
                    delete row.failedAt;
                    delete row.nextRetryAt;
                    return upsertQueueByDocId(row.type, row.docId, row).then(function () {
                        return flushMutationRowAndDequeue(row).then(function (res) {
                            retried++;
                            if (!res || !res.synced) stillFailed++;
                        });
                    });
                });
            });
            return chain.then(function () {
                return refreshSyncFailureCounts().then(function (counts) {
                    notifySyncFailureUI({ failed: counts.failed, pending: counts.pending, retried: retried });
                    return { ok: true, retried: retried, stillFailed: stillFailed, failed: counts.failed, pending: counts.pending };
                });
            });
        });
    };

    global.emsPendingSyncEnqueue = enqueue;
    global.emsPendingSyncFlush = global.emsOfflineFlushAll;
    global.emsPendingSyncCount = function () {
        return listQueueForActiveTenant().then(function (rows) { return rows.length; });
    };

    if (typeof global.addEventListener === 'function') {
        global.addEventListener('online', function () {
            if (global.EMS_OFFLINE_ONLY === true) return;
            global.emsOfflineFlushAll().catch(function () { /* ignore */ });
        });
        global.addEventListener('DOMContentLoaded', function () {
            migrateLegacyQueuesOnce().then(function () {
                return refreshSyncFailureCounts();
            }).then(function (counts) {
                if (counts.failed > 0 || counts.deadLetter > 0) notifySyncFailureUI(counts);
            });
        });
    }

    migrateLegacyQueuesOnce().catch(function () { /* ignore */ });
    if (global.EMS_TENANT_STORAGE_READY === true && global.EMS_ACTIVE_TENANT_ID) {
        global.emsMigrateLegacyAttendanceForTenant(global.EMS_ACTIVE_TENANT_ID);
    }

    if (typeof global.setInterval === 'function') {
        global.setInterval(function () {
            if (global.EMS_OFFLINE_ONLY === true) return;
            var online = typeof global.emsIsNetworkAvailable === 'function'
                ? global.emsIsNetworkAvailable()
                : !!(global.navigator && global.navigator.onLine);
            if (!online) return;
            global.emsOfflineFlushAll().catch(function () { /* ignore */ });
        }, 30000);
    }
})(typeof window !== 'undefined' ? window : globalThis);
