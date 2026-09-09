#!/usr/bin/env node
'use strict';

/**
 * READ ONLY — compare canonical Attendance documents with the live registration
 * roster and classify every mark the Smart Register must render.
 */
var fs = require('fs');
var os = require('os');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var PROJECT = 'madrasa-mangment-app';
var tenantArg = process.argv.find(function (arg) { return arg.indexOf('--tenant=') === 0; });
var TENANT = tenantArg ? tenantArg.slice('--tenant='.length) : 'bpV58OqWSKhRbvXL57CvihIlDj63';
var OUT = path.join(ROOT, 'backups', 'smart-register-visibility-audit-' + Date.now() + '.json');

async function setupCliCredentials() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return true;
  var candidates = [
    path.join(process.env.APPDATA || '', 'configstore', 'firebase-tools.json'),
    path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json')
  ];
  var configPath = candidates.find(function (candidate) { return candidate && fs.existsSync(candidate); });
  if (!configPath) return false;
  var config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  var defaults = require(path.join(ROOT, 'node_modules', 'firebase-tools', 'lib', 'defaultCredentials'));
  var credentialPath = await defaults.getCredentialPathAsync({ user: config.user, tokens: config.tokens });
  if (!credentialPath) return false;
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialPath;
  process.env.GCLOUD_PROJECT = PROJECT;
  return true;
}

function idOf(row, fallback) {
  return String(row && (row.id || row.regId || row.uid || row.docId) || fallback || '').trim();
}

function classOf(row) {
  return String(row && (row.class || row.className || row.grade || row.section) || '').trim();
}

function roleOf(row, id) {
  var type = String(row && (row.type || row.role || row.userType) || '').trim().toLowerCase();
  if (type === 'teacher' || type === 'teachers' || /^t(ch|cr)[_-]/i.test(id)) return 'teachers';
  if (type === 'student' || type === 'students' || /^st(d|u)[_-]/i.test(id)) return 'students';
  if (type === 'staff' || type === 'عملہ' || /^stf[_-]/i.test(id)) return 'staff';
  return 'other';
}

function isActive(row) {
  var status = String(row && row.status || '').trim().toLowerCase();
  return ['rejected', 'suspended', 'withdrawn', 'inactive', 'deleted', 'withdrawn/transferred'].indexOf(status) < 0;
}

function parseCanonical(docId) {
  var match = String(docId || '').match(/^att_rec_(\d{4}-\d{2})_(students|teachers|staff)_(.*)_all$/);
  if (!match) return null;
  return { month: match[1], type: match[2], classId: match[3] || '' };
}

function classify(value) {
  var st = String(value == null ? '' : value).trim();
  if (!st) return '';
  if (st === 'P' || st === 'ح' || st === 'حاضر') return 'P';
  if (st === 'A' || st === 'غ' || st === 'غائب' || st === 'غیر حاضر' || st === 'غیرحاضر') return 'A';
  if (st === 'L' || st === 'ر' || st === 'رخصت' || st.toLowerCase() === 'leave') return 'L';
  if (st === 'جزوی حاضری') return 'partial';
  if (st === 'نامکمل') return 'incomplete';
  return 'unknown';
}

function addCount(bucket, value) {
  var key = classify(value);
  if (!key) return;
  bucket[key] = (bucket[key] || 0) + 1;
}

function scanDaily(map, roster, statusCounts, orphanIds, matchedIds) {
  var cells = 0;
  Object.keys(map || {}).forEach(function (uid) {
    if (roster[uid]) matchedIds[uid] = true;
    else orphanIds[uid] = true;
    Object.keys(map[uid] || {}).forEach(function (day) {
      var value = map[uid][day];
      if (value == null || value === '') return;
      cells += 1;
      addCount(statusCounts, value);
    });
  });
  return cells;
}

function scanPeriods(map, roster, statusCounts, orphanIds, matchedIds) {
  var cells = 0;
  Object.keys(map || {}).forEach(function (uid) {
    if (roster[uid]) matchedIds[uid] = true;
    else orphanIds[uid] = true;
    Object.keys(map[uid] || {}).forEach(function (day) {
      Object.keys(map[uid][day] || {}).forEach(function (periodId) {
        var value = map[uid][day][periodId];
        if (value == null || value === '') return;
        cells += 1;
        addCount(statusCounts, value);
      });
    });
  });
  return cells;
}

