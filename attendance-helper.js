// ============================================================================
// EMS Attendance Helper — Firestore-based dashboard stats (Phase 3)
// ============================================================================
(function (global) {
    'use strict';

    function getTenantId() {
        if (global.CURRENT_MADRASA_TENANT_ID) return global.CURRENT_MADRASA_TENANT_ID;
        var user = firebase.auth().currentUser;
        return user ? user.uid : null;
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

    function todayParts() {
        var todayStr = new Date().toISOString().split('T')[0];
        return {
            todayStr: todayStr,
            todayMonth: todayStr.substring(0, 7),
            todayDateNum: parseInt(todayStr.substring(8, 10), 10)
        };
    }

    var _attKeysByMonthCache = Object.create(null);
    var _attAllKeysIndexed = false;

    function attParseSheet(raw) {
        if (raw == null) return null;
        try {
            return typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch (e) {
            return null;
        }
    }

    function attMonthFromAttKey(key) {
        if (!key || key.indexOf('att_rec_') !== 0) return null;
        var m = key.match(/att_rec_(?:[^_]+_)?(\d{4}-\d{2})_/);
        if (m) return m[1];
        return key.length >= 15 ? key.substring(8, 15) : null;
    }

    function attBuildKeyIndexFromKeys(keys) {
        (keys || []).forEach(function (key) {
            if (!key || key.indexOf('att_rec_') !== 0) return;
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
                if (k && k.indexOf('att_rec_') === 0) attBuildKeyIndexFromKeys([k]);
            }
        } catch (e) { /* ignore */ }
    }

    function attEnsureOfflineKeyIndex() {
        if (_attAllKeysIndexed) {
            return Promise.resolve(_attKeysByMonthCache);
        }
        var chain;
        if (typeof global.emsIdbKvKeysByPrefix === 'function') {
            chain = global.emsIdbKvKeysByPrefix('att_rec_').then(function (idbKeys) {
                attBuildKeyIndexFromKeys(idbKeys || []);
                if (!idbKeys || !idbKeys.length) attHarvestLegacyLocalStorageKeysOnce();
                return _attKeysByMonthCache;
            });
        } else if (typeof global.emsIdbKvKeys === 'function') {
            chain = global.emsIdbKvKeys().then(function (all) {
                attBuildKeyIndexFromKeys((all || []).filter(function (k) {
                    return k && k.indexOf('att_rec_') === 0;
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
        if (sync && sync.records) return Promise.resolve(sync);
        if (typeof global.emsIdbKvGet === 'function') {
            return global.emsIdbKvGet(key).then(function (raw) {
                var sheet = attParseSheet(raw);
                return sheet && sheet.records ? sheet : null;
            });
        }
        return Promise.resolve(sync && sync.records ? sync : null);
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
        var presentIds = Array.from(sets.present);
        var absentIds = Array.from(sets.absent).filter(function (id) { return !sets.present.has(id); });
        var leaveIds = Array.from(sets.leave).filter(function (id) {
            return !sets.present.has(id) && !sets.absent.has(id);
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

    function countDayMarksFromDoc(data, dayNum, sets) {
        if (!data || !data.records) return;
        Object.keys(data.records).forEach(function (uid) {
            var dayRec = data.records[uid];
            if (!dayRec) return;
            var st = dayRec[dayNum] || dayRec[String(dayNum)];
            if (attHelperStatusPresent(st)) sets.present.add(uid);
            else if (attHelperStatusAbsent(st)) sets.absent.add(uid);
            else if (attHelperStatusLeave(st)) sets.leave.add(uid);
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
        var dates = [];
        var now = new Date();
        for (var i = days - 1; i >= 0; i--) {
            dates.push(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i));
        }
        function ymd(d) { return d.toISOString().split('T')[0]; }
        function monthOf(d) { return ymd(d).substring(0, 7); }

        function accumulate(docs) {
            // docs: [{ month, data }]
            return dates.map(function (d) {
                var ms = monthOf(d), dayNum = d.getDate(), present = 0;
                docs.forEach(function (it) {
                    if (it.month !== ms || !it.data || !it.data.records) return;
                    var rec = it.data.records;
                    for (var u in rec) { if (rec[u] && rec[u][dayNum] === 'P') present++; }
                });
                return { date: ymd(d).substring(5), present: present };
            });
        }

        function fromCache() {
            var monthsNeeded = {};
            dates.forEach(function (d) { monthsNeeded[monthOf(d)] = true; });
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
            dates.forEach(function (d) { monthsNeeded[monthOf(d)] = true; });
            var monthKeys = Object.keys(monthsNeeded);
            return withTimeout(
                Promise.all(monthKeys.map(function (m) {
                    return fetchAttendanceDocsForMonth(db, uid, m).then(function (snap) {
                        var docs = [];
                        snap.forEach(function (doc) {
                            if (doc.id.indexOf('att_rec_') !== 0) return;
                            docs.push({ month: doc.id.substring(8, 15), data: doc.data() });
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
            return global.emsOfflineListAttendanceKeysAsync(monthStr).then(function (keys) {
                if (!keys || !keys.length) return [];
                return Promise.all(keys.map(function (key) {
                    return attReadSheetByKeyAsync(key).then(function (sheet) {
                        if (!sheet || !sheet.records) return null;
                        return {
                            month: monthStr,
                            records: sheet.records,
                            remarks: sheet.remarks || {}
                        };
                    });
                })).then(function (rows) {
                    return rows.filter(Boolean);
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
                    if (!sheet || !sheet.records) return null;
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

})(window);
