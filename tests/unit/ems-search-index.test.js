import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

describe('Phase 4 P5 — search index', function () {
    it('ems-search-index.js exposes token helpers', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-search-index.js'), 'utf8');
        expect(src).toContain('emsSearchIndexTokensForRow');
        expect(src).toContain('emsSearchIndexTokensForQuery');
    });

    it('ems-idb-engine.js uses DB version 4 and search_tokens store', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-idb-engine.js'), 'utf8');
        expect(src).toMatch(/DB_VERSION\s*=\s*4/);
        expect(src).toContain("SEARCH_STORE = 'search_tokens'");
        expect(src).toContain('searchIndex:rowDocs');
        expect(src).toContain('searchIndex:partial');
        expect(src).toContain('emsIdbSearchIndexProcessChunk');
        expect(src).toContain('lastPk');
        expect(src).toContain('countTypeFilterOnly');
    });

    it('background search index scheduler is wired in index.html', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        expect(html).toContain('ems-search-index-bg.js');
        var bg = fs.readFileSync(path.join(ROOT, 'ems-search-index-bg.js'), 'utf8');
        expect(bg).toContain('emsIdbSearchIndexSchedule');
        expect(bg).toContain('ems:search-index-progress');
    });

    it('ems-repository.js routes search through emsIdbColPage (no loadAll)', function () {
        var src = fs.readFileSync(path.join(ROOT, 'ems-repository.js'), 'utf8');
        expect(src).not.toMatch(/if\s*\(\s*opts\.search\s*\)[\s\S]*loadAll/);
        expect(src).toContain('emsIdbColPage');
    });

    it('index.html loads ems-search-index.js before ems-idb-engine.js', function () {
        var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        var searchIdx = html.indexOf('ems-search-index.js');
        var idbIdx = html.indexOf('ems-idb-engine.js');
        expect(searchIdx).toBeGreaterThan(-1);
        expect(idbIdx).toBeGreaterThan(searchIdx);
    });
});
