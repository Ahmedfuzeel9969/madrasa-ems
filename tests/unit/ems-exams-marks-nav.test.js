import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Exams marks grid directional navigation', function () {
    it('exposes move focus helper and binds arrow keys', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8');
        expect(src).toContain('window.exmMoveMarkFocus');
        expect(src).toContain('function exmBindMarkNavKeys');
        expect(src).toContain("key === 'ArrowUp'");
        expect(src).toContain("key === 'ArrowDown'");
        expect(src).toContain("data-mrk-nav");
        expect(src).toContain('_exmLastMarkFocus');
        expect(src).toContain('exmWaitForMarkInput');
        expect(src).toContain('exmBindMarkNavPad');
        expect(src).toContain("pointerType === 'mouse'");
        expect(src).toContain("addEventListener('pointerup'");
        expect(src).toContain('exmScrollMarkRowIntoViewSync');
    });

    it('virtual table can paint sync for mobile focus', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-virtual-table.js'), 'utf8');
        expect(src).toContain('paintNow');
        expect(src).toContain('opts.sync');
    });

    it('HTML has four navigation buttons for marks entry', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('id="mrk-nav-pad"');
        expect(html).toContain('data-mrk-nav="up"');
        expect(html).toContain('data-mrk-nav="down"');
        expect(html).toContain('data-mrk-nav="left"');
        expect(html).toContain('data-mrk-nav="right"');
    });
});
