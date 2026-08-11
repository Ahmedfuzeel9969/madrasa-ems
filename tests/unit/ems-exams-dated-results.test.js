import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Unlimited dated exam results', function () {
    it('stores and matches results by resultDate without overwriting other dates', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8');
        expect(src).toContain('function exmResultDateOf');
        expect(src).toContain('function exmFindStudentResult');
        expect(src).toContain('function exmListResultDates');
        expect(src).toContain('window.exmRefreshResultDateOptions');
        expect(src).toContain('resultDate: resultDate');
        expect(src).toContain("exmResultDateOf(m) === resultDate");
        expect(src).toContain('mrk-result-date');
    });

    it('HTML exposes date + session pickers on marks/results/analysis', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('id="mrk-result-date"');
        expect(html).toContain('id="mrk-result-session"');
        expect(html).toContain('id="res-result-date"');
        expect(html).toContain('id="res-result-session"');
        expect(html).toContain('id="ana-result-date"');
        expect(html).toContain('id="ana-all-dates"');
        expect(html).toContain('محفوظ شدہ نتائج');
    });
});
