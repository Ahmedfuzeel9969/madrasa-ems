import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Exam analysis teacher chart labels', function () {
    it('merges teacher chart into filtered subject chart panel', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8');
        expect(src).toContain('exmBuildAnaSubjectChartCard');
        expect(src).toContain('window.exmRefreshAnaSubjectChart');
        expect(src).toContain("value=\"teachers\"");
        expect(src).toContain("value=\"class_books\"");
        expect(src).toContain("value=\"student_books\"");
        expect(src).toContain('horizontal: true, labelMaxChars: 24');
        expect(src).toContain('emsEnsureUsersReady');
        expect(src).toContain('exmRenderExamAnalysisInner');
        expect(src).not.toContain('<h4>استاد وار اوسط کارکردگی</h4>');
    });

    it('bar chart helper supports horizontal layout and rotated labels', function () {
        var src = fs.readFileSync(path.join(ROOT, 'dashboard-pro.js'), 'utf8');
        expect(src).toContain('function emsHorizontalBarChartSVG');
        expect(src).toContain('opts.horizontal');
        expect(src).toContain('rotate(-42');
    });
});
