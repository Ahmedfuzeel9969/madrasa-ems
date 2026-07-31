/**
 * SQLite scale smoke test — proves the better-sqlite3 backend serves pages and
 * counts smoothly at the 1,000,000-record target.
 *
 *   node scripts/sqlite-scale-check.js            (default 1,000,000)
 *   node scripts/sqlite-scale-check.js --n=200000
 */
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var createSqliteDb = require(path.join(__dirname, '..', 'desktop', 'native-db-sqlite.js')).createSqliteDb;

var N = 1000000;
process.argv.slice(2).forEach(function (a) {
    if (a.indexOf('--n=') === 0) N = parseInt(a.split('=')[1], 10);
});

var COLL = 'default__registrations';
var dir = path.join(os.tmpdir(), 'ems-sqlite-scale-' + Date.now());
fs.mkdirSync(dir, { recursive: true });

async function ms(fn) {
    var t0 = process.hrtime.bigint();
    var r = await fn();
    return { ms: Number(process.hrtime.bigint() - t0) / 1e6, r: r };
}

function batch(start, size) {
    var arr = new Array(size);
    for (var i = 0; i < size; i++) {
        var idx = start + i;
        arr[i] = {
            id: 'STU-' + String(idx).padStart(7, '0'),
            type: (idx % 6 === 0) ? 'teacher' : 'student',
            status: (idx % 5 === 0) ? 'pending' : 'approved',
            name: 'طالب ' + idx,
            phone: '0300' + String(1000000 + idx),
            cnic: String(3520000000000 + idx),
            class: 'جماعت ' + (idx % 12 + 1),
            timestamp: Date.now() - idx * 1000
        };
    }
    return arr;
}

async function main() {
    var db = createSqliteDb(dir);
    console.log('inserting ' + N.toLocaleString() + ' records…');

    var BATCH = 10000;
    var writeStart = process.hrtime.bigint();
    for (var s = 0; s < N; s += BATCH) {
        var size = Math.min(BATCH, N - s);
        await db.bulkPut(COLL, batch(s, size));
    }
    var writeMs = Number(process.hrtime.bigint() - writeStart) / 1e6;
    console.log('  bulk insert total: ' + Math.round(writeMs) + ' ms  (' +
        Math.round(N / (writeMs / 1000)).toLocaleString() + ' rows/sec)');

    var total = await ms(function () { return db.count(COLL); });
    console.log('  count(all): ' + total.r + '  in ' + total.ms.toFixed(2) + ' ms');

    var cStudents = await ms(function () { return db.count(COLL, { type: 'student' }); });
    console.log('  count(type=student): ' + cStudents.r + '  in ' + cStudents.ms.toFixed(2) + ' ms');

    var p1 = await ms(function () {
        return db.page(COLL, { offset: 0, limit: 50, filter: { type: 'student' }, sort: { field: 'timestamp', dir: 'desc' } });
    });
    console.log('  page 1 (filter+sort, 50 rows): ' + p1.ms.toFixed(2) + ' ms  total=' + p1.r.total);

    var deepOpts = { filter: { type: 'student' }, sort: { field: 'timestamp', dir: 'desc' } };
    var deepOff = Math.floor(cStudents.r * 0.6 / 50) * 50; // ~60% into the filtered set, page-aligned
    var pDeep = await ms(function () {
        return db.page(COLL, Object.assign({ offset: deepOff, limit: 50 }, deepOpts));
    });
    console.log('  page @offset ' + deepOff.toLocaleString() + ' COLD (OFFSET fallback): ' + pDeep.ms.toFixed(2) + ' ms');

    // The realistic UI action: after landing on a deep page, click "next".
    // A cursor is now remembered → this is a pure keyset seek (O(limit)).
    var pNext = await ms(function () {
        return db.page(COLL, Object.assign({ offset: deepOff + 50, limit: 50 }, deepOpts));
    });
    console.log('  page @offset ' + (deepOff + 50).toLocaleString() + ' WARM (keyset seek): ' + pNext.ms.toFixed(2) + ' ms');

    // Walk 100 more pages forward from the deep point — each is a keyset seek.
    var walkStart = process.hrtime.bigint();
    for (var w = 1; w <= 100; w++) {
        await db.page(COLL, Object.assign({ offset: deepOff + 50 + w * 50, limit: 50 }, deepOpts));
    }
    var walkMs = Number(process.hrtime.bigint() - walkStart) / 1e6;
    console.log('  next×100 from deep page (keyset): ' + walkMs.toFixed(2) + ' ms total  (' + (walkMs / 100).toFixed(3) + ' ms/page)');

    var pFts = await ms(function () {
        return db.page(COLL, { offset: 0, limit: 50, search: { text: '0300100', fields: ['phone', 'name', 'id'] } });
    });
    console.log('  search page FTS5 (indexed substring): ' + pFts.ms.toFixed(2) + ' ms  total=' + pFts.r.total);

    var pLike = await ms(function () {
        return db.page(COLL, { offset: 0, limit: 50, search: { text: '0300100' } }); // all-fields → LIKE scan
    });
    console.log('  search page LIKE (all-fields scan): ' + pLike.ms.toFixed(2) + ' ms  total=' + pLike.r.total);

    var dbSize = 0;
    try { dbSize = fs.statSync(path.join(dir, 'madrasa-ems.sqlite')).size; } catch (e) {}
    console.log('  db file size: ' + (dbSize / (1024 * 1024)).toFixed(1) + ' MB');
    console.log('  db path: ' + path.join(dir, 'madrasa-ems.sqlite'));

    db.close();
    console.log('SCALE OK');
}

main().catch(function (e) { console.error(e); process.exit(1); });
