import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Exams Excel/CSV result import', function () {
    it('loads shared import engine with exams module', function () {
        var loader = fs.readFileSync(path.join(ROOT, 'ems-lazy-loader.js'), 'utf8');
        expect(loader).toMatch(/exams:\s*\[[^\]]*'ems-import-export\.js'/);
        expect(loader).toMatch(/exams:\s*\[[^\]]*'ems-import-templates\.js'/);
        expect(loader).toMatch(/exams:\s*\[[^\]]*'exams-import-export\.js'/);
        expect(fs.existsSync(path.join(ROOT, 'exams-import-export.js'))).toBe(true);
    });

    it('provides registration-grade mapping, profiles, sheet/header pickers and export', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams-import-export.js'), 'utf8');
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        var tpl = fs.readFileSync(path.join(ROOT, 'ems-import-templates.js'), 'utf8');
        expect(html).toContain('id="btn-import-exam-results"');
        expect(html).toContain('id="btn-export-exam-results"');
        expect(html).toContain('id="exam-import-modal"');
        expect(html).toContain('examOpenResultExport');
        expect(src).toContain('EmsImportExport.parseFile');
        expect(src).toContain('bookhdr');
        expect(src).toContain('bookcustom');
        expect(src).toContain('exam-import-profile');
        expect(src).toContain('btn-exam-import-automap');
        expect(src).toContain('exam-import-header-row');
        expect(src).toContain('examOpenResultExport');
        expect(src).toContain('PROFILES_KEY');
        expect(src).toContain('buildPreview');
        expect(src).toContain('emsSaveModuleData');
        expect(src).toContain('exmIsExamLocked');
        expect(tpl).toContain('exam_result_urdu_standard');
    });

    it('keeps the import action disabled for a locked result', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8');
        expect(src).toContain("getElementById('btn-import-exam-results')");
        expect(src).toMatch(/resultImportBtn\)\s+resultImportBtn\.disabled\s*=\s*locked/);
        expect(src).toContain("getElementById('btn-import-marks-quick')");
    });
});