async function main() {
  if (!(await setupCliCredentials())) throw new Error('Firebase CLI credentials not found');
  var admin = require(path.join(ROOT, 'functions', 'node_modules', 'firebase-admin'));
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  var db = admin.firestore();
  var tenantRef = db.collection('All_Madrasas').doc(TENANT);
  var reads = await Promise.all([
    tenantRef.get(),
    tenantRef.collection('Registrations').get(),
    tenantRef.collection('Attendance').get(),
    tenantRef.collection('ModuleData').doc('Attendance__ems_att_symbols').get(),
    tenantRef.collection('ModuleData').doc('Attendance__ems_att_periods').get()
  ]);
  if (!reads[0].exists) throw new Error('Target tenant not found');

  var roster = Object.create(null);
  reads[1].forEach(function (doc) {
    var row = doc.data() || {};
    if (!isActive(row)) return;
    var id = idOf(row, doc.id);
    roster[id] = { id: id, type: roleOf(row, id), classId: classOf(row) };
  });

  var registers = [];
  reads[2].forEach(function (doc) {
    var identity = parseCanonical(doc.id);
    if (!identity) return;
    var data = doc.data() || {};
    var expected = Object.create(null);
    Object.keys(roster).forEach(function (id) {
      var row = roster[id];
      if (row.type !== identity.type) return;
      if (identity.type === 'students' && row.classId !== identity.classId) return;
      expected[id] = true;
    });
    var dailyCounts = Object.create(null);
    var hourlyCounts = Object.create(null);
    var orphanIds = Object.create(null);
    var matchedIds = Object.create(null);
    var dailyCells = scanDaily(data.records, expected, dailyCounts, orphanIds, matchedIds);
    var hourlyCells = scanPeriods(data.periodRecords || data.teacherPeriodRecords, expected, hourlyCounts, orphanIds, matchedIds);
    registers.push({
      id: doc.id,
      month: identity.month,
      type: identity.type,
      classId: identity.classId,
      primaryCanonical: identity.type === 'students' || !identity.classId,
      locked: !!data.locked,
      dailyLockCount: Object.keys(data.dailyLocks || {}).filter(function (day) { return !!data.dailyLocks[day]; }).length,
      rosterCount: Object.keys(expected).length,
      matchedMarkedRosterCount: Object.keys(matchedIds).length,
      orphanMarkedIds: Object.keys(orphanIds).sort(),
      dailyCells: dailyCells,
      hourlyCells: hourlyCells,
      dailyStatusCounts: dailyCounts,
      hourlyStatusCounts: hourlyCounts,
      unknownStatusCount: (dailyCounts.unknown || 0) + (hourlyCounts.unknown || 0),
      timestamp: data.timestamp || null
    });
  });

  registers.sort(function (a, b) { return a.id.localeCompare(b.id); });
  // Teacher/staff class-scoped *_all docs are historical sheets. Smart Register
  // now reads only teachers__all / staff__all; students remain class-scoped.
  var primaryRegisters = registers.filter(function (row) { return row.primaryCanonical; });
  var current = primaryRegisters.filter(function (row) { return row.month === '2026-08'; });
  var timetableData = reads[4].exists ? (reads[4].data() || {}) : {};
  var timetableList = [];
  try {
    timetableList = JSON.parse(String(timetableData.data || '[]'));
    if (!Array.isArray(timetableList)) timetableList = [];
  } catch (error) { timetableList = []; }

  var report = {
    ok: true,
    mode: 'read_only',
    createdAt: new Date().toISOString(),
    project: PROJECT,
    tenantId: TENANT,
    tenantName: (reads[0].data() || {}).name || (reads[0].data() || {}).madrasaName || '',
    paths: {
      registrations: tenantRef.path + '/Registrations',
      attendance: tenantRef.path + '/Attendance',
      symbols: tenantRef.path + '/ModuleData/Attendance__ems_att_symbols',
      timetable: tenantRef.path + '/ModuleData/Attendance__ems_att_periods'
    },
    registrationCount: Object.keys(roster).length,
    timetablePeriodCount: timetableList.length,
    symbolsDocument: reads[3].exists ? reads[3].data() : null,
    totals: {
      allAllPeriodDocuments: registers.length,
      primaryCanonicalRegisters: primaryRegisters.length,
      currentMonthRegisters: current.length,
      currentMonthDailyCells: current.reduce(function (sum, row) { return sum + row.dailyCells; }, 0),
      currentMonthHourlyCells: current.reduce(function (sum, row) { return sum + row.hourlyCells; }, 0),
      currentMonthUnknownStatuses: current.reduce(function (sum, row) { return sum + row.unknownStatusCount; }, 0),
      currentMonthOrphanMarkedIds: Array.from(new Set([].concat.apply([], current.map(function (row) { return row.orphanMarkedIds; })))).sort()
    },
    registers: registers
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({
    ok: true,
    mode: report.mode,
    output: OUT,
    tenantId: TENANT,
    tenantName: report.tenantName,
    registrationCount: report.registrationCount,
    timetablePeriodCount: report.timetablePeriodCount,
    totals: report.totals,
    currentMonthRegisters: current
  }, null, 2));
}

main().catch(function (error) {
  console.error(JSON.stringify({ ok: false, error: String(error && error.stack || error) }));
  process.exit(1);
});
