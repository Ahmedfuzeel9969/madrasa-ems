import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('P0 — emsEnsureDashboardReportData', function () {
    it('dashboard.js defines emsEnsureDashboardReportData', function () {
        var src = fs.readFileSync(path.join(ROOT, 'dashboard.js'), 'utf8');
        expect(src).toContain('window.emsEnsureDashboardReportData = function');
        expect(src).toContain("typeof window.emsEnsureDashboardReportData === 'function'");
    });

    it('hydrates via emsEnsureRepositoryReady then cloud boot fallback', function () {
        var src = fs.readFileSync(path.join(ROOT, 'dashboard.js'), 'utf8');
        expect(src).toContain('emsDashReportUserCount');
        expect(src).toContain('emsEnsureRepositoryReady');
        expect(src).toContain('emsFirebaseEnsureModuleData');
    });

    it('insights path still renders on ensure failure', function () {
        var src = fs.readFileSync(path.join(ROOT, 'dashboard.js'), 'utf8');
        expect(src).toMatch(/emsEnsureDashboardReportData\(\)\.then[\s\S]{0,200}emsRenderDashboardInsights[\s\S]{0,200}\.catch/);
    });
});
