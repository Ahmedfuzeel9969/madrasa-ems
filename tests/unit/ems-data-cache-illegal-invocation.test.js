import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('ems-data-cache illegal invocation fix (regent5)', function () {
    it('core.js binds localStorage getItem', function () {
        var src = fs.readFileSync(path.join(ROOT, 'core.js'), 'utf8');
        expect(src).toContain('emsSafeLocalGet');
        expect(src).toContain('originalGetItem = localStorage.getItem.bind(localStorage)');
    });

    it('ems-data-cache uses emsSafeLocalGet', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-data-cache.js'), 'utf8');
        expect(src).toContain('emsSafeLocalGet');
        expect(src).not.toContain('getter(key)');
    });
});
