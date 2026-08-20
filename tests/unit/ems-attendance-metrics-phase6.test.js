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
    vm.runInNewContext(src, sandbox);
    return sandbox;
}

describe('Phase 6 — attendance metrics (TASK 6.1)', function () {
    it('defines daily vs period metric modes', function () {
        var m = loadMetrics();
        expect(m.ATT_METRIC_DAILY).toBe('daily');
        expect(m.ATT_METRIC_PERIOD).toBe('period');
        expect(fs.readFileSync(path.join(ROOT, 'att-metrics.js'), 'utf8')).toContain('DAILY observation');
        expect(fs.readFileSync(path.join(ROOT, 'att-metrics.js'), 'utf8')).toContain('PERIOD observation');
    });

    it('does not map partial/incomplete rollups into P/A/L buckets', function () {
        var m = loadMetrics();
        expect(m.attMetricsClassifyStatus('جزوی حاضری')).toBe('PARTIAL');
        expect(m.attMetricsClassifyStatus('نامکمل')).toBe('INCOMPLETE');
        expect(m.attMetricsStrictBucket('جزوی حاضری')).toBe('');
        expect(m.attMetricsStrictBucket('نامکمل')).toBe('');
        expect(m.attMetricsStrictBucket('P')).toBe('P');
    });
});

describe('Phase 6 — shared final-state dataset (TASK 6.2)', function () {
    it('dedupes legacy + canonical sheets for daily dashboard marks', function () {
        var m = loadMetrics();
        var users = [{ id: 'U1', type: 'student', class: 'A' }];
        var sheets = [
            {
                key: 'legacy',
                type: 'students',
                classId: 'A',
                period: 'all',
                data: { timestamp: 1, records: { U1: { 5: 'P' } } }
            },
            {
                key: 'canonical',
                type: 'students',
                classId: '',
                period: 'all',
                data: { timestamp: 2, records: { U1: { 5: 'A' } } }
            }
        ];
        var finalDs = m.attMetricsBuildFinalMarksForDay('2026-08-05', sheets, users, '');
        expect(finalDs.metric).toBe('daily');
        expect(finalDs.marks.U1.status).toBe('A');
    });

    it('uses periodRecords for period-filter analysis without daily double-count', function () {
        var m = loadMetrics();
        var users = [{ id: 'T1', type: 'teacher' }];
        var sheets = [{
            key: 't',
            type: 'teachers',
            classId: '',
            period: 'all',
            data: {
                timestamp: 3,
                records: { T1: { 5: 'P' } },
                periodRecords: { T1: { 5: { P1: 'A' } } }
            }
        }];
        var daily = m.attMetricsBuildFinalMarksForDay('2026-08-05', sheets, users, '');
        var period = m.attMetricsBuildFinalMarksForDay('2026-08-05', sheets, users, 'P1');
        expect(daily.marks.T1.status).toBe('P');
        expect(period.marks.T1.status).toBe('A');
        expect(period.metric).toBe('period');
    });

    it('monthly summary uses deduped daily final marks', function () {
        var m = loadMetrics();
        var users = [{ id: 'U1', type: 'student', class: 'A' }];
        var sheets = [
            {
                type: 'students',
                classId: 'A',
                period: 'all',
                data: { timestamp: 1, records: { U1: { 1: 'P' } } }
            },
            {
                type: 'students',
                classId: '',
                period: 'all',
                data: { timestamp: 2, records: { U1: { 1: 'P' } } }
            }
        ];
        var summary = m.attMetricsMonthlySummary('2026-08', sheets, users);
        expect(summary.markedTotal).toBe(1);
        expect(summary.totalMarks).toBe(1);
    });

    it('report collector does not stack period + daily for same date', function () {
        var m = loadMetrics();
        var symbols = { P: 'P', A: 'A', L: 'L' };
        var collected = m.attMetricsReportCollectMarks(
            { id: 'U1', name: 'Test' },
            [{
                month: '2026-08',
                timestamp: 5,
                records: { U1: { 1: 'P' } },
                periodRecords: { U1: { 1: { p1: 'P', p2: 'A' } } },
                remarks: {}
            }],
            '2026-08-01',
            '2026-08-31',
            symbols
        );
        expect(Object.keys(collected.finalMarks).length).toBe(2);
        expect(collected.finalMarks['2026-08-01|daily']).toBeUndefined();
    });

    it('lazy loader loads att-metrics before att-dashboard', function () {
        var lazy = fs.readFileSync(path.join(ROOT, 'ems-lazy-loader.js'), 'utf8');
        expect(lazy).toMatch(/attendance:\s*\[[^\]]*'att-metrics\.js'/);
        var idxMetrics = lazy.indexOf("'att-metrics.js'");
        var idxDash = lazy.indexOf("'att-dashboard.js'");
        expect(idxMetrics).toBeGreaterThan(-1);
        expect(idxMetrics).toBeLessThan(idxDash);
    });

    it('dashboard delegates final marks to att-metrics SSOT', function () {
        var dash = fs.readFileSync(path.join(ROOT, 'att-dashboard.js'), 'utf8');
        expect(dash).toContain('attMetricsBuildFinalMarksForDay');
        expect(dash).toContain('attMetricsMonthlySummary');
        expect(dash).toContain('attMetricsLowAttendanceAlerts');
    });
});
