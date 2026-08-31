// ============================================================================
// EMS Attendance Helper — Firestore-based dashboard stats (Phase 3)
// ============================================================================
(function (global) {
    'use strict';

    function getTenantId() {
        // Use the same fail-closed tenant authority as the attendance writer.
        // During a tenant switch/mismatch, never pull into a stale partition.
        if (typeof global.emsGetCanonicalTenantId === 'function') {
            return global.emsGetCanonicalTenantId();
        }
        if (typeof global.emsGetTenantId === 'function') {
            var tid = global.emsGetTenantId();
            if (tid) return tid;
        }
        if (global.CURRENT_MADRASA_TENANT_ID) return global.CURRENT_MADRASA_TENANT_ID;
        if (global.EMS_ACTIVE_TENANT_ID) return global.EMS_ACTIVE_TENANT_ID;
        return null;
    }

    function getDb() {
        return typeof global.getDbOrNull === 'function' ? global.getDbOrNull() : null;
    }

    function shouldUseFirestore() {
        if (global.EMS_OFFLINE_ONLY === true) return false;
        if (typeof global.emsIsNetworkAvailable === 'function' && !global.emsIsNetworkAvailable()) {
            return false;
        }
        try {
            if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
        } catch (eNav) { /* ignore */ }
        return !!(getDb() && getTenantId());
    }

    function withTimeout(promise, ms, fallback) {
        ms = ms || 3000;
        return Promise.race([
            promise,
            new Promise(function (resolve) {
                setTimeout(function () { resolve(fallback); }, ms);
            })
        ]);
    }

    function attHelperKarachiDateParts(d) {
        d = d || new Date();
        var todayStr = '';
        try {
            var fmt = new Intl.DateTimeFormat('en-CA', {
                timeZone: 'Asia/Karachi',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            });
            var y = '', m = '', day = '';
            fmt.formatToParts(d).forEach(function (p) {
                if (p.type === 'year') y = p.value;
                if (p.type === 'month') m = p.value;
                if (p.type === 'day') day = p.value;
            });
            if (y && m && day) todayStr = y + '-' + m + '-' + day;
        } catch (eTz) { /* fall through */ }
        if (!todayStr) {
            var off = new Date(d.getTime() + (5 * 60 * 60 * 1000));
            todayStr = off.toISOString().split('T')[0];
        }
        return {
            todayStr: todayStr,
            todayMonth: todayStr.substring(0, 7),
            todayDateNum: parseInt(todayStr.substring(8, 10), 10)
        };
    }

    /** Pakistan calendar day — must match att-dashboard ATT_DASH_TZ. */
    function todayParts() {
        return attHelperKarachiDateParts(new Date()); // Asia/Karachi
    }

    function emsAttTrendDateForDay(d) {
        return attHelperKarachiDateParts(d).todayStr;
    }
    global.emsAttTrendDateForDay = emsAttTrendDateForDay;

    var _attKeysByMonthCache = Object.create(null);
    var _attAllKeysIndexed = false;

    function activeTenantId() {
        if (typeof global.emsGetTenantId === 'function') {
            var tid = global.emsGetTenantId();
            if (tid) return String(tid);
        }
        return global.CURRENT_MADRASA_TENANT_ID ? String(global.CURRENT_MADRASA_TENANT_ID) : null;
    }

    function attKeyBelongsToActiveTenant(key) {
        var tenantId = activeTenantId();
        if (!tenantId || !key) return false;
        if (typeof global.emsIsActiveTenantAttendanceKey === 'function') {
            return global.emsIsActiveTenantAttendanceKey(key, tenantId);
        }
        return key.indexOf('att_rec_' + tenantId + '_') === 0;
    }

    var ATT_DOTTED_MAP_ROOTS = {
        records: true,
        periodRecords: true,
        teacherPeriodRecords: true,
        remarks: true,
        late: true,
        dailyLocks: true
    };

    function attCloneAttendanceMap(value) {
        if (Array.isArray(value)) return value.map(attCloneAttendanceMap);
        if (!value || typeof value !== 'object') return value;
        var proto = Object.getPrototypeOf ? Object.getPrototypeOf(value) : Object.prototype;
        // Preserve Firestore Timestamp and other SDK value objects verbatim.
        if (proto && proto !== Object.prototype) return value;
        var out = {};
        Object.keys(value).forEach(function (key) {
            out[key] = attCloneAttendanceMap(value[key]);
        });
        return out;
    }

    function attFillMissingAttendancePath(target, parts, value) {
        var cursor = target;
        for (var i = 0; i < parts.length - 1; i++) {
            var part = parts[i];
            if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {};
            cursor = cursor[part];
        }
        var leaf = parts[parts.length - 1];
        if (!Object.prototype.hasOwnProperty.call(cursor, leaf)) {
            cursor[leaf] = attCloneAttendanceMap(value);
            return true;
        }
        return false;
    }

    function attMergeMissingAttendanceMap(target, source) {
        Object.keys(source || {}).forEach(function (key) {
            if (!Object.prototype.hasOwnProperty.call(target, key)) {
                target[key] = attCloneAttendanceMap(source[key]);
                return;
            }
            if (target[key] && source[key]
                && typeof target[key] === 'object' && typeof source[key] === 'object') {
                attMergeMissingAttendanceMap(target[key], source[key]);
            }
        });
        return target;
    }

    /**
     * Old patch fallbacks stored keys such as `periodRecords.TCH-1.2.PRD-1`
     * literally at document root. Readers previously ignored those saved marks.
     * Fold only missing paths into the canonical maps; an existing nested cell is
     * kept because it is the already-visible/current value. The raw object is not
     * mutated and dotted keys are omitted from the normalized cache copy.
     */
    function attNormalizeAttendanceCloudDocument(raw) {
        if (raw == null) return null;
        var parsed = raw;
        if (typeof parsed === 'string') {
            try { parsed = JSON.parse(parsed); } catch (eParse) { return null; }
        }
        if (!parsed || typeof parsed !== 'object') return parsed;
        var out = Object.assign({}, parsed);
        var clonedRoots = Object.create(null);

        function ensureRoot(root) {
            if (!clonedRoots[root]) {
                out[root] = attCloneAttendanceMap(out[root] && typeof out[root] === 'object' ? out[root] : {});
                clonedRoots[root] = true;
            }
            return out[root];
        }

        Object.keys(parsed).forEach(function (key) {
            var dot = key.indexOf('.');
            if (dot <= 0) return;
            var root = key.slice(0, dot);
            if (!ATT_DOTTED_MAP_ROOTS[root]) return;
            var parts = key.slice(dot + 1).split('.').filter(Boolean);
            if (parts.length) attFillMissingAttendancePath(ensureRoot(root), parts, parsed[key]);
            delete out[key];
        });

        // One early release used teacherPeriodRecords; make it visible to every
        // current reader without deleting the legacy map from the cloud object.
        if (out.teacherPeriodRecords && typeof out.teacherPeriodRecords === 'object') {
            attMergeMissingAttendanceMap(ensureRoot('periodRecords'), out.teacherPeriodRecords);
        }
        return out;
    }

    global.emsNormalizeAttendanceCloudDocument = attNormalizeAttendanceCloudDocument;

    function attParseSheet(raw) {
        return attNormalizeAttendanceCloudDocument(raw);
    }

    function attHelperHasMeaningfulSheet(sheet) {
        if (typeof global.attHasMeaningfulAttendanceData === 'function') {
            return global.attHasMeaningfulAttendanceData(sheet);
        }
        if (!sheet || typeof sheet !== 'object') return false;
        if (sheet.timestamp || sheet.updatedAt) return true;
        if (sheet.locked) return true;
        if (Object.keys(sheet.records || {}).length) return true;
        if (Object.keys(sheet.dailyLocks || {}).length) return true;
        if (Object.keys(sheet.periodRecords || {}).length) return true;
        return false;
    }

    global.attHelperHasMeaningfulSheet = attHelperHasMeaningfulSheet;

    function attMonthFromAttKey(key) {
        if (!key || key.indexOf('att_rec_') !== 0) return null;
        var m = key.match(/_(\d{4}-\d{2})_/);
        if (m) return m[1];
        return key.length >= 15 ? key.substring(8, 15) : null;
    }

    function attBuildKeyIndexFromKeys(keys) {
        (keys || []).forEach(function (key) {
            if (!key || key.indexOf('att_rec_') !== 0) return;
            if (!attKeyBelongsToActiveTenant(key)) return;
            var month = attMonthFromAttKey(key);
            if (!month) return;
            if (!_attKeysByMonthCache[month]) _attKeysByMonthCache[month] = [];
            if (_attKeysByMonthCache[month].indexOf(key) < 0) {
                _attKeysByMonthCache[month].push(key);
            }
        });
    }

    function attHarvestLegacyLocalStorageKeysOnce() {
        try {
            if (typeof localStorage === 'undefined') return;
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k && attKeyBelongsToActiveTenant(k)) attBuildKeyIndexFromKeys([k]);
            }
        } catch (e) { /* ignore */ }
    }

    function attEnsureOfflineKeyIndex() {
        if (_attAllKeysIndexed) {
            return Promise.resolve(_attKeysByMonthCache);
        }
        var chain;
        if (typeof global.emsIdbKvKeysByPrefix === 'function') {
            var tenantId = activeTenantId();
            if (!tenantId) return Promise.resolve(_attKeysByMonthCache);
            chain = global.emsIdbKvKeysByPrefix('att_rec_' + tenantId + '_').then(function (idbKeys) {
                attBuildKeyIndexFromKeys(idbKeys || []);
                if (!idbKeys || !idbKeys.length) attHarvestLegacyLocalStorageKeysOnce();
                return _attKeysByMonthCache;
            });
        } else if (typeof global.emsIdbKvKeys === 'function') {
            chain = global.emsIdbKvKeys().then(function (all) {
                attBuildKeyIndexFromKeys((all || []).filter(function (k) {
                    return attKeyBelongsToActiveTenant(k);
                }));
                if (!all || !all.length) attHarvestLegacyLocalStorageKeysOnce();
                return _attKeysByMonthCache;
            });
        } else {
            attHarvestLegacyLocalStorageKeysOnce();
            chain = Promise.resolve(_attKeysByMonthCache);
        }
        return chain.then(function () {
            _attAllKeysIndexed = true;
            return _attKeysByMonthCache;
        });
    }

    global.emsAttOfflineKeyIndexInvalidate = function () {
        _attAllKeysIndexed = false;
        _attKeysByMonthCache = Object.create(null);
    };

    /** Sync read after index warm — null means caller should use async variant. */
    global.__emsAttKeyListFromHelper = function (monthStr) {
        if (!_attAllKeysIndexed || !monthStr) return null;
        return (_attKeysByMonthCache[monthStr] || []).slice();
    };

    global.emsOfflineListAttendanceKeys = global.__emsAttKeyListFromHelper;

    global.__emsAttKeyListAsyncFromHelper = function (monthStr) {
        return attEnsureOfflineKeyIndex().then(function () {
            return monthStr ? (_attKeysByMonthCache[monthStr] || []).slice() : [];
        });
    };

    global.emsOfflineListAttendanceKeysAsync = global.__emsAttKeyListAsyncFromHelper;

    function attReadSheetByKeyAsync(key) {
        var sync = null;
        if (typeof global.emsCacheGet === 'function') {
            sync = global.emsCacheGet(key, null);
        } else {
            var raw = typeof global.emsCacheGetRaw === 'function'
                ? global.emsCacheGetRaw(key)
                : (typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null);
            sync = attParseSheet(raw);
        }
        sync = attNormalizeAttendanceCloudDocument(sync);
        if (sync && attHelperHasMeaningfulSheet(sync)) return Promise.resolve(sync);
        if (typeof global.emsIdbKvGet === 'function') {
            return global.emsIdbKvGet(key).then(function (raw) {
                var sheet = attParseSheet(raw);
                return attHelperHasMeaningfulSheet(sheet) ? sheet : null;
            });
        }
        return Promise.resolve(attHelperHasMeaningfulSheet(sync) ? sync : null);
    }

    global.emsOfflineLoadAttendanceSheetsForMonth = function (monthStr) {
        return global.emsOfflineListAttendanceKeysAsync(monthStr).then(function (keys) {
            if (!keys.length) return [];
            return Promise.all(keys.map(attReadSheetByKeyAsync)).then(function (sheets) {
                return sheets.filter(Boolean);
            });
        });
    };

    function attHelperGetSymbols() {
        try {
            return JSON.parse(localStorage.getItem('ems_att_symbols')) || { P: 'P', A: 'A', L: 'L' };
        } catch (eSym) {
            return { P: 'P', A: 'A', L: 'L' };
        }
    }

    function attHelperStatusPresent(st) {
        if (st == null || st === '') return false;
        var sym = attHelperGetSymbols();
        return st === sym.P || st === 'P' || st === 'حاضر' || st === 'ح';
    }

    function attHelperStatusAbsent(st) {
        if (st == null || st === '') return false;
        var sym = attHelperGetSymbols();
        return st === sym.A || st === 'A' || st === 'غائب' || st === 'غ' || st === 'غیر حاضر';
    }

    function attHelperStatusLeave(st) {
        if (st == null || st === '') return false;
        var sym = attHelperGetSymbols();
        return st === sym.L || st === 'L' || st === 'رخصت' || st === 'Leave';
    }

    function attHelperObserveStatus(st) {
        if (typeof global.attMetricsClassifyStatus === 'function') {
            var kind = global.attMetricsClassifyStatus(st);
            if (kind === 'P' || kind === 'A' || kind === 'L') return kind;
            return '';
        }
        if (attHelperStatusPresent(st)) return 'P';
        if (attHelperStatusAbsent(st)) return 'A';
        if (attHelperStatusLeave(st)) return 'L';
        return '';
    }

    function attHelperEmptyDayStats(source) {
        return {
            present: 0,
            absent: 0,
            leave: 0,
            markedTotal: 0,
            presentIds: [],
            absentIds: [],
            leaveIds: [],
            source: source || 'cache'
        };
    }

    function attHelperStatsFromSets(sets, source) {
        if (sets && sets.best) {
            var presentIds = [];
            var absentIds = [];
            var leaveIds = [];
            Object.keys(sets.best).forEach(function (uid) {
                var st = sets.best[uid] && sets.best[uid].status;
                if (st === 'P') presentIds.push(uid);
                else if (st === 'A') absentIds.push(uid);
                else if (st === 'L') leaveIds.push(uid);
            });
            return {
                present: presentIds.length,
                absent: absentIds.length,
                leave: leaveIds.length,
                markedTotal: presentIds.length + absentIds.length + leaveIds.length,
                presentIds: presentIds,
                absentIds: absentIds,
                leaveIds: leaveIds,
                source: source || 'cache'
            };
        }
        var presentIdsLegacy = Array.from(sets.present || []);
        var absentIdsLegacy = Array.from(sets.absent || []).filter(function (id) {
            return !(sets.present && sets.present.has(id));
        });
        var leaveIdsLegacy = Array.from(sets.leave || []).filter(function (id) {
            return !(sets.present && sets.present.has(id)) && !(sets.absent && sets.absent.has(id));
        });
        return {
            present: presentIdsLegacy.length,
            absent: absentIdsLegacy.length,
            leave: leaveIdsLegacy.length,
            markedTotal: presentIdsLegacy.length + absentIdsLegacy.length + leaveIdsLegacy.length,
            presentIds: presentIdsLegacy,
            absentIds: absentIdsLegacy,
            leaveIds: leaveIdsLegacy,
            source: source || 'cache'
        };
    }

    function countDayMarksFromDoc(data, dayNum, sets) {
        if (typeof attNormalizeAttendanceCloudDocument === 'function') {
            data = attNormalizeAttendanceCloudDocument(data);
        }
        if (!data) return;
        sets.best = sets.best || Object.create(null);
        var ts = 0;
        if (data.timestamp) ts = Number(data.timestamp) || 0;
        else if (data.clientUpdatedAt) ts = Number(data.clientUpdatedAt) || 0;
        function consider(uid, raw) {
            var status = attHelperObserveStatus(raw);
            var cleared = !status;
            var cand = { ts: ts, status: status, cleared: cleared, isAll: true };
            var inc = sets.best[uid];
            var better = false;
            if (!inc) better = true;
            else if (typeof global.attMetricsMarkCandidateBetter === 'function') {
                better = global.attMetricsMarkCandidateBetter(cand, inc);
            } else if (cand.ts !== inc.ts) better = cand.ts > inc.ts;
            else if (cand.cleared !== inc.cleared) better = !!cand.cleared;
            if (better) sets.best[uid] = cand;
        }
        Object.keys(data.records || {}).forEach(function (uid) {
            var dayRec = data.records[uid];
            if (!dayRec) return;
            var st = dayRec[dayNum];
            if (st == null || st === '') st = dayRec[String(dayNum)];
            if (st == null) return;
            consider(uid, st);
        });
    }

    /** @deprecated — use countDayMarksFromDoc */
    function countPresentFromDoc(data, todayDateNum, presentSet) {
        if (!data || !data.records) return;
        Object.keys(data.records).forEach(function (uid) {
            var dayRec = data.records[uid];
            if (!dayRec) return;
            var st = dayRec[todayDateNum] || dayRec[String(todayDateNum)];
            if (attHelperStatusPresent(st)) presentSet.add(uid);
        });
    }

    function fetchAttendanceDocsForMonth(db, uid, monthStr) {
        var prefix = 'att_rec_' + monthStr;
        var col = typeof global.emsFirestoreSubColRef === 'function'
            ? global.emsFirestoreSubColRef(db, uid, 'Attendance')
            : db.collection('All_Madrasas').doc(uid).collection('Attendance');
        return col
            .where(firebase.firestore.FieldPath.documentId(), '>=', prefix)
            .where(firebase.firestore.FieldPath.documentId(), '<=', prefix + '\uf8ff')
            .get();
    }

    var _attMonthCloudRefresh = Object.create(null);
    var ATT_MONTH_CLOUD_REFRESH_TTL_MS = 10000;

    function attHelperParseSheetIdentity(key, monthStr) {
        if (!key || key.indexOf('att_rec_') !== 0 || !monthStr) return null;
        var directHead = 'att_rec_' + monthStr + '_';
        var tail = '';
        if (key.indexOf(directHead) === 0) {
            tail = key.slice(directHead.length);
        } else {
            var marker = '_' + monthStr + '_';
            var idx = key.indexOf(marker);
            if (idx < 0) return null;
            tail = key.slice(idx + marker.length);
        }
        var segs = tail.split('_');
        if (!segs.length) return null;
        var type = segs[0] || 'students';
        if (segs.length === 1) return { type: type, classId: '', period: 'all' };
        if (segs.length === 2) return { type: type, classId: segs[1], period: 'all' };
        return {
            type: type,
            classId: segs.slice(1, -1).join('_'),
            period: segs[segs.length - 1] || 'all'
        };
    }

    function attHasPendingCloudMutation(tenantId, cloudDocId) {
        try {
            if (typeof global.attHasPendingCloudPersistForDoc === 'function'
                && global.attHasPendingCloudPersistForDoc(cloudDocId)) {
                return Promise.resolve(true);
            }
        } catch (ePendingUi) { /* continue to durable outbox */ }
        if (typeof global.emsOfflineHasPendingAttendanceMutation !== 'function') {
            return Promise.resolve(false);
        }
        return global.emsOfflineHasPendingAttendanceMutation(tenantId, cloudDocId)
            .catch(function () { return true; });
    }

    /**
     * Refresh one attendance month from Firestore into the tenant-scoped durable cache.
     * Equal timestamps accept the complete cloud document: it is the acknowledgement
     * of the same granular mutation and can safely repair an incomplete local snapshot.
     */
    global.emsAttEnsureMonthFresh = function (monthStr, opts) {
        opts = opts || {};
        monthStr = String(monthStr || '').slice(0, 7);
        var tenantId = getTenantId();
        if (!monthStr || !tenantId || !shouldUseFirestore()) {
            return Promise.resolve({ ok: false, offline: true, month: monthStr, count: 0 });
        }
        var cacheKey = tenantId + '|' + monthStr;
        var cachedState = _attMonthCloudRefresh[cacheKey];
        if (cachedState && cachedState.promise) return cachedState.promise;
        if (!opts.force && cachedState && cachedState.at
            && Date.now() - cachedState.at < ATT_MONTH_CLOUD_REFRESH_TTL_MS) {
            return Promise.resolve(cachedState.result || { ok: true, cached: true, month: monthStr });
        }

        var db = getDb();
        var promise = fetchAttendanceDocsForMonth(db, tenantId, monthStr).then(function (snap) {
            var docs = [];
            snap.forEach(function (doc) {
                if (!doc.id || doc.id.indexOf('att_rec_') !== 0) return;
                docs.push({ id: doc.id, data: attNormalizeAttendanceCloudDocument(doc.data() || {}) });
            });
            var updated = 0;
            var keptLocal = 0;
            var pendingLocalKept = 0;
            return Promise.all(docs.map(function (item) {
                var localKey = attLocalKeyFromCloudDocId(tenantId, item.id);
                var localPromise = typeof global.emsOfflineGetCachedAttendance === 'function'
                    ? global.emsOfflineGetCachedAttendance(item.id, { localKey: localKey })
                    : Promise.resolve(null);
                return localPromise.then(function (local) {
                    return attHasPendingCloudMutation(tenantId, item.id).then(function (hasPending) {
                    // A local mark/delete waiting in memory or the durable outbox
                    // is newer user intent. Automatic refresh must not revive the
                    // currently older Firestore copy over it.
                    if (hasPending) {
                        keptLocal += 1;
                        pendingLocalKept += 1;
                        return null;
                    }
                    var remoteWins = !local || attSheetTimestamp(item.data) >= attSheetTimestamp(local);
                    if (!remoteWins) {
                        keptLocal += 1;
                        return null;
                    }
                    updated += 1;
                    if (typeof global.emsOfflineCacheAttendanceFromRemote !== 'function') return null;
                    return global.emsOfflineCacheAttendanceFromRemote(item.id, item.data, {
                        localKey: localKey
                    });
                    });
                });
            })).then(function () {
                if (typeof global.emsAttOfflineKeyIndexInvalidate === 'function') {
                    global.emsAttOfflineKeyIndexInvalidate();
                }
                if (typeof global.emsInvalidateAttDashboardCache === 'function') {
                    global.emsInvalidateAttDashboardCache();
                }
                return {
                    ok: true,
                    month: monthStr,
                    count: docs.length,
                    updated: updated,
                    keptLocal: keptLocal,
                    pendingLocalKept: pendingLocalKept,
                    source: 'firestore_month'
                };
            });
        }).catch(function (err) {
            return {
                ok: false,
                month: monthStr,
                count: 0,
                error: err && err.message ? err.message : String(err),
                source: 'local_fallback'
            };
        });

        _attMonthCloudRefresh[cacheKey] = { promise: promise, at: 0, result: null };
        return promise.then(function (result) {
            _attMonthCloudRefresh[cacheKey] = { promise: null, at: Date.now(), result: result };
            return result;
        });
    };

    /**
     * Once a canonical `all` sheet exists, it is the only daily source for that
     * register. Historic class/hour sheets remain safely cached for recovery,
     * but must not re-create a day that was deliberately cleared in canonical.
     */
    function attHelperCanonicalMonthRows(rows) {
        rows = (rows || []).filter(Boolean);
        var canonical = Object.create(null);
        rows.forEach(function (row) {
            if (!row || row.period !== 'all') return;
            if (row.type === 'students' && row.classId) {
                canonical['students|' + row.classId] = true;
            } else if ((row.type === 'teachers' || row.type === 'staff') && !row.classId) {
                canonical[row.type + '|'] = true;
            }
        });
        return rows.filter(function (row) {
            if (!row) return false;
            var group = row.type === 'students'
                ? ('students|' + (row.classId || ''))
                : (row.type + '|');
            if (!canonical[group]) return true;
            if (row.type === 'students') return row.period === 'all';
            return row.period === 'all' && !row.classId;
        });
    }

    global.emsAttCanonicalMonthRows = attHelperCanonicalMonthRows;

    /** One shared source for Smart/Collective, dashboard, and reports. */
    global.emsAttCollectMonthSheetsAsync = function (monthStr, opts) {
        opts = opts || {};
        monthStr = String(monthStr || '').slice(0, 7);
        var fresh = opts.cloud === false
            ? Promise.resolve({ ok: true, localOnly: true })
            : global.emsAttEnsureMonthFresh(monthStr, { force: !!opts.force });
        return fresh.then(function () {
            return global.emsOfflineListAttendanceKeysAsync(monthStr);
        }).then(function (keys) {
            return Promise.all((keys || []).map(function (key) {
                return attReadSheetByKeyAsync(key).then(function (data) {
                    var parsed = attHelperParseSheetIdentity(key, monthStr);
                    if (!parsed || !attHelperHasMeaningfulSheet(data)) return null;
                    return {
                        key: key,
                        month: monthStr,
                        type: parsed.type,
                        classId: parsed.classId,
                        period: parsed.period,
                        data: data
                    };
                });
            }));
        }).then(function (rows) {
            return attHelperCanonicalMonthRows(rows);
        });
    };

    /** Prefer AttendanceSummary doc when available (E8) */
    global.emsFetchTodayAttendanceStats = function () {
        var parts = todayParts();
        var summary = typeof global.emsGetAttendanceSummary === 'function'
            ? global.emsGetAttendanceSummary(parts.todayMonth)
            : null;
        if (summary && summary.version >= 1 && summary.todayDate === parts.todayStr) {
            var sPresent = Number(summary.todayPresent) || 0;
            var sAbsent = Number(summary.todayAbsent) || 0;
            var sLeave = Number(summary.todayLeave) || 0;
            var sMarked = sPresent + sAbsent + sLeave;
            return Promise.resolve({
                present: sPresent,
                absent: sAbsent,
                leave: sLeave,
                markedTotal: sMarked,
                presentIds: [],
                absentIds: [],
                leaveIds: [],
                source: 'summary'
            });
        }

        var db = getDb();
        var uid = getTenantId();

        if (!shouldUseFirestore()) {
            return global.emsFetchTodayAttendanceFromCache(parts);
        }

        return withTimeout(
            fetchAttendanceDocsForMonth(db, uid, parts.todayMonth)
                .then(function (snap) {
                    var sets = {
                        present: new Set(),
                        absent: new Set(),
                        leave: new Set()
                    };
                    snap.forEach(function (doc) {
                        countDayMarksFromDoc(doc.data(), parts.todayDateNum, sets);
                    });
                    return attHelperStatsFromSets(sets, 'firestore');
                })
                .catch(function () {
                    return global.emsFetchTodayAttendanceFromCache(parts);
                }),
            3000,
            null
        ).then(function (result) {
            if (result) return result;
            return global.emsFetchTodayAttendanceFromCache(parts);
        });
    };

    /** Fallback: IndexedDB KV index (no full localStorage scan per refresh). */
    global.emsFetchTodayAttendanceFromCache = function (parts) {
        parts = parts || todayParts();

        return global.emsOfflineListAttendanceKeysAsync(parts.todayMonth).then(function (keys) {
            return Promise.all(keys.map(attReadSheetByKeyAsync)).then(function (sheets) {
                if (typeof global.attMetricsBuildFinalMarksForDay === 'function') {
                    var metricSheets = (sheets || []).filter(Boolean).map(function (sheet, idx) {
                        return {
                            key: keys[idx] || ('cache_' + idx),
                            type: 'students',
                            classId: '',
                            period: 'all',
                            data: sheet
                        };
                    });
                    var ids = Object.create(null);
                    metricSheets.forEach(function (sh) {
                        Object.keys((sh.data && sh.data.records) || {}).forEach(function (id) { ids[id] = true; });
                        Object.keys((sh.data && sh.data.periodRecords) || {}).forEach(function (id) { ids[id] = true; });
                    });
                    var roster = Object.keys(ids).map(function (id) { return { id: id, type: 'student' }; });
                    var finalDs = global.attMetricsBuildFinalMarksForDay(parts.todayStr, metricSheets, roster, '');
                    var st = global.attMetricsStatsFromFinalMarks(finalDs, roster);
                    var presentIds = [];
                    var absentIds = [];
                    var leaveIds = [];
                    Object.keys(finalDs.marks || {}).forEach(function (uid) {
                        var status = finalDs.marks[uid] && finalDs.marks[uid].status;
                        if (status === 'P') presentIds.push(uid);
                        else if (status === 'A') absentIds.push(uid);
                        else if (status === 'L') leaveIds.push(uid);
                    });
                    return {
                        present: st.present,
                        absent: st.absent,
                        leave: st.leave,
                        markedTotal: st.markedTotal,
                        presentIds: presentIds,
                        absentIds: absentIds,
                        leaveIds: leaveIds,
                        source: 'cache'
                    };
                }
                var sets = {
                    present: new Set(),
                    absent: new Set(),
                    leave: new Set()
                };
                sheets.forEach(function (sheet) {
                    countDayMarksFromDoc(sheet, parts.todayDateNum, sets);
                });
                return attHelperStatsFromSets(sets, 'cache');
            });
        });
    };

    /** آج کے present طلباء کی تفصیل (dashboard modal) */
    global.emsFetchTodayAttendanceDetails = function (dbUsers) {
        dbUsers = dbUsers || [];
        return global.emsFetchTodayAttendanceStats().then(function (stats) {
            var rows = [];
            stats.presentIds.forEach(function (uid) {
                var std = dbUsers.find(function (u) { return u.id === uid; }) || {};
                rows.push({ uid: uid, name: std.name || '-', status: 'P' });
            });
            return { rows: rows, stats: stats };
        });
    };

    /** گزشتہ N دن کا حاضری رجحان (لائن چارٹ کے لیے) — حقیقی ڈیٹا */
    global.emsFetchAttendanceTrend = function (days) {
        days = days || 7;
        var db = getDb();
        var uid = getTenantId();
        var dateStrs = [];
        var nowParts = todayParts();
        var cursor = new Date(nowParts.todayStr + 'T12:00:00+05:00');
        for (var i = days - 1; i >= 0; i--) {
            var d = new Date(cursor.getTime() - i * 86400000);
            dateStrs.push(emsAttTrendDateForDay(d));
        }

        function sheetsToMetric(month, rawSheets) {
            return (rawSheets || []).map(function (sheet, idx) {
                if (sheet && sheet.data) return sheet;
                return {
                    key: 'trend_' + month + '_' + idx,
                    type: 'students',
                    classId: '',
                    period: 'all',
                    data: sheet
                };
            });
        }

        function accumulate(docs) {
            return dateStrs.map(function (dateStr) {
                var ms = dateStr.substring(0, 7);
                var monthDocs = docs.filter(function (it) { return it.month === ms; });
                var metricSheets = sheetsToMetric(ms, monthDocs.map(function (it) { return it.data; }));
                var present = 0;
                if (typeof global.attMetricsBuildFinalMarksForDay === 'function') {
                    var ids = Object.create(null);
                    metricSheets.forEach(function (sh) {
                        Object.keys((sh.data && sh.data.records) || {}).forEach(function (id) { ids[id] = true; });
                    });
                    var roster = Object.keys(ids).map(function (id) { return { id: id, type: 'student' }; });
                    var finalDs = global.attMetricsBuildFinalMarksForDay(dateStr, metricSheets, roster, '');
                    var stats = global.attMetricsStatsFromFinalMarks(finalDs, roster);
                    present = stats.present || 0;
                } else {
                    var sets = { present: new Set(), absent: new Set(), leave: new Set() };
                    monthDocs.forEach(function (it) {
                        countDayMarksFromDoc(it.data, parseInt(dateStr.substring(8, 10), 10), sets);
                    });
                    present = attHelperStatsFromSets(sets, 'trend').present;
                }
                return { date: dateStr.substring(5), present: present };
            });
        }

        function fromCache() {
            var monthsNeeded = {};
            dateStrs.forEach(function (ds) { monthsNeeded[ds.substring(0, 7)] = true; });
            var monthKeys = Object.keys(monthsNeeded);
            return Promise.all(monthKeys.map(function (m) {
                return global.emsOfflineLoadAttendanceSheetsForMonth(m).then(function (sheets) {
                    return sheets.map(function (sheet) {
                        return { month: m, data: sheet };
                    });
                });
            })).then(function (groups) {
                var docs = [];
                groups.forEach(function (g) { docs = docs.concat(g); });
                return accumulate(docs);
            });
        }

        if (shouldUseFirestore()) {
            var monthsNeeded = {};
            dateStrs.forEach(function (ds) { monthsNeeded[ds.substring(0, 7)] = true; });
            var monthKeys = Object.keys(monthsNeeded);
            return withTimeout(
                Promise.all(monthKeys.map(function (m) {
                    return fetchAttendanceDocsForMonth(db, uid, m).then(function (snap) {
                        var docs = [];
                        snap.forEach(function (doc) {
                            if (doc.id.indexOf('att_rec_') !== 0) return;
                            docs.push({
                                month: doc.id.substring(8, 15),
                                data: attNormalizeAttendanceCloudDocument(doc.data())
                            });
                        });
                        return docs;
                    });
                })).then(function (groups) {
                    var docs = [];
                    groups.forEach(function (g) { docs = docs.concat(g); });
                    return accumulate(docs);
                }).catch(function () { return fromCache(); }),
                3500,
                null
            ).then(function (result) {
                return result || fromCache();
            });
        }
        return fromCache();
    };

    global.emsAttReadSheetByKeyAsync = attReadSheetByKeyAsync;

    function attMonthsBetween(fromMonth, toMonth) {
        var out = [];
        if (!fromMonth || !toMonth) return out;
        var y = parseInt(fromMonth.slice(0, 4), 10);
        var m = parseInt(fromMonth.slice(5, 7), 10);
        var ey = parseInt(toMonth.slice(0, 4), 10);
        var em = parseInt(toMonth.slice(5, 7), 10);
        if (isNaN(y) || isNaN(m) || isNaN(ey) || isNaN(em)) return out;
        while (y < ey || (y === ey && m <= em)) {
            out.push(y + '-' + String(m).padStart(2, '0'));
            m++;
            if (m > 12) { m = 1; y++; }
        }
        return out;
    }

    /** Async report sheet collector — IDB month index + cache/IDB reads (no localStorage scan). */
    global.emsAttCollectReportSheetsAsync = function (fromDate, toDate) {
        var fromMonth = String(fromDate || '').slice(0, 7);
        var toMonth = String(toDate || '').slice(0, 7);
        var months = attMonthsBetween(fromMonth, toMonth);
        if (!months.length && fromMonth) months = [fromMonth];

        return Promise.all(months.map(function (monthStr) {
            if (typeof global.emsArchiveMonthInWindow === 'function' && !global.emsArchiveMonthInWindow(monthStr)) {
                return Promise.resolve([]);
            }
            return global.emsAttCollectMonthSheetsAsync(monthStr).then(function (sheets) {
                return (sheets || []).map(function (entry) {
                    var sheet = entry.data || {};
                    return {
                        key: entry.key,
                        month: monthStr,
                        type: entry.type,
                        classId: entry.classId,
                        period: entry.period,
                        records: sheet.records || {},
                        remarks: sheet.remarks || {},
                        periodRecords: sheet.periodRecords || {},
                        timestamp: attSheetTimestamp(sheet)
                    };
                });
            });
        })).then(function (nested) {
            var flat = [];
            nested.forEach(function (arr) {
                flat = flat.concat(arr);
            });
            return flat;
        });
    };

    /** Staff/teacher registers only — att_rec_* keys containing _teachers_ or _staff_ */
    function attPayrollIsStaffRegisterKey(key) {
        return !!(key && /_(teachers|staff)_/i.test(key));
    }

    function attPayrollUrduStatus(st) {
        if (attHelperStatusAbsent(st)) return 'غیر حاضر';
        if (attHelperStatusLeave(st)) return 'رخصت';
        if (attHelperStatusPresent(st)) return 'حاضر';
        return null;
    }

    var ATT_PAYROLL_STATUS_PRI = { 'غیر حاضر': 3, 'رخصت': 2, 'حاضر': 1 };

    /** Flatten live att_rec sheets → payroll rows { studentId, date, status } */
    function attPayrollFlattenSheets(sheets) {
        var byKey = Object.create(null);
        (sheets || []).forEach(function (sheet) {
            var month = sheet.month;
            if (!month || !sheet.records) return;
            Object.keys(sheet.records).forEach(function (uid) {
                var dayRec = sheet.records[uid];
                if (!dayRec || typeof dayRec !== 'object') return;
                Object.keys(dayRec).forEach(function (dayKey) {
                    var dayNum = parseInt(dayKey, 10);
                    if (!dayNum || dayNum < 1 || dayNum > 31) return;
                    var fullDate = month + '-' + (dayNum < 10 ? '0' + dayNum : String(dayNum));
                    var status = attPayrollUrduStatus(dayRec[dayKey]);
                    if (!status || status === 'حاضر') return;
                    var k = uid + '|' + fullDate;
                    if (!byKey[k] || ATT_PAYROLL_STATUS_PRI[status] > ATT_PAYROLL_STATUS_PRI[byKey[k].status]) {
                        byKey[k] = { studentId: uid, date: fullDate, status: status };
                    }
                });
            });
        });
        return Object.keys(byKey).map(function (k) { return byKey[k]; });
    }

    function attPayrollLoadStaffSheetsForMonth(monthStr) {
        return global.emsOfflineListAttendanceKeysAsync(monthStr).then(function (keys) {
            var staffKeys = (keys || []).filter(attPayrollIsStaffRegisterKey);
            if (!staffKeys.length) return [];
            return Promise.all(staffKeys.map(function (key) {
                return attReadSheetByKeyAsync(key).then(function (sheet) {
                    if (!attHelperHasMeaningfulSheet(sheet)) return null;
                    return { month: monthStr, records: sheet.records, remarks: sheet.remarks || {} };
                });
            })).then(function (rows) {
                return rows.filter(Boolean);
            });
        });
    }

    /**
     * Bridge live att_rec_* registers for payroll (replaces deprecated ems_full_attendance).
     * Loads all staff/teacher sheets for the calendar year of monthVal (leave quota needs YTD).
     */
    global.emsFetchAttendanceForPayroll = function (monthVal) {
        monthVal = String(monthVal || '').trim();
        if (!monthVal || monthVal.length < 7) return Promise.resolve([]);
        var year = monthVal.substring(0, 4);
        var yearStart = year + '-01';
        var yearEnd = year + '-12';
        var months = attMonthsBetween(yearStart, yearEnd);
        if (!months.length) months = [monthVal];
        return Promise.all(months.map(attPayrollLoadStaffSheetsForMonth)).then(function (nested) {
            var sheets = [];
            nested.forEach(function (arr) {
                sheets = sheets.concat(arr || []);
            });
            return attPayrollFlattenSheets(sheets);
        });
    };

    global.emsApplyDashboardAttendance = function (totalStudents) {
        var el = document.getElementById('dash-att-rate');
        if (!el) return Promise.resolve();

        return global.emsFetchTodayAttendanceStats().then(function (stats) {
            var markedTotal = stats.markedTotal != null
                ? stats.markedTotal
                : ((stats.present || 0) + (stats.absent || 0) + (stats.leave || 0));
            if (markedTotal <= 0) {
                el.innerText = '—';
                el.title = 'حاضری نہیں لی گئی';
                return;
            }
            var pct = Math.min(100, Math.round(((stats.present || 0) / markedTotal) * 100));
            el.innerText = pct + '%';
            el.title = stats.source === 'firestore' ? 'Firestore حاضری' : (stats.source === 'summary' ? 'Summary حاضری' : 'کیشے (fallback)');
        });
    };

    function attSheetTimestamp(rec) {
        if (!rec) return 0;
        if (rec.timestamp) return Number(rec.timestamp) || 0;
        if (rec.updatedAt) {
            var t = rec.updatedAt;
            if (typeof t === 'number') return t;
            if (t && typeof t.toMillis === 'function') return t.toMillis();
            if (typeof t === 'string') return Date.parse(t) || 0;
        }
        return 0;
    }

    function attReconcileLocalRemote(localRec, remoteRec) {
        if (!remoteRec) return localRec || null;
        if (!localRec) return remoteRec;
        return attSheetTimestamp(remoteRec) >= attSheetTimestamp(localRec) ? remoteRec : localRec;
    }

    /** Cloud doc id → tenant-scoped durable key (att_rec_{tid}_…). */
    function attLocalKeyFromCloudDocId(tenantId, cloudDocId) {
        if (!cloudDocId) return cloudDocId;
        if (cloudDocId.indexOf('att_rec_') !== 0) return cloudDocId;
        var tid = tenantId || getTenantId();
        if (!tid) return null;
        var rest = cloudDocId.slice('att_rec_'.length);
        if (rest.indexOf(tid + '_') === 0) return cloudDocId;
        return 'att_rec_' + tid + '_' + rest;
    }

    function attIsRecognizedCloudSheetDocId(cloudDocId) {
        return /^att_rec_\d{4}-\d{2}_(students|teachers|staff)_/.test(String(cloudDocId || ''));
    }

    /**
     * Manual cloud pull for Attendance department only.
     * Pulls ModuleData settings group + all Attendance sheet docs into local SSOT.
     * Newer local sheets are kept (timestamp reconcile) so clears are not revived.
     */
    global.emsPullAttendanceFromCloud = function (tenantId, opts) {
        opts = opts || {};
        var verifiedTenantId = getTenantId();
        tenantId = tenantId || verifiedTenantId;
        if (!tenantId || !verifiedTenantId) {
            return Promise.resolve({ ok: false, reason: 'no_tenant', count: 0, source: 'attendance_cloud_pull' });
        }
        if (String(tenantId) !== String(verifiedTenantId)) {
            return Promise.resolve({
                ok: false,
                reason: 'tenant_mismatch',
                count: 0,
                source: 'attendance_cloud_pull',
                tenantId: tenantId,
                verifiedTenantId: verifiedTenantId
            });
        }

        var db = getDb();
        if (!db && typeof global.getDbOrNull === 'function') db = global.getDbOrNull();
        if (!db) {
            return Promise.resolve({
                ok: false,
                reason: 'firestore_unavailable',
                count: 0,
                source: 'attendance_cloud_pull'
            });
        }

        // `ems_att_periods` must never arrive through the generic settings
        // pull.  The specialised reader below verifies the active tenant and
        // teacher roster before applying a timetable.
        var settingsP = Promise.resolve({ pulled: 0 });
        if (typeof global.emsPullModuleGroup === 'function') {
            settingsP = global.emsPullModuleGroup('Attendance', {
                excludeKeys: ['ems_att_periods'],
                attendanceSafeSettingsOnly: true
            }).catch(function () {
                return { pulled: 0 };
            });
        }

        var col = typeof global.emsFirestoreSubColRef === 'function'
            ? global.emsFirestoreSubColRef(db, tenantId, 'Attendance')
            : db.collection('All_Madrasas').doc(tenantId).collection('Attendance');

        if (!col) {
            return Promise.resolve({
                ok: false,
                reason: 'firestore_unavailable',
                count: 0,
                source: 'attendance_cloud_pull'
            });
        }

        return settingsP.then(function (settingsRes) {
            var timetableP = typeof global.emsPullAttendanceTimetableFromCloud === 'function'
                ? global.emsPullAttendanceTimetableFromCloud(tenantId)
                : Promise.resolve({ ok: false, reason: 'timetable_helper_unavailable', count: 0 });
            return timetableP.then(function (timetableRes) {
            return col.get().then(function (snap) {
                var docs = [];
                var invalidDocsSkipped = 0;
                snap.forEach(function (doc) {
                    var id = doc.id;
                    if (!id || id.indexOf('att_rec_') !== 0) return;
                    if (!attIsRecognizedCloudSheetDocId(id)) {
                        invalidDocsSkipped++;
                        return;
                    }
                    docs.push({ id: id, data: attNormalizeAttendanceCloudDocument(doc.data() || {}) });
                });

                var cached = 0;
                var updated = 0;
                var keptLocal = 0;
                var pendingLocalKept = 0;
                var chain = Promise.resolve();

                docs.forEach(function (item) {
                    chain = chain.then(function () {
                        var localKey = attLocalKeyFromCloudDocId(tenantId, item.id);
                        var getLocal = typeof global.emsOfflineGetCachedAttendance === 'function'
                            ? global.emsOfflineGetCachedAttendance(item.id, { localKey: localKey })
                            : Promise.resolve(null);

                        return getLocal.then(function (local) {
                            return attHasPendingCloudMutation(tenantId, item.id).then(function (hasPending) {
                            // A local save/clear that has not reached Firebase is
                            // newer user intent. The recovery button must never
                            // replace it with the currently older cloud copy.
                            if (hasPending) {
                                keptLocal++;
                                pendingLocalKept++;
                                return null;
                            }
                            // This is the explicit, confirmed recovery button. Its
                            // dialog says the local attendance cache will be replaced,
                            // so the verified tenant's normalized Firestore document
                            // must win even when a stale/empty local copy has a newer
                            // client timestamp.
                            var forceVerifiedCloud = opts.preferCloud !== false;
                            var remoteWins = forceVerifiedCloud
                                || !local
                                || attSheetTimestamp(item.data) >= attSheetTimestamp(local);
                            if (!remoteWins) {
                                keptLocal++;
                                return null;
                            }
                            // The confirmed cloud button promises to replace the
                            // local attendance cache. Do not run that choice back
                            // through timestamp reconciliation: a newer but empty
                            // stale cache would otherwise win again and Smart
                            // Register would show its lock without its marks.
                            var merged = forceVerifiedCloud
                                ? item.data
                                : attReconcileLocalRemote(local, item.data);
                            if (typeof global.emsOfflineCacheAttendanceFromRemote !== 'function') {
                                cached++;
                                updated++;
                                return null;
                            }
                            return global.emsOfflineCacheAttendanceFromRemote(item.id, merged, {
                                localKey: localKey
                            }).then(function () {
                                cached++;
                                updated++;
                            });
                            });
                        });
                    });
                });

                return chain.then(function () {
                    if (typeof global.emsInvalidateAttDashboardCache === 'function') {
                        global.emsInvalidateAttDashboardCache();
                    }
                    return {
                        ok: true,
                        count: docs.length,
                        sheets: docs.length,
                        cached: cached,
                        updated: updated,
                        keptLocal: keptLocal,
                        pendingLocalKept: pendingLocalKept,
                        invalidDocsSkipped: invalidDocsSkipped,
                        settingsPulled: (settingsRes && settingsRes.pulled) || 0,
                        timetablePulled: !!(timetableRes && timetableRes.ok),
                        timetableCount: (timetableRes && timetableRes.count) || 0,
                        timetableTeacherCount: (timetableRes && timetableRes.teacherCount) || 0,
                        timetableReason: timetableRes && timetableRes.reason,
                        source: 'attendance_cloud_pull',
                        tenantId: tenantId
                    };
                });
            });
            });
        }).catch(function (err) {
            return {
                ok: false,
                error: err && err.message ? err.message : String(err),
                count: 0,
                source: 'attendance_cloud_pull',
                tenantId: tenantId
            };
        });
    };

})(window);
