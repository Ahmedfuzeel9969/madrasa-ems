import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function loadReportBuilder() {
    var metricsSrc = fs.readFileSync(path.join(ROOT, 'att-metrics.js'), 'utf8');
    var src = fs.readFileSync(path.join(ROOT, 'attendance.js'), 'utf8');
    var start = src.indexOf('function attReportStatusKind');
    var end = src.indexOf('\nvar _repSearchUsersCache', start);
    var sandbox = {
        window: {},
        localStorage: { getItem: function () { return null; } },
        ATT_ROLLUP_PARTIAL: 'جزوی حاضری',
        ATT_ROLLUP_INCOMPLETE: 'نامکمل',
        attGetUserId: function (u) { return u.id; },
        attGetUserClass: function (u) { return u.class || ''; }
    };
    sandbox.window = sandbox;
    vm.runInNewContext(metricsSrc, sandbox);
    vm.runInNewContext(
        src.slice(start, end) + '\nthis.build = attBuildReportRowHtml;',
        sandbox
    );
    return sandbox.build;
}

describe('Attendance report hour calculations', function () {
    var symbols = { P: 'P', A: 'A', L: 'L' };

    it('counts canonical period marks as hours and does not stack daily rollups', function () {
        var build = loadReportBuilder();
        var html = build(
            { id: 'U1', name: 'طالب علم', class: 'اولیٰ' },
            [
                {
                    month: '2026-08',
                    timestamp: 5,
                    records: { U1: { 1: 'P' } },
                    periodRecords: { U1: { 1: { p1: 'P', p2: 'A' } } },
                    remarks: {}
                },
                { month: '2026-08', timestamp: 10, records: { U1: { 1: 'A', 2: 'نامکمل' } }, remarks: {} }
            ],
            '2026-08-01',
            '2026-08-31',
            symbols
        );
        expect(html).toContain('>2</td>');
        expect(html).toContain('>50%</td>');
        expect(html).not.toContain('>3</td>');
    });

    it('deduplicates daily-only legacy sheets by the newest mark', function () {
        var build = loadReportBuilder();
        var html = build(
            { id: 'U1', name: 'طالب علم', class: 'اولیٰ' },
            [
                { month: '2026-08', timestamp: 1, records: { U1: { 1: 'P' } }, remarks: {} },
                { month: '2026-08', timestamp: 2, records: { U1: { 1: 'A' } }, remarks: {} }
            ],
            '2026-08-01',
            '2026-08-31',
            symbols
        );
        expect(html).toContain('>1</td>');
        expect(html).toContain('>0%</td>');
    });

    it('does not count partial/incomplete rollup labels as absent or present hours', function () {
        var build = loadReportBuilder();
        var html = build(
            { id: 'U1', name: 'طالب علم', class: 'اولیٰ' },
            [{ month: '2026-08', timestamp: 1, records: { U1: { 2: 'نامکمل' } }, remarks: {} }],
            '2026-08-01',
            '2026-08-31',
            symbols
        );
        expect(html).toBe(null);
    });
});
