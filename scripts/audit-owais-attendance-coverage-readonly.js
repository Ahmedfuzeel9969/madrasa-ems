#!/usr/bin/env node
'use strict';

/**
 * READ ONLY — attendance coverage proof for one madrasa.
 *
 * This script only reads Firestore.  It deliberately never calls set, update,
 * delete, batch, or transaction APIs.  The report contains IDs/counts only;
 * it does not print student or teacher names.
 */
var fs = require('fs');
var os = require('os');
var path = require('path');
var ROOT = path.resolve(__dirname, '..');
var PROJECT = 'madrasa-mangment-app';
var tenantArg = process.argv.find(function (arg) { return arg.indexOf('--tenant=') === 0; });
var TENANT = tenantArg ? tenantArg.slice('--tenant='.length) : 'bpV58OqWSKhRbvXL57CvihIlDj63';

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

function personId(row, fallback) {
  return String(row && (row.id || row.regId || row.uid || row.docId) || fallback || '').trim();
}

function typeOf(row, id) {
  var value = String(row && (row.type || row.role || row.userType) || '').trim().toLowerCase();
  if (['teacher', 'teachers', 'استاد', 'اساتذہ'].indexOf(value) >= 0 || /^t(ch|cr)[_-]/i.test(id)) return 'teacher';
  if (['student', 'students', 'طالب علم', 'طالب'].indexOf(value) >= 0 || /^std[_-]/i.test(id)) return 'student';
  return 'other';
}

function isActive(row) {
  var status = String(row && row.status || '').trim().toLowerCase();
  return ['pending', 'rejected', 'suspended', 'withdrawn', 'inactive', 'deleted', 'withdrawn/transferred'].indexOf(status) < 0;
}

function attendanceDocKind(id) {
  if (id.indexOf('att_rec_') !== 0) return null;
  var parts = id.slice('att_rec_'.length).split('_');
  if (parts.length < 4) return null;
  return { periodId: parts[parts.length - 1], isDailyScope: parts[parts.length - 1] === 'all' };
}

function present(value) {
  return value != null && String(value).trim() !== '';
}

function visitDaily(map, visit) {
  Object.keys(map || {}).forEach(function (id) {
    Object.keys(map[id] || {}).forEach(function (day) {
      if (present(map[id][day])) visit(String(id), String(day), map[id][day]);
    });
  });
}

function visitPeriods(map, visit) {
  Object.keys(map || {}).forEach(function (id) {
    Object.keys(map[id] || {}).forEach(function (day) {
      Object.keys(map[id][day] || {}).forEach(function (periodId) {
        if (present(map[id][day][periodId])) visit(String(id), String(day), String(periodId), map[id][day][periodId]);
      });
    });
  });
}

function coverageFor(ids) {
  return {
    registered: Object.keys(ids).length,
    peopleWithDailyAttendance: Object.create(null),
    peopleWithHourlyAttendance: Object.create(null),
    dailyCells: Object.create(null),
    hourlyCells: Object.create(null)
  };
}

function addDaily(bucket, id, docId, day) {
  if (!bucket || !bucket.ids[id]) return false;
  bucket.stats.peopleWithDailyAttendance[id] = true;
  bucket.stats.dailyCells[docId + '|' + id + '|' + day] = true;
  return true;
}

function addHourly(bucket, id, docId, day, periodId) {
  if (!bucket || !bucket.ids[id]) return false;
  bucket.stats.peopleWithHourlyAttendance[id] = true;
  bucket.stats.hourlyCells[docId + '|' + id + '|' + day + '|' + periodId] = true;
  return true;
}

