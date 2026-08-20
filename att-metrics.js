// ============================================================================
// Attendance metrics SSOT — daily vs period semantics + final-state dedupe (Phase 6)
//
// DAILY observation: one final P/A/L/unmarked state per person per calendar date
//   (teacher/staff/student daily register in records.*)
//
// PERIOD observation: one final P/A/L/unmarked state per person per date per periodId
//   (periodRecords.* — never merged into daily P/A/L totals when period filter active)
//
// PARTIAL / INCOMPLETE rollup labels are display-only rollups in Smart Register.
// They are NOT silently mapped to P/A/L in dashboard/report denominators.
// ============================================================================
(function (global) {
    'use strict';

    global.ATT_METRIC_DAILY = 'daily';
    global.ATT_METRIC_PERIOD = 'period';

    function attMetricsGetSymbols() {
        try {
            return JSON.parse(localStorage.getItem('ems_att_symbols')) || { P: 'P', A: 'A', L: 'L' };
        } catch (eSym) {
            return { P: 'P', A: 'A', L: 'L' };
        }
    }

    function attMetricsPartialLabel() {
        return global.ATT_ROLLUP_PARTIAL || 'جزوی حاضری';
    }

    function attMetricsIncompleteLabel() {
        return global.ATT_ROLLUP_INCOMPLETE || 'نامکمل';
    }

    function attMetricsGetUserId(u) {
        if (typeof global.attGetUserId === 'function') return global.attGetUserId(u);
        if (!u) return '';
        return String(u.id || u.regId || u.uid || u.docId || '').trim();
    }

    function attMetricsNormType(u) {
        var t = String((u && u.type) || '').toLowerCase();
        if (t === 'teacher' || t === 'staff' || t === 'student') return t;
        return t || 'student';
    }

    /** Full classification — partial/incomplete stay explicit, never coerced to P/A/L. */
    function attMetricsClassifyStatus(st, symbols) {
        symbols = symbols || attMetricsGetSymbols();
        var raw = String(st == null ? '' : st).trim();
        if (!raw) return 'UNMARKED';
        if (raw === attMetricsPartialLabel()) return 'PARTIAL';
        if (raw === attMetricsIncompleteLabel()) return 'INCOMPLETE';
        if (raw === symbols.P || raw === 'P' || raw === 'حاضر' || raw === 'ح') return 'P';
        if (raw === symbols.A || raw === 'A' || raw === 'غائب' || raw === 'غ' || raw === 'غیر حاضر') return 'A';
        if (raw === symbols.L || raw === 'L' || raw === 'رخصت' || raw === 'Leave' || raw === 'ر') return 'L';
        return 'OTHER';
    }

    /** Strict P/A/L bucket for stats — partial/incomplete/other => unmarked (''). */
    function attMetricsStrictBucket(st, symbols) {
        var kind = attMetricsClassifyStatus(st, symbols);
        if (kind === 'P' || kind === 'A' || kind === 'L') return kind;
        return '';
    }

    function attMetricsReadDayObservation(dayRec, dayNum) {
        if (!dayRec || typeof dayRec !== 'object') return { hasKey: false, status: '' };
        var hasKey = Object.prototype.hasOwnProperty.call(dayRec, dayNum)
            || Object.prototype.hasOwnProperty.call(dayRec, String(dayNum));
        if (!hasKey) return { hasKey: false, status: '' };
        var st = dayRec[dayNum];
        if (st == null || st === '') st = dayRec[String(dayNum)];
        if (st == null) st = '';
        return { hasKey: true, status: String(st).trim() };
    }

    function attMetricsSheetTimestamp(data) {
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

    function attMetricsDayNumOf(dateStr) {
        return parseInt(String(dateStr || '').substring(8, 10), 10);
    }

    function attMetricsDaysInMonth(monthStr) {
        var parts = String(monthStr || '').split('-');
        var y = parseInt(parts[0], 10);
        var m = parseInt(parts[1], 10);
        if (!y || !m) return [];
        var count = new Date(y, m, 0).getDate();
        var out = [];
        for (var d = 1; d <= count; d++) {
            out.push(monthStr + '-' + (d < 10 ? '0' + d : String(d)));
        }
        return out;
    }

    /** Newer ts wins; on tie prefer period=all; clear/tombstone beats stale mark. */
    function attMetricsMarkCandidateBetter(cand, incumbent) {
        if (!incumbent) return true;
        if (!cand) return false;
        if (cand.ts !== incumbent.ts) return cand.ts > incumbent.ts;
        if (cand.isAll !== incumbent.isAll) return !!cand.isAll;
        if (cand.cleared !== incumbent.cleared) return !!cand.cleared;
        return false;
    }

    /**
     * One final strict P/A/L (or unmarked) per roster member for a date.
     * periodFilter set => PERIOD metric via periodRecords (canonical) or legacy period sheet.
     */
    function attMetricsBuildFinalMarksForDay(dateStr, sheets, rosterUsers, periodFilter) {
        var symbols = attMetricsGetSymbols();
        var dayNum = attMetricsDayNumOf(dateStr);
        var periodId = String(periodFilter || '').trim();
        var roster = Object.create(null);
        (rosterUsers || []).forEach(function (u) {
            var id = attMetricsGetUserId(u);
            if (!id) return;
            roster[id] = {
                classId: String(u.class || u.className || u.grade || '').trim() || 'نامعلوم',
                role: attMetricsNormType(u),
                user: u
            };
        });

        var best = Object.create(null);

        (sheets || []).forEach(function (sh) {
            if (!sh || !sh.data) return;
            var sheetTs = attMetricsSheetTimestamp(sh.data);
            var isAll = !sh.period || sh.period === 'all';

            if (periodId) {
                if (isAll) {
                    var periodRecs = sh.data.periodRecords || {};
                    Object.keys(periodRecs).forEach(function (uid) {
                        if (!roster[uid]) return;
                        var role = roster[uid].role;
                        if (role === 'student' && sh.type && sh.type !== 'students') return;
                        if (role === 'teacher' && sh.type && sh.type !== 'teachers') return;
                        if (role === 'staff' && sh.type && sh.type !== 'staff') return;
                        if (role === 'student' && sh.classId && sh.classId !== roster[uid].classId) return;

                        var dayMap = periodRecs[uid] && (periodRecs[uid][dayNum] || periodRecs[uid][String(dayNum)]);
                        if (!dayMap || typeof dayMap !== 'object') return;
                        if (!Object.prototype.hasOwnProperty.call(dayMap, periodId)) return;
                        var raw = dayMap[periodId];
                        var bucket = attMetricsStrictBucket(raw == null ? '' : String(raw).trim(), symbols);
                        var cand = {
                            uid: uid,
                            ts: sheetTs,
                            isAll: true,
                            hasObservation: true,
                            cleared: !bucket,
                            status: bucket,
                            sheetKey: sh.key || '',
                            period: periodId,
                            metric: global.ATT_METRIC_PERIOD
                        };
                        if (attMetricsMarkCandidateBetter(cand, best[uid])) best[uid] = cand;
                    });
                    return;
                }

                if (String(sh.period) !== periodId) return;
                var recLegacy = sh.data.records || {};
                Object.keys(recLegacy).forEach(function (uid) {
                    if (!roster[uid]) return;
                    var role = roster[uid].role;
                    if (role === 'student' && sh.type && sh.type !== 'students') return;
                    if (role === 'teacher' && sh.type && sh.type !== 'teachers') return;
                    if (role === 'staff' && sh.type && sh.type !== 'staff') return;
                    if (role === 'student' && sh.classId && sh.classId !== roster[uid].classId) return;

                    var obs = attMetricsReadDayObservation(recLegacy[uid], dayNum);
                    if (!obs.hasKey) return;
                    var bucketL = attMetricsStrictBucket(obs.status, symbols);
                    var candL = {
                        uid: uid,
                        ts: sheetTs,
                        isAll: false,
                        hasObservation: true,
                        cleared: !bucketL,
                        status: bucketL,
                        sheetKey: sh.key || '',
                        period: periodId,
                        metric: global.ATT_METRIC_PERIOD
                    };
                    if (attMetricsMarkCandidateBetter(candL, best[uid])) best[uid] = candL;
                });
                return;
            }

            var rec = sh.data.records || {};
            Object.keys(rec).forEach(function (uid) {
                if (!roster[uid]) return;
                var role = roster[uid].role;
                if (role === 'student' && sh.type && sh.type !== 'students') return;
                if (role === 'teacher' && sh.type && sh.type !== 'teachers') return;
                if (role === 'staff' && sh.type && sh.type !== 'staff') return;
                if (role === 'student' && sh.classId && sh.classId !== roster[uid].classId) return;

                var dayRec = rec[uid];
                var obs = attMetricsReadDayObservation(dayRec, dayNum);
                var cand;
                if (isAll) {
                    cand = {
                        uid: uid,
                        ts: sheetTs,
                        isAll: true,
                        hasObservation: true,
                        cleared: !obs.hasKey || !attMetricsStrictBucket(obs.status, symbols),
                        status: obs.hasKey ? attMetricsStrictBucket(obs.status, symbols) : '',
                        sheetKey: sh.key || '',
                        period: 'all',
                        metric: global.ATT_METRIC_DAILY
                    };
                } else {
                    if (!obs.hasKey) return;
                    var bucket = attMetricsStrictBucket(obs.status, symbols);
                    cand = {
                        uid: uid,
                        ts: sheetTs,
                        isAll: false,
                        hasObservation: true,
                        cleared: !bucket,
                        status: bucket,
                        sheetKey: sh.key || '',
                        period: sh.period || '',
                        metric: global.ATT_METRIC_DAILY
                    };
                }
                if (attMetricsMarkCandidateBetter(cand, best[uid])) best[uid] = cand;
            });
        });

        var marks = Object.create(null);
        Object.keys(roster).forEach(function (uid) {
            var b = best[uid];
            marks[uid] = {
                status: (b && !b.cleared && b.status) ? b.status : '',
                classId: roster[uid].classId,
                role: roster[uid].role,
                ts: b ? b.ts : 0,
                sourceKey: b ? b.sheetKey : '',
                metric: periodId ? global.ATT_METRIC_PERIOD : global.ATT_METRIC_DAILY
            };
        });
        return {
            roster: roster,
            marks: marks,
            dayNum: dayNum,
            dateStr: dateStr,
            periodFilter: periodId || '',
            metric: periodId ? global.ATT_METRIC_PERIOD : global.ATT_METRIC_DAILY
        };
    }

    function attMetricsStatsFromFinalMarks(finalDataset, rosterUsers) {
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
        var markedTotal = present + absent + leave;
        var notMarked = Math.max(0, total - markedTotal);
        return {
            present: present,
            absent: absent,
            leave: leave,
            notMarked: notMarked,
            total: total,
            markedTotal: markedTotal,
            metric: (finalDataset && finalDataset.metric) || global.ATT_METRIC_DAILY
        };
    }

    /** Monthly rate from deduped daily final marks — legacy+canonical sheets never double-count. */
    function attMetricsMonthlySummary(monthStr, sheets, rosterUsers) {
        var days = attMetricsDaysInMonth(monthStr);
        var totalPresentMarks = 0;
        var totalMarked = 0;
        var daysWithData = Object.create(null);
        days.forEach(function (dateStr) {
            var finalDs = attMetricsBuildFinalMarksForDay(dateStr, sheets, rosterUsers, '');
            var dayStats = attMetricsStatsFromFinalMarks(finalDs, rosterUsers);
            if (dayStats.markedTotal > 0) {
                daysWithData[attMetricsDayNumOf(dateStr)] = true;
                totalPresentMarks += dayStats.present;
                totalMarked += dayStats.markedTotal;
            }
        });
        return {
            activeDays: Object.keys(daysWithData).length,
            monthRate: totalMarked > 0 ? Math.round((totalPresentMarks / totalMarked) * 100) : 0,
            totalMarks: totalPresentMarks,
            markedTotal: totalMarked
        };
    }

    function attMetricsLowAttendanceAlerts(monthStr, sheets, rosterUsers) {
        var stats = Object.create(null);
        (rosterUsers || []).forEach(function (u) {
            var id = attMetricsGetUserId(u);
            if (!id) return;
            stats[id] = { user: u, present: 0, total: 0 };
        });
        attMetricsDaysInMonth(monthStr).forEach(function (dateStr) {
            var finalDs = attMetricsBuildFinalMarksForDay(dateStr, sheets, rosterUsers, '');
            Object.keys(finalDs.marks || {}).forEach(function (uid) {
                if (!stats[uid]) return;
                var st = finalDs.marks[uid].status;
                if (!st) return;
                stats[uid].total++;
                if (st === 'P') stats[uid].present++;
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

    function attMetricsFindUserRecord(records, user) {
        if (!records || !user) return null;
        var ids = [attMetricsGetUserId(user), user.id, user.regId, user.uid, user.docId].filter(Boolean);
        var seen = Object.create(null);
        for (var i = 0; i < ids.length; i++) {
            var id = String(ids[i]).trim();
            if (!id || seen[id]) continue;
            seen[id] = true;
            if (records[id]) return records[id];
        }
        return null;
    }

    function attMetricsReportKind(st, symbols) {
        var kind = attMetricsClassifyStatus(st, symbols);
        if (kind === 'P') return 'present';
        if (kind === 'A') return 'absent';
        if (kind === 'L') return 'leave';
        return '';
    }

    /**
     * Report hour marks — period authoritative; daily fallback only when no period marks for that date.
     */
    function attMetricsReportCollectMarks(user, allRecords, fromDate, toDate, symbols) {
        symbols = symbols || attMetricsGetSymbols();
        var periodMarks = Object.create(null);
        var dailyMarks = Object.create(null);
        var reasons = Object.create(null);

        function inRange(sheet, dayKey) {
            var dayNum = parseInt(dayKey, 10);
            if (!dayNum || dayNum < 1 || dayNum > 31) return '';
            var fullDate = sheet.month + '-' + (dayNum < 10 ? '0' + dayNum : String(dayNum));
            return fullDate >= fromDate && fullDate <= toDate ? fullDate : '';
        }
        function shouldReplace(candidate, current) {
            if (!current) return true;
            if (candidate.timestamp !== current.timestamp) return candidate.timestamp > current.timestamp;
            return !!candidate.kind && !current.kind;
        }
        function addReason(date, remark, timestamp) {
            if (!remark) return;
            if (!reasons[date] || timestamp >= reasons[date].timestamp) {
                reasons[date] = { text: date + ': ' + remark, timestamp: timestamp };
            }
        }

        (allRecords || []).forEach(function (sheet) {
            var userRecord = attMetricsFindUserRecord(sheet.records, user) || {};
            var userPeriods = attMetricsFindUserRecord(sheet.periodRecords, user) || {};
            var userRemarks = attMetricsFindUserRecord(sheet.remarks, user) || {};
            var timestamp = Number(sheet.timestamp) || 0;

            Object.keys(userPeriods).forEach(function (dayKey) {
                var fullDate = inRange(sheet, dayKey);
                if (!fullDate || !userPeriods[dayKey] || typeof userPeriods[dayKey] !== 'object') return;
                Object.keys(userPeriods[dayKey]).forEach(function (periodId) {
                    var kind = attMetricsReportKind(userPeriods[dayKey][periodId], symbols);
                    if (!kind) return;
                    var key = fullDate + '|' + String(periodId);
                    var candidate = { kind: kind, timestamp: timestamp };
                    if (shouldReplace(candidate, periodMarks[key])) periodMarks[key] = candidate;
                });
                addReason(fullDate, userRemarks[dayKey], timestamp);
            });

            Object.keys(userRecord).forEach(function (dayKey) {
                var fullDate = inRange(sheet, dayKey);
                if (!fullDate) return;
                var kind = attMetricsReportKind(userRecord[dayKey], symbols);
                if (!kind) return;
                var candidate = { kind: kind, timestamp: timestamp };
                if (shouldReplace(candidate, dailyMarks[fullDate])) dailyMarks[fullDate] = candidate;
                addReason(fullDate, userRemarks[dayKey], timestamp);
            });
        });

        var finalMarks = Object.create(null);
        Object.keys(periodMarks).forEach(function (key) {
            finalMarks[key] = periodMarks[key];
        });
        Object.keys(dailyMarks).forEach(function (date) {
            var hasPeriodForDate = Object.keys(periodMarks).some(function (key) {
                return key.indexOf(date + '|') === 0;
            });
            if (!hasPeriodForDate) finalMarks[date + '|daily'] = dailyMarks[date];
        });

        return { finalMarks: finalMarks, reasons: reasons, periodMarks: periodMarks, dailyMarks: dailyMarks };
    }

    global.attMetricsClassifyStatus = attMetricsClassifyStatus;
    global.attMetricsStrictBucket = attMetricsStrictBucket;
    global.attMetricsBuildFinalMarksForDay = attMetricsBuildFinalMarksForDay;
    global.attMetricsStatsFromFinalMarks = attMetricsStatsFromFinalMarks;
    global.attMetricsMarkCandidateBetter = attMetricsMarkCandidateBetter;
    global.attMetricsMonthlySummary = attMetricsMonthlySummary;
    global.attMetricsLowAttendanceAlerts = attMetricsLowAttendanceAlerts;
    global.attMetricsReportCollectMarks = attMetricsReportCollectMarks;
    global.attMetricsDaysInMonth = attMetricsDaysInMonth;
})(typeof window !== 'undefined' ? window : globalThis);
