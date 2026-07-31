/**
 * SQLite backend parity check — proves the better-sqlite3 engine (incl. the
 * FTS5 search fast-path and keyset pagination) returns the SAME results as the
 * reference ems-query-utils engine used by the IndexedDB / fs-JSON backends.
 *
 *   node scripts/sqlite-parity-check.js
 *
 * Exits non-zero on any mismatch.
 */
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var Q = require(path.join(__dirname, '..', 'ems-query-utils.js'));
var createSqliteDb = require(path.join(__dirname, '..', 'desktop', 'native-db-sqlite.js')).createSqliteDb;

function tmpDir(tag) {
    var d = path.join(os.tmpdir(), 'ems-sqlite-parity-' + tag + '-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    fs.mkdirSync(d, { recursive: true });
    return d;
}

function makeRows(n) {
    var rows = [];
    for (var i = 0; i < n; i++) {
        rows.push({
            id: 'STU-' + String(i).padStart(5, '0'),
            type: (i % 6 === 0) ? 'teacher' : 'student',
            status: (i % 5 === 0) ? 'pending' : 'approved',
            name: 'Ali ' + i + (i % 3 === 0 ? ' Khan' : ' Ahmed'),
            phone: '0300' + String(1000000 + i),
            cnic: String(3520000000000 + i),
            class: 'Class ' + (i % 12 + 1),
            timestamp: 1000000 + (i % 7 === 0 ? 0 : i) // deliberate ties + repeats
        });
    }
    return rows;
}

/** Some rows get a NULL timestamp to stress keyset NULL handling. */
function makeRowsWithNulls(n) {
    var rows = makeRows(n);
    for (var i = 0; i < n; i++) {
        if (i % 9 === 0) rows[i].timestamp = null;
    }
    return rows;
}

function ids(arr) { return arr.map(function (r) { return r.id; }); }

var COLL = 'default__registrations';
var failures = 0;

function check(label, got, want) {
    var ok;
    try { ok = JSON.stringify(got) === JSON.stringify(want); } catch (e) { ok = false; }
    if (ok) {
        console.log('  ok  ' + label);
    } else {
        failures++;
        console.log('  XX  ' + label);
        console.log('       got : ' + JSON.stringify(got));
        console.log('       want: ' + JSON.stringify(want));
    }
}

/** Page through EVERY page sequentially on ONE db instance so keyset cursors accumulate. */
async function sequentialParity(label, db, rows, baseOpts, perPage) {
    var total = Q.pageFromAll(rows, Object.assign({ offset: 0, limit: 0 }, baseOpts)).total;
    var pages = Math.max(1, Math.ceil(total / perPage));
    var allOk = true;
    for (var p = 0; p < pages; p++) {
        var opts = Object.assign({}, baseOpts, { offset: p * perPage, limit: perPage });
        var sql = await db.page(COLL, opts);
        var ref = Q.pageFromAll(rows, opts);
        if (JSON.stringify(ids(sql.rows)) !== JSON.stringify(ids(ref.rows)) || sql.total !== ref.total) {
            allOk = false;
            failures++;
            console.log('  XX  ' + label + ' [page ' + p + ' offset ' + (p * perPage) + ']');
            console.log('       got : ' + JSON.stringify(ids(sql.rows)));
            console.log('       want: ' + JSON.stringify(ids(ref.rows)));
            break;
        }
    }
    if (allOk) console.log('  ok  ' + label + ' (' + pages + ' pages, keyset)');
}

async function run() {
    var db = createSqliteDb(tmpDir('main'));
    console.log('FTS available: ' + db.ftsAvailable());
    var rows = makeRows(500);
    await db.bulkPut(COLL, rows);
    check('bulkPut count', await db.count(COLL), 500);

    console.log('\n-- static page/count parity --');
    var queries = [
        { label: 'default page', opts: { offset: 0, limit: 50 } },
        { label: 'page 3, limit 40', opts: { offset: 80, limit: 40 } },
        { label: 'filter type=student, sort ts desc', opts: { offset: 0, limit: 50, filter: { type: 'student' }, sort: { field: 'timestamp', dir: 'desc' } } },
        { label: 'filter status=approved, sort ts asc, deep offset', opts: { offset: 120, limit: 30, filter: { status: 'approved' }, sort: { field: 'timestamp', dir: 'asc' } } },
        { label: 'FTS search "khan" in [name]', opts: { offset: 0, limit: 100, search: { text: 'khan', fields: ['name'] } } },
        { label: 'FTS search UPPER "KHAN"', opts: { offset: 0, limit: 100, search: { text: 'KHAN', fields: ['name'] } } },
        { label: 'FTS search phone substring', opts: { offset: 0, limit: 50, search: { text: '0300100', fields: ['phone', 'name', 'id'] } } },
        { label: 'FTS search id substring', opts: { offset: 0, limit: 50, search: { text: 'STU-004', fields: ['id', 'name'] } } },
        { label: 'short search "Al" (<3 → LIKE fallback)', opts: { offset: 0, limit: 50, search: { text: 'Al', fields: ['name'] } } },
        { label: 'all-fields search (LIKE fallback)', opts: { offset: 0, limit: 50, search: { text: 'Ahmed' } } },
        { label: 'FTS + filter + sort combined', opts: { offset: 0, limit: 25, filter: { type: 'student' }, search: { text: 'ahmed', fields: ['name'] }, sort: { field: 'id', dir: 'asc' } } },
        { label: 'limit -1 (all) filter status=pending', opts: { offset: 0, limit: -1, filter: { status: 'pending' } } }
    ];
    for (var i = 0; i < queries.length; i++) {
        var qy = queries[i];
        var sqlRes = await db.page(COLL, qy.opts);
        var ref = Q.pageFromAll(rows, qy.opts);
        check('page ids — ' + qy.label, ids(sqlRes.rows), ids(ref.rows));
        check('page total — ' + qy.label, sqlRes.total, ref.total);
    }

    console.log('\n-- keyset sequential pagination parity --');
    await sequentialParity('sort ts desc', createSqliteDbSeeded(rows), rows, { filter: { type: 'student' }, sort: { field: 'timestamp', dir: 'desc' } }, 25);
    await sequentialParity('sort ts asc', createSqliteDbSeeded(rows), rows, { filter: { type: 'student' }, sort: { field: 'timestamp', dir: 'asc' } }, 25);
    await sequentialParity('default (no sort)', createSqliteDbSeeded(rows), rows, {}, 40);
    await sequentialParity('sort id asc', createSqliteDbSeeded(rows), rows, { sort: { field: 'id', dir: 'asc' } }, 33);

    console.log('\n-- keyset with NULL sort values --');
    var nrows = makeRowsWithNulls(400);
    await sequentialParity('NULLs, sort ts desc (nulls last)', createSqliteDbSeeded(nrows), nrows, { sort: { field: 'timestamp', dir: 'desc' } }, 30);
    await sequentialParity('NULLs, sort ts asc (nulls first)', createSqliteDbSeeded(nrows), nrows, { sort: { field: 'timestamp', dir: 'asc' } }, 30);

    console.log('\n-- random deep-jump parity (cold cursors) --');
    var dbJump = createSqliteDbSeeded(rows);
    var jumps = [ { offset: 300, limit: 25 }, { offset: 55, limit: 25 }, { offset: 475, limit: 25 } ];
    for (var j = 0; j < jumps.length; j++) {
        var o = Object.assign({ sort: { field: 'timestamp', dir: 'desc' } }, jumps[j]);
        var s = await dbJump.page(COLL, o);
        var r = Q.pageFromAll(rows, o);
        check('random jump offset ' + o.offset, ids(s.rows), ids(r.rows));
    }

    console.log('\n-- crud + migration --');
    await db.remove(COLL, 'STU-00042');
    check('get after remove', await db.get(COLL, 'STU-00042'), null);
    await db.put(COLL, { id: 'ZZZ-1', type: 'student', status: 'approved', name: 'Zeta', timestamp: 999999999 });
    check('search finds freshly put record', (await db.page(COLL, { offset: 0, limit: 5, search: { text: 'Zeta', fields: ['name'] } })).rows.map(function (r) { return r.id; }), ['ZZZ-1']);

    var dir2 = tmpDir('migrate');
    var colDir = path.join(dir2, 'collections');
    fs.mkdirSync(colDir, { recursive: true });
    var legacy = {};
    var legacyRows = makeRows(30);
    legacyRows.forEach(function (r) { legacy[r.id] = r; });
    fs.writeFileSync(path.join(colDir, encodeURIComponent(COLL) + '.json'), JSON.stringify(legacy), 'utf8');
    var db2 = createSqliteDb(dir2);
    check('migration imported all rows', await db2.count(COLL), 30);
    check('migration built FTS (search works post-migrate)',
        (await db2.page(COLL, { offset: 0, limit: 100, search: { text: 'khan', fields: ['name'] } })).total,
        Q.pageFromAll(legacyRows, { offset: 0, limit: 100, search: { text: 'khan', fields: ['name'] } }).total);

    console.log('');
    if (failures) { console.log('PARITY FAILED — ' + failures + ' mismatch(es)'); process.exit(1); }
    console.log('PARITY OK — better-sqlite3 (FTS + keyset) matches ems-query-utils');
}

function createSqliteDbSeeded(rows) {
    var db = createSqliteDb(tmpDir('seq'));
    db.bulkPut(COLL, rows); // synchronous under the hood
    return db;
}

run().catch(function (e) { console.error('parity check crashed:', e); process.exit(1); });
