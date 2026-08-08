import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Exams library books durable save', function () {
    it('reads and writes library via durable helpers, not localStorage-only', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8');
        expect(src).toContain('function exmReadRaw');
        expect(src).toContain('function exmReadJson');
        expect(src).toContain("exmReadJson('ems_library_books'");
        expect(src).toContain('emsDurableWriteRaw');
        expect(src).toContain('window.exmAddLibraryBook');
        expect(src).not.toMatch(/JSON\.parse\(localStorage\.getItem\('ems_library_books'\)\)/);
    });

    it('emsSaveModuleData persists large blob keys through durable storage', function () {
        var core = fs.readFileSync(path.join(ROOT, 'core.js'), 'utf8');
        expect(core).toMatch(/emsSaveModuleData[\s\S]*emsIsLargeBlobKey[\s\S]*emsDurableWriteRaw/);
    });
});
