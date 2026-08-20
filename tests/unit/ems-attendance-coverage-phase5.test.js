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
        ATT_ROLLUP_INCOMPLETE: 'نامکمل'
    };
    sandbox.window = sandbox;
    sandbox.global = sandbox;
    vm.runInNewContext(src, sandbox);
    return sandbox;
}

function loadMergeApi() {
    var metricsSrc = fs.readFileSync(path.join(ROOT, 'att-metrics.js'), 'utf8');
    var src = fs.readFileSync(path.join(ROOT, 'att-dashboard.js'), 'utf8');
    var start = src.indexOf('function attDashAssertStatsInvariant');
    var end = src.indexOf('function attDashSheetTimestamp');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    var body = src.slice(start, end);
    var prelude = [
        'function attDashGetUserId(u) { return u && u.id ? String(u.id) : ""; }',
        'function attDashComputeRate(present, absent, leave) {',
        '  var markedTotal = (present || 0) + (absent || 0) + (leave || 0);',
        '  if (markedTotal <= 0) return { rate: null, markedTotal: 0, notTaken: true };',
        '  return { rate: Math.min(100, Math.round(((present || 0) / markedTotal) * 100)), markedTotal: markedTotal, notTaken: false };',
        '}',
        'function setTxt() {}',
        'var document = { getElementById: function () { return null; } };'
    ].join('\n');
    var sandbox = { console: console, document: { getElementById: function () { return null; } } };
    sandbox.globalThis = sandbox;
    sandbox.global = sandbox;
    sandbox.window = sandbox;
    vm.runInNewContext(metricsSrc, sandbox);
    vm.runInNewContext(
        prelude + '\n' + body + '\n'
        + 'this.attDashMergeRemoteStats = attDashMergeRemoteStats;'
        + 'this.attDashRemoteAggregateIsImpossible = attDashRemoteAggregateIsImpossible;'
        + 'this.attDashAttachCoverage = attDashAttachCoverage;',
        sandbox
    );
    return sandbox;
}

describe('Phase 5 — coverage statistics (TASK 5.1)', function () {
    it('exposes target, observed, unmarked, partial, incomplete, coverageRate', function () {
        var m = loadMetrics();
        var users = [];
        for (var i = 1; i <= 10; i++) users.push({ id: 'S' + i, type: 'student', class: 'A' });
        var records = {
            S1: { 6: 'P' }, S2: { 6: 'P' }, S3: { 6: 'A' }, S4: { 6: 'L' }, S5: { 6: 'جزوی حاضری' }
        };
        var sheets = [{
            key: 'all', type: 'students', classId: 'A', period: 'all',
            data: { timestamp: 1, records: records }
        }];
        var stats = m.attMetricsStatsFromFinalMarks(
            m.attMetricsBuildFinalMarksForDay('2026-08-06', sheets, users, ''),
            users
        );
        expect(stats.target).toBe(10);
        expect(stats.observed).toBe(5);
        expect(stats.unmarked).toBe(5);
        expect(stats.partial).toBe(1);
        expect(stats.incomplete).toBe(0);
        expect(stats.coverageRate).toBe(50);
        expect(stats.present + stats.absent + stats.leave + stats.partial + stats.incomplete + stats.unmarked + stats.other)
            .toBe(stats.target);
    });

    it('teacher period summary aliases periodCompletionRate', function () {
        var m = loadMetrics();
        var user = { id: 'T1', type: 'teacher' };
        var sheets = [{
            key: 't', type: 'teachers', classId: '', period: 'all',
            data: {
                timestamp: 1,
                records: { T1: { 5: 'نامکمل' } },
                periodRecords: { T1: { 5: { p1: 'P', p2: 'P' } } }
            }
        }];
        var summary = m.attMetricsTeacherPeriodDaySummary('2026-08-05', sheets, user, ['p1', 'p2', 'p3', 'p4']);
        expect(summary.expectedPeriods).toBe(4);
        expect(summary.markedPeriods).toBe(2);
        expect(summary.completionRate).toBe(50);
        expect(summary.periodCompletionRate).toBe(50);
    });

    it('does not rank classes below ATT_DASH_MIN_RANKING_COVERAGE_PCT', function () {
        var dash = fs.readFileSync(path.join(ROOT, 'att-dashboard.js'), 'utf8');
        expect(dash).toContain('ATT_DASH_MIN_RANKING_COVERAGE_PCT');
        expect(dash).toMatch(/var ATT_DASH_MIN_RANKING_COVERAGE_PCT = 50/);
        var start = dash.indexOf('function attDashClassEligibleForRanking');
        var end = dash.indexOf('function attDashRenderClassHighlights');
        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);
        var sandbox = {
            ATT_DASH_MIN_RANKING_COVERAGE_PCT: 50
        };
        sandbox.global = sandbox;
        sandbox.globalThis = sandbox;
        sandbox.window = sandbox;
        vm.runInNewContext(
            dash.slice(start, end) + '\nthis.attDashClassEligibleForRanking = attDashClassEligibleForRanking;',
            sandbox
        );
        expect(sandbox.attDashClassEligibleForRanking({
            total: 10, rate: 100, coverageRate: 40
        })).toBe(false);
        expect(sandbox.attDashClassEligibleForRanking({
            total: 10, rate: 80, coverageRate: 50
        })).toBe(true);
    });
});

describe('Phase 5 — remote reconciliation (TASK 5.2)', function () {
    it('rejects remote aggregates when P+A+L exceeds target and keeps local', function () {
        var api = loadMergeApi();
        var users = [];
        for (var i = 1; i <= 10; i++) users.push({ id: 'S' + i, type: 'student' });
        var local = {
            present: 0, absent: 0, leave: 0, markedTotal: 0, observedTotal: 0,
            total: 10, source: 'local', notTaken: true
        };
        var merged = api.attDashMergeRemoteStats(local, {
            present: 8, absent: 3, leave: 2, source: 'cloud'
        }, users);
        expect(api.attDashRemoteAggregateIsImpossible(8, 3, 2, 10)).toBe(true);
        expect(merged.remoteRejected).toBe(true);
        expect(merged.source).toBe('local');
        expect(merged.present).toBe(0);
        expect(merged.absent).toBe(0);
        expect(merged.leave).toBe(0);
    });

    it('publishes roster-scoped remote when local has no observations and PAL fits target', function () {
        var api = loadMergeApi();
        var users = [];
        for (var i = 1; i <= 10; i++) users.push({ id: 'S' + i, type: 'student' });
        var local = {
            present: 0, absent: 0, leave: 0, markedTotal: 0, observedTotal: 0,
            total: 10, source: 'local', notTaken: true
        };
        var merged = api.attDashMergeRemoteStats(local, {
            presentIds: ['S1', 'S2', 'S3'],
            absentIds: ['S4'],
            leaveIds: ['S5'],
            source: 'cloud'
        }, users);
        expect(merged.remoteRejected).toBeFalsy();
        expect(merged.source).toBe('cloud');
        expect(merged.present).toBe(3);
        expect(merged.absent).toBe(1);
        expect(merged.leave).toBe(1);
        expect(merged.coverageRate).toBe(50);
    });
});
