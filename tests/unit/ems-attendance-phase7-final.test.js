import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

/**
 * Phase 7 — maps manual acceptance rows to automated coverage (source/tests).
 * Browser-only flows remain MANUAL in the final report.
 */
var ACCEPTANCE_MATRIX = [
    { id: 1, item: 'Teacher daily mark reopen', auto: ['ems-attendance-teacher-reopen-phase0.test.js', 'attPersistSheetLocal'] },
    { id: 2, item: 'Teacher period mark reopen', auto: ['ems-attendance-meaningful-data-phase2.test.js', 'periodRecords'] },
    { id: 3, item: 'Hard refresh same data', manual: true },
    { id: 4, item: 'Stale class dropdown canonical teacher sheet', auto: ['ems-attendance-teacher-canonical-scope-phase1.test.js'] },
    { id: 5, item: 'Change stale class storage key unchanged', auto: ['attNormalizeStorageScope', 'ems-attendance-teacher-canonical-scope-phase1.test.js'] },
    { id: 6, item: 'periodRecords-only local visible', auto: ['ems-attendance-meaningful-data-phase2.test.js'] },
    { id: 7, item: 'periodRecords-only cloud visible', auto: ['ems-attendance-cloud-pull.test.js', 'attHelperHasMeaningfulSheet'] },
    { id: 8, item: 'Offline mark reconnect cloud', manual: true, auto: ['ems-att-save-status.test.js', 'ems-outbox-flush-lock.test.js'] },
    { id: 9, item: 'Clear mark stays clear on reopen', auto: ['ems-attendance-clear-cell.test.js'] },
    { id: 10, item: 'Clear beats stale cloud', manual: true, auto: ['ems-attendance-print-dedupe.test.js'] },
    { id: 11, item: 'Two devices different teachers', auto: ['ems-attendance-cloud-concurrency-phase5.test.js'] },
    { id: 12, item: 'Two devices different periods same teacher', auto: ['ems-attendance-cloud-concurrency-phase5.test.js'] },
    { id: 13, item: 'Duplicate teacher names no wrong bind', auto: ['ems-attendance-teacher-identity-phase4.test.js'] },
    { id: 14, item: 'Linked teacher Gmail tenant not auth uid', auto: ['ems-attendance-tenant-isolation-phase3.test.js'] },
    { id: 15, item: 'Account switch no leakage', manual: true, auto: ['ems-tenant-local-isolation.test.js'] },
    { id: 16, item: 'Class-scoped teacher sheet adoption', auto: ['ems-attendance-teacher-canonical-scope-phase1.test.js'] },
    { id: 17, item: 'Period-scoped teacher sheet adoption', auto: ['ems-attendance-teacher-sheet-unify.test.js'] },
    { id: 18, item: 'Migration twice no duplicates', auto: ['skips already-merged legacy keys'] },
    { id: 19, item: 'Delete/recreate period history preserved', auto: ['ems-attendance-teacher-identity-phase4.test.js'] },
    { id: 20, item: 'Daily dashboard vs Smart Register', auto: ['ems-attendance-print-dedupe.test.js', 'att-metrics.js'] },
    { id: 21, item: 'Period dashboard vs period boxes', auto: ['ems-attendance-print-dedupe.test.js', 'ems-attendance-metrics-phase6.test.js'] },
    { id: 22, item: 'Monthly/report/print normalized source', auto: ['ems-attendance-report-hours.test.js', 'ems-attendance-metrics-phase6.test.js'] },
    { id: 23, item: 'Student register unchanged', auto: ['ems-attendance-canonical-unified.test.js'] },
    { id: 24, item: 'Teacher legacy daily controls', auto: ['ems-attendance-teacher-periods.test.js'] },
    { id: 25, item: 'P+A+L+unmarked=target', auto: ['ems-attendance-dash-calc.test.js', 'attDashAssertStatsInvariant'] }
];

describe('Phase 7 — final regression gate (TASK 7.1)', function () {
    it('loads att-metrics before dashboard in lazy loader', function () {
        var lazy = fs.readFileSync(path.join(ROOT, 'ems-lazy-loader.js'), 'utf8');
        expect(lazy.indexOf("'att-metrics.js'")).toBeLessThan(lazy.indexOf("'att-dashboard.js'"));
    });

    it('has phase 0–6 focused test files present', function () {
        [
            'ems-attendance-teacher-reopen-phase0.test.js',
            'ems-attendance-teacher-canonical-scope-phase1.test.js',
            'ems-attendance-meaningful-data-phase2.test.js',
            'ems-attendance-tenant-isolation-phase3.test.js',
            'ems-attendance-teacher-identity-phase4.test.js',
            'ems-attendance-cloud-concurrency-phase5.test.js',
            'ems-attendance-metrics-phase6.test.js'
        ].forEach(function (f) {
            expect(fs.existsSync(path.join(ROOT, 'tests', 'unit', f))).toBe(true);
        });
    });

    it('migration adoption is non-destructive and idempotent (source)', function () {
        var js = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
        expect(js).toContain('function attMarkLegacyPeriodSheetsMerged');
        expect(js).toContain('function attLegacyTeacherStaffSheetKeys');
        expect(js).not.toMatch(/attAdoptLegacyPeriodSheets[\s\S]{0,2000}localStorage\.removeItem/);
    });
});

describe('Phase 7 — manual acceptance traceability (TASK 7.2)', function () {
    ACCEPTANCE_MATRIX.forEach(function (row) {
        it('row ' + row.id + ': ' + row.item + ' has automated or manual coverage documented', function () {
            if (row.manual && (!row.auto || !row.auto.length)) {
                expect(row.manual).toBe(true);
                return;
            }
            var covered = (row.auto || []).some(function (needle) {
                if (needle.endsWith('.test.js')) {
                    return fs.existsSync(path.join(ROOT, 'tests', 'unit', needle))
                        || fs.existsSync(path.join(ROOT, 'tests', 'unit', needle.replace('.test.js', '.js')));
                }
                if (needle.indexOf('.js') >= 0) {
                    return fs.existsSync(path.join(ROOT, needle)) || fs.existsSync(path.join(ROOT, needle.split('/').pop()));
                }
                var phase1 = fs.readFileSync(path.join(ROOT, 'tests', 'unit', 'ems-attendance-teacher-canonical-scope-phase1.test.js'), 'utf8');
                var att = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
                var metrics = fs.existsSync(path.join(ROOT, 'att-metrics.js'))
                    ? fs.readFileSync(path.join(ROOT, 'att-metrics.js'), 'utf8') : '';
                return phase1.indexOf(needle) >= 0 || att.indexOf(needle) >= 0 || metrics.indexOf(needle) >= 0;
            });
            expect(covered || row.manual).toBeTruthy();
        });
    });
});
