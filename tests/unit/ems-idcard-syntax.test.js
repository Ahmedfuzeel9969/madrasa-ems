import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('ems-idcard.js syntax (regent8)', function () {
    it('parses without syntax errors', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-idcard.js'), 'utf8');
        expect(function () { return new Function(src); }).not.toThrow();
    });

    it('uses photoSrc helper without broken ternary', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-idcard.js'), 'utf8');
        expect(src).toContain('var photoSrc');
        expect(src.indexOf('var photoSrc')).toBeLessThan(src.indexOf('var photo = cfg.showPhoto'));
    });
});
