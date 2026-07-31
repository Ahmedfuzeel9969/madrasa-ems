import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

var require = createRequire(import.meta.url);
var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
// Option A (fs-JSON) is now the durable FALLBACK engine (Option B/SQLite is the
// default). Target the fallback factory directly so this suite keeps validating
// the JSON-on-disk contract regardless of which engine the selector prefers.
var { createFsJsonDb } = require(path.join(ROOT, 'desktop', 'native-db.js'));
var Q = require(path.join(ROOT, 'ems-query-utils.js'));

function seed(db, n) {
    var rows = [];
    for (var i = 1; i <= n; i++) {
        rows.push({
            id: i,
            name: 'Student ' + i,
            type: (i % 2 === 0) ? 'student' : 'teacher',
            status: (i % 3 === 0) ? 'approved' : 'pending',
            createdAt: i
        });
    }
    return db.bulkPut('registrations', rows);
}

describe('Native DB (Option A fs-JSON) — Repository contract', function () {
    var baseDir;
    var db;

    beforeAll(function () {
        baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ems-nativedb-'));
        db = createFsJsonDb(baseDir);
    });

    afterAll(function () {
        try { fs.rmSync(baseDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    });

    it('reports native fs-json engine', function () {
        expect(db.isNative).toBe(true);
        expect(db.engine).toBe('fs-json');
    });

    it('bulkPut writes an actual JSON file on disk', async function () {
        var n = await seed(db, 5000);
        expect(n).toBe(5000);
        var file = path.join(baseDir, 'collections', 'registrations.json');
        expect(fs.existsSync(file)).toBe(true);
    });

    it('count reflects total and respects equality filter', async function () {
        expect(await db.count('registrations')).toBe(5000);
        // status 'approved' = multiples of 3 in 1..5000 => 1666
        expect(await db.count('registrations', { status: 'approved' })).toBe(1666);
        // type student = even numbers => 2500
        expect(await db.count('registrations', { type: 'student' })).toBe(2500);
    });

    it('page returns a bounded window with correct total (no full scan leak)', async function () {
        var res = await db.page('registrations', { offset: 0, limit: 50, sort: { field: 'createdAt', dir: 'asc' } });
        expect(res.rows.length).toBe(50);
        expect(res.total).toBe(5000);
        expect(res.rows[0].id).toBe(1);
        expect(res.rows[49].id).toBe(50);

        var res2 = await db.page('registrations', { offset: 100, limit: 50, sort: { field: 'createdAt', dir: 'asc' } });
        expect(res2.rows[0].id).toBe(101);
    });

    it('page supports filter + search + descending sort together', async function () {
        var res = await db.page('registrations', {
            offset: 0,
            limit: 10,
            filter: { type: 'student' },
            sort: { field: 'createdAt', dir: 'desc' }
        });
        expect(res.total).toBe(2500);
        expect(res.rows.every(function (r) { return r.type === 'student'; })).toBe(true);
        expect(res.rows[0].id).toBe(5000); // largest even id first

        var searchRes = await db.page('registrations', {
            offset: 0, limit: 20, search: { text: 'Student 12', fields: ['name'] }
        });
        // "Student 12", "Student 120".."Student 129", "Student 1200".. etc — just assert all match
        expect(searchRes.rows.every(function (r) { return r.name.indexOf('Student 12') >= 0; })).toBe(true);
    });

    it('get / remove operate by id', async function () {
        var row = await db.get('registrations', 42);
        expect(row).toBeTruthy();
        expect(row.name).toBe('Student 42');
        await db.remove('registrations', 42);
        expect(await db.get('registrations', 42)).toBe(null);
        expect(await db.count('registrations')).toBe(4999);
    });

    it('data survives a fresh engine instance (cold reopen = permanent)', async function () {
        var reopened = createFsJsonDb(baseDir);
        expect(await reopened.count('registrations')).toBe(4999);
        var row = await reopened.get('registrations', 100);
        expect(row.name).toBe('Student 100');
        // removed id stays removed after reopen
        expect(await reopened.get('registrations', 42)).toBe(null);
    });

    it('pagination semantics match shared EmsQueryUtils (drop-in parity)', async function () {
        var all = await db.all('registrations');
        var direct = Q.pageFromAll(all, { offset: 10, limit: 25, filter: { status: 'approved' }, sort: { field: 'id', dir: 'asc' } });
        var viaDb = await db.page('registrations', { offset: 10, limit: 25, filter: { status: 'approved' }, sort: { field: 'id', dir: 'asc' } });
        expect(viaDb.total).toBe(direct.total);
        expect(viaDb.rows.map(function (r) { return r.id; })).toEqual(direct.rows.map(function (r) { return r.id; }));
    });
});
