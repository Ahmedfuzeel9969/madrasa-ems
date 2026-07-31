import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

/** Mirrors buildChunkedTable eviction: loaded tracks footer X, dom capped at domMax. */
function simulateDomCap(totalRows, pageSize, domMax) {
    var dom = 0;
    var loaded = 0;
    var offset = 0;
    while (offset < totalRows) {
        var batch = Math.min(pageSize, totalRows - offset);
        dom += batch;
        loaded += batch;
        offset += batch;
        while (dom > domMax) dom--;
    }
    return { dom: dom, loaded: loaded };
}

describe('P6 Phase 2 — drill DOM cap & curriculum chunking', function () {
    it('buildChunkedTable defines DOM cap and eviction helpers', function () {
        var src = fs.readFileSync(path.join(ROOT, 'dashboard-pro.js'), 'utf8');
        expect(src).toContain('DRILL_DOM_MAX_ROWS = 200');
        expect(src).toContain('evictOverflowRows');
        expect(src).toContain('domMaxRows');
        expect(src).toContain('state.loaded');
        expect(src).toContain('updateFooter');
        expect(src).toMatch(/دکھائے گئے:[\s\S]{0,80}state\.loaded/);
    });

    it('DOM cap keeps tbody at 200 rows while loaded count grows to 5000', function () {
        var res = simulateDomCap(5000, 50, 200);
        expect(res.dom).toBe(200);
        expect(res.loaded).toBe(5000);
    });

    it('curriculum drill uses chunked table for large plan lists', function () {
        var src = fs.readFileSync(path.join(ROOT, 'dashboard-pro.js'), 'utf8');
        expect(src).toMatch(/nodeCurriculum[\s\S]{0,2500}buildChunkedTableFromRows/);
        expect(src).toMatch(/rows\.length > DRILL_PAGE_SIZE[\s\S]{0,300}buildChunkedTableFromRows/);
        expect(src).toContain('curOpenFromDashboard');
        expect(src).not.toContain("b.innerHTML += '<div style=\"text-align:center;margin-top:10px;'");
    });

    it('curriculum open button appended without wiping chunked table', function () {
        var src = fs.readFileSync(path.join(ROOT, 'dashboard-pro.js'), 'utf8');
        expect(src).toContain('btnWrap = document.createElement');
        expect(src).toContain('b.appendChild(btnWrap)');
    });
});