function finalise(bucket) {
  var dailyPeople = Object.keys(bucket.stats.peopleWithDailyAttendance).sort();
  var hourlyPeople = Object.keys(bucket.stats.peopleWithHourlyAttendance).sort();
  var registered = Object.keys(bucket.ids).sort();
  return {
    registered: registered.length,
    peopleWithDailyAttendance: dailyPeople.length,
    peopleWithHourlyAttendance: hourlyPeople.length,
    dailyCells: Object.keys(bucket.stats.dailyCells).length,
    hourlyCells: Object.keys(bucket.stats.hourlyCells).length,
    missingDailyAttendanceIds: registered.filter(function (id) { return !bucket.stats.peopleWithDailyAttendance[id]; }),
    missingHourlyAttendanceIds: registered.filter(function (id) { return !bucket.stats.peopleWithHourlyAttendance[id]; })
  };
}

async function main() {
  if (!(await setupCliCredentials())) throw new Error('Firebase CLI credentials not found');
  var admin = require(path.join(ROOT, 'functions', 'node_modules', 'firebase-admin'));
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  var db = admin.firestore();
  var tenantRef = db.collection('All_Madrasas').doc(TENANT);
  var snapshots = await Promise.all([
    tenantRef.get(),
    tenantRef.collection('Registrations').get(),
    tenantRef.collection('Attendance').get()
  ]);
  var profile = snapshots[0].exists ? snapshots[0].data() || {} : {};
  var teachers = { ids: Object.create(null), stats: null };
  var students = { ids: Object.create(null), stats: null };
  var rejectedOrInactive = 0;
  var unknownRole = 0;
  snapshots[1].forEach(function (doc) {
    var row = doc.data() || {};
    var id = personId(row, doc.id);
    if (!id) return;
    if (!isActive(row)) { rejectedOrInactive += 1; return; }
    var kind = typeOf(row, id);
    if (kind === 'teacher') teachers.ids[id] = true;
    else if (kind === 'student') students.ids[id] = true;
    else unknownRole += 1;
  });
  teachers.stats = coverageFor(teachers.ids);
  students.stats = coverageFor(students.ids);
  var historicalIds = Object.create(null);
  var attendanceRegisters = 0;
  var eventDocuments = 0;
  snapshots[2].forEach(function (doc) {
    var kind = attendanceDocKind(doc.id);
    if (!kind) { eventDocuments += 1; return; }
    attendanceRegisters += 1;
    var data = doc.data() || {};
    function daily(id, day) {
      if (addDaily(teachers, id, doc.id, day) || addDaily(students, id, doc.id, day)) return;
      historicalIds[id] = true;
    }
    function hourly(id, day, periodId) {
      if (addHourly(teachers, id, doc.id, day, periodId) || addHourly(students, id, doc.id, day, periodId)) return;
      historicalIds[id] = true;
    }
    // A legacy period document's `records` are lesson attendance, not daily attendance.
    if (kind.isDailyScope) visitDaily(data.records, daily);
    else visitDaily(data.records, function (id, day) { hourly(id, day, kind.periodId); });
    visitPeriods(data.periodRecords || data.teacherPeriodRecords, hourly);
  });
  var result = {
    ok: true,
    mode: 'read_only',
    project: PROJECT,
    tenantId: TENANT,
    tenantName: profile.name || profile.madrasaName || profile.instituteName || '',
    firebasePath: 'All_Madrasas/' + TENANT + '/Attendance',
    registrations: {
      totalDocuments: snapshots[1].size,
      excludedInactiveOrRejected: rejectedOrInactive,
      activeUnknownRole: unknownRole
    },
    attendance: {
      totalDocuments: snapshots[2].size,
      attendanceRegisterDocuments: attendanceRegisters,
      nonRegisterEventOrOtherDocuments: eventDocuments
    },
    activeTeachers: finalise(teachers),
    activeStudents: finalise(students),
    historicUnregisteredAttendancePersonCount: Object.keys(historicalIds).length
  };
  console.log(JSON.stringify(result, null, 2));
}

main().catch(function (error) {
  console.error(JSON.stringify({ ok: false, error: String(error && error.message || error) }));
  process.exit(1);
});
