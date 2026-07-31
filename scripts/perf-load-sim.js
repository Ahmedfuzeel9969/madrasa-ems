/**
 * Synthetic load simulation — mirrors EMS hot paths (localStorage + in-memory scans)
 * Run: node scripts/perf-load-sim.js
 * Run: node scripts/perf-load-sim.js --max=10000
 * Run: node scripts/perf-load-sim.js --skip-legacy --json-out=docs/benchmark-latest.json
 */
'use strict';

var fs = require('fs');
var path = require('path');
var Q = require(path.join(__dirname, '..', 'ems-query-utils.js'));

function parseArgs() {
  var opts = { max: null, scales: null, skipLegacy: true, includeLegacy: false, jsonOut: null };
  process.argv.slice(2).forEach(function (arg) {
    if (arg.indexOf('--max=') === 0) opts.max = parseInt(arg.split('=')[1], 10);
    if (arg.indexOf('--scales=') === 0) {
      opts.scales = arg.split('=')[1].split(',').map(function (s) { return parseInt(s.trim(), 10); });
    }
    if (arg === '--skip-legacy') opts.skipLegacy = true;
    if (arg === '--include-legacy') { opts.includeLegacy = true; opts.skipLegacy = false; }
    if (arg.indexOf('--json-out=') === 0) opts.jsonOut = arg.split('=')[1];
  });
  return opts;
}

function makeStudent(i) {
  return {
    id: 'STU-' + String(i).padStart(5, '0'),
    type: 'student',
    name: 'طالب ' + i,
    fname: 'ولی ' + i,
    class: 'جماعت ' + (i % 12 + 1),
    phone: '0300' + String(1000000 + i),
    cnic: String(3520000000000 + i),
    departmentId: ['boys_dars', 'boys_hifz', 'girls_dars', 'girls_hifz'][i % 4],
    timestamp: Date.now() - i * 86400000
  };
}

function makeCollection(nStudents) {
  var users = [];
  for (var i = 0; i < nStudents; i++) users.push(makeStudent(i));
  var teachers = [];
  for (var t = 0; t < Math.max(10, Math.floor(nStudents / 20)); t++) {
    teachers.push({ id: 'TCH-' + t, type: 'teacher', name: 'استاد ' + t, departmentId: 'boys_dars' });
  }
  return users.concat(teachers);
}

function makeFeeCollections(nStudents, perStudent) {
  var cols = [];
  for (var s = 0; s < nStudents; s++) {
    for (var j = 0; j < perStudent; j++) {
      cols.push({
        id: 'REC-' + s + '-' + j,
        studentId: 'STU-' + String(s).padStart(5, '0'),
        amount: 500 + j * 100,
        date: '2025-06-' + String((j % 28) + 1).padStart(2, '0')
      });
    }
  }
  return cols;
}

function bench(label, fn) {
  var t0 = process.hrtime.bigint();
  fn();
  var ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { label: label, ms: Math.round(ms * 100) / 100 };
}

function fingerprint(raw) {
  if (raw === null || raw === undefined) return 'null';
  var len = raw.length;
  if (len === 0) return '0';
  return len + ':' + raw.charCodeAt(0) + ':' + raw.charCodeAt(len - 1) + ':' + raw.charCodeAt(Math.floor(len / 2));
}

function verdictForScale(n, mapArrearsMs, searchMs, sizeMb) {
  if (n <= 1000 && mapArrearsMs < 5 && searchMs < 5) return 'production-ready';
  if (n <= 10000 && mapArrearsMs < 50 && searchMs < 20) return 'acceptable';
  if (n <= 50000 && mapArrearsMs < 200 && searchMs < 100) return 'large-tenant';
  if (mapArrearsMs < 500 && searchMs < 500) return 'stress-ok';
  return 'needs-server-aggregation';
}

