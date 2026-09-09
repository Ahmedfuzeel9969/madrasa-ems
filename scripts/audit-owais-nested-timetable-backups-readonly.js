#!/usr/bin/env node
'use strict';

/**
 * READ ONLY — inspect nested backup modules for Jamia Arabia Owais Qarni.
 *
 * BackupSnapshots and Platform_Backups keep module payloads in a `modules`
 * subcollection. A direct collection scan cannot see those grandchildren.
 * This script reads those nested copies, validates timetable ownership against
 * the current 47-teacher roster and compares period ids with saved attendance.
 * It never calls set/update/delete/batch/write APIs.
 */
var fs = require('fs');
var os = require('os');
var path = require('path');
var ROOT = path.resolve(__dirname, '..');
var PROJECT = 'madrasa-mangment-app';
var TARGET = 'bpV58OqWSKhRbvXL57CvihIlDj63';
var OUT = path.join(ROOT, 'backups', 'owais-qarnai-nested-timetable-backups-2026-08-30.json');

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

function normalize(value) {
  return String(value || '')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[ـ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function personType(row, id) {
  var value = normalize(row && (row.type || row.role || row.userType));
  if (['teacher', 'teachers', 'استاد', 'اساتذہ'].indexOf(value) >= 0 || /^t(ch|cr)[_-]/i.test(id)) return 'teacher';
  if (['student', 'students', 'طالب علم', 'طالب'].indexOf(value) >= 0 || /^std[_-]/i.test(id)) return 'student';
  return 'other';
}

function parseList(raw) {
  if (raw == null) return [];
  var value = raw;
  for (var i = 0; i < 3; i++) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') {
      if (Array.isArray(value.list)) return value.list;
      if (value.data != null && value.data !== value) {
        value = value.data;
        continue;
      }
      return [];
    }
    if (typeof value !== 'string') return [];
    try { value = JSON.parse(value); } catch (e) { return []; }
  }
  return Array.isArray(value) ? value : [];
}

function parseAttendance(raw) {
  var value = raw;
  for (var i = 0; i < 3; i++) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object' && value.data != null) {
      value = value.data;
      continue;
    }
    if (typeof value !== 'string') return [];
    try { value = JSON.parse(value); } catch (e) { return []; }
  }
  return Array.isArray(value) ? value : [];
}

function attendancePeriodIds(attendanceDocs) {
  var ids = Object.create(null);
  (attendanceDocs || []).forEach(function (entry) {
    var docId = String(entry.id || '');
    var parsedId = docId.indexOf('att_rec_') === 0 ? docId.split('_').pop() : '';
    if (/^PRD-/.test(parsedId)) ids[parsedId] = true;
    var data = entry.data || {};
    var maps = [data.periodRecords, data.teacherPeriodRecords];
    maps.forEach(function (map) {
      Object.keys(map || {}).forEach(function (uid) {
        Object.keys(map[uid] || {}).forEach(function (day) {
          Object.keys(map[uid][day] || {}).forEach(function (periodId) {
            if (/^PRD-/.test(periodId)) ids[periodId] = true;
          });
        });
      });
    });
  });
  return ids;
}

function summarizeList(source, list, teacherIds, teacherNames, attPeriodIds, meta) {
  list = Array.isArray(list) ? list : [];
  var uniqueTeachers = Object.create(null);
  var uniquePeriods = Object.create(null);
  var matchedPeriods = [];
  var unmatchedTeachers = [];
  var complete = 0;
  var teacherBound = 0;
  list.forEach(function (period, index) {
    period = period || {};
    var periodId = String(period.id || period.periodId || '').trim();
    var teacherId = String(period.teacherId || period.teacherUid || '').trim();
    var teacherName = String(period.teacherName || period.ustadName || '').trim();
    if (periodId) uniquePeriods[periodId] = true;
    if (periodId && attPeriodIds[periodId]) matchedPeriods.push(periodId);
    var teacherOwned = teacherId ? !!teacherIds[teacherId] : !!teacherNames[normalize(teacherName)];
    if (teacherOwned) {
      teacherBound++;
      uniqueTeachers[teacherId || ('name:' + normalize(teacherName))] = true;
    } else {
      unmatchedTeachers.push({ index: index, periodId: periodId, teacherId: teacherId, teacherName: teacherName });
    }
    var className = String(period.className || period.class || period.grade || '').trim();
    var start = String(period.start || period.startTime || '').trim();
    var end = String(period.end || period.endTime || '').trim();
    var days = Array.isArray(period.days) ? period.days : (Array.isArray(period.weekdays) ? period.weekdays : []);
    if (periodId && teacherOwned && className && start && end && days.length) complete++;
  });
  matchedPeriods = Array.from(new Set(matchedPeriods)).sort();
  return {
    source: source,
    meta: meta || {},
    count: list.length,
    uniquePeriodCount: Object.keys(uniquePeriods).length,
    uniqueTeacherCount: Object.keys(uniqueTeachers).length,
    teacherBoundCount: teacherBound,
    unmatchedTeacherCount: unmatchedTeachers.length,
    unmatchedTeachers: unmatchedTeachers.slice(0, 100),
    attendancePeriodOverlapCount: matchedPeriods.length,
    attendancePeriodOverlap: matchedPeriods,
    completeMetadataCount: complete,
    ownershipProven: list.length > 0 && unmatchedTeachers.length === 0 && teacherBound === list.length,
    periods: list
  };
}

