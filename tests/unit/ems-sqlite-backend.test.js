import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

var require = createRequire(import.meta.url);
var ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
var Q = require(path.join(ROOT, 'ems-query-utils.js'));

// Try to load the native engine; if better-sqlite3 isn't built for this ABI we
// still run the (static) wiring assertions and skip only the runtime block.
var createSqliteDb = null;
var sqliteRuntime = false;
var sqliteSkipReason = '';
try {
    createSqliteDb = require(path.join(ROOT, 'desktop', 'native-db-sqlite.js')).createSqliteDb;
    if (createSqliteDb) {
        var probeDir = path.join(os.tmpdir(), 'ems-sqlite-probe-' + Date.now());
        fs.mkdirSync(probeDir, { recursive: true });
        createSqliteDb(probeDir);
        sqliteRuntime = true;
    }
} catch (e) {
    sqliteSkipReason = e && e.message ? e.message : String(e);
}

function sqliteIt(name, fn) {
    (sqliteRuntime ? it : it.skip)(name, fn);
}

function tmpDir() {
    var d = path.join(os.tmpdir(), 'ems-sqlite-vitest-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    fs.mkdirSync(d, { recursive: true });
    return d;
}

function makeRows(n) {
    var rows = [];
    for (var i = 0; i < n; i++) {
        rows.push({
            id: 'R-' + String(i).padStart(4, '0'),
            type: (i % 4 === 0) ? 'teacher' : 'student',
            status: (i % 3 === 0) ? 'pending' : 'approved',
            name: 'Name ' + i + (i % 2 ? ' Khan' : ' Ali'),
            phone: '0300' + (100000 + i),
            timestamp: 5000 + i
        });
    }
    return rows;
}

describe('better-sqlite3 native backend (Option B)', function () {
    var COLL = 'default__registrations';

    sqliteIt('implements the full repository contract', function () {
        var db = createSqliteDb(tmpDir());
        expect(db.isNative).toBe(true);
        expect(db.engine).toBe('better-sqlite3');
        ['put', 'bulkPut', 'get', 'remove', 'clear', 'all', 'count', 'page'].forEach(function (m) {
            expect(typeof db[m]).toBe('function');
        });
    });

    sqliteIt('put / get / remove / clear behave correctly', async function () {
        var db = createSqliteDb(tmpDir());
        await db.put(COLL, { id: 'A1', type: 'student', name: 'Zed' });
        expect((await db.get(COLL, 'A1')).name).toBe('Zed');
        await db.put(COLL, { id: 'A1', type: 'student', name: 'Zed2' }); // upsert
        expect((await db.get(COLL, 'A1')).name).toBe('Zed2');
        await db.remove(COLL, 'A1');
        expect(await db.get(COLL, 'A1')).toBe(null);
        await db.bulkPut(COLL, makeRows(10));
        expect(await db.count(COLL)).toBe(10);
        await db.clear(COLL);
        expect(await db.count(COLL)).toBe(0);
    });

    sqliteIt('page/count match the reference ems-query-utils engine', async function () {
        var db = createSqliteDb(tmpDir());
        var rows = makeRows(200);
        await db.bulkPut(COLL, rows);

        var cases = [
            { offset: 0, limit: 50 },
            { offset: 60, limit: 25, filter: { type: 'student' }, sort: { field: 'timestamp', dir: 'desc' } },
            { offset: 0, limit: 100, search: { text: 'khan', fields: ['name'] } },
            { offset: 0, limit: -1, filter: { status: 'approved' }, sort: { field: 'id', dir: 'asc' } }
        ];

        for (var i = 0; i < cases.length; i++) {
            var opts = cases[i];
            var sql = await db.page(COLL, opts);
            var ref = Q.pageFromAll(rows, opts);
            expect(sql.rows.map(function (r) { return r.id; })).toEqual(ref.rows.map(function (r) { return r.id; }));
            expect(sql.total).toBe(ref.total);
        }

        expect(await db.count(COLL, { type: 'student' })).toBe(Q.countFromAll(rows, { type: 'student' }));
    });

    sqliteIt('FTS search matches the reference engine (case-insensitive substring) + stays live on writes', async function () {
        var db = createSqliteDb(tmpDir());
        var rows = makeRows(200);
        await db.bulkPut(COLL, rows);

        var searches = [
            { text: 'khan', fields: ['name'] },       // FTS path
            { text: 'KHAN', fields: ['name'] },       // case-insensitive
            { text: '0300100', fields: ['phone'] },   // numeric substring
            { text: 'Al', fields: ['name'] },         // < 3 chars → LIKE fallback
            { text: 'ali' }                           // all-fields → LIKE fallback
        ];
        for (var i = 0; i < searches.length; i++) {
            var opts = { offset: 0, limit: 100, search: searches[i], sort: { field: 'timestamp', dir: 'desc' } };
            var sql = await db.page(COLL, opts);
            var ref = Q.pageFromAll(rows, opts);
            expect(sql.rows.map(function (r) { return r.id; })).toEqual(ref.rows.map(function (r) { return r.id; }));
            expect(sql.total).toBe(ref.total);
        }

        // Trigger keeps FTS live: a freshly put record is immediately searchable,
        // and a removed one disappears from search results.
        await db.put(COLL, { id: 'FTS-NEW', type: 'student', name: 'Unique Zephyr', timestamp: 999999 });
        var found = await db.page(COLL, { offset: 0, limit: 5, search: { text: 'zephyr', fields: ['name'] } });
        expect(found.rows.map(function (r) { return r.id; })).toEqual(['FTS-NEW']);
        await db.remove(COLL, 'FTS-NEW');
        var gone = await db.page(COLL, { offset: 0, limit: 5, search: { text: 'zephyr', fields: ['name'] } });
        expect(gone.total).toBe(0);
    });

    sqliteIt('keyset pagination matches OFFSET results across all pages (incl. NULL sort values)', async function () {
        async function walk(rows, baseOpts, perPage) {
            var db = createSqliteDb(tmpDir());
            await db.bulkPut(COLL, rows);
            var total = Q.pageFromAll(rows, Object.assign({ offset: 0, limit: 0 }, baseOpts)).total;
            var pages = Math.max(1, Math.ceil(total / perPage));
            for (var p = 0; p < pages; p++) {
                var opts = Object.assign({}, baseOpts, { offset: p * perPage, limit: perPage });
                var sql = await db.page(COLL, opts);         // uses remembered keyset cursor
                var ref = Q.pageFromAll(rows, opts);
                expect(sql.rows.map(function (r) { return r.id; })).toEqual(ref.rows.map(function (r) { return r.id; }));
            }
        }
        var rows = makeRows(200);
        await walk(rows, { filter: { type: 'student' }, sort: { field: 'timestamp', dir: 'desc' } }, 25);
        await walk(rows, { sort: { field: 'timestamp', dir: 'asc' } }, 30);
        await walk(rows, {}, 40); // default seq order

        var withNulls = makeRows(120);
        for (var i = 0; i < withNulls.length; i++) { if (i % 7 === 0) withNulls[i].timestamp = null; }
        await walk(withNulls, { sort: { field: 'timestamp', dir: 'desc' } }, 25); // OFFSET fallback path
        await walk(withNulls, { sort: { field: 'timestamp', dir: 'asc' } }, 25);
    });

    sqliteIt('migrates legacy fs-JSON collections on first open', async function () {
        var dir = tmpDir();
        var colDir = path.join(dir, 'collections');
        fs.mkdirSync(colDir, { recursive: true });
        var legacy = {};
        makeRows(15).forEach(function (r) { legacy[r.id] = r; });
        fs.writeFileSync(path.join(colDir, encodeURIComponent(COLL) + '.json'), JSON.stringify(legacy), 'utf8');

        var db = createSqliteDb(dir);
        expect(await db.count(COLL)).toBe(15);
    });

    // ---- static wiring (runs even without the native binary) ---------------
    it('native-db.js selects sqlite first with an fs-JSON fallback', function () {
        var src = fs.readFileSync(path.join(ROOT, 'desktop', 'native-db.js'), 'utf8');
        expect(src).toContain("require('./native-db-sqlite.js')");
        expect(src).toContain('createSqliteDb');
        expect(src).toContain('createFsJsonDb'); // durable fallback preserved
    });

    it('sqlite engine stores a real DB file in the OS app-data dir', function () {
        var src = fs.readFileSync(path.join(ROOT, 'desktop', 'native-db-sqlite.js'), 'utf8');
        expect(src).toContain("madrasa-ems.sqlite");
        expect(src).toContain("journal_mode = WAL");
        expect(src).toContain('json_extract');
    });

    it('sqlite engine wires FTS5 (trigram) search + keyset pagination', function () {
        var src = fs.readFileSync(path.join(ROOT, 'desktop', 'native-db-sqlite.js'), 'utf8');
        expect(src).toContain("USING fts5");
        expect(src).toContain("tokenize = 'trigram'");
        expect(src).toContain('search_index');       // FTS virtual table
        expect(src).toContain('pageViaFts');          // FTS fast path
        expect(src).toContain('keysetCond');          // keyset seek predicate
        expect(src).toContain('ix_items_ts_desc');    // directional index for seek
    });

    it('package.json declares better-sqlite3 + electron-rebuild wiring', function () {
        var pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
        expect(pkg.dependencies['better-sqlite3']).toBeDefined();
        expect(pkg.devDependencies['@electron/rebuild']).toBeDefined();
        expect(pkg.scripts['rebuild:native']).toContain('electron-rebuild');
        expect(pkg.build.asarUnpack.join(' ')).toContain('better-sqlite3');
        expect(pkg.build.files.join(' ')).toContain('desktop/native-db-sqlite.js');
    });

    it('documents native runtime skip reason when ABI rebuild is required', function () {
        if (sqliteRuntime) {
            expect(sqliteSkipReason).toBe('');
            return;
        }
        expect(sqliteSkipReason || 'native module unavailable').toMatch(/NODE_MODULE_VERSION|better-sqlite3|Cannot find module|was compiled against/i);
    });
});
