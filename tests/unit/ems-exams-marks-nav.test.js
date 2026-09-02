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
