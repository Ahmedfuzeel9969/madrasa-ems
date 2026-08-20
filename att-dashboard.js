// ============================================================================
// حاضری ماڈیول — مرکزی ڈیش بورڈ (main dashboard style)
// ============================================================================
(function (global) {
    'use strict';

    var _attDashInflight = null;
    var _attDashFilterTimer = null;
    var _attDashRenderGen = 0;
    var _attSheetCache = { month: null, tenantId: null, sheets: null };
    var _attTabBootHandlers = Object.create(null);
    var _attRibbonDelegated = false;

    function attPanelIsVisible(panelId) {
        var el = document.getElementById(panelId);
        if (!el) return false;
        if (!el.classList.contains('att-panel')) return false;
        return el.classList.contains('active');
    }
    global.emsAttPanelIsVisible = attPanelIsVisible;

    /** Timetable stubs — attendance.js overwrites when fully loaded; prevents onclick errors during lazy load */
    if (typeof global.ttSetView !== 'function') {
        global.ttSetView = function (view) {
            global._ttView = view;
            var tBtn = document.getElementById('tt-view-teacher');
            var cBtn = document.getElementById('tt-view-class');
            if (tBtn) tBtn.classList.toggle('active', view === 'teacher');
            if (cBtn) cBtn.classList.toggle('active', view === 'class');
            if (typeof global.renderTimetable === 'function') global.renderTimetable();
        };
    }
    if (typeof global.ttClearFilters !== 'function') {
        global.ttClearFilters = function () {
            ['tt-filter-teacher', 'tt-filter-class', 'tt-filter-book', 'tt-filter-day', 'tt-filter-search'].forEach(function (id) {
                var el = document.getElementById(id);
                if (el) el.value = '';
            });
            if (typeof global.renderTimetable === 'function') global.renderTimetable();
        };
    }
    if (typeof global.renderTimetable !== 'function') {
        global.renderTimetable = function () { /* no-op until attendance.js loads */ };
    }

    global.attDashCancelRender = function () {
        _attDashRenderGen += 1;
        _attDashInflight = null;
    };

    function attDashInvalidateSheetCache() {
        _attSheetCache.month = null;
        _attSheetCache.tenantId = null;
        _attSheetCache.sheets = null;
    }
    global.emsInvalidateAttDashboardCache = attDashInvalidateSheetCache;

    function setTxt(id, val) {
        var el = document.getElementById(id);
        if (el) el.innerText = val == null ? '—' : String(val);
    }

    function setHTML(id, html) {
        var el = document.getElementById(id);
        if (el) el.innerHTML = html;
    }

    function fmt(n) {
        return (Number(n) || 0).toLocaleString('ur-PK');
    }

    var ATT_DASH_TZ = 'Asia/Karachi';

    function attDashLocalDateParts(d) {
        d = d || new Date();
        try {
            var fmt = new Intl.DateTimeFormat('en-CA', {
                timeZone: ATT_DASH_TZ,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            });
            var y = '';
            var m = '';
            var day = '';
            fmt.formatToParts(d).forEach(function (p) {
                if (p.type === 'year') y = p.value;
                if (p.type === 'month') m = p.value;
                if (p.type === 'day') day = p.value;
            });
            if (y && m && day) {
                return { dateStr: y + '-' + m + '-' + day };
            }
        } catch (eTz) { /* fallback below */ }
        return { dateStr: d.toISOString().split('T')[0] };
    }

    function todayStr() {
        return attDashLocalDateParts().dateStr;
    }

    function monthOf(dateStr) {
        return String(dateStr || '').substring(0, 7);
    }

    function dayNumOf(dateStr) {
        return parseInt(String(dateStr || '').substring(8, 10), 10);
    }

    function attDashGetUserId(u) {
        if (typeof global.attGetUserId === 'function') return global.attGetUserId(u);
        if (!u) return '';
        return String(u.id || u.regId || u.uid || u.docId || '').trim();
    }

    function attDashGetSymbols() {
        try {
            return JSON.parse(localStorage.getItem('ems_att_symbols')) || { P: 'P', A: 'A', L: 'L' };
        } catch (eSym) {
            return { P: 'P', A: 'A', L: 'L' };
        }
    }

    function attDashStatusPresent(st) {
        if (st == null || st === '') return false;
        var sym = attDashGetSymbols();
        return st === sym.P || st === 'P' || st === 'حاضر' || st === 'ح';
    }

    function attDashStatusLeave(st) {
        if (st == null || st === '') return false;
        var sym = attDashGetSymbols();
        return st === sym.L || st === 'L' || st === 'رخصت' || st === 'Leave';
    }

    function attDashStatusAbsent(st) {
        if (st == null || st === '') return false;
        var sym = attDashGetSymbols();
        return st === sym.A || st === 'A' || st === 'غائب' || st === 'غ' || st === 'غیر حاضر';
    }

    function attDashIsFutureDate(dateStr) {
        return String(dateStr || '') > todayStr();
    }

    function attDashComputeRate(present, absent, leave) {
        var markedTotal = (present || 0) + (absent || 0) + (leave || 0);
        if (markedTotal <= 0) return { rate: null, markedTotal: 0, notTaken: true };
        return {
            rate: Math.min(100, Math.round(((present || 0) / markedTotal) * 100)),
            markedTotal: markedTotal,
            notTaken: false
        };
    }

    function attDashReadDayObservation(dayRec, dayNum) {
        if (!dayRec || typeof dayRec !== 'object') {
            return { hasKey: false, status: '' };
        }
        var hasKey = Object.prototype.hasOwnProperty.call(dayRec, dayNum)
            || Object.prototype.hasOwnProperty.call(dayRec, String(dayNum));
        if (!hasKey) return { hasKey: false, status: '' };
        var st = dayRec[dayNum];
        if (st == null || st === '') st = dayRec[String(dayNum)];
        if (st == null) st = '';
        return { hasKey: true, status: String(st).trim() };
    }

    function attDashNormalizeStatusBucket(st) {
        if (typeof global.attMetricsStrictBucket === 'function') {
            return global.attMetricsStrictBucket(st);
        }
        if (attDashStatusPresent(st)) return 'P';
        if (attDashStatusAbsent(st)) return 'A';
        if (attDashStatusLeave(st)) return 'L';
        return '';
    }

    /** Newer ts wins; on tie prefer period=all; clear/tombstone beats stale mark. */
    function attDashMarkCandidateBetter(cand, incumbent) {
        if (typeof global.attMetricsMarkCandidateBetter === 'function') {
            return global.attMetricsMarkCandidateBetter(cand, incumbent);
        }
        if (!incumbent) return true;
        if (!cand) return false;
        if (cand.ts !== incumbent.ts) return cand.ts > incumbent.ts;
        if (cand.isAll !== incumbent.isAll) return !!cand.isAll;
        if (cand.cleared !== incumbent.cleared) return !!cand.cleared;
        return false;
    }

    function attDashBuildFinalMarksForDay(dateStr, sheets, rosterUsers, periodFilter) {
        if (typeof global.attMetricsBuildFinalMarksForDay === 'function') {
            return global.attMetricsBuildFinalMarksForDay(dateStr, sheets, rosterUsers, periodFilter);
        }
        return { roster: {}, marks: {}, dayNum: dayNumOf(dateStr), dateStr: dateStr, periodFilter: periodFilter || '' };
    }

    function attDashAssertStatsInvariant(stats, ctx) {
        var p = stats.present || 0;
        var a = stats.absent || 0;
        var l = stats.leave || 0;
        var unmarked = stats.notMarked || 0;
        var total = stats.total || 0;
        var marked = p + a + l;
        if (marked > total) {
            var msg = '[EMS] att-dash invariant: marked(' + marked + ') > target(' + total + ') — ' + (ctx || '');
            console.error(msg, { present: p, absent: a, leave: l, unmarked: unmarked, total: total });
            stats.diagnosticError = msg;
            stats.invariantBroken = true;
        }
        if (p + a + l + unmarked !== total) {
            // Repair unmarked rather than silently publishing bad math
            stats.notMarked = Math.max(0, total - marked);
            if (p + a + l + stats.notMarked !== total) {
                stats.invariantBroken = true;
                stats.diagnosticError = (stats.diagnosticError || '') +
                    ' | P+A+L+unmarked !== target';
                console.error('[EMS] att-dash invariant failed', stats);
            }
        }
        return stats;
    }

    function attDashStatsFromFinalMarks(finalDataset, rosterUsers) {
        var total = (rosterUsers || []).length;
        var present = 0;
        var absent = 0;
        var leave = 0;
        var marks = (finalDataset && finalDataset.marks) || {};
        Object.keys(marks).forEach(function (uid) {
            var st = marks[uid] && marks[uid].status;
            if (st === 'P') present++;
            else if (st === 'A') absent++;
            else if (st === 'L') leave++;
        });
        var rateInfo = attDashComputeRate(present, absent, leave);
        var notMarked = Math.max(0, total - rateInfo.markedTotal);
        var stats = {
            present: present,
            absent: absent,
            leave: leave,
            notMarked: notMarked,
            total: total,
            markedTotal: rateInfo.markedTotal,
            rate: rateInfo.rate,
            notTaken: rateInfo.notTaken,
            lockedSheets: 0,
            source: 'local',
            rows: marks
        };
        return attDashAssertStatsInvariant(stats, 'stats-from-final');
    }

    function attDashClassBreakdownFromFinal(finalDataset, rosterUsers) {
        var byClass = Object.create(null);
        (rosterUsers || []).forEach(function (u) {
            if (attDashNormType(u) !== 'student') return;
            var cls = String(u.class || u.className || u.grade || 'نامعلوم').trim() || 'نامعلوم';
            if (!byClass[cls]) {
                byClass[cls] = {
                    className: cls,
                    total: 0,
                    present: 0,
                    absent: 0,
                    leave: 0
                };
            }
            byClass[cls].total++;
        });
        var marks = (finalDataset && finalDataset.marks) || {};
        Object.keys(marks).forEach(function (uid) {
            var m = marks[uid];
            if (!m || m.role !== 'student') return;
            var cls = m.classId || 'نامعلوم';
            if (!byClass[cls]) return;
            if (m.status === 'P') byClass[cls].present++;
            else if (m.status === 'A') byClass[cls].absent++;
            else if (m.status === 'L') byClass[cls].leave++;
        });
        return Object.keys(byClass).sort().map(function (k) {
            var row = byClass[k];
            var rateInfo = attDashComputeRate(row.present, row.absent, row.leave);
            row.notMarked = Math.max(0, row.total - rateInfo.markedTotal);
            row.markedTotal = rateInfo.markedTotal;
            row.rate = rateInfo.rate;
            row.notTaken = rateInfo.notTaken;
            attDashAssertStatsInvariant({
                present: row.present,
                absent: row.absent,
                leave: row.leave,
                notMarked: row.notMarked,
                total: row.total,
                markedTotal: row.markedTotal
            }, 'class:' + k);
            return row;
        });
    }

    function attDashApplyStatsKpis(stats) {
        var notTaken = stats.rate == null || stats.notTaken;
        setTxt('att-dash-present', notTaken ? '—' : stats.present);
        setTxt('att-dash-absent', notTaken ? '—' : stats.absent);
        setTxt('att-dash-leave', notTaken ? '—' : stats.leave);
        setTxt('att-dash-rate', notTaken ? 'حاضری نہیں لی گئی' : (stats.rate + '%'));
        if (stats.invariantBroken && typeof global.showToast === 'function') {
            global.showToast('حاضری شماریات میں تضاد — تفصیل کنسول میں', 'error');
        }
    }

    function attDashMergeRemoteStats(localStats, remote, users) {
        if (!remote) return localStats;
        // Local normalized sheets are SSOT — never stack cloud summary on top (double-count).
        if (localStats && localStats.markedTotal > 0) {
            return localStats;
        }
        var rosterIds = Object.create(null);
        (users || []).forEach(function (u) {
            var id = attDashGetUserId(u);
            if (id) rosterIds[id] = true;
        });

        var present = localStats.present || 0;
        var absent = localStats.absent || 0;
        var leave = localStats.leave || 0;

        if (Array.isArray(remote.presentIds) || Array.isArray(remote.absentIds) || Array.isArray(remote.leaveIds)) {
            var pSet = Object.create(null);
            var aSet = Object.create(null);
            var lSet = Object.create(null);
            (remote.presentIds || []).forEach(function (id) { if (rosterIds[id]) pSet[id] = true; });
            (remote.absentIds || []).forEach(function (id) { if (rosterIds[id] && !pSet[id]) aSet[id] = true; });
            (remote.leaveIds || []).forEach(function (id) { if (rosterIds[id] && !pSet[id] && !aSet[id]) lSet[id] = true; });
            present = Object.keys(pSet).length;
            absent = Object.keys(aSet).length;
            leave = Object.keys(lSet).length;
        } else {
            if (typeof remote.present === 'number') {
                present = Math.max(0, Math.min(remote.present, Object.keys(rosterIds).length));
            }
            if (typeof remote.absent === 'number') {
                absent = Math.max(0, Math.min(remote.absent, Object.keys(rosterIds).length));
            }
            if (typeof remote.leave === 'number') {
                leave = Math.max(0, Math.min(remote.leave, Object.keys(rosterIds).length));
            }
        }

        var rateInfo = attDashComputeRate(present, absent, leave);
        var total = (users && users.length) || localStats.total || 0;
        return attDashAssertStatsInvariant({
            present: present,
            absent: absent,
            leave: leave,
            notMarked: Math.max(0, total - rateInfo.markedTotal),
            total: total,
            markedTotal: rateInfo.markedTotal,
            rate: rateInfo.rate,
            notTaken: rateInfo.notTaken,
            lockedSheets: localStats.lockedSheets || 0,
            source: remote.source || 'cloud'
        }, 'remote-merge');
    }

    function attDashSheetTimestamp(data) {
        if (!data) return 0;
        if (data.timestamp) return Number(data.timestamp) || 0;
        if (data.clientUpdatedAt) return Number(data.clientUpdatedAt) || 0;
        if (data.updatedAt) {
            var t = data.updatedAt;
            if (typeof t === 'number') return t;
            if (t && typeof t.toMillis === 'function') return t.toMillis();
            if (typeof t === 'string') return Date.parse(t) || 0;
        }
        return 0;
    }

    function attDashRecordMarkCount(data) {
        var rec = (data && data.records) || {};
        var n = 0;
        Object.keys(rec).forEach(function (uid) {
            var dayRec = rec[uid];
            if (!dayRec) return;
            Object.keys(dayRec).forEach(function (d) {
                if (dayRec[d]) n++;
            });
        });
        return n;
    }

    function attDashReadSheetAsync(key) {
        if (typeof global.emsAttReadSheetByKeyAsync === 'function') {
            return global.emsAttReadSheetByKeyAsync(key);
        }
        if (typeof global.emsCacheGet === 'function') {
            var cached = global.emsCacheGet(key, null);
            if (cached && cached.records) return Promise.resolve(cached);
        }
        if (typeof global.emsIdbKvGet === 'function') {
            return global.emsIdbKvGet(key).then(function (raw) {
                if (raw == null) return null;
                try {
                    var data = typeof raw === 'string' ? JSON.parse(raw) : raw;
                    return data && data.records ? data : null;
                } catch (eParse) {
                    return null;
                }
            });
        }
        return Promise.resolve(null);
    }

    function attDashCollectSheetsAsync(monthStr, force) {
        var tenantId = typeof global.emsGetTenantId === 'function'
            ? global.emsGetTenantId()
            : global.CURRENT_MADRASA_TENANT_ID;
        // No identified madrasa: never briefly reuse sheets from an earlier account.
        if (!tenantId) return Promise.resolve([]);
        if (!force && _attSheetCache.month === monthStr
            && _attSheetCache.tenantId === tenantId && _attSheetCache.sheets) {
            return Promise.resolve(_attSheetCache.sheets);
        }
        var listFn = typeof global.emsOfflineListAttendanceKeysAsync === 'function'
            ? global.emsOfflineListAttendanceKeysAsync
            : function (m) {
                return Promise.resolve(
                    typeof global.emsOfflineListAttendanceKeys === 'function'
                        ? (global.emsOfflineListAttendanceKeys(m) || [])
                        : []
                );
            };
        return listFn(monthStr).then(function (keyList) {
            keyList = keyList || [];
            if (!keyList.length) {
                _attSheetCache.month = monthStr;
                _attSheetCache.tenantId = tenantId;
                _attSheetCache.sheets = [];
                return [];
            }
            return Promise.all(keyList.map(function (key) {
                return attDashReadSheetAsync(key).then(function (data) {
                    return { key: key, data: data };
                });
            })).then(function (results) {
                var buckets = Object.create(null);
                results.forEach(function (res) {
                    if (!res || !res.data) return;
                    var parsed = attDashParseSheetKey(res.key, monthStr);
                    if (!parsed) return;
                    var dedupe = parsed.type + '|' + parsed.classId + '|' + parsed.period;
                    var candidate = {
                        key: res.key,
                        type: parsed.type,
                        classId: parsed.classId,
                        period: parsed.period,
                        data: res.data,
                        ts: attDashSheetTimestamp(res.data),
                        score: attDashRecordMarkCount(res.data)
                    };
                    if (attDashSheetBetter(candidate, buckets[dedupe])) {
                        buckets[dedupe] = candidate;
                    }
                });
                var sheets = Object.keys(buckets).map(function (k) {
                    var b = buckets[k];
                    return {
                        key: b.key,
                        type: b.type,
                        classId: b.classId,
                        period: b.period,
                        data: b.data
                    };
                });
                _attSheetCache.month = monthStr;
                _attSheetCache.tenantId = tenantId;
                _attSheetCache.sheets = sheets;
                return sheets;
            });
        });
    }

    function attDashCollectSheetsMapAsync(monthStrs, force) {
        monthStrs = monthStrs || [];
        var unique = [];
        monthStrs.forEach(function (m) {
            if (m && unique.indexOf(m) < 0) unique.push(m);
        });
        return Promise.all(unique.map(function (m) {
            return attDashCollectSheetsAsync(m, force);
        })).then(function (lists) {
            var map = Object.create(null);
            unique.forEach(function (m, i) {
                map[m] = lists[i] || [];
            });
            return map;
        });
    }

    /** @deprecated sync — use attDashCollectSheetsAsync */
    function attDashCollectSheets(monthStr, force) {
        var tenantId = typeof global.emsGetTenantId === 'function'
            ? global.emsGetTenantId()
            : global.CURRENT_MADRASA_TENANT_ID;
        if (!tenantId) return [];
        if (!force && _attSheetCache.month === monthStr
            && _attSheetCache.tenantId === tenantId && _attSheetCache.sheets) {
            return _attSheetCache.sheets;
        }
        return _attSheetCache.month === monthStr && _attSheetCache.tenantId === tenantId
            ? (_attSheetCache.sheets || []) : [];
    }

    function attDashSheetBetter(candidate, incumbent) {
        if (!incumbent) return true;
        if (!candidate || !candidate.data) return false;
        if (!incumbent.data) return true;
        var cTs = candidate.ts;
        var iTs = incumbent.ts;
        if (cTs !== iTs) return cTs > iTs;
        return candidate.score > incumbent.score;
    }

    function attDashGetUsersRaw() {
        var users = [];
        if (typeof global.emsGetUsersMerged === 'function') users = global.emsGetUsersMerged();
        else if (typeof global.emsGetUsersSync === 'function') users = global.emsGetUsersSync();
        return Array.isArray(users) ? users : [];
    }

    /** Match register eligibility — inactive/rejected must not inflate roster totals. */
    function attDashIsEligibleRegistration(u) {
        if (!u || !attDashGetUserId(u)) return false;
        if (typeof global.attFilterEligibleUsers === 'function') {
            return global.attFilterEligibleUsers([u]).length > 0;
        }
        if (typeof global.EmsQueryUtils !== 'undefined'
            && typeof global.EmsQueryUtils.isActiveRegistrationStatus === 'function') {
            var st = String(u.status == null ? '' : u.status).trim().toLowerCase();
            if (st === 'pending') return true;
            return global.EmsQueryUtils.isActiveRegistrationStatus(u.status);
        }
        var s = String(u.status == null ? '' : u.status).trim().toLowerCase();
        if (!s) return true;
        if (s === 'rejected' || s === 'suspended' || s === 'withdrawn'
            || s === 'inactive' || s === 'deleted' || s === 'withdrawn/transferred') {
            return false;
        }
        return true;
    }

    function attDashGetUsers() {
        var users = attDashGetUsersRaw().filter(attDashIsEligibleRegistration);
        if (typeof global.emsFilterByDepartment === 'function') {
            users = global.emsFilterByDepartment(users);
        }
        return users;
    }

    function attDashUpdateDeptHint(rawUsers, filteredUsers, f) {
        var hint = document.getElementById('att-dash-dept-hint');
        if (!hint) {
            hint = document.createElement('p');
            hint.id = 'att-dash-dept-hint';
            hint.style.cssText = 'margin:10px 0 0;padding:10px 14px;border-radius:8px;font-size:13px;display:none;background:#fef3c7;color:#92400e;border:1px solid #fcd34d;';
            var anchor = document.querySelector('#att-dashboard-panel .att-dash-toolbar')
                || document.querySelector('#att-dashboard-panel .att-dash-shell')
                || document.getElementById('att-dashboard-panel');
            if (anchor) {
                if (anchor.id === 'att-dashboard-panel') {
                    anchor.insertBefore(hint, anchor.firstChild);
                } else {
                    anchor.insertAdjacentElement('afterend', hint);
                }
            }
        }
        var rawCount = attDashFilterUsers(rawUsers, f.roleFilter, f.classFilter).length;
        var filteredCount = attDashFilterUsers(filteredUsers, f.roleFilter, f.classFilter).length;
        if (rawCount > 0 && filteredCount === 0) {
            var deptLabel = typeof global.emsGetDepartmentLabel === 'function'
                ? global.emsGetDepartmentLabel(global.emsGetDepartmentId())
                : (global.emsGetDepartmentId && global.emsGetDepartmentId()) || '';
            hint.textContent = 'موجودہ شعبے (' + deptLabel + ') میں کوئی ریکارڈ نہیں — دوسرا شعبہ منتخب کریں یا رجسٹریشن میں departmentId درست کریں۔';
            hint.style.display = 'block';
        } else {
            hint.style.display = 'none';
        }
    }

    function attDashNormType(u) {
        if (typeof global.attNormalizeUserType === 'function') return global.attNormalizeUserType(u);
        var t = String(u && u.type || '').toLowerCase();
        if (t === 'students') return 'student';
        if (t === 'teachers') return 'teacher';
        return t;
    }

    function attDashFilterUsers(users, roleFilter, classFilter) {
        return users.filter(function (u) {
            if (!u) return false;
            var t = attDashNormType(u);
            if (roleFilter === 'student' && t !== 'student') return false;
            if (roleFilter === 'teacher' && t !== 'teacher') return false;
            if (roleFilter === 'staff' && t !== 'staff') return false;
            if (classFilter) {
                var cls = String(u.class || u.className || u.grade || '').trim();
                if (cls !== classFilter) return false;
            }
            return true;
        });
    }

    /** Scan local att_rec_* sheets (offline-first SSOT). Supports tenant-scoped keys. */
    function attDashParseSheetKey(key, monthStr) {
        if (!key || key.indexOf('att_rec_') !== 0) return null;
        var legacyHead = 'att_rec_' + monthStr + '_';
        var tail;
        if (key.indexOf(legacyHead) === 0) {
            tail = key.slice(legacyHead.length);
        } else {
            var scopedHead = '_' + monthStr + '_';
            var idx = key.indexOf(scopedHead);
            if (idx < 0) return null;
            tail = key.slice(idx + scopedHead.length);
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

    function attDashSheetsForMonth(sheetsByMonth, monthStr) {
        if (sheetsByMonth && sheetsByMonth[monthStr]) return sheetsByMonth[monthStr];
        return attDashCollectSheets(monthStr);
    }

    /** Count P/A/L for a given day from sheets + user roster (deduped final-state). */
    function attDashStatsForDay(dateStr, roleFilter, classFilter, users, sheets, periodFilter) {
        users = users || attDashFilterUsers(attDashGetUsers(), roleFilter, classFilter);
        var total = users.length;
        if (attDashIsFutureDate(dateStr)) {
            return {
                present: 0, absent: 0, leave: 0, notMarked: total, total: total,
                markedTotal: 0, rate: null, notTaken: true, lockedSheets: 0, source: 'local'
            };
        }

        sheets = sheets || [];
        var lockedSheets = 0;
        sheets.forEach(function (sh) {
            if (sh.data && sh.data.locked) lockedSheets++;
        });

        var finalDataset = attDashBuildFinalMarksForDay(dateStr, sheets, users, periodFilter);
        var stats = attDashStatsFromFinalMarks(finalDataset, users);
        stats.lockedSheets = lockedSheets;
        stats.source = 'local';
        stats.periodFilter = String(periodFilter || '').trim();
        return stats;
    }

    function attDashClassBreakdown(dateStr, roleFilter, classFilter, sheets, periodFilter) {
        if (roleFilter !== 'student' && roleFilter !== 'all') return [];
        if (attDashIsFutureDate(dateStr)) return [];

        var users = attDashFilterUsers(attDashGetUsers(), 'student', classFilter || '');
        sheets = sheets || [];
        var finalDataset = attDashBuildFinalMarksForDay(dateStr, sheets, users, periodFilter);
        var rows = attDashClassBreakdownFromFinal(finalDataset, users);
        if (classFilter) {
            rows = rows.filter(function (r) { return r.className === classFilter; });
        }
        return rows;
    }

    function attDashMonthlySummary(monthStr, roleFilter, classFilter, sheets) {
        var users = attDashFilterUsers(attDashGetUsers(), roleFilter, classFilter);
        sheets = sheets || [];
        if (typeof global.attMetricsMonthlySummary === 'function') {
            return global.attMetricsMonthlySummary(monthStr, sheets, users);
        }
        return { activeDays: 0, monthRate: 0, totalMarks: 0 };
    }

    function attDashLowAttendanceAlerts(monthStr, sheets) {
        var users = attDashFilterUsers(attDashGetUsers(), 'student', '');
        sheets = sheets || [];
        if (typeof global.attMetricsLowAttendanceAlerts === 'function') {
            return global.attMetricsLowAttendanceAlerts(monthStr, sheets, users);
        }
        return [];
    }

    function attDashPopulateClassFilter() {
        var sel = document.getElementById('att-dash-class-filter');
        if (!sel || sel.dataset.attDashBound) return;
        sel.dataset.attDashBound = '1';
        var classes = [];
        if (typeof global.emsRegRepoCollectClasses === 'function') {
            classes = global.emsRegRepoCollectClasses();
        }
        if (!classes.length) {
            attDashFilterUsers(attDashGetUsers(), 'student', '').forEach(function (u) {
                var c = String(u.class || u.className || '').trim();
                if (c && c !== 'نامعلوم' && classes.indexOf(c) < 0) classes.push(c);
            });
            classes.sort();
        }
        var curr = sel.value;
        sel.innerHTML = '<option value="">تمام درجات</option>' +
            classes.map(function (c) { return '<option value="' + c + '">' + c + '</option>'; }).join('');
        if (curr) sel.value = curr;
    }

    function attDashListPeriods() {
        try {
            if (typeof global.attReadTimetablePeriods === 'function') {
                var fromFn = global.attReadTimetablePeriods();
                if (Array.isArray(fromFn)) return fromFn;
            }
            var raw = localStorage.getItem('ems_att_periods');
            var list = raw ? JSON.parse(raw) : [];
            return Array.isArray(list) ? list : [];
        } catch (ePer) {
            return [];
        }
    }

    function attDashEscAttr(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }

    function attDashPeriodLabel(periodId) {
        periodId = String(periodId || '').trim();
        if (!periodId) return 'یومیہ';
        var periods = attDashListPeriods();
        for (var i = 0; i < periods.length; i++) {
            var p = periods[i];
            if (!p || String(p.id) !== periodId) continue;
            var parts = [p.name || 'گھنٹہ'];
            if (p.bookName && p.bookName !== '-') parts.push(p.bookName);
            if (p.className) parts.push(p.className);
            if (p.start) parts.push(p.start + (p.end ? '–' + p.end : ''));
            return parts.join(' · ');
        }
        return 'گھنٹہ: ' + periodId;
    }

    function attDashPopulatePeriodFilter(f) {
        var sel = document.getElementById('att-dash-period-filter');
        if (!sel) return;
        f = f || {};
        var classFilter = String(f.classFilter || '').trim();
        var periods = attDashListPeriods().filter(function (p) {
            if (!p || !p.id) return false;
            if (classFilter && String(p.className || '').trim() !== classFilter) return false;
            return true;
        }).slice().sort(function (a, b) {
            var c = String(a.className || '').localeCompare(String(b.className || ''), 'ur');
            if (c) return c;
            return String(a.start || '').localeCompare(String(b.start || ''));
        });
        var curr = sel.value;
        var html = '<option value="">یومیہ (پورا دن)</option>';
        periods.forEach(function (p) {
            var label = p.name || 'گھنٹہ';
            if (p.bookName && p.bookName !== '-') label += ' — ' + p.bookName;
            if (!classFilter && p.className) label += ' (' + p.className + ')';
            if (p.start) label += ' · ' + p.start + (p.end ? '–' + p.end : '');
            html += '<option value="' + attDashEscAttr(p.id) + '">' + attDashEscAttr(label) + '</option>';
        });
        sel.innerHTML = html;
        if (curr && periods.some(function (p) { return String(p.id) === curr; })) {
            sel.value = curr;
        } else {
            sel.value = '';
        }
    }

    function attDashReadFilters() {
        var dateEl = document.getElementById('att-dash-date');
        var roleEl = document.getElementById('att-dash-role-filter');
        var classEl = document.getElementById('att-dash-class-filter');
        var periodEl = document.getElementById('att-dash-period-filter');
        var calcEl = document.getElementById('att-dash-calc-mode');
        var calcMode = (calcEl && calcEl.value) || 'daily';
        if (calcMode !== 'period_order') calcMode = 'daily';
        var periodFilter = (periodEl && periodEl.value) || '';
        // گھنٹوں کی ترتیب موڈ میں واحد گھنٹہ فلٹر نظر انداز — یومیہ خلاصہ + ترتیب جدول
        if (calcMode === 'period_order') periodFilter = '';
        return {
            dateStr: (dateEl && dateEl.value) || todayStr(),
            roleFilter: (roleEl && roleEl.value) || 'all',
            classFilter: (classEl && classEl.value) || '',
            periodFilter: periodFilter,
            calcMode: calcMode
        };
    }

    function attDashSyncCalcModeUi(f) {
        var periodEl = document.getElementById('att-dash-period-filter');
        var seqPanel = document.getElementById('att-dash-period-sequence-panel');
        var byOrder = !!(f && f.calcMode === 'period_order');
        if (periodEl) {
            periodEl.disabled = byOrder;
            if (byOrder) periodEl.value = '';
            periodEl.title = byOrder
                ? 'گھنٹوں کی ترتیب موڈ میں تمام گھنٹے دکھائے جاتے ہیں'
                : '';
        }
        if (seqPanel) seqPanel.classList.toggle('att-col-hidden', !byOrder);
        setTxt('att-dash-calc-mode-label', byOrder ? 'گھنٹوں کی ترتیب سے' : 'یومیہ خلاصہ');
    }

    /** Timetable periods for the selected day, sorted by start time. */
    function attDashOrderedPeriodsForDay(dateStr, classFilter) {
        var weekday = 0;
        try {
            weekday = new Date(String(dateStr) + 'T12:00:00').getDay();
        } catch (eWd) {
            weekday = new Date().getDay();
        }
        var classF = String(classFilter || '').trim();
        var seen = Object.create(null);
        var out = [];
        attDashListPeriods().forEach(function (p) {
            if (!p || !p.id) return;
            if (classF && String(p.className || '').trim() !== classF) return;
            var days = Array.isArray(p.days) ? p.days : null;
            if (days && days.length) {
                var onDay = days.some(function (d) { return Number(d) === weekday; });
                if (!onDay) return;
            }
            var id = String(p.id);
            if (seen[id]) return;
            seen[id] = true;
            out.push(p);
        });
        out.sort(function (a, b) {
            var t = String(a.start || '').localeCompare(String(b.start || ''));
            if (t) return t;
            return String(a.name || '').localeCompare(String(b.name || ''), 'ur');
        });
        return out;
    }

    function attDashBuildPeriodSequenceStats(dateStr, roleFilter, classFilter, users, sheets) {
        var periods = attDashOrderedPeriodsForDay(dateStr, classFilter);
        return periods.map(function (p, idx) {
            var st = attDashStatsForDay(dateStr, roleFilter, classFilter, users, sheets, p.id);
            return {
                index: idx + 1,
                periodId: String(p.id),
                name: p.name || ('گھنٹہ ' + (idx + 1)),
                bookName: (p.bookName && p.bookName !== '-') ? p.bookName : '',
                className: p.className || '',
                start: p.start || '',
                end: p.end || '',
                present: st.present,
                absent: st.absent,
                leave: st.leave,
                notMarked: st.notMarked,
                total: st.total,
                markedTotal: st.markedTotal,
                rate: st.rate,
                notTaken: st.notTaken
            };
        });
    }

    function attDashRenderPeriodSequence(rows, f) {
        var panel = document.getElementById('att-dash-period-sequence-panel');
        var tbody = document.getElementById('att-dash-period-seq-tbody');
        var note = document.getElementById('att-dash-period-seq-note');
        var chart = document.getElementById('att-dash-chart-period-seq');
        if (!panel || !tbody) return;
        var active = !!(f && f.calcMode === 'period_order');
        panel.classList.toggle('att-col-hidden', !active);
        if (!active) {
            tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;">—</td></tr>';
            if (chart) chart.innerHTML = '';
            if (note) note.textContent = '—';
            return;
        }
        if (!rows || !rows.length) {
            tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;">اس دن نظام الاوقات میں کوئی گھنٹہ نہیں ملا — پہلے گھنٹے شامل کریں یا درجہ فلٹر ہٹائیں</td></tr>';
            if (chart) chart.innerHTML = '<p style="color:#94a3b8;font-size:13px;text-align:center;padding:16px;">گھنٹے دستیاب نہیں</p>';
            if (note) note.textContent = 'گھنٹوں کی ترتیب سے دیکھنے کے لیے نظام الاوقات میں اس دن کے گھنٹے درکار ہیں۔';
            return;
        }
        tbody.innerHTML = rows.map(function (r) {
            var label = escHtmlSafe(r.name);
            if (r.bookName) label += ' — ' + escHtmlSafe(r.bookName);
            if (!f.classFilter && r.className) label += ' <small>(' + escHtmlSafe(r.className) + ')</small>';
            var time = (r.start || '—') + (r.end ? '–' + r.end : '');
            var rateTxt = r.rate == null ? '—' : (r.rate + '%');
            var col = r.rate == null ? '#94a3b8' : (r.rate >= 75 ? '#27ae60' : (r.rate >= 50 ? '#f39c12' : '#e74c3c'));
            return '<tr>'
                + '<td>' + r.index + '</td>'
                + '<td><strong>' + label + '</strong></td>'
                + '<td>' + escHtmlSafe(time) + '</td>'
                + '<td>' + r.total + '</td>'
                + '<td style="color:#27ae60;font-weight:bold;">' + (r.notTaken ? '—' : r.present) + '</td>'
                + '<td style="color:#e74c3c;font-weight:bold;">' + (r.notTaken ? '—' : r.absent) + '</td>'
                + '<td style="color:#f39c12;">' + (r.notTaken ? '—' : r.leave) + '</td>'
                + '<td>' + (r.notMarked != null ? r.notMarked : '—') + '</td>'
                + '<td style="color:' + col + ';font-weight:bold;">' + rateTxt + '</td>'
                + '</tr>';
        }).join('');

        var withRates = rows.filter(function (r) { return r.rate != null; });
        if (chart) {
            if (typeof global.emsBarChartSVG === 'function' && withRates.length) {
                chart.innerHTML = global.emsBarChartSVG(withRates.slice(0, 12).map(function (r) {
                    return {
                        label: String(r.name || '').substring(0, 10) || ('#' + r.index),
                        value: r.rate,
                        display: r.rate + '%',
                        color: r.rate >= 75 ? '#27ae60' : (r.rate >= 50 ? '#f39c12' : '#e74c3c')
                    };
                }));
            } else if (!withRates.length) {
                chart.innerHTML = '<p style="color:#94a3b8;font-size:13px;text-align:center;padding:16px;">ان گھنٹوں میں حاضری نہیں لی گئی</p>';
            } else {
                chart.innerHTML = '';
            }
        }
        if (note) {
            var taken = withRates.length;
            note.textContent = 'کل ' + rows.length + ' گھنٹے (وقت کی ترتیب) · ' + taken + ' میں حاضری لی گئی · تاریخ ' + f.dateStr;
        }
    }

    function escHtmlSafe(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function attDashDateOffset(daysAgo) {
        var base = todayStr();
        var d = new Date(base + 'T12:00:00+05:00');
        d.setTime(d.getTime() - (Number(daysAgo) || 0) * 86400000);
        return attDashLocalDateParts(d).dateStr;
    }

    function attDashWeekdayLabel(dateStr) {
        var ur = ['اتوار', 'پیر', 'منگل', 'بدھ', 'جمعرات', 'جمعہ', 'ہفتہ'];
        try {
            var d = new Date(String(dateStr) + 'T12:00:00+05:00');
            var short = new Intl.DateTimeFormat('en-US', {
                timeZone: ATT_DASH_TZ,
                weekday: 'short'
            }).format(d);
            var map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
            if (map[short] != null) return ur[map[short]];
        } catch (eWd) { /* fall through */ }
        var fallback = new Date(String(dateStr) + 'T12:00:00+05:00');
        return ur[fallback.getUTCDay()] || dateStr.substring(5);
    }

    /** Last N days attendance rate trend — offline-first from local sheets. */
    function attDashComputeLocalTrend(days, roleFilter, classFilter, users, sheetsByMonth, periodFilter) {
        days = days || 7;
        sheetsByMonth = sheetsByMonth || Object.create(null);
        var points = [];
        for (var i = days - 1; i >= 0; i--) {
            var dateStr = attDashDateOffset(i);
            var monthStr = monthOf(dateStr);
            var monthSheets = attDashSheetsForMonth(sheetsByMonth, monthStr);
            var dayStats = attDashStatsForDay(dateStr, roleFilter, classFilter, users, monthSheets, periodFilter);
            points.push({
                date: dateStr,
                label: attDashWeekdayLabel(dateStr),
                present: dayStats.present,
                rate: dayStats.rate,
                total: dayStats.total,
                notTaken: dayStats.notTaken
            });
        }
        return points;
    }

    function attDashUpdateLiveIndicator(source) {
        var dot = document.getElementById('att-dash-live-dot');
        var text = document.getElementById('att-dash-live-text');
        if (!text) return;
        var map = {
            local: ['#22c55e', 'مقامی ڈیٹا'],
            cloud: ['#3b82f6', 'کلاؤڈ'],
            firestore: ['#3b82f6', 'Firestore'],
            summary: ['#8b5cf6', 'Summary'],
            cache: ['#22c55e', 'مقامی کیش']
        };
        var pair = map[source] || map.local;
        if (dot) dot.style.background = pair[0];
        text.textContent = pair[1];
    }

    function attDashRenderSummary(stats, f) {
        var el = document.getElementById('att-dash-summary-text');
        if (!el) return;
        var roleLabels = { all: 'تمام رجسٹر', student: 'طلباء', teacher: 'اساتذہ', staff: 'عملہ' };
        var role = roleLabels[f.roleFilter] || 'تمام';
        var cls = f.classFilter ? (' · درجہ: ' + f.classFilter) : '';
        var periodPart = f.periodFilter
            ? (' · گھنٹہ: ' + attDashPeriodLabel(f.periodFilter))
            : (f.calcMode === 'period_order' ? ' · گھنٹوں کی ترتیب' : ' · یومیہ');
        setTxt('att-dash-period-label', f.periodFilter
            ? attDashPeriodLabel(f.periodFilter)
            : (f.calcMode === 'period_order' ? 'گھنٹوں کی ترتیب' : 'یومیہ'));
        setTxt('att-dash-calc-mode-label', f.calcMode === 'period_order' ? 'گھنٹوں کی ترتیب سے' : 'یومیہ خلاصہ');
        if (stats.total === 0) {
            el.textContent = 'منتخب فلٹر (' + role + cls + periodPart + ') کے لیے کوئی حاضری ہدف نہیں — رجسٹر یا فلٹر چیک کریں۔';
            return;
        }
        if (stats.rate == null || stats.notTaken || attDashIsFutureDate(f.dateStr)) {
            el.textContent = f.dateStr + ' — ' + role + cls + periodPart + ': حاضری نہیں لی گئی (نشان زد نہیں: ' +
                fmt(stats.notMarked != null ? stats.notMarked : stats.total) + ' / ' + fmt(stats.total) + ')';
            return;
        }
        el.textContent = f.dateStr + ' — ' + role + cls + periodPart + ': ' +
            fmt(stats.present) + ' حاضر، ' + fmt(stats.absent) + ' غائب، ' +
            fmt(stats.leave) + ' رخصت، ' + fmt(stats.notMarked) + ' نشان زد نہیں (کل ' + fmt(stats.total) + ') — شرح ' + stats.rate + '%';
    }

    function attDashRenderTrendSummary(trend) {
        var el = document.getElementById('att-dash-trend-summary');
        if (!el) return;
        if (!trend || !trend.length) {
            el.textContent = 'گزشتہ 7 دن کا ڈیٹا دستیاب نہیں — پہلے رجسٹر میں حاضری درج کریں۔';
            return;
        }
        var rates = trend.map(function (d) { return d.rate; }).filter(function (r) { return r != null; });
        if (!rates.length) {
            el.textContent = 'حاضری نہیں لی گئی — گزشتہ 7 دن میں کوئی نشان زد دن نہیں';
            return;
        }
        var sum = rates.reduce(function (a, b) { return a + b; }, 0);
        var avg = Math.round(sum / rates.length);
        var min = Math.min.apply(null, rates);
        var max = Math.max.apply(null, rates);
        el.textContent = 'اوسط شرح ' + avg + '% · کم از کم ' + min + '% · زیادہ سے زیادہ ' + max + '%';
    }

    function attDashRenderClassHighlights(rows) {
        var bestEl = document.getElementById('att-dash-class-best-val');
        var worstEl = document.getElementById('att-dash-class-worst-val');
        if (!bestEl || !worstEl) return;
        var withData = rows.filter(function (r) { return r.total > 0 && r.rate != null; });
        if (!withData.length) {
            bestEl.textContent = '—';
            worstEl.textContent = '—';
            return;
        }
        var sorted = withData.slice().sort(function (a, b) { return b.rate - a.rate; });
        var top = sorted[0];
        var bottom = sorted[sorted.length - 1];
        bestEl.textContent = top.className + ' — ' + top.rate + '%';
        worstEl.textContent = bottom.className + ' — ' + bottom.rate + '%';
    }

    function attDashRenderTodayLegend(stats) {
        var legend = document.getElementById('att-dash-today-legend');
        if (!legend) return;
        if (stats.rate == null || stats.notTaken) {
            legend.innerHTML = '<span style="color:#94a3b8;font-size:13px;">حاضری نہیں لی گئی</span>';
            return;
        }
        var items = [
            { color: '#27ae60', label: 'حاضر', val: stats.present },
            { color: '#e74c3c', label: 'غائب', val: stats.absent },
            { color: '#f39c12', label: 'رخصت', val: stats.leave }
        ];
        if (stats.notMarked > 0) {
            items.push({ color: '#94a3b8', label: 'نشان زد نہیں', val: stats.notMarked });
        }
        legend.innerHTML = items.map(function (it) {
            return '<span><i style="background:' + it.color + '"></i>' + it.label + ' <strong>(' + fmt(it.val) + ')</strong></span>';
        }).join('');
    }

    function attDashRenderCharts(stats, trend, classRows) {
        var notTaken = stats.rate == null || stats.notTaken;
        if (notTaken) {
            setHTML('att-dash-chart-today', '<p style="color:#94a3b8;font-size:13px;text-align:center;padding:24px 8px;">حاضری نہیں لی گئی</p>');
            attDashRenderTodayLegend(stats);
        } else {
            var segs = [
                { label: 'حاضر', value: stats.present, color: '#27ae60' },
                { label: 'غائب', value: stats.absent, color: '#e74c3c' },
                { label: 'رخصت', value: stats.leave, color: '#f39c12' }
            ];
            var totalSeg = stats.present + stats.absent + stats.leave;
            if (typeof global.emsDonutSVG === 'function') {
                setHTML('att-dash-chart-today', global.emsDonutSVG(segs, stats.rate + '%', 'شرح'));
            } else if (typeof global.emsDonutCompactSVG === 'function') {
                setHTML('att-dash-chart-today', global.emsDonutCompactSVG(segs, stats.rate + '%', 'شرح', 160));
                attDashRenderTodayLegend(stats);
            } else if (totalSeg > 0) {
                setHTML('att-dash-chart-today',
                    '<div style="width:140px;height:140px;border-radius:50%;background:conic-gradient(#27ae60 0% ' + stats.rate + '%, #e2e8f0 ' + stats.rate + '% 100%);display:flex;align-items:center;justify-content:center;margin:0 auto;">' +
                    '<div style="width:100px;height:100px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:800;color:#0f766e;">' + stats.rate + '%</div></div>');
                attDashRenderTodayLegend(stats);
            } else {
                setHTML('att-dash-chart-today', '<p style="color:#94a3b8;font-size:13px;text-align:center;">حاضری نہیں لی گئی</p>');
                attDashRenderTodayLegend(stats);
            }
        }

        var trendPoints = (trend || []).filter(function (d) { return d.rate != null; });
        if (typeof global.emsLineChartSVG === 'function' && trendPoints.length) {
            setHTML('att-dash-chart-trend', global.emsLineChartSVG(
                trendPoints.map(function (d) { return { label: d.label, value: d.rate }; }),
                '#6366f1'
            ));
        } else if (Array.isArray(trend) && trend.length && !trendPoints.length) {
            setHTML('att-dash-chart-trend', '<p style="color:#94a3b8;font-size:13px;text-align:center;padding:24px 8px;">حاضری نہیں لی گئی</p>');
        } else if (Array.isArray(trend) && trend.length) {
            setHTML('att-dash-chart-trend', '<p style="color:#94a3b8;font-size:13px;text-align:center;">چارٹ لوڈ نہیں — dashboard-pro.js چیک کریں</p>');
        } else {
            setHTML('att-dash-chart-trend', '<p style="color:#94a3b8;font-size:13px;text-align:center;">گزشتہ 7 دن کا ڈیٹا نہیں</p>');
        }

        var classWithRates = (classRows || []).filter(function (r) { return r.rate != null; });
        if (typeof global.emsBarChartSVG === 'function' && classWithRates.length) {
            var sorted = classWithRates.slice().sort(function (a, b) { return b.rate - a.rate; });
            setHTML('att-dash-chart-class', global.emsBarChartSVG(
                sorted.slice(0, 10).map(function (r) {
                    return {
                        label: (r.className || '').substring(0, 10),
                        value: r.rate,
                        display: r.rate + '%',
                        color: r.rate >= 75 ? '#27ae60' : (r.rate >= 50 ? '#f39c12' : '#e74c3c')
                    };
                })
            ));
        } else if (classRows && classRows.length && !classWithRates.length) {
            setHTML('att-dash-chart-class', '<p style="color:#94a3b8;font-size:13px;text-align:center;padding:24px;">حاضری نہیں لی گئی</p>');
        } else {
            setHTML('att-dash-chart-class', '<p style="color:#94a3b8;font-size:13px;text-align:center;padding:24px;">درجہ وار حاضری ڈیٹا دستیاب نہیں — طلباء کی کلاس درج کریں</p>');
        }
    }

    function attDashRenderClassTable(rows) {
        var tbody = document.getElementById('att-dash-class-tbody');
        if (!tbody) return;
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">آج کے لیے درجہ وار ریکارڈ نہیں</td></tr>';
            return;
        }
        tbody.innerHTML = rows.map(function (r) {
            var rateTxt = r.rate == null ? '—' : (r.rate + '%');
            var col = r.rate == null ? '#94a3b8' : (r.rate >= 75 ? '#27ae60' : (r.rate >= 50 ? '#f39c12' : '#e74c3c'));
            var pTxt = r.rate == null ? '—' : r.present;
            var aTxt = r.rate == null ? '—' : r.absent;
            var lTxt = r.rate == null ? '—' : r.leave;
            return '<tr style="cursor:pointer;" onclick="window.attDashOpenClassRegister(\'' +
                String(r.className).replace(/'/g, "\\'") + '\')">' +
                '<td><strong>' + r.className + '</strong></td>' +
                '<td>' + r.total + '</td>' +
                '<td style="color:#27ae60;font-weight:bold;">' + pTxt + '</td>' +
                '<td style="color:#e74c3c;font-weight:bold;">' + aTxt + '</td>' +
                '<td style="color:#f39c12;">' + lTxt + '</td>' +
                '<td style="color:' + col + ';font-weight:bold;">' + rateTxt + '</td></tr>';
        }).join('');
    }

    function attDashRenderAlerts(alerts) {
        var box = document.getElementById('att-dash-alerts-list');
        if (!box) return;
        if (!alerts.length) {
            box.innerHTML = '<p style="color:#64748b;font-size:13px;margin:0;">کوئی کم حاضری الرٹ نہیں — سب ٹھیک!</p>';
            return;
        }
        box.innerHTML = alerts.map(function (a) {
            return '<div class="att-dash-alert-row">' +
                '<span><strong>' + a.name + '</strong> <small>(' + a.className + ')</small></span>' +
                '<span style="color:#e74c3c;font-weight:bold;">' + a.rate + '%</span>' +
                '<small style="color:#94a3b8;">' + a.present + '/' + a.total + ' دن</small></div>';
        }).join('');
    }

    global.attDashOpenClassRegister = function (className) {
        if (typeof global.switchAttTab !== 'function') return;
        var btn = document.querySelector('#att-ribbon-menu [onclick*="att-smart-register"]');
        global.switchAttTab('att-smart-register', btn);
        var typeSel = document.getElementById('att-reg-type');
        var classSel = document.getElementById('att-reg-class');
        var monthIn = document.getElementById('att-reg-month');
        if (typeSel) typeSel.value = 'students';
        if (classSel) classSel.value = className;
        if (monthIn) monthIn.value = monthOf(todayStr());
        var loadBtn = document.getElementById('btn-load-smart-register');
        if (loadBtn) loadBtn.click();
    };

    function attDashShouldFetchCloud() {
        if (global.EMS_OFFLINE_ONLY === true) return false;
        if (typeof global.emsIsNetworkAvailable === 'function' && !global.emsIsNetworkAvailable()) {
            return false;
        }
        try {
            if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
        } catch (eNav) { /* ignore */ }
        return true;
    }

    function attDashPromiseTimeout(promise, ms, fallback) {
        return Promise.race([
            promise,
            new Promise(function (resolve) {
                setTimeout(function () { resolve(fallback); }, ms);
            })
        ]);
    }

    function attDashRenderBody() {
        attDashPopulateClassFilter();
        var f = attDashReadFilters();
        attDashPopulatePeriodFilter(f);
        f = attDashReadFilters();
        attDashSyncCalcModeUi(f);
        var rawUsers = attDashGetUsersRaw();
        // Eligible + department-scoped roster (inactive/suspended/expelled excluded).
        var users = attDashGetUsers();
        attDashUpdateDeptHint(rawUsers, users, f);
        var allUsers = attDashFilterUsers(users, f.roleFilter, f.classFilter);
        var monthStr = monthOf(f.dateStr);

        var trendMonths = [];
        for (var ti = 6; ti >= 0; ti--) {
            var tm = monthOf(attDashDateOffset(ti));
            if (trendMonths.indexOf(tm) < 0) trendMonths.push(tm);
        }
        var monthsToLoad = [monthStr];
        trendMonths.forEach(function (m) {
            if (monthsToLoad.indexOf(m) < 0) monthsToLoad.push(m);
        });

        setTxt('att-dash-source', 'لوڈ...');

        return attDashCollectSheetsMapAsync(monthsToLoad).then(function (sheetsByMonth) {
        setTxt('att-dash-source', 'مقامی');
        var sheets = sheetsByMonth[monthStr] || [];

        setTxt('att-dash-total-roster', allUsers.length);
        setTxt('att-dash-date-label', f.dateStr);

        var stats = attDashStatsForDay(f.dateStr, f.roleFilter, f.classFilter, allUsers, sheets, f.periodFilter);
        var classRows = attDashClassBreakdown(f.dateStr, f.roleFilter, f.classFilter, sheets, f.periodFilter);
        var periodSeqRows = f.calcMode === 'period_order'
            ? attDashBuildPeriodSequenceStats(f.dateStr, f.roleFilter, f.classFilter, allUsers, sheets)
            : [];
        // Single pipeline snapshot for print/debug — summary and class-wise must match.
        global._attDashLastCalc = {
            dateStr: f.dateStr,
            roleFilter: f.roleFilter,
            classFilter: f.classFilter,
            periodFilter: f.periodFilter || '',
            calcMode: f.calcMode || 'daily',
            target: stats.total,
            present: stats.present,
            absent: stats.absent,
            leave: stats.leave,
            unmarked: stats.notMarked,
            markedTotal: stats.markedTotal,
            classRows: classRows,
            periodSequence: periodSeqRows,
            invariantBroken: !!stats.invariantBroken,
            rows: stats.rows || null
        };
        attDashApplyStatsKpis(stats);
        setTxt('att-dash-locked', stats.lockedSheets);
        setTxt('att-dash-source', stats.source === 'local' ? 'مقامی' : '—');
        attDashUpdateLiveIndicator(stats.source);
        attDashRenderSummary(stats, f);
        attDashRenderPeriodSequence(periodSeqRows, f);

        var monthSummary = attDashMonthlySummary(monthStr, f.roleFilter, f.classFilter, sheets);
        setTxt('att-dash-month-rate', monthSummary.monthRate + '%');
        setTxt('att-dash-active-days', monthSummary.activeDays);
        setTxt('att-dash-month-marks', fmt(monthSummary.totalMarks));

        attDashRenderClassTable(classRows);
        attDashRenderClassHighlights(classRows);

        var alerts = attDashLowAttendanceAlerts(monthStr, sheets);
        attDashRenderAlerts(alerts);

        var localTrend = attDashComputeLocalTrend(7, f.roleFilter, f.classFilter, allUsers, sheetsByMonth, f.periodFilter);
        attDashRenderCharts(stats, localTrend, classRows);
        attDashRenderTrendSummary(localTrend);

        if (!attDashShouldFetchCloud()) {
            return Promise.resolve();
        }

        return Promise.resolve().then(function () {
            // Cloud daily summary is یومیہ only — skip when hour filter / period-order detail is active.
            if (typeof global.emsFetchTodayAttendanceStats === 'function'
                && f.roleFilter === 'all'
                && !f.classFilter
                && !f.periodFilter
                && f.calcMode !== 'period_order'
                && f.dateStr === todayStr()) {
                return attDashPromiseTimeout(global.emsFetchTodayAttendanceStats(), 3000, null)
                    .then(function (remote) {
                        if (!remote) return;
                        var merged = attDashMergeRemoteStats(stats, remote, allUsers);
                        if (merged.markedTotal <= 0 && stats.markedTotal <= 0) return;
                        stats = merged;
                        attDashApplyStatsKpis(stats);
                        setTxt('att-dash-source', remote.source === 'summary' ? 'Summary' : (remote.source === 'firestore' ? 'Firestore' : 'کلاؤڈ'));
                        attDashUpdateLiveIndicator(remote.source || 'cloud');
                        attDashRenderSummary(stats, f);
                        attDashRenderCharts(stats, localTrend, classRows);
                    });
            }
        }).catch(function () { /* keep local data */ });
        });
    }

    global.renderAttDashboard = function () {
        if (!attPanelIsVisible('att-dashboard-panel')) return Promise.resolve();
        if (_attDashInflight) return _attDashInflight;

        var dateEl = document.getElementById('att-dash-date');
        if (dateEl && !dateEl.value) dateEl.value = todayStr();

        var gen = _attDashRenderGen;
        var safetyTimer = setTimeout(function () {
            if (gen === _attDashRenderGen) _attDashInflight = null;
        }, 12000);

        var ready = typeof global.emsEnsureRepositoryReady === 'function'
            ? global.emsEnsureRepositoryReady()
            : Promise.resolve();

        _attDashInflight = ready.then(function () {
            return new Promise(function (resolve) {
                var run = function () {
                    if (gen !== _attDashRenderGen || !attPanelIsVisible('att-dashboard-panel')) {
                        resolve();
                        return;
                    }
                    Promise.resolve(attDashRenderBody()).catch(function (err) {
                        console.error('[EMS] att dashboard render', err);
                    }).finally(function () {
                        if (gen === _attDashRenderGen) _attDashInflight = null;
                        clearTimeout(safetyTimer);
                        resolve();
                    });
                };
                if (typeof global.requestAnimationFrame === 'function') {
                    global.requestAnimationFrame(function () { setTimeout(run, 0); });
                } else {
                    setTimeout(run, 0);
                }
            });
        });

        return _attDashInflight;
    };

    global.emsExportAttDashboard = function () {
        var g = function (id) { var el = document.getElementById(id); return el ? el.innerText : '-'; };
        var madrasa = (global.CURRENT_MADRASA_DATA && (global.CURRENT_MADRASA_DATA.madrasaName || global.CURRENT_MADRASA_DATA.name)) || 'ادارہ';
        var now = new Date().toLocaleString('ur-PK');
        var kpi = [
            ['تاریخ', g('att-dash-date-label')],
            ['حاضر', g('att-dash-present')],
            ['غائب', g('att-dash-absent')],
            ['رخصت', g('att-dash-leave')],
            ['آج کی شرح', g('att-dash-rate')],
            ['حاضری ہدف', g('att-dash-total-roster')],
            ['ماہانہ شرح', g('att-dash-month-rate')],
            ['فعال ایام', g('att-dash-active-days')]
        ];
        var rows = kpi.map(function (k) {
            return '<tr><td style="padding:8px 12px;border:1px solid #ccc;">' + k[0] +
                '</td><td style="padding:8px 12px;border:1px solid #ccc;font-weight:bold;">' + k[1] + '</td></tr>';
        }).join('');
        var classTable = document.getElementById('att-dash-class-tbody');
        var html = '<div style="font-family:\'Noto Nastaliq Urdu\',Arial;direction:rtl;text-align:right;padding:20px;">' +
            '<div style="text-align:center;border-bottom:3px double #0f766e;padding-bottom:12px;margin-bottom:20px;">' +
            '<h1 style="margin:0;color:#0f766e;">' + madrasa + '</h1>' +
            '<h3 style="margin:5px 0;color:#64748b;">حاضری تجزیات — خلاصہ</h3>' +
            '<p style="margin:0;color:#94a3b8;font-size:13px;">' + now + '</p></div>' +
            '<table style="width:100%;border-collapse:collapse;font-size:15px;margin-bottom:24px;">' + rows + '</table>' +
            (global._attDashLastCalc
                ? '<p style="font-size:13px;color:#64748b;">نشان زد: ' + (global._attDashLastCalc.markedTotal || 0)
                    + ' · نشان زد نہیں: ' + (global._attDashLastCalc.unmarked || 0)
                    + ' · invariant: P+A+L+unmarked='
                    + ((global._attDashLastCalc.present || 0) + (global._attDashLastCalc.absent || 0)
                        + (global._attDashLastCalc.leave || 0) + (global._attDashLastCalc.unmarked || 0))
                    + ' / target ' + (global._attDashLastCalc.target || 0)
                    + (global._attDashLastCalc.invariantBroken ? ' ⚠️ تضاد' : ' ✓')
                    + '</p>'
                : '') +
            (classTable ? '<h3>درجہ وار تفصیل</h3>' + classTable.closest('table').outerHTML : '') +
            '</div>';
        var w = global.open('', '_blank');
        if (!w) {
            if (typeof global.showToast === 'function') global.showToast('پاپ اپ بلاک — اجازت دیں', 'error');
            return;
        }
        w.document.write('<html><head><title>حاضری ڈیش بورڈ</title></head><body>' + html + '</body></html>');
        w.document.close();
        setTimeout(function () { w.print(); }, 400);
    };

    function attDashBindControls() {
        var debouncedRender = function () {
            if (_attDashFilterTimer) clearTimeout(_attDashFilterTimer);
            _attDashFilterTimer = setTimeout(function () {
                _attDashFilterTimer = null;
                global.renderAttDashboard();
            }, 180);
        };
        var btn = document.getElementById('btn-att-dash-refresh');
        if (btn && !btn._attDashBound) {
            btn._attDashBound = true;
            btn.addEventListener('click', function () {
                attDashInvalidateSheetCache();
                global.renderAttDashboard();
            });
        }
        ['att-dash-date', 'att-dash-role-filter', 'att-dash-class-filter', 'att-dash-period-filter', 'att-dash-calc-mode'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el && !el._attDashBound) {
                el._attDashBound = true;
                el.addEventListener('change', debouncedRender);
            }
        });
        var dateEl = document.getElementById('att-dash-date');
        if (dateEl && !dateEl.value) dateEl.value = todayStr();
    }

    if (typeof global.addEventListener === 'function') {
        global.addEventListener('ems:department-changed', function () {
            attDashInvalidateSheetCache();
        });
        global.addEventListener('ems:repository-ready', function () {
            if (attPanelIsVisible('att-dashboard-panel')) global.renderAttDashboard();
        });
        global.addEventListener('ems:users-changed', function () {
            if (attPanelIsVisible('att-dashboard-panel')) global.renderAttDashboard();
        });
    }

    global.emsRegisterAttTabBoot = function (tabId, fn) {
        if (!tabId || typeof fn !== 'function') return;
        _attTabBootHandlers[tabId] = fn;
    };

    function attShowPanel(tabId, btn) {
        var root = document.getElementById('module-attendance');
        if (!root) return;
        root.querySelectorAll('.att-panel').forEach(function (el) {
            el.classList.remove('active');
            el.style.removeProperty('display');
        });
        var panel = document.getElementById(tabId);
        if (panel) {
            panel.classList.add('active');
        }
        document.querySelectorAll('#att-ribbon-menu .btn, #att-ribbon-menu .reg-tab').forEach(function (b) {
            b.classList.remove('active-sub-tab');
        });
        if (btn && btn.classList) {
            btn.classList.add('active-sub-tab');
        } else if (tabId) {
            var fallback = document.querySelector('#att-ribbon-menu [onclick*="' + tabId + '"]');
            if (fallback) fallback.classList.add('active-sub-tab');
        }
        global._attCurrentTabId = tabId;
        if (tabId !== 'att-dashboard-panel') global.attDashCancelRender();
    }

    function attRunTabBoot(tabId) {
        var fn = _attTabBootHandlers[tabId];
        if (!fn) return;
        var run = function () {
            if (global._attCurrentTabId !== tabId) return;
            if (typeof global.emsIsAttendanceModuleActive === 'function' && !global.emsIsAttendanceModuleActive()) return;
            try { fn(); } catch (e) { console.error('[EMS] att tab boot', tabId, e); }
        };
        if (typeof global.emsDeferModuleWork === 'function') {
            global.emsDeferModuleWork(run, { idle: true, timeout: 120 });
        } else if (typeof global.requestAnimationFrame === 'function') {
            global.requestAnimationFrame(function () { setTimeout(run, 0); });
        } else {
            setTimeout(run, 0);
        }
    }

    global.emsReplayAttTabBoot = function (tabId) {
        if (!tabId) tabId = global._attCurrentTabId;
        if (!tabId) return;
        attRunTabBoot(tabId);
    };

    global.switchAttTab = function (tabId, btn) {
        if (!tabId) return;
        if (global._attCurrentTabId === tabId && attPanelIsVisible(tabId)) {
            if (tabId === 'att-collective-register') attRunTabBoot(tabId);
            return;
        }
        if (typeof global.emsCloseAllModals === 'function') global.emsCloseAllModals();
        attShowPanel(tabId, btn);
        attRunTabBoot(tabId);
        if (global.EmsI18n && typeof global.EmsI18n.refresh === 'function') global.EmsI18n.refresh();
    };

    function attBindRibbonDelegation() {
        if (_attRibbonDelegated) return;
        var menu = document.getElementById('att-ribbon-menu');
        if (!menu) return;
        _attRibbonDelegated = true;
        menu.addEventListener('click', function (ev) {
            var btn = ev.target && ev.target.closest ? ev.target.closest('button.reg-tab') : null;
            if (!btn || !menu.contains(btn)) return;
            var onclick = btn.getAttribute('onclick') || '';
            var m = onclick.match(/switchAttTab\s*\(\s*['"]([^'"]+)['"]/);
            if (!m) return;
            ev.preventDefault();
            global.switchAttTab(m[1], btn);
        }, false);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', attBindRibbonDelegation);
    } else {
        attBindRibbonDelegation();
    }

    // Test/diagnostic exports — same final-state pipeline as dashboard + print.
    global.attDashBuildFinalMarksForDay = attDashBuildFinalMarksForDay;
    global.attDashStatsFromFinalMarks = attDashStatsFromFinalMarks;
    global.attDashClassBreakdownFromFinal = attDashClassBreakdownFromFinal;
    global.attDashAssertStatsInvariant = attDashAssertStatsInvariant;
    global.attDashMarkCandidateBetter = attDashMarkCandidateBetter;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', attDashBindControls);
    } else {
        attDashBindControls();
    }
})(typeof window !== 'undefined' ? window : globalThis);
