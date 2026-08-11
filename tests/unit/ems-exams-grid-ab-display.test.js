import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Exams marks grid hides AB and empty obtained', function () {
    it('grid render does not show English AB placeholder or value', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8');
        expect(src).toContain('function exmGridMarkDisplay');
        expect(src).toContain('function exmGridObtainedDisplay');
        expect(src).toContain('exmGridMarkDisplay(val)');
        expect(src).toContain('exmGridObtainedDisplay(row.marks, row.totalObtained)');
        expect(src).not.toMatch(/placeholder="AB"/);
        expect(src).not.toMatch(/exmIsAbsentMark\(val\) \? 'AB'/);
    });

    it('display helpers hide AB and zero obtained without numeric marks', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8');
        var start = src.indexOf('function exmIsAbsentMark');
        var end = src.indexOf('\n  function exmGetBookMax', start);
        var sandbox = {
            exmSumMarks: function (marks) {
                var sum = 0;
                Object.keys(marks || {}).forEach(function (k) {
                    var v = marks[k];
                    if (v === 'AB' || v === 'غ') return;
                    var n = Number(v);
                    if (!isNaN(n)) sum += n;
                });
                return sum;
            }
        };
        vm.runInNewContext(
            src.slice(start, end) +
            '\nthis.exmIsAbsentMark=exmIsAbsentMark;' +
            '\nthis.exmGridMarkDisplay=exmGridMarkDisplay;' +
            '\nthis.exmHasNumericMarks=exmHasNumericMarks;' +
            '\nthis.exmGridObtainedDisplay=exmGridObtainedDisplay;',
            sandbox
        );
        expect(sandbox.exmGridMarkDisplay('AB')).toBe('');
        expect(sandbox.exmGridMarkDisplay('غ')).toBe('');
        expect(sandbox.exmGridMarkDisplay(45)).toBe(45);
        expect(sandbox.exmGridObtainedDisplay({ Math: 'AB', Fiqh: 'AB' }, 0)).toBe('');
        expect(sandbox.exmGridObtainedDisplay({ Math: 20, Fiqh: 'AB' }, 20)).toBe('20');
    });
});
