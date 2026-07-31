import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { readAppScriptManifest } from '../helpers/boot-manifest.js';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Enterprise E8-S1 — Module Summary Collections', function () {
    it('cloud function writes FinanceSummary and AttendanceSummary', function () {
        var src = fs.readFileSync(path.join(ROOT, 'functions/lib/tenant-dashboard-stats.js'), 'utf8');
        expect(src).toContain('FinanceSummary');
        expect(src).toContain('AttendanceSummary');
        expect(src).toContain('applyFinanceSummaryDelta');
        expect(src).toContain('recomputeAttendanceSummaryForMonth');
        expect(src).toContain('monthly_');
    });

    it('ems-module-summaries.js exposes listener APIs', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-module-summaries.js'), 'utf8');
        expect(src).toContain('emsStartModuleSummariesListener');
        expect(src).toContain('emsGetFinanceSummary');
        expect(src).toContain('emsGetAttendanceSummary');
    });

    it('finance.js uses FinanceSummary for dashboard KPIs', function () {
        var src = fs.readFileSync(path.join(ROOT, 'finance.js'), 'utf8');
        expect(src).toContain('emsGetFinanceSummary');
        expect(src).toContain('emsOnFinanceSummaryUpdate');
    });

    it('attendance-helper prefers AttendanceSummary', function () {
        var src = fs.readFileSync(path.join(ROOT, 'attendance-helper.js'), 'utf8');
        expect(src).toContain('emsGetAttendanceSummary');
        expect(src).toContain("source: 'summary'");
    });

    it('post-auth bundle loads module summaries script', function () {
        var m = readAppScriptManifest(ROOT);
        expect(m.combined).toContain('ems-module-summaries.js');
    });
});