function attendanceBackupSummary(raw) {
  var list = parseAttendance(raw);
  var ids = list.map(function (entry) { return String(entry && entry.id || ''); }).filter(Boolean);
  return {
    count: list.length,
    attRecordCount: ids.filter(function (id) { return id.indexOf('att_rec_') === 0; }).length,
    eventCount: ids.filter(function (id) { return id.indexOf('att_evt_') === 0; }).length,
    ids: ids.sort()
  };
}

async function readDocCandidate(docRef, source, teacherIds, teacherNames, attPeriodIds, meta) {
  var snap = await docRef.get();
  if (!snap.exists) return null;
  var data = snap.data() || {};
  return summarizeList(source, parseList(data), teacherIds, teacherNames, attPeriodIds,
    Object.assign({ documentPath: docRef.path }, meta || {}, {
      updatedAt: data.updatedAt || null,
      key: data.key || null,
      rawDataLength: typeof data.data === 'string' ? data.data.length : null
    }));
}

async function inspectBackupRoot(rootDoc, label, teacherIds, teacherNames, attPeriodIds) {
  var metaSnap = await rootDoc.get();
  if (!metaSnap.exists) return null;
  var meta = metaSnap.data() || {};
  var periodRef = rootDoc.collection('modules').doc('ems_att_periods');
  var attendanceRef = rootDoc.collection('modules').doc('_attendance');
  var pair = await Promise.all([periodRef.get(), attendanceRef.get()]);
  var candidate = null;
  if (pair[0].exists) {
    candidate = summarizeList(label, parseList(pair[0].data() || {}), teacherIds, teacherNames, attPeriodIds, {
      documentPath: periodRef.path,
      backupId: rootDoc.id,
      createdAt: meta.createdAt || null,
      type: meta.type || null,
      checksum: meta.checksum || null,
      declaredPeriodCount: meta.recordCounts && meta.recordCounts.ems_att_periods
    });
  }
  return {
    id: rootDoc.id,
    rootPath: rootDoc.path,
    createdAt: meta.createdAt || null,
    type: meta.type || null,
    recordCounts: meta.recordCounts || {},
    timetable: candidate,
    attendance: pair[1].exists ? attendanceBackupSummary(pair[1].data() || {}) : null
  };
}

