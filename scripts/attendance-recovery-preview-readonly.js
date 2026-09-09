#!/usr/bin/env node
'use strict';

/**
 * Read-only attendance recovery inventory for every madrasa.
 * It never writes to Firestore. The JSON report is a local migration preview:
 * current canonical timetable IDs, IDs referenced by attendance history, and
 * teacher-attendance baseline counts required to prove a safe repair.
 */
var fs = require('fs');
var os = require('os');
var path = require('path');
var ROOT = path.resolve(__dirname, '..');
var PROJECT = 'madrasa-mangment-app';
var outArg = process.argv.find(function (a) { return a.indexOf('--out=') === 0; });

async function setupCliCredentials() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return true;
  var candidates = [
    path.join(process.env.APPDATA || '', 'configstore', 'firebase-tools.json'),
    path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json')
  ];
  var cfgPath = candidates.find(function (p) { return p && fs.existsSync(p); });
  if (!cfgPath) return false;
  var cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  var defaults = require(path.join(ROOT, 'node_modules', 'firebase-tools', 'lib', 'defaultCredentials'));
  var credentialPath = await defaults.getCredentialPathAsync({ user: cfg.user, tokens: cfg.tokens });
  if (!credentialPath) return false;
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialPath;
  process.env.GCLOUD_PROJECT = PROJECT;
  return true;
}

function parsePeriods(data) {
  if (!data) return [];
  var raw = data.data != null ? data.data : data.list;
  try {
    raw = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(raw) ? raw.filter(Boolean) : [];
  } catch (e) { return []; }
}

function parseAttendanceDocId(id) {
  if (!id || id.indexOf('att_rec_') !== 0) return null;
  var parts = id.slice(8).split('_');
  if (parts.length < 4) return null;
  return {
    month: parts[0], type: parts[1],
    classId: parts.slice(2, -1).join('_'), periodId: parts[parts.length - 1]
  };
}

function userId(row) {
  return String(row && (row.id || row.regId || row.uid || row.docId) || '').trim();
}

function userType(row) {
  return String(row && (row.type || row.role || row.userType) || '').trim().toLowerCase();
}

function isTeacher(row) {
  return ['teacher', 'teachers', 'استاد', 'اساتذہ'].indexOf(userType(row)) >= 0
    || /^t(ch|cr)[_-]/i.test(userId(row));
}

function nonEmptyCells(map, allowedIds) {
  var cells = 0;
  var people = Object.create(null);
  Object.keys(map || {}).forEach(function (id) {
    if (!allowedIds[id]) return;
    Object.keys(map[id] || {}).forEach(function (day) {
      var value = map[id][day];
      if (value != null && String(value) !== '') { cells += 1; people[id] = true; }
    });
  });
  return { cells: cells, people: Object.keys(people).length };
}

function nonEmptyPeriodCells(map, allowedIds) {
  var cells = 0;
  var people = Object.create(null);
  var ids = Object.create(null);
  Object.keys(map || {}).forEach(function (id) {
    if (!allowedIds[id]) return;
    Object.keys(map[id] || {}).forEach(function (day) {
      Object.keys(map[id][day] || {}).forEach(function (pid) {
        var value = map[id][day][pid];
        if (value != null && String(value) !== '') {
          cells += 1; people[id] = true; ids[pid] = true;
        }
      });
    });
  });
  return { cells: cells, people: Object.keys(people).length, ids: ids };
}

function profileName(data) {
  return data.name || data.madrasaName || data.instituteName || data.organizationName || '';
}

