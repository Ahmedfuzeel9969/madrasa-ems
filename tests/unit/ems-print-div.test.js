import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Print system (printDiv + CSS)', function () {
    it('does not globally hide body on print (breaks printDiv iframes)', function () {
        var css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
        expect(css).not.toMatch(/@media\s+print\s*\{[^}]*body\s+\*\s*\{\s*visibility:\s*hidden/s);
        expect(css).toContain('body.ems-printing-att-register *');
        expect(css).toContain('visibility: hidden');
    });

    it('printDiv forces visibility visible in print media', function () {
        var src = fs.readFileSync(path.join(ROOT, 'src/shared/utils/ems-utils.js'), 'utf8');
        expect(src).toContain('global.printDiv = function');
        expect(src).toContain('body,body *{visibility:visible!important;}');
        expect(src).toContain('iframe.contentWindow.print()');
    });

    it('exams fallback printDiv actually prints when element exists', function () {
        var src = fs.readFileSync(path.join(ROOT, 'exams.js'), 'utf8');
        var idx = src.indexOf('if (typeof window.printDiv !== \'function\')');
        expect(idx).toBeGreaterThan(-1);
        var slice = src.slice(idx, idx + 1600);
        expect(slice).toContain('w.print()');
        expect(slice).not.toMatch(/if \(!el\) return;\s*if \(typeof window\.showToast[\s\S]*پرنٹ ایریا نہیں ملا/);
    });
});
