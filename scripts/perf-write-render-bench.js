/**
 * Write + render micro-benchmark — quantifies the offline-first perf refactor:
 *   Phase 1  incremental durable write   (per-record vs full-list snapshot)
 *   Phase 2  coalesced event storm       (1 dashboard scan vs N per change)
 *   Phase 3  snapshot-cache pagination   (cached page vs full IDB re-read)
 *
 * Uses the REAL EmsQueryUtils so pagination cost is representative.
 *
 * Run: node scripts/perf-write-render-bench.js
 * Run: node scripts/perf-write-render-bench.js --max=100000
 * Run: node scripts/perf-write-render-bench.js --json-out=docs/write-render-bench.json
 */
'use strict';

var fs = require('fs');
var path = require('path');
var Q = require(path.join(__dirname, '..', 'ems-query-utils.js'));

function parseArgs() {
  var opts = { max: null, scales: null, jsonOut: null, listeners: 4, renders: 20 };
  process.argv.slice(2).forEach(function (arg) {
    if (arg.indexOf('--max=') === 0) opts.max = parseInt(arg.split('=')[1], 10);
    if (arg.indexOf('--scales=') === 0) {
      opts.scales = arg.split('=')[1].split(',').map(function (s) { return parseInt(s.trim(), 10); });
    }
    if (arg.indexOf('--listeners=') === 0) opts.listeners = parseInt(arg.split('=')[1], 10);
    if (arg.indexOf('--renders=') === 0) opts.renders = parseInt(arg.split('=')[1], 10);
    if (arg.indexOf('--json-out=') === 0) opts.jsonOut = arg.split('=')[1];
  });
  return opts;
}

function makeRow(i) {
  return {
    id: 'STU-' + String(i).padStart(6, '0'),
    type: (i % 7 === 0) ? 'teacher' : 'student',
    status: 'approved',
    name: 'طالب ' + i,
    fname: 'ولی ' + i,
    class: 'جماعت ' + (i % 12 + 1),
    phone: '0300' + String(1000000 + i),
    cnic: String(3520000000000 + i),
    timestamp: Date.now() - i * 60000
  };
}

function makeRows(n) {
  var a = new Array(n);
  for (var i = 0; i < n; i++) a[i] = makeRow(i);
  return a;
}

function ms(fn) {
  var t0 = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

function round(x) { return Math.round(x * 1000) / 1000; }

// ---- Phase 1: cost of persisting ONE new record ---------------------------
// OLD: rewrite the entire blob (JSON.stringify of the whole list) on every add.
// NEW: a single-record put — modelled as stringifying just that one record.
function benchSingleWrite(rows) {
  var old = ms(function () { JSON.stringify(rows); });                 // full-list snapshot
  var neu = ms(function () { JSON.stringify(rows[rows.length - 1]); }); // one-record put
  return { fullListWriteMs: round(old), perRecordWriteMs: round(neu),
           speedup: neu > 0 ? Math.round(old / neu) : null };
}

// ---- Phase 3: cost of rendering ONE page -----------------------------------
// getAll() materialises a fresh array from IDB every call — that copy is what
// the snapshot cache avoids. Model it as a shallow copy per uncached render.
function idbGetAll(rows) { return rows.slice(); }

function benchRender(rows, renders) {
  var pageOpts = {
    offset: 0, limit: 50,
    filter: { type: 'student' },
    sort: { field: 'timestamp', dir: 'desc' },
    search: { text: '', fields: ['name', 'id', 'cnic', 'phone', 'class'] }
  };

  var noCache = ms(function () {
    for (var i = 0; i < renders; i++) {
      var all = idbGetAll(rows);          // full re-read every render (OLD)
      Q.pageFromAll(all, pageOpts);
    }
  });

  var withCache = ms(function () {
    var all = idbGetAll(rows);            // read once (NEW: snapshot cache)
    for (var i = 0; i < renders; i++) {
      Q.pageFromAll(all, pageOpts);       // reuse cached array
    }
  });

  return {
    renders: renders,
    noCacheMs: round(noCache),
    withCacheMs: round(withCache),
    noCachePerRenderMs: round(noCache / renders),
    withCachePerRenderMs: round(withCache / renders),
    speedup: withCache > 0 ? Math.round(noCache / withCache) : null
  };
}

// ---- Phase 2: dashboard scan storm -----------------------------------------
// One data change fans out to `listeners` handlers that each scan all users.
// Coalescing collapses them into a single scan per frame.
function benchEventStorm(rows, listeners) {
  function scan() {
    var students = 0, teachers = 0;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].type === 'student') students++; else teachers++;
    }
    return students + teachers;
  }
  var storm = ms(function () { for (var i = 0; i < listeners; i++) scan(); });
  var coalesced = ms(function () { scan(); });
  return {
    listeners: listeners,
    stormMs: round(storm),
    coalescedMs: round(coalesced),
    savedMs: round(storm - coalesced)
  };
}

var args = parseArgs();
var defaultScales = [1000, 10000, 50000, 100000];
var scales = args.scales || defaultScales;
if (args.max) {
  scales = defaultScales.filter(function (n) { return n <= args.max; });
  if (!scales.length) scales = [args.max];
}

var report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  purpose: 'offline-first perf refactor (write + render + event coalescing)',
  scales: scales,
  rows: []
};

scales.forEach(function (n) {
  var rows = makeRows(n);
  report.rows.push({
    records: n,
    phase1_singleWrite: benchSingleWrite(rows),
    phase3_render: benchRender(rows, args.renders),
    phase2_eventStorm: benchEventStorm(rows, args.listeners)
  });
});

if (args.jsonOut) {
  var outPath = path.resolve(args.jsonOut);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  process.stderr.write('[perf-write-render-bench] wrote ' + outPath + '\n');
}

console.log(JSON.stringify(report, null, 2));
