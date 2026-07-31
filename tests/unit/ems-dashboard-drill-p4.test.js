import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('P4 — dashboard drill hydration + chunked lists', function () {
    it('emsCardDrill opens via emsDrillOpen after builder resolves', function () {
        var src = fs.readFileSync(path.join(ROOT, 'dashboard-pro.js'), 'utf8');
        expect(src).toMatch(/global\.emsCardDrill[\s\S]{0,300}emsDrillOpen\(node\)/);
    });

    it('emsDrillOpen awaits emsEnsureDashboardReportData before render', function () {
        var src = fs.readFileSync(path.join(ROOT, 'dashboard-pro.js'), 'utf8');
        expect(src).toContain('ensureDrillHydrated');
        expect(src).toMatch(/emsDrillOpen[\s\S]{0,400}ensureDrillHydrated/);
        expect(src).toMatch(/ensureDrillHydrated[\s\S]{0,200}emsEnsureDashboardReportData/);
    });

    it('people drill uses DB count helpers not sync readUsers only', function () {
        var src = fs.readFileSync(path.join(ROOT, 'dashboard-pro.js'), 'utf8');
        expect(src).toContain('drillCountByType');
        expect(src).toContain('drillAggregateGroups');
        expect(src).toContain('drillCountInGroup');
        expect(src).toMatch(/nodePeople[\s\S]{0,400}drillCountByType/);
    });

    it('large drill lists use chunked table (50/page scroll) with DOM cap', function () {
        var src = fs.readFileSync(path.join(ROOT, 'dashboard-pro.js'), 'utf8');
        expect(src).toContain('buildChunkedTable');
        expect(src).toContain('DRILL_PAGE_SIZE = 50');
        expect(src).toContain('DRILL_DOM_MAX_ROWS = 200');
        expect(src).toContain('buildChunkedTableFromRows');
        expect(src).toContain('evictOverflowRows');
    });

    it('people pagination uses emsRepo.page when available', function () {
        var src = fs.readFileSync(path.join(ROOT, 'dashboard-pro.js'), 'utf8');
        expect(src).toContain('drillPagePeople');
        expect(src).toContain("global.emsRepo.page('registrations'");
    });
});
