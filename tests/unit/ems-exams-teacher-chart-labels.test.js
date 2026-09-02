import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Exam analysis teacher chart labels', function () {
    it('uses horizontal bars for teacher chart to avoid overlapping names', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8');
        expect(src).toContain("emsBarChartSVG(teacherItems, { horizontal: true");
    });

    it('bar chart helper supports horizontal layout and rotated labels', function () {
        var src = fs.readFileSync(path.join(ROOT, 'dashboard-pro.js'), 'utf8');
        expect(src).toContain('function emsHorizontalBarChartSVG');
        expect(src).toContain('opts.horizontal');
        expect(src).toContain('rotate(-42');
    });
});
