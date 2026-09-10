import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');

describe('Desktop and laptop full-width application shell', function () {
    it('does not cap or centre the main content on wide screens', function () {
        expect(css).toMatch(/\.main-content\s*\{[^}]*width:\s*100%[^}]*max-width:\s*none[^}]*margin:\s*0[^}]*padding:\s*20px 0[^}]*box-sizing:\s*border-box/s);
        expect(css).not.toMatch(/\.main-content\s*\{[^}]*max-width:\s*1600px/s);
    });

    it('removes the old 1840px caps from wide departmental modules', function () {
        expect(css).not.toContain('max-width: 1840px');
        expect(css).toMatch(/#module-attendance\.active\s*\{[^}]*width:\s*100%[^}]*max-width:\s*none[^}]*margin-left:\s*0[^}]*margin-right:\s*0/s);
        expect(css).toMatch(/#module-complaints\.active[^{]*\{[^}]*width:\s*100%[^}]*max-width:\s*none/s);
    });

    it('keeps the compact phone gutter in the existing mobile rule', function () {
        expect(css).toMatch(/@media[^\{]*max-width:\s*768px[\s\S]*?\.main-content\s*\{\s*padding:\s*10px;/);
    });
});
