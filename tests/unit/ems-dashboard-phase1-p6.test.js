import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('P6 Phase 1 — dashboard accuracy & dead code cleanup', function () {
    it('uses dash-att-rate everywhere (no stale dash-attendance-percent)', function () {
        var dash = fs.readFileSync(path.join(ROOT, 'dashboard.js'), 'utf8');
        var att = fs.readFileSync(path.join(ROOT, 'attendance-helper.js'), 'utf8');
        var stats = fs.readFileSync(path.join(ROOT, 'cloud', 'ems-dashboard-stats.js'), 'utf8');
        expect(dash).toContain("getElementById('dash-att-rate')");
        expect(dash).not.toContain('dash-attendance-percent');
        expect(att).toContain("getElementById('dash-att-rate')");
        expect(att).not.toContain('dash-attendance-percent');
        expect(stats).toContain('dash-att-rate');
        expect(stats).not.toContain('dash-attendance-percent');
    });

    it('dashboard-pro complaints use dept filter like dashboard.js', function () {
        var src = fs.readFileSync(path.join(ROOT, 'dashboard-pro.js'), 'utf8');
        expect(src).toMatch(/function getComplaints[\s\S]{0,400}emsFilterByDepartment/);
    });

    it('360 curriculum rejects empty grade with missingGrade flag', function () {
        var src = fs.readFileSync(path.join(ROOT, 'dashboard.js'), 'utf8');
        expect(src).toContain('missingGrade: true');
        expect(src).toContain('درجہ نہیں');
    });

    it('360 fee setup missing shows ریکارڈ نہیں not 100% paid', function () {
        var src = fs.readFileSync(path.join(ROOT, 'dashboard.js'), 'utf8');
        expect(src).toContain('ریکارڈ نہیں — فیس سیٹ اپ درج نہیں');
        expect(src).not.toMatch(/percentPaid = netP > 0 \? Math\.round\(\(totalPaid \/ netP\) \* 100\) : 100/);
    });

    it('360 exams use cold-cache fallback helper', function () {
        var src = fs.readFileSync(path.join(ROOT, 'dashboard.js'), 'utf8');
        expect(src).toContain('emsDash360ReadExams');
        expect(src).toContain('emsDash360ReadExams()');
    });

    it('removes dead code: trend chart, quick view, legacy listener stub', function () {
        var src = fs.readFileSync(path.join(ROOT, 'dashboard.js'), 'utf8');
        expect(src).not.toContain('emsRenderTrendChart');
        expect(src).not.toContain('showCardQuickView');
        expect(src).not.toContain('emsShowMonthDetail');
        expect(src).not.toContain('emsStopDashboardLegacyListeners');
    });
});
