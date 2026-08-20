/**
 * Phase 1 — TASK 1.2: dashboard target roster, legacy calc, monthly, trend, 360 locks (NO production changes).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function loadMetrics() {
    var src = fs.readFileSync(path.join(ROOT, 'att-metrics.js'), 'utf8');
    var sandbox = {
        localStorage: { getItem: function () { return null; } },
        ATT_ROLLUP_PARTIAL: 'جزوی حاضری',
        ATT_ROLLUP_INCOMPLETE: 'نامکمل',
        console: console
    };
    sandbox.window = sandbox;
    vm.runInNewContext(src, sandbox);
    return sandbox;
}

function loadDashNormalizeApi() {
    var metricsSrc = fs.readFileSync(path.join(ROOT, 'att-metrics.js'), 'utf8');
    var src = fs.readFileSync(path.join(ROOT, 'att-dashboard.js'), 'utf8');
    var start = src.indexOf('function attDashReadDayObservation');
    var end = src.indexOf('function attDashApplyStatsKpis');
    var body = src.slice(start, end);
    var prelude = [
        'var localStorage = { getItem: function () { return null; } };',
        'function dayNumOf(dateStr) { return parseInt(String(dateStr || "").substring(8, 10), 10); }',
        'global.attGetUserId = function(u) { return u && u.id ? String(u.id) : ""; };',
        'function attDashGetUserId(u) { return global.attGetUserId(u); }',
        'function attDashNormType(u) { return String(u && u.type || "student").toLowerCase(); }',
        'function attDashGetSymbols() { return { P: "P", A: "A", L: "L" }; }',
        'function attDashStatusPresent(st) { return st === "P" || st === "حاضر"; }',
        'function attDashStatusAbsent(st) { return st === "A" || st === "غائب"; }',
        'function attDashStatusLeave(st) { return st === "L" || st === "رخصت"; }',
        'function attDashSheetTimestamp(data) { return (data && data.timestamp) || 0; }',
        'function attDashComputeRate(present, absent, leave) {',
        '  var markedTotal = (present || 0) + (absent || 0) + (leave || 0);',
        '  if (markedTotal <= 0) return { rate: null, markedTotal: 0, notTaken: true };',
        '  return { rate: Math.min(100, Math.round(((present || 0) / markedTotal) * 100)), markedTotal: markedTotal, notTaken: false };',
        '}',
        'var console = globalThis.console;'
    ].join('\n');
    var sandbox = { console: console };
    sandbox.global = sandbox;
    sandbox.window = sandbox;
    vm.runInNewContext(metricsSrc, sandbox);
    vm.runInNewContext(
        prelude + '\n' + body + '\n'
        + 'this.attDashBuildFinalMarksForDay = attDashBuildFinalMarksForDay;'
        + 'this.attDashStatsFromFinalMarks = attDashStatsFromFinalMarks;',
        sandbox
    );
    return sandbox;
}

function loadHelperCountApi() {
    var src = fs.readFileSync(path.join(ROOT, 'attendance-helper.js'), 'utf8');
    var start = src.indexOf('function attHelperStatusPresent');
    var end = src.indexOf('function fetchAttendanceDocsForMonth');
    var body = src.slice(start, end);
    var sandbox = { console: console, localStorage: { getItem: function () { return null; } } };
    sandbox.global = sandbox;
    sandbox.window = sandbox;
    vm.runInNewContext(
        'function attHelperGetSymbols() { return { P: "P", A: "A", L: "L" }; }\n'
        + body
        + '\nthis.countDayMarksFromDoc = countDayMarksFromDoc;\nthis.attHelperStatsFromSets = attHelperStatsFromSets;',
        sandbox
    );
    return sandbox;
}

function loadDash360Scan() {
    var src = fs.readFileSync(path.join(ROOT, 'dashboard.js'), 'utf8');
    var start = src.indexOf('function emsDash360CollectAttendanceAsync');
    var end = src.indexOf('/** IDB-aware cache read for 360 adapters');
    var fnSrc = src.slice(start, end);
    var sandbox = {
        console: console,
        emsCollectUserIdAliases: function (u) { return [u.id]; },
        emsOfflineLoadAttendanceSheetsForMonth: null
    };
    sandbox.window = sandbox;
    vm.runInNewContext(fnSrc, sandbox);
    return sandbox;
}

function makeStudents(n, className, idPrefix) {
    idPrefix = idPrefix || 'S';
    var out = [];
    for (var i = 1; i <= n; i++) {
        out.push({ id: idPrefix + i, type: 'student', class: className });
    }
    return out;
}

function makeTeachers(n) {
    var out = [];
    for (var i = 1; i <= n; i++) {
        out.push({ id: 'T' + i, type: 'teacher', name: 'Teacher ' + i });
    }
    return out;
}

function studentSheet(opts) {
    return {
        key: opts.key || 'att_rec_students',
        type: 'students',
        classId: opts.classId || '',
        period: 'all',
        data: {
            timestamp: opts.ts || 5000,
            records: opts.records || {},
            periodRecords: opts.periodRecords || {}
        }
    };
}

function karachiYmd(date) {
    var fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Karachi',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    var y = '';
    var m = '';
    var d = '';
    fmt.formatToParts(date).forEach(function (p) {
        if (p.type === 'year') y = p.value;
        if (p.type === 'month') m = p.value;
        if (p.type === 'day') d = p.value;
    });
    return y + '-' + m + '-' + d;
}

describe('Phase 1 — TASK 1.2: period targets and legacy dashboard calculations (Bug B–G)', function () {
    it('Class A period target is Class A roster (30), not full filtered roster (55)', function () {
        var api = loadDashNormalizeApi();
        var classA = makeStudents(30, 'A');
        var classB = makeStudents(25, 'B');
        var allUsers = classA.concat(classB);
        var day = 6;
        var periodRecords = {};
        classA.forEach(function (u, idx) {
            periodRecords[u.id] = { 6: { 'PRD-A': idx < 20 ? 'P' : 'A' } };
        });
        var sheets = [studentSheet({
            classId: 'A',
            periodRecords: periodRecords,
            records: {}
        })];

        var stats = api.attDashStatsFromFinalMarks(
            api.attDashBuildFinalMarksForDay('2026-08-06', sheets, allUsers, 'PRD-A'),
            allUsers
        );

        expect(stats.total).toBe(30);
        expect(stats.present + stats.absent + stats.leave + stats.notMarked).toBe(30);
    });

    it('teacher period target is assigned teacher(s), not all teachers in madrasa', function () {
        var api = loadDashNormalizeApi();
        var teachers = makeTeachers(10);
        var day = 6;
        var sheets = [{
            key: 'att_rec_teachers',
            type: 'teachers',
            classId: '',
            period: 'all',
            data: {
                timestamp: 5000,
                records: {},
                periodRecords: {
                    T1: { 6: { 'PRD-1': 'P' } }
                }
            }
        }];

        var stats = api.attDashStatsFromFinalMarks(
            api.attDashBuildFinalMarksForDay('2026-08-06', sheets, teachers, 'PRD-1'),
            teachers
        );

        expect(stats.total).toBe(1);
        expect(stats.present).toBe(1);
        expect(stats.notMarked).toBe(0);
    });

    it('stale legacy P + newer canonical A resolves to A (main helper must use final-state, not P-set wins)', function () {
        var metrics = loadMetrics();
        var helper = loadHelperCountApi();
        var users = [{ id: 'U1', type: 'student', class: 'A' }];
        var day = 5;
        var legacy = {
            type: 'students',
            classId: 'A',
            period: 'all',
            data: { timestamp: 1, records: { U1: { 5: 'P' } } }
        };
        var canonical = {
            type: 'students',
            classId: '',
            period: 'all',
            data: { timestamp: 2, records: { U1: { 5: 'A' } } }
        };

        var finalDs = metrics.attMetricsBuildFinalMarksForDay('2026-08-05', [legacy, canonical], users, '');
        expect(finalDs.marks.U1.status).toBe('A');

        var sets = { present: new Set(), absent: new Set(), leave: new Set() };
        [legacy, canonical].forEach(function (sh) {
            helper.countDayMarksFromDoc(sh.data, day, sets);
        });
        var helperStats = helper.attHelperStatsFromSets(sets, 'test');
        expect(finalDs.marks.U1.status).toBe('A');
        expect(helperStats.absent).toBe(1);
        expect(helperStats.present).toBe(0);
    });

    it('partial-only teacher day counts as an active attendance day (monthly denominator)', function () {
        var m = loadMetrics();
        var users = [{ id: 'T1', type: 'teacher' }];
        var sheets = [{
            type: 'teachers',
            classId: '',
            period: 'all',
            data: {
                timestamp: 5,
                records: { T1: { 1: 'جزوی حاضری', 2: 'P' } },
                periodRecords: {}
            }
        }];
        var summary = m.attMetricsMonthlySummary('2026-08', sheets, users);

        expect(summary.activeDays).toBe(2);
        expect(summary.markedTotal).toBeGreaterThanOrEqual(2);
    });

    it('monthly teacher rate does not discard partial days (10 full P + 10 partial must not report 100%)', function () {
        var m = loadMetrics();
        var users = [{ id: 'T1', type: 'teacher' }];
        var records = {};
        for (var d = 1; d <= 10; d++) records[d] = 'P';
        for (var d2 = 11; d2 <= 20; d2++) records[d2] = 'جزوی حاضری';
        var sheets = [{
            type: 'teachers',
            classId: '',
            period: 'all',
            data: { timestamp: 5, records: { T1: records }, periodRecords: {} }
        }];

        var summary = m.attMetricsMonthlySummary('2026-08', sheets, users);
        expect(summary.activeDays).toBe(20);

        if (typeof m.attMetricsTeacherMonthlySummary === 'function') {
            var teacherSummary = m.attMetricsTeacherMonthlySummary('2026-08', sheets, users);
            expect(teacherSummary.periodWeightedRate).toBeLessThan(100);
            expect(teacherSummary.partialDays).toBe(10);
        } else {
            expect(summary.monthRate).toBeLessThan(100);
        }
    });

    it('Pakistan calendar date: trend must not use raw toISOString when Karachi day differs', function () {
        var helperSrc = fs.readFileSync(path.join(ROOT, 'attendance-helper.js'), 'utf8');
        expect(helperSrc).toContain('function emsAttTrendDateForDay');
        expect(helperSrc).toMatch(/emsFetchAttendanceTrend[\s\S]{0,2500}emsAttTrendDateForDay/);

        var boundary = new Date('2026-08-19T20:30:00.000Z');
        var isoDay = boundary.toISOString().split('T')[0];
        var karachiDay = karachiYmd(boundary);
        expect(isoDay).not.toBe(karachiDay);

        var start = helperSrc.indexOf('function attHelperKarachiDateParts');
        var end = helperSrc.indexOf('global.emsAttTrendDateForDay');
        expect(start).toBeGreaterThan(-1);
        var fnSrc = helperSrc.slice(start, end);
        var sandbox = { Intl: Intl, Date: Date };
        vm.runInNewContext(fnSrc + '\nthis.emsAttTrendDateForDay = emsAttTrendDateForDay;', sandbox);
        expect(sandbox.emsAttTrendDateForDay(boundary)).toBe(karachiDay);
    });

    it('360 person attendance does not double-count legacy + canonical duplicate sheets', function () {
        var scan360 = loadDash360Scan();
        var user = { id: 'U1', name: 'Student' };
        var month = '2026-08';
        var sheets = [
            {
                records: { U1: { 1: 'P', 2: 'P' } },
                timestamp: 1
            },
            {
                records: { U1: { 1: 'P', 2: 'P' } },
                timestamp: 2
            }
        ];
        var now = new Date();
        var currentMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().substring(0, 7);
        scan360.window.emsOfflineLoadAttendanceSheetsForMonth = function (month) {
            if (month !== currentMonth) return Promise.resolve([]);
            return Promise.resolve(sheets);
        };

        return scan360.emsDash360CollectAttendanceAsync(user).then(function (stats) {
            expect(stats.total).toBe(2);
            expect(stats.present).toBe(2);
        });
    });
});
