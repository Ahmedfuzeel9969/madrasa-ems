import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

var require = createRequire(import.meta.url);
var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
var Q = require(path.join(ROOT, 'ems-query-utils.js'));

function makeRows(n) {
    var rows = [];
    for (var i = 0; i < n; i++) {
        rows.push({
            id: 'STU-' + i,
            type: i % 5 === 0 ? 'teacher' : 'student',
            name: 'Name ' + i,
            phone: '0300' + String(1000000 + (i % 10000)),
            timestamp: 1000000 - i
        });
    }
    return rows;
}

function naivePage(allRows, opts) {
    opts = opts || {};
    var offset = opts.offset || 0;
    var limit = opts.limit == null ? 100 : opts.limit;
    var filtered = allRows.filter(function (r) {
        if (opts.filter && opts.filter.type && r.type !== opts.filter.type) return false;
        if (opts.search && opts.search.text) {
            var t = String(opts.search.text).toLowerCase();
            var hay = [r.name, r.id, r.phone].join(' ').toLowerCase();
            if (hay.indexOf(t) < 0) return false;
        }
        return true;
    });
    filtered.sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
    return {
        rows: filtered.slice(offset, offset + limit),
        total: filtered.length
    };
}

describe('Priority 4 — EmsQueryUtils large-tenant paths', function () {
    it('streaming top-K matches naive first page for 5k rows without search', function () {
        var rows = makeRows(5000);
        var opts = {
            offset: 0,
            limit: 40,
            filter: { type: 'student' },
            sort: { field: 'timestamp', dir: 'desc' }
        };
        expect(Q.canStreamTopK(opts, rows)).toBe(false);
        var fast = Q.pageFromAll(rows, opts);
        var ref = naivePage(rows, opts);
        expect(fast.total).toBe(ref.total);
        expect(fast.rows.map(function (r) { return r.id; })).toEqual(ref.rows.map(function (r) { return r.id; }));
    });

    it('search path uses full filter (not streaming top-K)', function () {
        var opts = {
            offset: 0,
            limit: 40,
            filter: { type: 'student' },
            search: { text: '0300', fields: ['phone'] },
            sort: { field: 'timestamp', dir: 'desc' }
        };
        expect(Q.canStreamTopK(opts, [])).toBe(false);
    });

    it('streaming top-K activates only for large unfiltered first pages', function () {
        var big = makeRows(25000);
        var opts = {
            offset: 0,
            limit: 40,
            filter: { type: 'student' },
            sort: { field: 'timestamp', dir: 'desc' }
        };
        expect(Q.canStreamTopK(opts, big)).toBe(true);
    });

    it('countFromAll avoids building match arrays', function () {
        var rows = makeRows(2000);
        var n = Q.countFromAll(rows, { type: 'student' }, { text: '0300', fields: ['phone'] });
        expect(n).toBeGreaterThan(0);
        expect(n).toBeLessThan(rows.length);
    });

    it('registration repository delegates list page to EmsQueryUtils', function () {
        var src = require('fs').readFileSync(path.join(ROOT, 'ems-registration-repository.js'), 'utf8');
        expect(src).toContain('Q.pageFromAll(repoListFromState()');
        expect(src).toContain('searchLocalFromState');
    });
});
