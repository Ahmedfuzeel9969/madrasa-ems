/**
 * Phase 1 — TASK 1.1: PARTIAL / INCOMPLETE daily-state regression locks (NO production changes).
 * These tests document Bug A semantics: PARTIAL and INCOMPLETE are observed states, not UNMARKED.
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
    sandbox.globalThis = sandbox;
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
        'var ATT_ROLLUP_PARTIAL = "جزوی حاضری";',
        'var ATT_ROLLUP_INCOMPLETE = "نامکمل";',
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
    sandbox.globalThis = sandbox;
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

function teacherUsers() {
    return [{ id: 'T1', type: 'teacher', name: 'Teacher One' }];
}

function teacherSheet(opts) {
    return {
        key: opts.key || 'att_rec_teachers',
        type: 'teachers',
        classId: '',
        period: 'all',
        data: {
            timestamp: opts.ts || 5000,
            records: opts.records || {},
            periodRecords: opts.periodRecords || {}
        }
    };
}

/** Expected six-bucket invariant once Phase 2 lands. */
function expectDailyInvariant(stats, target) {
    var sum = (stats.present || 0) + (stats.absent || 0) + (stats.leave || 0)
        + (stats.partial || 0) + (stats.incomplete || 0) + (stats.notMarked || 0)
        + (stats.other || 0);
    expect(sum).toBe(target);
}