async function main() {
  if (!(await setupCliCredentials())) throw new Error('Firebase credentials not found');
  var admin = require(path.join(ROOT, 'functions', 'node_modules', 'firebase-admin'));
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  var db = admin.firestore();
  var tenantRef = db.collection('All_Madrasas').doc(TARGET);
  var baseline = await Promise.all([
    tenantRef.get(),
    tenantRef.collection('Registrations').get(),
    tenantRef.collection('Attendance').get(),
    tenantRef.collection('BackupSnapshots').get(),
    db.collection('Platform_Backups').where('madrasaId', '==', TARGET).get()
  ]);
  var teacherIds = Object.create(null);
  var teacherNames = Object.create(null);
  baseline[1].forEach(function (doc) {
    var row = doc.data() || {};
    var id = String(row.id || row.regId || row.uid || doc.id || '').trim();
    if (personType(row, id) !== 'teacher') return;
    teacherIds[id] = true;
    var name = normalize(row.name || row.fullName || '');
    if (name) teacherNames[name] = true;
  });
  var currentAttendance = baseline[2].docs.map(function (doc) { return { id: doc.id, data: doc.data() || {} }; });
  var attPeriodIds = attendancePeriodIds(currentAttendance);
  var snapshotResults = [];
  for (var i = 0; i < baseline[3].docs.length; i++) {
    console.error('[nested-backup] tenant snapshot ' + (i + 1) + '/' + baseline[3].size + ' · ' + baseline[3].docs[i].id);
    snapshotResults.push(await inspectBackupRoot(baseline[3].docs[i].ref, 'tenant_backup_snapshot',
      teacherIds, teacherNames, attPeriodIds));
  }
  var platformResults = [];
  for (var p = 0; p < baseline[4].docs.length; p++) {
    console.error('[nested-backup] platform backup ' + (p + 1) + '/' + baseline[4].size + ' · ' + baseline[4].docs[p].id);
    platformResults.push(await inspectBackupRoot(baseline[4].docs[p].ref, 'platform_backup',
      teacherIds, teacherNames, attPeriodIds));
  }

  var directRefs = [
    { label: 'canonical_module', ref: tenantRef.collection('ModuleData').doc('Attendance__ems_att_periods') },
    { label: 'legacy_config', ref: tenantRef.collection('Attendance_Config').doc('periods') },
    { label: 'foreign_archive', ref: tenantRef.collection('Attendance_Config').doc('periods_foreign_archive') },
    { label: 'tenant_backup_direct', ref: tenantRef.collection('Backup').doc('ems_att_periods') },
    { label: 'root_madrasa_backup', ref: db.collection('Madrasa_Backup').doc('ems_att_periods') }
  ];
  var directCandidates = [];
  for (var d = 0; d < directRefs.length; d++) {
    var candidate = await readDocCandidate(directRefs[d].ref, directRefs[d].label,
      teacherIds, teacherNames, attPeriodIds);
    if (candidate) directCandidates.push(candidate);
  }

  var allCandidates = directCandidates.slice();
  snapshotResults.forEach(function (row) { if (row && row.timetable) allCandidates.push(row.timetable); });
  platformResults.forEach(function (row) { if (row && row.timetable) allCandidates.push(row.timetable); });
  allCandidates.sort(function (a, b) {
    if (a.ownershipProven !== b.ownershipProven) return a.ownershipProven ? -1 : 1;
    if (b.attendancePeriodOverlapCount !== a.attendancePeriodOverlapCount) {
      return b.attendancePeriodOverlapCount - a.attendancePeriodOverlapCount;
    }
    return b.count - a.count;
  });

  var profile = baseline[0].exists ? baseline[0].data() || {} : {};
  var result = {
    ok: true,
    mode: 'read_only',
    createdAt: new Date().toISOString(),
    project: PROJECT,
    target: {
      tenantId: TARGET,
      name: profile.name || profile.madrasaName || profile.instituteName || '',
      teachers: Object.keys(teacherIds).length,
      currentAttendanceDocuments: currentAttendance.length,
      currentAttendancePeriodIds: Object.keys(attPeriodIds).length
    },
    tenantBackupSnapshots: snapshotResults,
    platformBackups: platformResults,
    directCandidates: directCandidates,
    allTimetableCandidates: allCandidates,
    provenCandidates: allCandidates.filter(function (row) { return row.ownershipProven; }),
    safetyNote: 'No Firebase data was created, updated, moved, or deleted.'
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify({
    ok: true,
    written: OUT,
    tenantSnapshots: snapshotResults.length,
    platformBackups: platformResults.length,
    timetableCandidates: allCandidates.length,
    provenCandidates: result.provenCandidates.length,
    bestCandidate: allCandidates.length ? {
      source: allCandidates[0].source,
      path: allCandidates[0].meta && allCandidates[0].meta.documentPath,
      count: allCandidates[0].count,
      teachers: allCandidates[0].uniqueTeacherCount,
      overlap: allCandidates[0].attendancePeriodOverlapCount,
      complete: allCandidates[0].completeMetadataCount,
      ownershipProven: allCandidates[0].ownershipProven
    } : null
  }, null, 2));
}

main().catch(function (error) {
  console.error(JSON.stringify({ ok: false, error: String(error && error.stack || error) }));
  process.exit(1);
});
