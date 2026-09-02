import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Exam analysis teacher chart labels', function () {
    it('merges teacher chart into filtered subject chart panel with vertical clear labels', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8');
        expect(src).toContain('exmBuildAnaSubjectChartCard');
        expect(src).toContain('window.exmRefreshAnaSubjectChart');
        expect(src).toContain("value=\"teachers\"");
        expect(src).toContain("value=\"class_books\"");
        expect(src).toContain("value=\"student_books\"");
        expect(src).toContain('function exmAnaChartOpts');
        expect(src).toContain('clearLabels: true');
        expect(src).toContain('emsEnsureUsersReady');
        expect(src).toContain('exmRenderExamAnalysisInner');
        expect(src).not.toContain('<h4>استاد وار اوسط کارکردگی</h4>');
        expect(src).not.toContain('horizontal: true, labelMaxChars: 24');
    });

    it('vertical bar chart keeps values above bars and labels below axis', function () {
        var src = fs.readFileSync(path.join(ROOT, 'dashboard-pro.js'), 'utf8');
        expect(src).toContain('function emsHorizontalBarChartSVG');
        expect(src).toContain('opts.horizontal');
        expect(src).toContain('clearLabels');
        expect(src).toContain('rotate(-48');
        expect(src).toContain('axisY');
        expect(src).toContain('قدر ہمیشہ بار کے اوپر');
    });
});
