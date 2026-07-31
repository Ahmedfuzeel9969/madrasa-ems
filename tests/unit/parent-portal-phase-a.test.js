import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Parent Portal Phase A — bundle, report cards, receipts', function () {
    it('parent-shared.js exports P0 permission and messaging helpers', function () {
        var src = fs.readFileSync(path.join(ROOT, 'parent-shared.js'), 'utf8');
        expect(src).toContain('PARENT_VIEWS');
        expect(src).toContain('PARENT_MSG_CATEGORIES');
        expect(src).toContain('apGetParentPerm');
        expect(src).toContain('parentCanView');
        expect(src).toContain('parentSubmitMessage');
    });

    it('parent-shared loads at boot before parent portal lazy module', function () {
        var cloud = fs.readFileSync(path.join(ROOT, 'cloud', 'ems-cloud-manifest.js'), 'utf8');
        var post = fs.readFileSync(path.join(ROOT, 'ems-post-auth-loader.js'), 'utf8');
        var lazy = fs.readFileSync(path.join(ROOT, 'ems-lazy-loader.js'), 'utf8');
        expect(cloud).toMatch(/boot:[\s\S]*?parent-shared\.js/);
        expect(post).toContain("'parent-shared.js'");
        expect(lazy).toMatch(/'parent-portal':\s*\['parent-shared\.js',\s*'parent-portal\.js'\]/);
    });

    it('exams.js exposes shared student card builder for parent print', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8');
        expect(src).toContain('exmBuildStudentCardHtml');
        expect(src).toContain('exmPrintStudentCard');
        expect(src).toContain('کشف النتیجہ');
    });

    it('parent-portal.js implements print report card and fee receipt actions', function () {
        var src = fs.readFileSync(path.join(ROOT, 'parent-portal.js'), 'utf8');
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(src).toContain('ppPrintExamResult');
        expect(src).toContain('ppPrintFeeReceipt');
        expect(src).toContain('نتیجہ پرنٹ کریں');
        expect(src).toContain('رسید پرنٹ کریں');
        expect(src).toContain('exmPrintStudentCard');
        expect(src).toContain('finShowReceipt');
        expect(html).toContain('id="pp-result-print-area"');
    });

    it('admin-panel delegates parent core helpers to parent-shared', function () {
        var src = fs.readFileSync(path.join(ROOT, 'admin-panel.js'), 'utf8');
        expect(src).toContain('emsParentGetAllPerms');
        expect(src).toContain('see parent-shared.js');
        expect(src).not.toMatch(/window\.PARENT_VIEWS\s*=\s*\[/);
        expect(src).not.toMatch(/window\.parentSubmitMessage\s*=\s*function/);
    });
});
