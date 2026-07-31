import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function loadSearchIndex(ctx) {
    var src = fs.readFileSync(path.join(ROOT, 'ems-search-index.js'), 'utf8');
    vm.runInNewContext(src, ctx, { filename: 'ems-search-index.js' });
}

function benchRow(i) {
    return {
        id: 'STU-' + String(i).padStart(6, '0'),
        type: (i % 7 === 0) ? 'teacher' : 'student',
        status: (i % 5 === 0) ? 'pending' : 'approved',
        name: 'طالب ' + i,
        fname: 'ولی ' + i,
        class: 'جماعت ' + (i % 12 + 1),
        phone: '0300' + String(1000000 + i),
        cnic: String(3520000000000 + i),
        timestamp: Date.now() - i * 60000
    };
}

function rowDocHasAllTokens(docTokens, queryTokens) {
    for (var i = 0; i < queryTokens.length; i++) {
        if (docTokens.indexOf(queryTokens[i]) < 0) return false;
    }
    return true;
}

describe('P5B — search index token volume (v3 row-doc optimization)', function () {
    it('bench row uses compact tokens (~10x fewer IDB puts than v2 per-token index)', function () {
        var ctx = { global: {}, window: {} };
        ctx.global = ctx.window;
        loadSearchIndex(ctx);
        var row = benchRow(1);
        var tokens = ctx.global.emsSearchIndexTokensForRow(row);
        expect(tokens.length).toBeGreaterThan(4);
        expect(tokens.length).toBeLessThan(35);
        expect(tokens.length * 10000).toBeLessThan(350000);
    });

    it('query tokens intersect row tokens for id, phone, and Arabic name', function () {
        var ctx = { global: {}, window: {} };
        ctx.global = ctx.window;
        loadSearchIndex(ctx);
        var row = benchRow(42);
        var rowTokens = ctx.global.emsSearchIndexTokensForRow(row);

        var idQuery = ctx.global.emsSearchIndexTokensForQuery('stu-000042');
        expect(rowDocHasAllTokens(rowTokens, idQuery)).toBe(true);

        var phoneQuery = ctx.global.emsSearchIndexTokensForQuery('03001000042');
        expect(rowDocHasAllTokens(rowTokens, phoneQuery)).toBe(true);

        var nameQuery = ctx.global.emsSearchIndexTokensForQuery('طالب');
        expect(rowDocHasAllTokens(rowTokens, nameQuery)).toBe(true);
    });
});
