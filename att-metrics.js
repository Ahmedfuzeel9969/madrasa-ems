// ============================================================================
// Attendance metrics SSOT — daily vs period semantics + final-state dedupe (Phase 6)
//
// DAILY observation / person state: exactly one of P | A | L | PARTIAL | INCOMPLETE | UNMARKED | OTHER
//   (teacher/staff/student daily register in records.*)
//
// PERIOD observation: one final state per person per date per periodId
//   (periodRecords.* — never merged into daily P/A/L totals when period filter active)
//
// Classification (kind) and observation (hasObservation / cleared) are separate.
// PARTIAL and INCOMPLETE are observed states — never treated as UNMARKED merely
// because strictBucket() is empty. strictBucket remains P/A/L-only.
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

    /** Strict P/A/L bucket — PARTIAL/INCOMPLETE/OTHER/UNMARKED stay empty. Do NOT use this to detect observation. */
    function attMetricsStrictBucket(st, symbols) {
        var kind = attMetricsClassifyStatus(st, symbols);
        if (kind === 'P' || kind === 'A' || kind === 'L') return kind;
        return '';
    }

    /**
     * Separate observation from P/A/L classification.
     * hasKey + empty => cleared tombstone (UNMARKED).
     * PARTIAL / INCOMPLETE / OTHER => observed, not cleared.
     */
    function attMetricsObservationState(raw, hasKey, symbols) {
        if (!hasKey) {
            return { kind: 'UNMARKED', status: '', hasObservation: false, cleared: false };
        }
        var kind = attMetricsClassifyStatus(raw, symbols);
        if (kind === 'UNMARKED') {
            return { kind: 'UNMARKED', status: '', hasObservation: true, cleared: true };
        }
        return {
            kind: kind,
            status: kind,
            hasObservation: true,
            cleared: false
        };
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

    function attMetricsListTimetablePeriods() {
        try {
            if (typeof global.attReadAllTimetablePeriodsRaw === 'function') {
                var rawAll = global.attReadAllTimetablePeriodsRaw();
                if (Array.isArray(rawAll)) return rawAll;
            }
            if (typeof global.attHydrateTimetablePeriods === 'function') {
                var hyd = global.attHydrateTimetablePeriods();
                if (Array.isArray(hyd)) return hyd;
            }
            var raw = localStorage.getItem('ems_att_periods');
            var list = raw ? JSON.parse(raw) : [];
            return Array.isArray(list) ? list : [];
        } catch (ePer) {
            return [];
        }
    }

    function attMetricsFindTimetablePeriod(periodId) {
        var id = String(periodId || '').trim();
        if (!id) return null;
        var list = attMetricsListTimetablePeriods();
        for (var i = 0; i < list.length; i++) {
            if (list[i] && String(list[i].id) === id) return list[i];
        }
        return null;
    }

    function attMetricsPeriodOnWeekday(period, weekday) {
        if (!period) return false;
        var days = Array.isArray(period.days) ? period.days : null;
        if (!days || !days.length) return true;
        return days.some(function (d) { return Number(d) === Number(weekday); });
    }

    function attMetricsInferPeriodScope(dateStr, sheets, periodId, roster) {
        var dayNum = attMetricsDayNumOf(dateStr);
        var classIds = Object.create(null);
        var teacherIds = Object.create(null);
        (sheets || []).forEach(function (sh) {
            if (!sh || !sh.data) return;
            var periodRecs = sh.data.periodRecords || {};
            Object.keys(periodRecs).forEach(function (uid) {
                if (!roster[uid]) return;
                var dayMap = periodRecs[uid] && (periodRecs[uid][dayNum] || periodRecs[uid][String(dayNum)]);
                if (!dayMap || !Object.prototype.hasOwnProperty.call(dayMap, periodId)) return;
                if (roster[uid].role === 'student') classIds[roster[uid].classId] = true;
                if (roster[uid].role === 'teacher') teacherIds[uid] = true;
            });
            if (String(sh.period) === String(periodId)) {
                Object.keys(sh.data.records || {}).forEach(function (uid) {
                    if (!roster[uid]) return;
                    if (roster[uid].role === 'student') classIds[roster[uid].classId] = true;
                    if (roster[uid].role === 'teacher') teacherIds[uid] = true;
                });
                if (sh.classId) classIds[String(sh.classId)] = true;
            }
        });
        return { classIds: classIds, teacherIds: teacherIds };
    }

    /**
     * Target population for date + role + class + period.
     * student period → active students of period.className
     * teacher period → stable teacherId assigned to that period
     * teacher + class → timetable assignment for that class/date
     * staff + class → class filter is not applied
     */
    function attMetricsResolveTargetRoster(dateStr, rosterUsers, periodFilter, sheets, opts) {
        opts = opts || {};
        var classFilter = String(opts.classFilter || '').trim();
        var roleFilter = String(opts.roleFilter || '').trim();
        var weekday = attMetricsWeekdayOf(dateStr);
        var periodId = String(periodFilter || '').trim();
        var users = (rosterUsers || []).slice();

        function idOf(u) { return attMetricsGetUserId(u); }

        if (roleFilter === 'student' || roleFilter === 'teacher' || roleFilter === 'staff') {
            users = users.filter(function (u) { return attMetricsNormType(u) === roleFilter; });
        }

        if (classFilter && !periodId) {
            var assignedTeachers = Object.create(null);
            attMetricsListTimetablePeriods().forEach(function (p) {
                if (!p || attMetricsIsPeriodArchived(p)) return;
                if (String(p.className || '').trim() !== classFilter) return;
                if (!attMetricsPeriodOnWeekday(p, weekday)) return;
                var tid = String(p.teacherId || '').trim();
                if (tid) assignedTeachers[tid] = true;
            });
            users = users.filter(function (u) {
                var role = attMetricsNormType(u);
                if (role === 'staff') return roleFilter === 'staff';
                if (role === 'teacher') return !!assignedTeachers[idOf(u)];
                if (role === 'student') {
                    var cls = String(u.class || u.className || u.grade || '').trim();
                    return cls === classFilter;
                }
                return false;
            });
        }

        if (!periodId) return users;

        var rosterIndex = Object.create(null);
        users.forEach(function (u) {
            var id = idOf(u);
            if (!id) return;
            rosterIndex[id] = {
                classId: String(u.class || u.className || u.grade || '').trim() || 'نامعلوم',
                role: attMetricsNormType(u),
                user: u
            };
        });

        var period = attMetricsFindTimetablePeriod(periodId);
        var allowClass = Object.create(null);
        var allowTeacher = Object.create(null);
        var hasClassConstraint = false;
        var hasTeacherConstraint = false;

        if (period) {
            var pClass = String(period.className || '').trim();
            var pTeacher = String(period.teacherId || '').trim();
            if (pClass) {
                allowClass[pClass] = true;
                hasClassConstraint = true;
            }
            if (pTeacher) {
                allowTeacher[pTeacher] = true;
                hasTeacherConstraint = true;
            }
        }

        var inferred = attMetricsInferPeriodScope(dateStr, sheets, periodId, rosterIndex);
        if (!hasClassConstraint) {
            Object.keys(inferred.classIds).forEach(function (c) {
                allowClass[c] = true;
                hasClassConstraint = true;
            });
        }
        if (!hasTeacherConstraint) {
            Object.keys(inferred.teacherIds).forEach(function (t) {
                allowTeacher[t] = true;
                hasTeacherConstraint = true;
            });
        }

        var rolesInRoster = Object.create(null);
        users.forEach(function (u) { rolesInRoster[attMetricsNormType(u)] = true; });
        var onlyTeachers = !!rolesInRoster.teacher && !rolesInRoster.student && !rolesInRoster.staff;
        var onlyStudents = !!rolesInRoster.student && !rolesInRoster.teacher && !rolesInRoster.staff;

        return users.filter(function (u) {
            var role = attMetricsNormType(u);
            var uid = idOf(u);
            if (role === 'staff') return !classFilter && !periodId;
            if (role === 'student') {
                if (onlyTeachers) return false;
                if (!hasClassConstraint) return true;
                var cls = String(u.class || u.className || u.grade || '').trim() || 'نامعلوم';
                return !!allowClass[cls];
            }
            if (role === 'teacher') {
                if (onlyStudents) return false;
                if (!hasTeacherConstraint) return !hasClassConstraint;
                return !!allowTeacher[uid];
            }
            return false;
        });
    }

    function attMetricsIsPeriodArchived(period) {
        if (typeof global.attIsPeriodArchived === 'function') return global.attIsPeriodArchived(period);
        return !!(period && (period.archived === true || period.deleted === true));
    }

    /**
     * One final daily/period state per roster member for a date.
     * Status is the classified kind (P/A/L/PARTIAL/INCOMPLETE/OTHER), never coerced via strictBucket.
     * periodFilter set => PERIOD metric via periodRecords (canonical) or legacy period sheet.
     */
    function attMetricsBuildFinalMarksForDay(dateStr, sheets, rosterUsers, periodFilter) {
        var symbols = attMetricsGetSymbols();
        var dayNum = attMetricsDayNumOf(dateStr);
        var periodId = String(periodFilter || '').trim();
        var resolvedUsers = attMetricsResolveTargetRoster(dateStr, rosterUsers, periodId, sheets, {});
        var roster = Object.create(null);
        (resolvedUsers || []).forEach(function (u) {
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
                        var obsP = attMetricsObservationState(dayMap[periodId], true, symbols);
                        var cand = {
                            uid: uid,
                            ts: sheetTs,
                            isAll: true,
                            hasObservation: obsP.hasObservation,
                            cleared: obsP.cleared,
                            status: obsP.status,
                            kind: obsP.kind,
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
                    var obsL = attMetricsObservationState(obs.status, true, symbols);
                    var candL = {
                        uid: uid,
                        ts: sheetTs,
                        isAll: false,
                        hasObservation: obsL.hasObservation,
                        cleared: obsL.cleared,
                        status: obsL.status,
                        kind: obsL.kind,
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
                var state = attMetricsObservationState(obs.status, obs.hasKey, symbols);
                var cand;
                if (isAll) {
                    cand = {
                        uid: uid,
                        ts: sheetTs,
                        isAll: true,
                        hasObservation: state.hasObservation,
                        cleared: state.cleared,
                        status: state.status,
                        kind: state.kind,
                        sheetKey: sh.key || '',
                        period: 'all',
                        metric: global.ATT_METRIC_DAILY
                    };
                } else {
                    if (!obs.hasKey) return;
                    cand = {
                        uid: uid,
                        ts: sheetTs,
                        isAll: false,
                        hasObservation: state.hasObservation,
                        cleared: state.cleared,
                        status: state.status,
                        kind: state.kind,
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
            var cleared = !!(b && b.cleared);
            var status = (b && !cleared && b.status) ? b.status : '';
            marks[uid] = {
                status: status,
                kind: cleared || !status ? 'UNMARKED' : (b.kind || status),
                hasObservation: !!(b && b.hasObservation && !cleared && status),
                cleared: cleared,
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
        var total = Object.keys((finalDataset && finalDataset.roster) || {}).length;
        if (!total) total = (rosterUsers || []).length;
        var present = 0;
        var absent = 0;
        var leave = 0;
        var partial = 0;
        var incomplete = 0;
        var other = 0;
        var marks = (finalDataset && finalDataset.marks) || {};
        Object.keys(marks).forEach(function (uid) {
            var st = marks[uid] && marks[uid].status;
            if (st === 'P') present++;
            else if (st === 'A') absent++;
            else if (st === 'L') leave++;
            else if (st === 'PARTIAL') partial++;
            else if (st === 'INCOMPLETE') incomplete++;
            else if (st) other++;
        });
        var markedTotal = present + absent + leave;
        var observedTotal = markedTotal + partial + incomplete + other;
        var notMarked = Math.max(0, total - observedTotal);
        var out = {
            present: present,
            absent: absent,
            leave: leave,
            partial: partial,
            incomplete: incomplete,
            other: other,
            notMarked: notMarked,
            total: total,
            markedTotal: markedTotal,
            observedTotal: observedTotal,
            notTaken: observedTotal <= 0,
            metric: (finalDataset && finalDataset.metric) || global.ATT_METRIC_DAILY
        };
        return attMetricsAttachCoverage(out);
    }

    function attMetricsAttachCoverage(stats) {
        stats = stats || {};
        var target = Number(stats.total) || 0;
        var observed = stats.observedTotal != null
            ? Number(stats.observedTotal) || 0
            : (Number(stats.present) || 0) + (Number(stats.absent) || 0) + (Number(stats.leave) || 0)
                + (Number(stats.partial) || 0) + (Number(stats.incomplete) || 0) + (Number(stats.other) || 0);
        stats.target = target;
        stats.observed = observed;
        stats.unmarked = stats.notMarked != null ? stats.notMarked : Math.max(0, target - observed);
        stats.coverageRate = target > 0 ? Math.round((observed / target) * 100) : 0;
        return stats;
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
            if ((dayStats.observedTotal || dayStats.markedTotal) > 0) {
                daysWithData[attMetricsDayNumOf(dateStr)] = true;
                totalPresentMarks += dayStats.present;
                totalMarked += (dayStats.markedTotal || 0)
                    + (dayStats.partial || 0)
                    + (dayStats.incomplete || 0);
            }
        });
        var teacherUsers = (rosterUsers || []).filter(function (u) {
            return attMetricsNormType(u) === 'teacher';
        });
        if (teacherUsers.length && teacherUsers.length === (rosterUsers || []).length) {
            var teacherMonth = attMetricsTeacherMonthlySummary(monthStr, sheets, teacherUsers);
            return {
                activeDays: teacherMonth.activeDays,
                monthRate: teacherMonth.periodWeightedRate,
                totalMarks: teacherMonth.presentPeriods,
                markedTotal: teacherMonth.markedPeriods,
                partialDays: teacherMonth.partialDays,
                incompleteDays: teacherMonth.incompleteDays,
                periodWeighted: true
            };
        }
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

    function attMetricsWeekdayOf(dateStr) {
        try {
            var d = new Date(String(dateStr) + 'T12:00:00+05:00');
            var short = new Intl.DateTimeFormat('en-US', {
                timeZone: 'Asia/Karachi',
                weekday: 'short'
            }).format(d);
            var map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
            if (map[short] != null) return map[short];
        } catch (eWd) { /* fall through */ }
        return new Date(String(dateStr) + 'T12:00:00Z').getUTCDay();
    }

    function attMetricsCollectPeriodMapForUserDay(dateStr, sheets, uid) {
        var dayNum = attMetricsDayNumOf(dateStr);
        var bestByPeriod = Object.create(null);
        (sheets || []).forEach(function (sh) {
            if (!sh || !sh.data) return;
            var ts = attMetricsSheetTimestamp(sh.data);
            var isAll = !sh.period || sh.period === 'all';
            if (isAll) {
                var userPeriods = sh.data.periodRecords && sh.data.periodRecords[uid];
                var dayMap = userPeriods && (userPeriods[dayNum] || userPeriods[String(dayNum)]);
                if (!dayMap || typeof dayMap !== 'object') return;
                Object.keys(dayMap).forEach(function (pid) {
                    var state = attMetricsObservationState(dayMap[pid], true);
                    var cand = { ts: ts, status: state.status, kind: state.kind, cleared: state.cleared };
                    if (!bestByPeriod[pid] || attMetricsMarkCandidateBetter(
                        { ts: ts, isAll: true, cleared: state.cleared },
                        { ts: bestByPeriod[pid].ts, isAll: true, cleared: bestByPeriod[pid].cleared }
                    )) {
                        bestByPeriod[pid] = cand;
                    }
                });
                return;
            }
            var rec = sh.data.records && sh.data.records[uid];
            var obs = attMetricsReadDayObservation(rec, dayNum);
            if (!obs.hasKey) return;
            var stateL = attMetricsObservationState(obs.status, true);
            var pidL = String(sh.period);
            var candL = { ts: ts, status: stateL.status, kind: stateL.kind, cleared: stateL.cleared };
            if (!bestByPeriod[pidL] || ts >= bestByPeriod[pidL].ts) bestByPeriod[pidL] = candL;
        });
        return bestByPeriod;
    }

    function attMetricsUnionPeriodIds(explicitIds, timetableIds, savedIds) {
        var seen = Object.create(null);
        var out = [];
        function add(id) {
            var pid = String(id || '').trim();
            if (!pid || seen[pid]) return;
            seen[pid] = true;
            out.push(pid);
        }
        (explicitIds || []).forEach(add);
        (timetableIds || []).forEach(add);
        (savedIds || []).forEach(add);
        return out;
    }

    function attMetricsDailyStateFromPeriodCounts(present, absent, leave, otherMarked, unmarked) {
        var marked = present + absent + leave + otherMarked;
        if (marked <= 0) return 'UNMARKED';
        if (unmarked > 0) return 'INCOMPLETE';
        if (otherMarked && !present && !absent && !leave) return 'OTHER';
        if (present && !absent && !leave && !otherMarked) return 'P';
        if (absent && !present && !leave && !otherMarked) return 'A';
        if (leave && !present && !absent && !otherMarked) return 'L';
        return 'PARTIAL';
    }

    /**
     * One teacher + date period summary.
     * expectedPeriodIds optional — otherwise timetable (stable teacherId) + archived saved marks.
     */
    function attMetricsTeacherPeriodDaySummary(dateStr, sheets, user, expectedPeriodIds) {
        var uid = attMetricsGetUserId(user);
        var periodMap = attMetricsCollectPeriodMapForUserDay(dateStr, sheets, uid);
        var timetableIds = [];
        var weekday = attMetricsWeekdayOf(dateStr);
        var dayNum = attMetricsDayNumOf(dateStr);
        if (typeof global.attTeacherPeriodsForRegisterDay === 'function') {
            (global.attTeacherPeriodsForRegisterDay(uid, (user && user.name) || '', dayNum, weekday) || []).forEach(function (p) {
                if (p && p.id) timetableIds.push(p.id);
            });
        } else if (typeof global.attTeacherPeriodsForWeekday === 'function') {
            (global.attTeacherPeriodsForWeekday(uid, (user && user.name) || '', weekday) || []).forEach(function (p) {
                if (p && p.id) timetableIds.push(p.id);
            });
        }
        var savedIds = Object.keys(periodMap).filter(function (pid) {
            var obs = periodMap[pid];
            return obs && !obs.cleared && obs.status;
        });
        var expected = attMetricsUnionPeriodIds(expectedPeriodIds, timetableIds, savedIds);

        if (!expected.length) {
            var daily = attMetricsBuildFinalMarksForDay(dateStr, sheets, [user], '');
            var mark = (daily.marks && daily.marks[uid]) || {};
            var kind = mark.status || 'UNMARKED';
            if (!kind) kind = 'UNMARKED';
            var observed = kind !== 'UNMARKED';
            return {
                teacherId: uid,
                dateStr: dateStr,
                expectedPeriods: 0,
                markedPeriods: observed ? 1 : 0,
                presentPeriods: kind === 'P' ? 1 : 0,
                absentPeriods: kind === 'A' ? 1 : 0,
                leavePeriods: kind === 'L' ? 1 : 0,
                unmarkedPeriods: observed ? 0 : 1,
                completionRate: observed ? 100 : 0,
                periodCompletionRate: observed ? 100 : 0,
                periodAttendanceRate: kind === 'P' ? 100 : 0,
                dailyState: kind,
                usedDailyFallback: true
            };
        }

        var presentPeriods = 0;
        var absentPeriods = 0;
        var leavePeriods = 0;
        var otherPeriods = 0;
        var unmarkedPeriods = 0;
        expected.forEach(function (pid) {
            var obs = periodMap[pid];
            var st = (obs && !obs.cleared) ? obs.status : '';
            if (st === 'P') presentPeriods++;
            else if (st === 'A') absentPeriods++;
            else if (st === 'L') leavePeriods++;
            else if (st) otherPeriods++;
            else unmarkedPeriods++;
        });
        var expectedPeriods = expected.length;
        var markedPeriods = presentPeriods + absentPeriods + leavePeriods + otherPeriods;
        var pal = presentPeriods + absentPeriods + leavePeriods;
        var completionRate = expectedPeriods > 0 ? Math.round((markedPeriods / expectedPeriods) * 100) : 0;
        return {
            teacherId: uid,
            dateStr: dateStr,
            expectedPeriods: expectedPeriods,
            markedPeriods: markedPeriods,
            presentPeriods: presentPeriods,
            absentPeriods: absentPeriods,
            leavePeriods: leavePeriods,
            unmarkedPeriods: unmarkedPeriods,
            completionRate: completionRate,
            periodCompletionRate: completionRate,
            periodAttendanceRate: pal > 0 ? Math.round((presentPeriods / pal) * 100) : 0,
            dailyState: attMetricsDailyStateFromPeriodCounts(
                presentPeriods, absentPeriods, leavePeriods, otherPeriods, unmarkedPeriods
            ),
            usedDailyFallback: false
        };
    }

    function attMetricsTeacherRosterDayAggregate(dateStr, sheets, teachers) {
        var presentPeriods = 0;
        var absentPeriods = 0;
        var leavePeriods = 0;
        var expectedPeriods = 0;
        var markedPeriods = 0;
        var pal = 0;
        (teachers || []).forEach(function (u) {
            var s = attMetricsTeacherPeriodDaySummary(dateStr, sheets, u);
            if (s.usedDailyFallback) {
                if (s.dailyState === 'UNMARKED') return;
                markedPeriods += 1;
                pal += 1;
                if (s.dailyState === 'P') presentPeriods += 1;
                else if (s.dailyState === 'A') absentPeriods += 1;
                else if (s.dailyState === 'L') leavePeriods += 1;
                return;
            }
            presentPeriods += s.presentPeriods || 0;
            absentPeriods += s.absentPeriods || 0;
            leavePeriods += s.leavePeriods || 0;
            expectedPeriods += s.expectedPeriods || 0;
            markedPeriods += s.markedPeriods || 0;
            pal += (s.presentPeriods || 0) + (s.absentPeriods || 0) + (s.leavePeriods || 0);
        });
        var completionRate = expectedPeriods > 0 ? Math.round((markedPeriods / expectedPeriods) * 100) : null;
        return {
            dateStr: dateStr,
            expectedPeriods: expectedPeriods,
            markedPeriods: markedPeriods,
            presentPeriods: presentPeriods,
            absentPeriods: absentPeriods,
            leavePeriods: leavePeriods,
            palPeriods: pal,
            completionRate: completionRate,
            periodCompletionRate: completionRate,
            periodAttendanceRate: pal > 0 ? Math.round((presentPeriods / pal) * 100) : null,
            notTaken: markedPeriods <= 0 && pal <= 0
        };
    }

    function attMetricsTeacherMonthlySummary(monthStr, sheets, rosterUsers) {
        var presentPeriods = 0;
        var palPeriods = 0;
        var partialDays = 0;
        var incompleteDays = 0;
        var daysWithData = Object.create(null);
        attMetricsDaysInMonth(monthStr).forEach(function (dateStr) {
            var dayActive = false;
            (rosterUsers || []).forEach(function (u) {
                if (attMetricsNormType(u) !== 'teacher') return;
                var s = attMetricsTeacherPeriodDaySummary(dateStr, sheets, u);
                if (s.dailyState === 'UNMARKED' && (s.markedPeriods || 0) <= 0) return;
                dayActive = true;
                if (s.dailyState === 'PARTIAL') partialDays++;
                if (s.dailyState === 'INCOMPLETE') incompleteDays++;
                if (s.usedDailyFallback) {
                    palPeriods += 1;
                    if (s.dailyState === 'P') presentPeriods += 1;
                } else {
                    presentPeriods += s.presentPeriods || 0;
                    palPeriods += (s.presentPeriods || 0) + (s.absentPeriods || 0) + (s.leavePeriods || 0);
                }
            });
            if (dayActive) daysWithData[dateStr] = true;
        });
        return {
            activeDays: Object.keys(daysWithData).length,
            partialDays: partialDays,
            incompleteDays: incompleteDays,
            presentPeriods: presentPeriods,
            markedPeriods: palPeriods,
            periodWeightedRate: palPeriods > 0 ? Math.round((presentPeriods / palPeriods) * 100) : 0
        };
    }

    global.attMetricsClassifyStatus = attMetricsClassifyStatus;
    global.attMetricsStrictBucket = attMetricsStrictBucket;
    global.attMetricsObservationState = attMetricsObservationState;
    global.attMetricsBuildFinalMarksForDay = attMetricsBuildFinalMarksForDay;
    global.attMetricsStatsFromFinalMarks = attMetricsStatsFromFinalMarks;
    global.attMetricsAttachCoverage = attMetricsAttachCoverage;
    global.attMetricsMarkCandidateBetter = attMetricsMarkCandidateBetter;
    global.attMetricsMonthlySummary = attMetricsMonthlySummary;
    global.attMetricsTeacherPeriodDaySummary = attMetricsTeacherPeriodDaySummary;
    global.attMetricsTeacherMonthlySummary = attMetricsTeacherMonthlySummary;
    global.attMetricsTeacherRosterDayAggregate = attMetricsTeacherRosterDayAggregate;
    global.attMetricsLowAttendanceAlerts = attMetricsLowAttendanceAlerts;
    global.attMetricsReportCollectMarks = attMetricsReportCollectMarks;
    global.attMetricsResolveTargetRoster = attMetricsResolveTargetRoster;
    global.attMetricsWeekdayOf = attMetricsWeekdayOf;
    global.attMetricsDaysInMonth = attMetricsDaysInMonth;
})(typeof window !== 'undefined' ? window : globalThis);