describe('Phase 1 — TASK 1.1: PARTIAL / INCOMPLETE daily semantics (Bug A)', function () {
    it('A: teacher P,P,A,A => daily PARTIAL, partial=1, unmarked=0, completion 100%, period rate 50%', function () {
        var m = loadMetrics();
        var dash = loadDashNormalizeApi();
        var users = teacherUsers();
        var day = 5;
        var periodRecords = {
            T1: {
                5: { p1: 'P', p2: 'P', p3: 'A', p4: 'A' }
            }
        };
        var sheets = [teacherSheet({
            records: { T1: { 5: 'جزوی حاضری' } },
            periodRecords: periodRecords
        })];
        var dateStr = '2026-08-05';

        var finalDs = m.attMetricsBuildFinalMarksForDay(dateStr, sheets, users, '');
        var stats = m.attMetricsStatsFromFinalMarks(finalDs, users);
        var dashStats = dash.attDashStatsFromFinalMarks(
            dash.attDashBuildFinalMarksForDay(dateStr, sheets, users, ''),
            users
        );

        expect(m.attMetricsClassifyStatus('جزوی حاضری')).toBe('PARTIAL');
        expect(finalDs.marks.T1.status).toBe('PARTIAL');
        expect(stats.partial).toBe(1);
        expect(stats.notMarked).toBe(0);
        expectDailyInvariant(stats, 1);

        expect(dashStats.partial).toBe(1);
        expect(dashStats.notMarked).toBe(0);

        if (typeof m.attMetricsTeacherPeriodDaySummary === 'function') {
            var summary = m.attMetricsTeacherPeriodDaySummary(dateStr, sheets, users[0], ['p1', 'p2', 'p3', 'p4']);
            expect(summary.dailyState).toBe('PARTIAL');
            expect(summary.completionRate).toBe(100);
            expect(summary.periodCompletionRate).toBe(100);
            expect(summary.periodAttendanceRate).toBe(50);
            expect(summary.expectedPeriods).toBe(4);
            expect(summary.markedPeriods).toBe(4);
            expect(summary.presentPeriods).toBe(2);
            expect(summary.absentPeriods).toBe(2);
        } else {
            expect(typeof m.attMetricsTeacherPeriodDaySummary).toBe('function');
        }
    });

    it('B: teacher P,P,blank,blank => daily INCOMPLETE, incomplete=1, unmarked=0, completion 50%', function () {
        var m = loadMetrics();
        var users = teacherUsers();
        var sheets = [teacherSheet({
            records: { T1: { 5: 'نامکمل' } },
            periodRecords: { T1: { 5: { p1: 'P', p2: 'P' } } }
        })];
        var dateStr = '2026-08-05';

        var finalDs = m.attMetricsBuildFinalMarksForDay(dateStr, sheets, users, '');
        var stats = m.attMetricsStatsFromFinalMarks(finalDs, users);

        expect(m.attMetricsClassifyStatus('نامکمل')).toBe('INCOMPLETE');
        expect(finalDs.marks.T1.status).toBe('INCOMPLETE');
        expect(stats.incomplete).toBe(1);
        expect(stats.notMarked).toBe(0);
        expectDailyInvariant(stats, 1);

        if (typeof m.attMetricsTeacherPeriodDaySummary === 'function') {
            var summary = m.attMetricsTeacherPeriodDaySummary(dateStr, sheets, users[0], ['p1', 'p2', 'p3', 'p4']);
            expect(summary.dailyState).toBe('INCOMPLETE');
            expect(summary.completionRate).toBe(50);
            expect(summary.markedPeriods).toBe(2);
            expect(summary.expectedPeriods).toBe(4);
        } else {
            expect(typeof m.attMetricsTeacherPeriodDaySummary).toBe('function');
        }
    });

    it('C: teacher four P periods => daily P=1', function () {
        var m = loadMetrics();
        var users = teacherUsers();
        var sheets = [teacherSheet({
            records: { T1: { 5: 'P' } },
            periodRecords: { T1: { 5: { p1: 'P', p2: 'P', p3: 'P', p4: 'P' } } }
        })];
        var finalDs = m.attMetricsBuildFinalMarksForDay('2026-08-05', sheets, users, '');
        var stats = m.attMetricsStatsFromFinalMarks(finalDs, users);

        expect(finalDs.marks.T1.status).toBe('P');
        expect(stats.present).toBe(1);
        expect(stats.notMarked).toBe(0);
        expectDailyInvariant(stats, 1);
    });

    it('D: teacher with zero marks => UNMARKED=1', function () {
        var m = loadMetrics();
        var users = teacherUsers();
        var sheets = [teacherSheet({ records: {}, periodRecords: {} })];
        var finalDs = m.attMetricsBuildFinalMarksForDay('2026-08-05', sheets, users, '');
        var stats = m.attMetricsStatsFromFinalMarks(finalDs, users);

        expect(finalDs.marks.T1.status).toBe('');
        expect(stats.notMarked).toBe(1);
        expect(stats.partial || 0).toBe(0);
        expect(stats.incomplete || 0).toBe(0);
        expectDailyInvariant(stats, 1);
    });

    it('E: PARTIAL/INCOMPLETE must not be treated as cleared tombstone because strictBucket is empty', function () {
        var m = loadMetrics();
        var users = teacherUsers();
        var partialSheet = teacherSheet({ records: { T1: { 5: 'جزوی حاضری' } } });
        var incompleteSheet = teacherSheet({ records: { T1: { 5: 'نامکمل' } } });

        expect(m.attMetricsStrictBucket('جزوی حاضری')).toBe('');
        expect(m.attMetricsStrictBucket('نامکمل')).toBe('');

        var partialFinal = m.attMetricsBuildFinalMarksForDay('2026-08-05', [partialSheet], users, '');
        var incompleteFinal = m.attMetricsBuildFinalMarksForDay('2026-08-05', [incompleteSheet], users, '');

        expect(partialFinal.marks.T1.status).toBe('PARTIAL');
        expect(incompleteFinal.marks.T1.status).toBe('INCOMPLETE');
        expect(partialFinal.marks.T1.cleared).toBe(false);
        expect(incompleteFinal.marks.T1.cleared).toBe(false);
        expect(partialFinal.marks.T1.hasObservation).toBe(true);
        expect(incompleteFinal.marks.T1.hasObservation).toBe(true);

        var partialStats = m.attMetricsStatsFromFinalMarks(partialFinal, users);
        var incompleteStats = m.attMetricsStatsFromFinalMarks(incompleteFinal, users);
        expect(partialStats.notMarked).toBe(0);
        expect(incompleteStats.notMarked).toBe(0);
    });
});