async function inspectTenant(tenantDoc) {
  var base = tenantDoc.ref;
  var timetableSnap = await base.collection('ModuleData').doc('Attendance__ems_att_periods').get();
  var timetable = parsePeriods(timetableSnap.exists ? timetableSnap.data() : null);
  var liveIds = Object.create(null);
  timetable.forEach(function (p) { if (p && p.id) liveIds[String(p.id)] = true; });

  var registrations = await base.collection('Registrations').get();
  var teacherIds = Object.create(null);
  registrations.forEach(function (doc) {
    var row = doc.data() || {};
    var id = userId(row) || doc.id;
    if (isTeacher(row) && id) teacherIds[id] = true;
  });

  var attendance = await base.collection('Attendance').get();
  var referenced = Object.create(null);
  var daily = 0;
  var hourly = 0;
  var teachersWithMarks = Object.create(null);
  attendance.forEach(function (doc) {
    var data = doc.data() || {};
    var parsed = parseAttendanceDocId(doc.id);
    if (parsed && /^PRD-/.test(parsed.periodId)) referenced[parsed.periodId] = true;
    var dailyStats = nonEmptyCells(data.records || {}, teacherIds);
    daily += dailyStats.cells;
    Object.keys(data.records || {}).forEach(function (id) {
      if (!teacherIds[id]) return;
      Object.keys(data.records[id] || {}).forEach(function (day) {
        var v = data.records[id][day];
        if (v != null && String(v) !== '') teachersWithMarks[id] = true;
      });
    });
    var periodStats = nonEmptyPeriodCells(data.periodRecords || data.teacherPeriodRecords || {}, teacherIds);
    hourly += periodStats.cells;
    Object.keys(periodStats.ids).forEach(function (pid) { referenced[pid] = true; });
    Object.keys(data.periodRecords || data.teacherPeriodRecords || {}).forEach(function (id) {
      if (teacherIds[id]) teachersWithMarks[id] = true;
    });
  });

  var orphanIds = Object.keys(referenced).filter(function (id) { return !liveIds[id]; }).sort();
  return {
    tenantId: tenantDoc.id,
    madrasaName: profileName(tenantDoc.data() || {}),
    attendanceRegisterCount: attendance.size,
    registeredTeacherCount: Object.keys(teacherIds).length,
    teachersWithAttendance: Object.keys(teachersWithMarks).length,
    teacherDailyAttendanceCells: daily,
    teacherPeriodAttendanceCells: hourly,
    currentTimetablePeriodCount: timetable.length,
    attendanceReferencedPeriodCount: Object.keys(referenced).length,
    missingTimetableMetadataPeriodCount: orphanIds.length,
    missingTimetableMetadataPeriodIds: orphanIds
  };
}

async function main() {
  if (!(await setupCliCredentials())) throw new Error('Firebase CLI credentials not found');
  var admin = require(path.join(ROOT, 'functions', 'node_modules', 'firebase-admin'));
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  var tenants = await admin.firestore().collection('All_Madrasas').get();
  var rows = [];
  for (var i = 0; i < tenants.docs.length; i++) rows.push(await inspectTenant(tenants.docs[i]));
  var report = {
    version: 1,
    mode: 'read_only_migration_preview',
    createdAt: new Date().toISOString(),
    project: PROJECT,
    tenantCount: rows.length,
    tenants: rows,
    totals: {
      attendanceRegisters: rows.reduce(function (n, r) { return n + r.attendanceRegisterCount; }, 0),
      registeredTeachers: rows.reduce(function (n, r) { return n + r.registeredTeacherCount; }, 0),
      teacherDailyCells: rows.reduce(function (n, r) { return n + r.teacherDailyAttendanceCells; }, 0),
      teacherPeriodCells: rows.reduce(function (n, r) { return n + r.teacherPeriodAttendanceCells; }, 0),
      missingMetadataPeriods: rows.reduce(function (n, r) { return n + r.missingTimetableMetadataPeriodCount; }, 0)
    }
  };
  var out = outArg ? path.resolve(ROOT, outArg.slice(6))
    : path.join(ROOT, 'backups', 'attendance-recovery-preview-' + Date.now() + '.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({ written: out, tenantCount: report.tenantCount, totals: report.totals }, null, 2));
}

main().catch(function (err) {
  console.error('[attendance-recovery-preview] FAILED:', err && err.message ? err.message : String(err));
  process.exit(1);
});
