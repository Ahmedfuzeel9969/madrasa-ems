import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Exams Excel/CSV result import', function () {
    it('loads the exams import module with the exams module', function () {
        var loader = fs.readFileSync(path.join(ROOT, 'ems-lazy-loader.js'), 'utf8');
        expect(loader).toMatch(/exams:\s*\[[^\]]*'exams-import-export\.js'/);
        expect(fs.existsSync(path.join(ROOT, 'exams-import-export.js'))).toBe(true);
    });

    it('provides Excel/CSV import, manual mapping, validation and local-first persistence', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams-import-export.js'), 'utf8');
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('id="btn-import-exam-results"');
        expect(html).toContain('id="exam-import-modal"');
        expect(src).toContain('function parseFile');
        expect(src).toContain("ext === 'xlsx'");
        expect(src).toContain('emsLoadXlsxLib');
        expect(src).toContain('function autoMap');
        expect(src).toContain('function buildPreview');
        expect(src).toContain('function persist');
        expect(src).toContain('studentId');
        expect(src).toContain('resultDate');
        expect(src).toContain("book:' + b.name");
        expect(src).toContain('emsSaveModuleData');
        expect(src).toContain('exmIsExamLocked');
    });

    it('keeps the import action disabled for a locked result', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8');
        expect(src).toContain("getElementById('btn-import-exam-results')");
        expect(src).toMatch(/resultImportBtn\)\s+resultImportBtn\.disabled\s*=\s*locked/);
    });
});
