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
        expect(js).toContain('function attDashBuildFinalMarksForDay');
        expect(js).toMatch(/attDashStatsForDay[\s\S]{0,1200}attDashBuildFinalMarksForDay/);
        expect(js).not.toMatch(/attDashStatsForDay[\s\S]{0,1800}total - present - leave/);
        expect(js).toMatch(/attDashComputeRate[\s\S]{0,400}markedTotal <= 0[\s\S]{0,120}rate: null/);
    });

    it('class breakdown respects roster membership and classFilter', function () {
        var js = fs.readFileSync(path.join(ROOT, 'att-dashboard.js'), 'utf8');
        expect(js).toMatch(/attDashClassBreakdown[\s\S]{0,800}attDashClassBreakdownFromFinal/);
        expect(js).toMatch(/attDashClassBreakdown[\s\S]{0,1200}classFilter/);
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
        expect(helper).toMatch(/todayParts[\s\S]{0,400}Asia\/Karachi/);
    });

    it('supports hourly period filter on dashboard analysis', function () {
        var js = fs.readFileSync(path.join(ROOT, 'att-dashboard.js'), 'utf8');
        var metrics = fs.readFileSync(path.join(ROOT, 'att-metrics.js'), 'utf8');
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('id="att-dash-period-filter"');
        expect(html).toContain('تجزیہ کی بنیاد');
        expect(js).toContain('function attDashPopulatePeriodFilter');
        expect(metrics).toContain('periodRecords');
        expect(js).toContain('attMetricsBuildFinalMarksForDay');
        expect(js).toMatch(/!f\.periodFilter/);
        expect(js).toContain('att-dash-period-filter');
    });

    it('adds daily view mode filter for period-order calculation', function () {
        var js = fs.readFileSync(path.join(ROOT, 'att-dashboard.js'), 'utf8');
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('id="att-dash-calc-mode"');
        expect(html).toContain('گھنٹوں کی ترتیب سے');
        expect(html).toContain('id="att-dash-period-sequence-panel"');
        expect(html).toContain('id="att-dash-period-seq-tbody"');
        expect(js).toContain('function attDashOrderedPeriodsForDay');
        expect(js).toContain('function attDashBuildPeriodSequenceStats');
        expect(js).toContain('function attDashRenderPeriodSequence');
        expect(js).toContain("calcMode === 'period_order'");
        expect(js).toContain('att-dash-calc-mode');
    });

    it('filters inactive registrations out of dashboard roster', function () {
        var js = fs.readFileSync(path.join(ROOT, 'att-dashboard.js'), 'utf8');
        expect(js).toContain('function attDashIsEligibleRegistration');
        expect(js).toMatch(/attDashGetUsers[\s\S]{0,500}filter\(attDashIsEligibleRegistration\)/);
        expect(js).toContain("s === 'inactive'");
    });

    it('main dashboard snapshot uses marked denominator not residual absent', function () {
        var js = fs.readFileSync(path.join(ROOT, 'dashboard.js'), 'utf8');
        expect(js).not.toMatch(/emsRenderAttendanceSnapshot[\s\S]{0,800}totalStudents - present/);
        expect(js).toMatch(/emsRenderAttendanceSnapshot[\s\S]{0,1200}markedTotal/);
    });
});
