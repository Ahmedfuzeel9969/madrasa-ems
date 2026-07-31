import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('P5 — 360 report module adapters', function () {
    it('defines async curriculum, training, ledger collectors', function () {
        var src = fs.readFileSync(path.join(ROOT, 'dashboard.js'), 'utf8');
        expect(src).toContain('emsDash360CollectCurriculumAsync');
        expect(src).toContain('emsDash360CollectTrainingAsync');
        expect(src).toContain('emsDash360CollectLedgerPayrollAsync');
    });

    it('360 build runs parallel async module fetches', function () {
        var src = fs.readFileSync(path.join(ROOT, 'dashboard.js'), 'utf8');
        expect(src).toMatch(/Promise\.all\([\s\S]{0,400}emsDash360CollectAttendanceAsync/);
        expect(src).toMatch(/Promise\.all[\s\S]{0,600}emsDash360CollectCurriculumAsync/);
        expect(src).toMatch(/Promise\.all[\s\S]{0,800}emsDash360CollectLedgerPayrollAsync/);
    });

    it('uses emsCacheGet / lazy load — not sync localStorage scan', function () {
        var src = fs.readFileSync(path.join(ROOT, 'dashboard.js'), 'utf8');
        expect(src).toContain('emsDash360CacheRead');
        expect(src).toContain('emsDash360EnsureModule');
        expect(src).toContain('emsLazyLoadModule');
        expect(src).not.toContain('یہ سیکشن صرف طلباء کے لیے ہے۔ اساتذہ کی مالی تفصیل لیجر میں دیکھیں');
    });

    it('generateMaster360Report hydrates SSOT before build', function () {
        var src = fs.readFileSync(path.join(ROOT, 'dashboard.js'), 'utf8');
        var idx = src.indexOf('window.generateMaster360Report = function');
        expect(idx).toBeGreaterThan(-1);
        expect(src.substring(idx, idx + 2500)).toContain('emsEnsureDashboardReportData');
        expect(src.substring(idx, idx + 2500)).toContain('emsBuild360Report');
    });

    it('student sections include curriculum and training headings', function () {
        var src = fs.readFileSync(path.join(ROOT, 'dashboard.js'), 'utf8');
        expect(src).toContain('نصاب نگرانی (Curriculum)');
        expect(src).toContain('تربیت و نظم (Training)');
    });

    it('teacher/staff finance shows ledger payroll summary', function () {
        var src = fs.readFileSync(path.join(ROOT, 'dashboard.js'), 'utf8');
        expect(src).toMatch(/ldgStats[\s\S]{0,200}statusLabel/);
        expect(src).toContain('بنیادی تنخواہ');
    });
});