function simulateDashboard(usersJson, collectionsJson, options) {
  options = options || {};
  var results = [];
  results.push(bench('JSON.parse users', function () {
    JSON.parse(usersJson);
  }));
  var users = JSON.parse(usersJson);
  var collections = JSON.parse(collectionsJson);
  results.push(bench('filter students + counts', function () {
    var students = users.filter(function (u) { return u.type === 'student'; });
    students.length;
    users.filter(function (u) { return u.type === 'teacher'; }).length;
  }));
  if (!options.skipLegacy) {
    results.push(bench('arrears O(n*m) [legacy]', function () {
      var students = users.filter(function (u) { return u.type === 'student'; });
      var total = 0;
      students.forEach(function (std) {
        var paid = collections.filter(function (c) { return c.studentId === std.id; })
          .reduce(function (s, c) { return s + c.amount; }, 0);
        total += paid;
      });
    }));
  }
  results.push(bench('arrears O(n+m) Map [production]', function () {
    var students = users.filter(function (u) { return u.type === 'student'; });
    var paidByStudent = Object.create(null);
    collections.forEach(function (c) {
      paidByStudent[c.studentId] = (paidByStudent[c.studentId] || 0) + c.amount;
    });
    var total = 0;
    students.forEach(function (std) {
      total += paidByStudent[std.id] || 0;
    });
  }));
  results.push(bench('reg table filter+search+virtual slice', function () {
    Q.pageFromAll(users, {
      offset: 0,
      limit: 40,
      filter: { type: 'student' },
      search: { text: '0300', fields: ['name', 'id', 'cnic', 'phone', 'class'] },
      sort: { field: 'timestamp', dir: 'desc' }
    });
  }));
  results.push(bench('reg table filter-only count (type=student)', function () {
    Q.countFromAll(users, { type: 'student' }, null);
  }));
  results.push(bench('cache fingerprint hit (emsCacheGet)', function () {
    var fp = fingerprint(usersJson);
    var store = { fp: fp, value: users };
    for (var i = 0; i < 50; i++) {
      if (store.fp === fingerprint(usersJson)) store.value;
    }
  }));
  results.push(bench('JSON.stringify users (snapshot write)', function () {
    JSON.stringify(users);
  }));
  var sizeMb = (Buffer.byteLength(usersJson, 'utf8') / (1024 * 1024)).toFixed(2);
  var mapMs = results.find(function (r) { return r.label.indexOf('Map [production]') >= 0; }).ms;
  var searchMs = results.find(function (r) { return r.label.indexOf('virtual slice') >= 0; }).ms;
  return {
    results: results,
    sizeMb: sizeMb,
    userCount: users.length,
    verdict: verdictForScale(users.filter(function (u) { return u.type === 'student'; }).length, mapMs, searchMs, sizeMb)
  };
}

function timingMs(timings, labelPart) {
  var row = timings.find(function (t) { return t.label.indexOf(labelPart) >= 0; });
  return row ? row.ms : null;
}

var args = parseArgs();
var defaultScales = [400, 1000, 10000, 50000, 100000];
var scales = args.scales || defaultScales;
if (args.max) {
  scales = defaultScales.filter(function (n) { return n <= args.max; });
  if (!scales.length) scales = [args.max];
}

var report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  skipLegacy: args.skipLegacy,
  scales: scales,
  release: '20260621-perf5',
  rows: []
};

scales.forEach(function (n) {
  var users = makeCollection(n);
  var usersJson = JSON.stringify(users);
  var cols = makeFeeCollections(Math.floor(n * 0.85), 3);
  var colsJson = JSON.stringify(cols);
  var dash = simulateDashboard(usersJson, colsJson, { skipLegacy: args.skipLegacy });
  report.rows.push({
    students: n,
    records: users.length,
    usersJsonMb: dash.sizeMb,
    feeRecords: cols.length,
    verdict: dash.verdict,
    timings: dash.results,
    mapArrearsMs: timingMs(dash.results, 'Map [production]'),
    legacyArrearsMs: timingMs(dash.results, 'legacy'),
    searchMs: timingMs(dash.results, 'virtual slice'),
    parseMs: timingMs(dash.results, 'JSON.parse')
  });
});

if (args.jsonOut) {
  var outPath = path.resolve(args.jsonOut);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  process.stderr.write('[perf-load-sim] wrote ' + outPath + '\n');
}

console.log(JSON.stringify(report, null, 2));
