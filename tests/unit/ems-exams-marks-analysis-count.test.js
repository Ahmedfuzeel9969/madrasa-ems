import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Exams marks sheet + analysis student count fixes', function () {
    it('auto-fills result date for new mark sheet and finds class templates robustly', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8');
        expect(src).toContain('function exmEnsureResultDateFilled');
        expect(src).toContain("exmEnsureResultDateFilled('mrk')");
        expect(src).toContain('function exmStudentsInClass');
        expect(src).toContain('function exmFindClassTpl');
        expect(src).toContain('exmFindClassTpl(templates, cls)');
        expect(src).toContain('exmStudentsInClass(cls)');
    });

    it('analysis dedupes results and excludes orphaned transferred students', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8');
        expect(src).toContain('function exmDedupeAnalysisRows');
        expect(src).toContain('activeOnly: true');
        expect(src).toContain('uniqueStudent: !!useAllDates');
        expect(src).toContain('پرانا نتیجہ رجسٹرڈ فہرست سے باہر');
    });
});
