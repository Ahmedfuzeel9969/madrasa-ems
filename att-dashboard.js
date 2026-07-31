// ============================================================================
// حاضری ماڈیول — مرکزی ڈیش بورڈ (main dashboard style)
// ============================================================================
(function (global) {
    'use strict';

    var _attDashInflight = null;
    var _attDashFilterTimer = null;
    var _attDashRenderGen = 0;
    var _attSheetCache = { month: null, sheets: null };
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

    function attDashApplyStatsKpis(stats) {
        var notTaken = stats.rate == null || stats.notTaken;
        setTxt('att-dash-present', notTaken ? '—' : stats.present);
        setTxt('att-dash-absent', notTaken ? '—' : stats.absent);
        setTxt('att-dash-leave', notTaken ? '—' : stats.leave);
        setTxt('att-dash-rate', notTaken ? 'حاضری نہیں لی گئی' : (stats.rate + '%'));
    }

    function attDashMergeRemoteStats(localStats, remote, users) {
        if (!remote) return localStats;
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
        var total = localStats.total || 0;
        return Object.assign({}, localStats, {
            present: present,
            absent: absent,
            leave: leave,
            notMarked: Math.max(0, total - rateInfo.markedTotal),
            markedTotal: rateInfo.markedTotal,
            rate: rateInfo.rate,
            notTaken: rateInfo.notTaken,
            source: remote.source || 'cloud'
        });
    }

    function attDashSheetTimestamp(data) {
        if (!data) return 0;
        if (data.timestamp) return Number(data.timestamp) || 0;
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
        if (!force && _attSheetCache.month === monthStr && _attSheetCache.sheets) {
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
        if (!force && _attSheetCache.month === monthStr && _attSheetCache.sheets) {
            return _attSheetCache.sheets;
        }
        return _attSheetCache.month === monthStr ? (_attSheetCache.sheets || []) : [];
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

    function attDashGetUsers() {
        var users = attDashGetUsersRaw();
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

    /** Count P/A/L for a given day from sheets + user roster (explicit absent; unmarked excluded from rate). */
    function attDashStatsForDay(dateStr, roleFilter, classFilter, users, sheets) {
        users = users || attDashFilterUsers(attDashGetUsers(), roleFilter, classFilter);
        var total = users.length;
        if (attDashIsFutureDate(dateStr)) {
            return {
                present: 0, absent: 0, leave: 0, notMarked: total, total: total,
                markedTotal: 0, rate: null, notTaken: true, lockedSheets: 0, source: 'local'
            };
        }

        var dayNum = dayNumOf(dateStr);
        sheets = sheets || [];
        var presentIds = Object.create(null);
        var absentIds = Object.create(null);
        var leaveIds = Object.create(null);
        var lockedSheets = 0;

        sheets.forEach(function (sh) {
            if (roleFilter === 'student' && sh.type !== 'students') return;
            if (roleFilter === 'teacher' && sh.type !== 'teachers') return;
            if (roleFilter === 'staff' && sh.type !== 'staff') return;
            if (classFilter && sh.classId && sh.classId !== classFilter) return;
            if (sh.data && sh.data.locked) lockedSheets++;
            var rec = (sh.data && sh.data.records) || {};
            Object.keys(rec).forEach(function (uid) {
                var dayRec = rec[uid];
                if (!dayRec) return;
                var st = dayRec[dayNum] || dayRec[String(dayNum)];
                if (attDashStatusPresent(st)) presentIds[uid] = true;
                else if (attDashStatusAbsent(st)) absentIds[uid] = true;
                else if (attDashStatusLeave(st)) leaveIds[uid] = true;
            });
        });

        var rosterIds = Object.create(null);
        users.forEach(function (u) {
            var id = attDashGetUserId(u);
            if (id) rosterIds[id] = true;
        });

        var present = 0, absent = 0, leave = 0;
        Object.keys(presentIds).forEach(function (id) {
            if (rosterIds[id]) present++;
        });
        Object.keys(absentIds).forEach(function (id) {
            if (rosterIds[id] && !presentIds[id]) absent++;
        });
        Object.keys(leaveIds).forEach(function (id) {
            if (rosterIds[id] && !presentIds[id] && !absentIds[id]) leave++;
        });

        var rateInfo = attDashComputeRate(present, absent, leave);
        var notMarked = Math.max(0, total - rateInfo.markedTotal);

        return {
            present: present,
            absent: absent,
            leave: leave,
            notMarked: notMarked,
            total: total,
            markedTotal: rateInfo.markedTotal,
            rate: rateInfo.rate,
            notTaken: rateInfo.notTaken,
            lockedSheets: lockedSheets,
            source: 'local'
        };
    }

    function attDashClassBreakdown(dateStr, roleFilter, classFilter, sheets) {
        if (roleFilter !== 'student' && roleFilter !== 'all') return [];
        if (attDashIsFutureDate(dateStr)) return [];

        var users = attDashFilterUsers(attDashGetUsers(), 'student', classFilter || '');
        var byClass = Object.create(null);
        users.forEach(function (u) {
            var cls = String(u.class || u.className || u.grade || 'نامعلوم').trim() || 'نامعلوم';
            if (classFilter && cls !== classFilter) return;
            if (!byClass[cls]) {
                byClass[cls] = {
                    className: cls,
                    total: 0,
                    present: 0,
                    absent: 0,
                    leave: 0,
                    rosterIds: Object.create(null)
                };
            }
            var uid = attDashGetUserId(u);
            if (uid) byClass[cls].rosterIds[uid] = true;
            byClass[cls].total++;
        });

        var dayNum = dayNumOf(dateStr);
        sheets = sheets || [];
        sheets.forEach(function (sh) {
            if (sh.type !== 'students') return;
            var cls = sh.classId || '';
            if (!cls || !byClass[cls]) return;
            if (classFilter && cls !== classFilter) return;
            var rec = (sh.data && sh.data.records) || {};
            Object.keys(rec).forEach(function (uid) {
                if (!byClass[cls].rosterIds[uid]) return;
                var dayRec = rec[uid];
                if (!dayRec) return;
                var st = dayRec[dayNum] || dayRec[String(dayNum)];
                if (attDashStatusPresent(st)) byClass[cls].present++;
                else if (attDashStatusAbsent(st)) byClass[cls].absent++;
                else if (attDashStatusLeave(st)) byClass[cls].leave++;
            });
        });

        return Object.keys(byClass).sort().map(function (k) {
            var row = byClass[k];
            var rateInfo = attDashComputeRate(row.present, row.absent, row.leave);
            row.notMarked = Math.max(0, row.total - rateInfo.markedTotal);
            row.markedTotal = rateInfo.markedTotal;
            row.rate = rateInfo.rate;
            row.notTaken = rateInfo.notTaken;
            delete row.rosterIds;
            return row;
        });
    }

    function attDashMonthlySummary(monthStr, roleFilter, classFilter, sheets) {
        var users = attDashFilterUsers(attDashGetUsers(), roleFilter, classFilter);
        sheets = sheets || [];
        var rosterIds = Object.create(null);
        users.forEach(function (u) {
            var id = attDashGetUserId(u);
            if (id) rosterIds[id] = true;
        });

        var daysWithData = Object.create(null);
        var totalPresentMarks = 0;
        var totalPossible = 0;

        sheets.forEach(function (sh) {
            if (roleFilter === 'student' && sh.type !== 'students') return;
            if (roleFilter === 'teacher' && sh.type !== 'teachers') return;
            if (roleFilter === 'staff' && sh.type !== 'staff') return;
            if (classFilter && sh.classId && sh.classId !== classFilter) return;
            var rec = (sh.data && sh.data.records) || {};
            Object.keys(rec).forEach(function (uid) {
                if (!rosterIds[uid]) return;
                var dayRec = rec[uid] || {};
                Object.keys(dayRec).forEach(function (d) {
                    daysWithData[d] = true;
                    totalPossible++;
                    if (attDashStatusPresent(dayRec[d])) totalPresentMarks++;
                });
            });
        });

        var activeDays = Object.keys(daysWithData).length;
        var monthRate = totalPossible > 0 ? Math.round((totalPresentMarks / totalPossible) * 100) : 0;
        return { activeDays: activeDays, monthRate: monthRate, totalMarks: totalPresentMarks };
    }

    function attDashLowAttendanceAlerts(monthStr, sheets) {
        var users = attDashFilterUsers(attDashGetUsers(), 'student', '');
        sheets = sheets || [];
        var stats = Object.create(null);

        users.forEach(function (u) {
            var id = attDashGetUserId(u);
            if (!id) return;
            stats[id] = { user: u, present: 0, total: 0 };
        });

        sheets.forEach(function (sh) {
            if (sh.type !== 'students') return;
            var rec = (sh.data && sh.data.records) || {};
            Object.keys(rec).forEach(function (uid) {
                if (!stats[uid]) return;
                var dayRec = rec[uid] || {};
                Object.keys(dayRec).forEach(function (d) {
                    stats[uid].total++;
                    if (attDashStatusPresent(dayRec[d])) stats[uid].present++;
                });
            });
        });

        return Object.keys(stats).map(function (id) {
            var s = stats[id];
            if (s.total < 3) return null;
            var rate = Math.round((s.present / s.total) * 100);
            if (rate >= 75) return null;
            return {
                name: s.user.name || id,
                className: s.user.class || s.user.className || '—',
                rate: rate,
                present: s.present,
                total: s.total
            };
        }).filter(Boolean).sort(function (a, b) { return a.rate - b.rate; }).slice(0, 8);
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

    function attDashReadFilters() {
        var dateEl = document.getElementById('att-dash-date');
        var roleEl = document.getElementById('att-dash-role-filter');
        var classEl = document.getElementById('att-dash-class-filter');
        return {
            dateStr: (dateEl && dateEl.value) || todayStr(),
            roleFilter: (roleEl && roleEl.value) || 'all',
            classFilter: (classEl && classEl.value) || ''
        };
    }

    function attDashDateOffset(daysAgo) {
        var d = new Date();
        d.setDate(d.getDate() - daysAgo);
        return attDashLocalDateParts(d).dateStr;
    }

    function attDashWeekdayLabel(dateStr) {
        var ur = ['اتوار', 'پیر', 'منگل', 'بدھ', 'جمعرات', 'جمعہ', 'ہفتہ'];
        var d = new Date(dateStr + 'T12:00:00');
        return ur[d.getDay()] || dateStr.substring(5);
    }

    /** Last N days attendance rate trend — offline-first from local sheets. */
    function attDashComputeLocalTrend(days, roleFilter, classFilter, users, sheetsByMonth) {
        days = days || 7;
        sheetsByMonth = sheetsByMonth || Object.create(null);
        var points = [];
        for (var i = days - 1; i >= 0; i--) {
            var dateStr = attDashDateOffset(i);
            var monthStr = monthOf(dateStr);
            var monthSheets = attDashSheetsForMonth(sheetsByMonth, monthStr);
            var dayStats = attDashStatsForDay(dateStr, roleFilter, classFilter, users, monthSheets);
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
        if (stats.total === 0) {
            el.textContent = 'منتخب فلٹر (' + role + cls + ') کے لیے کوئی حاضری ہدف نہیں — رجسٹر یا فلٹر چیک کریں۔';
            return;
        }
        if (stats.rate == null || stats.notTaken || attDashIsFutureDate(f.dateStr)) {
            el.textContent = f.dateStr + ' — ' + role + cls + ': حاضری نہیں لی گئی (نشان زد نہیں: ' +
                fmt(stats.notMarked != null ? stats.notMarked : stats.total) + ' / ' + fmt(stats.total) + ')';
            return;
        }
        el.textContent = f.dateStr + ' — ' + role + cls + ': ' +
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
        var rawUsers = attDashGetUsersRaw();
        var users = typeof global.emsFilterByDepartment === 'function'
            ? global.emsFilterByDepartment(rawUsers)
            : rawUsers;
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

        var stats = attDashStatsForDay(f.dateStr, f.roleFilter, f.classFilter, allUsers, sheets);
        attDashApplyStatsKpis(stats);
        setTxt('att-dash-locked', stats.lockedSheets);
        setTxt('att-dash-source', stats.source === 'local' ? 'مقامی' : '—');
        attDashUpdateLiveIndicator(stats.source);
        attDashRenderSummary(stats, f);

        var monthSummary = attDashMonthlySummary(monthStr, f.roleFilter, f.classFilter, sheets);
        setTxt('att-dash-month-rate', monthSummary.monthRate + '%');
        setTxt('att-dash-active-days', monthSummary.activeDays);
        setTxt('att-dash-month-marks', fmt(monthSummary.totalMarks));

        var classRows = attDashClassBreakdown(f.dateStr, f.roleFilter, f.classFilter, sheets);
        attDashRenderClassTable(classRows);
        attDashRenderClassHighlights(classRows);

        var alerts = attDashLowAttendanceAlerts(monthStr, sheets);
        attDashRenderAlerts(alerts);

        var localTrend = attDashComputeLocalTrend(7, f.roleFilter, f.classFilter, allUsers, sheetsByMonth);
        attDashRenderCharts(stats, localTrend, classRows);
        attDashRenderTrendSummary(localTrend);

        if (!attDashShouldFetchCloud()) {
            return Promise.resolve();
        }

        return Promise.resolve().then(function () {
            if (typeof global.emsFetchTodayAttendanceStats === 'function'
                && f.roleFilter === 'all'
                && !f.classFilter
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
        ['att-dash-date', 'att-dash-role-filter', 'att-dash-class-filter'].forEach(function (id) {
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
        if (global._attCurrentTabId === tabId && attPanelIsVisible(tabId)) return;
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

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', attDashBindControls);
    } else {
        attDashBindControls();
    }
})(typeof window !== 'undefined' ? window : globalThis);
