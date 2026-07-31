import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Attendance dashboard calculation fixes', function () {
    it('uses explicit absent and marked denominator (not residual roster absent)', function () {
        var js = fs.readFileSync(path.join(ROOT, 'att-dashboard.js'), 'utf8');
        expect(js).toContain('function attDashStatusAbsent');
        expect(js).toContain('function attDashComputeRate');
        expect(js).toMatch(/attDashStatsForDay[\s\S]{0,2500}attDashStatusAbsent/);
        expect(js).not.toMatch(/attDashStatsForDay[\s\S]{0,1800}total - present - leave/);
        expect(js).toMatch(/attDashComputeRate[\s\S]{0,400}markedTotal <= 0[\s\S]{0,120}rate: null/);
    });

    it('class breakdown respects roster membership and classFilter', function () {
        var js = fs.readFileSync(path.join(ROOT, 'att-dashboard.js'), 'utf8');
        expect(js).toMatch(/attDashClassBreakdown[\s\S]{0,1200}rosterIds/);
        expect(js).toMatch(/attDashClassBreakdown[\s\S]{0,1800}classFilter/);
        expect(js).not.toMatch(/attDashClassBreakdown[\s\S]{0,2000}row\.total - row\.present - row\.leave/);
    });

    it('UI shows not-taken state instead of false 0% absent', function () {
        var js = fs.readFileSync(path.join(ROOT, 'att-dashboard.js'), 'utf8');
        expect(js).toContain('function attDashApplyStatsKpis');
        expect(js.indexOf('\u062D\u0627\u0636\u0631\u06CC \u0646\u06C1\u06CC\u06BA \u0644\u06CC \u06AF\u0626\u06CC') >= 0).toBe(true);
        expect(js).toMatch(/attDashRenderCharts[\s\S]{0,1500}\u062D\u0627\u0636\u0631\u06CC \u0646\u06C1\u06CC\u06BA \u0644\u06CC \u06AF\u0626\u06CC/);
    });

    it('cloud merge uses roster-scoped merge helper', function () {
        var js = fs.readFileSync(path.join(ROOT, 'att-dashboard.js'), 'utf8');
        expect(js).toContain('function attDashMergeRemoteStats');
        expect(js).toMatch(/attDashMergeRemoteStats[\s\S]{0,1200}rosterIds/);
        expect(js).toMatch(/attDashComputeRate[\s\S]{0,300}Math\.min\(100/);
    });

    it('central dashboard helper uses markedTotal denominator', function () {
        var helper = fs.readFileSync(path.join(ROOT, 'attendance-helper.js'), 'utf8');
        expect(helper).toContain('function attHelperStatusAbsent');
        expect(helper).toContain('function countDayMarksFromDoc');
        expect(helper).toMatch(/emsApplyDashboardAttendance[\s\S]{0,600}markedTotal <= 0/);
        expect(helper).toMatch(/emsApplyDashboardAttendance[\s\S]{0,800}Math\.min\(100/);
    });
});
