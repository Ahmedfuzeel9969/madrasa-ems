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

    it('provides a dedicated registration-style page with mapping, profiles and explicit export actions', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams-import-export.js'), 'utf8');
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        var tpl = fs.readFileSync(path.join(ROOT, 'ems-import-templates.js'), 'utf8');
        expect(html).toContain('id="btn-exam-data-page"');
        expect(html).toContain('id="exam-win-data"');
        expect(html).toContain('id="exam-import-body"');
        expect(html).toContain('id="exam-export-summary"');
        expect(html).not.toContain('id="exam-import-modal"');
        expect(src).toContain('examOpenResultExport');
        expect(html).toContain("examRunResultExport('xlsx')");
        expect(html).toContain("examRunResultExport('csv')");
        expect(html).toContain("examRunResultExport('json')");
        expect(src).toContain('EmsImportExport.parseFile');
        expect(src).toContain('bookhdr');
        expect(src).toContain('bookcustom');
        expect(src).toContain('exam-import-profile');
        expect(src).toContain('btn-exam-import-automap');
        expect(src).toContain('exam-import-header-row');
        expect(src).toContain('examOpenResultExport');
        expect(src).toContain('examOpenDataPage');
        expect(src).toContain('examPrepareDataPage');
        expect(src).toContain('PROFILES_KEY');
        expect(src).toContain('buildPreview');
        expect(src).toContain('emsSaveModuleData');
        expect(src).toContain('exmIsExamLocked');
        expect(tpl).toContain('exam_result_urdu_standard');
    });

    it('keeps the import action disabled for a locked result', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8');
        var io = fs.readFileSync(path.join(ROOT, 'exams-import-export.js'), 'utf8');
        expect(src).toContain("getElementById('btn-exam-data-page')");
        expect(io).toContain("file.disabled = locked");
        expect(io).toContain("lockFn(chk.examName, chk.className, chk.resultDate)");
        expect(io).toContain('یہ نتیجہ لاک ہے');
    });
});
