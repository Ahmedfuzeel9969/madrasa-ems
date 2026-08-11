import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Exams analysis multi-class + all-classes', function () {
    it('exposes one / multi / all scope helpers', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8');
        expect(src).toContain('window.exmUpdateAnaScopeUi');
        expect(src).toContain('window.exmPopulateAnaMultiClasses');
        expect(src).toContain('window.exmAnaMultiSelectAll');
        expect(src).toContain('exmResolveAnaScope');
        expect(src).toContain("mode === 'multi'");
        expect(src).toContain("mode === 'all'");
        expect(src).toContain('window.renderExamAnalysis');
    });

    it('HTML has analysis scope mode and multi-class picker', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('id="ana-scope-mode"');
        expect(html).toContain('value="one"');
        expect(html).toContain('value="multi"');
        expect(html).toContain('value="all"');
        expect(html).toContain('id="ana-class-multi-wrap"');
        expect(html).toContain('id="ana-class-multi-list"');
        expect(html).toContain('ایک سے زیادہ درجات');
        expect(html).toContain('تمام درجات (ایک ساتھ)');
    });
});
