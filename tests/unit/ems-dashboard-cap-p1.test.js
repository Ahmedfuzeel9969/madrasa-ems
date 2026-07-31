import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('P1 — dashboard 50-user cap removed', function () {
    it('emsDashboardListLimit returns 0 (no artificial cap)', function () {
        var src = fs.readFileSync(path.join(ROOT, 'dashboard.js'), 'utf8');
        expect(src).toMatch(/emsDashboardListLimit\s*=\s*function[\s\S]{0,120}return\s+0/);
        expect(src).not.toMatch(/emsDashboardListLimit[\s\S]{0,120}return\s+50/);
    });

    it('360 select uses emsEnsureDashboardReportData + emsGetUsersMerged', function () {
        var src = fs.readFileSync(path.join(ROOT, 'dashboard.js'), 'utf8');
        expect(src).toContain('emsEnsureDashboardReportData');
        expect(src).toMatch(/emsLoad360UserSelect[\s\S]{0,600}emsGetUsersMerged/);
        expect(src).not.toMatch(/emsLoad360UserSelect[\s\S]{0,800}limit\s*>\s*0\s*\?\s*limit\s*:\s*500/);
    });

    it('filter drill-down uses local SSOT helper emsDashFilterUsersLocal', function () {
        var src = fs.readFileSync(path.join(ROOT, 'dashboard.js'), 'utf8');
        expect(src).toContain('function emsDashFilterUsersLocal');
        expect(src).toMatch(/emsLoadDashboardFilterDetails[\s\S]{0,400}emsDashFilterUsersLocal/);
    });

    it('360 options use createElement instead of innerHTML concat', function () {
        var src = fs.readFileSync(path.join(ROOT, 'dashboard.js'), 'utf8');
        var block = src.match(/window\.emsLoad360UserSelect\s*=\s*function[\s\S]*?\n};/);
        expect(block).toBeTruthy();
        expect(block[0]).toContain("createElement('option')");
        expect(block[0]).not.toContain('innerHTML +=');
    });
});
