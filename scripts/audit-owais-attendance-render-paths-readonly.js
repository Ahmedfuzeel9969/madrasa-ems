#!/usr/bin/env node
'use strict';

/**
 * READ ONLY — prove the current timetable fingerprint and trace attendance data
 * from Firestore documents to the three attendance readers.
 *
 * This script never calls set(), update(), delete(), batch(), or transaction().
 */
var crypto = require('crypto');
var fs = require('fs');
var os = require('os');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var PROJECT = 'madrasa-mangment-app';
var tenantArg = process.argv.find(function (arg) { return arg.indexOf('--tenant=') === 0; });
var TENANT = tenantArg ? tenantArg.slice('--tenant='.length) : 'bpV58OqWSKhRbvXL57CvihIlDj63';
var OUT = path.join(ROOT, 'backups', 'owais-attendance-render-path-audit-' + Date.now() + '.json');

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

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function parseList(raw) {
  var value = raw;
  for (var i = 0; i < 4; i++) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object' && value.data != null) {
      value = value.data;
      continue;
    }
    if (typeof value !== 'string') return [];
    try { value = JSON.parse(value); } catch (error) { return []; }
  }
  return Array.isArray(value) ? value : [];
}

function idOf(row, fallback) {
  return String(row && (row.id || row.regId || row.uid || row.docId) || fallback || '').trim();
}

function nameOf(row) {
  return String(row && (row.name || row.fullName || row.teacherName) || '').trim();
}

function roleOf(row, id) {
  var role = String(row && (row.type || row.role || row.userType) || '').trim().toLowerCase();
  if (['teacher', 'teachers', 'استاد', 'اساتذہ'].indexOf(role) >= 0 || /^t(ch|cr)[_-]/i.test(id)) return 'teacher';
  if (['student', 'students', 'طالب علم', 'طالب'].indexOf(role) >= 0 || /^std[_-]/i.test(id)) return 'student';
  if (['staff', 'عملہ'].indexOf(role) >= 0) return 'staff';
  return 'other';
}

function isActive(row) {
  var status = String(row && row.status || '').trim().toLowerCase();
  return ['pending', 'rejected', 'suspended', 'withdrawn', 'inactive', 'deleted', 'withdrawn/transferred'].indexOf(status) < 0;
}

function meaningful(value) {
  return value != null && String(value).trim() !== '';
}

function jsonValue(value) {
  try { return JSON.stringify(value); } catch (error) { return String(value); }
}

function getNested(data, parts) {
  var cursor = data;
  for (var i = 0; i < parts.length; i++) {
    if (!cursor || typeof cursor !== 'object' || !Object.prototype.hasOwnProperty.call(cursor, parts[i])) {
      return { exists: false, value: undefined };
    }
    cursor = cursor[parts[i]];
  }
  return { exists: true, value: cursor };
}

function parseIdentity(docId) {
  var match = String(docId || '').match(/^att_rec_(\d{4}-\d{2})_(.+)$/);
  if (!match) return null;
  var month = match[1];
  var tail = match[2];
  var first = tail.indexOf('_');
  if (first < 0) return { month: month, type: tail, classId: '', period: 'all' };
  var type = tail.slice(0, first);
  var rest = tail.slice(first + 1);
  var last = rest.lastIndexOf('_');
  if (last < 0) return { month: month, type: type, classId: rest, period: 'all' };
  return {
    month: month,
    type: type,
    classId: rest.slice(0, last),
    period: rest.slice(last + 1) || 'all'
  };
}

function countDaily(map, visitor) {
  var count = 0;
  Object.keys(map || {}).forEach(function (uid) {
    Object.keys(map[uid] || {}).forEach(function (day) {
      var value = map[uid][day];
      if (!meaningful(value)) return;
      count += 1;
      if (visitor) visitor(String(uid), String(day), value);
    });
  });
  return count;
}

function countPeriods(map, visitor) {
  var count = 0;
  Object.keys(map || {}).forEach(function (uid) {
    Object.keys(map[uid] || {}).forEach(function (day) {
      Object.keys(map[uid][day] || {}).forEach(function (periodId) {
        var value = map[uid][day][periodId];
        if (!meaningful(value)) return;
        count += 1;
        if (visitor) visitor(String(uid), String(day), String(periodId), value);
      });
    });
  });
  return count;
}

function dateWeekday(month, day) {
  var dayText = String(day).padStart(2, '0');
  return new Date(month + '-' + dayText + 'T12:00:00+05:00').getUTCDay();
}

var DAY_NAMES = {
  sunday: 0, sun: 0, 'اتوار': 0,
  monday: 1, mon: 1, 'پیر': 1,
  tuesday: 2, tue: 2, 'منگل': 2,
  wednesday: 3, wed: 3, 'بدھ': 3,
  thursday: 4, thu: 4, 'جمعرات': 4,
  friday: 5, fri: 5, 'جمعہ': 5,
  saturday: 6, sat: 6, 'ہفتہ': 6
};

function normalizeScheduleDay(value) {
  if (typeof value === 'number' && isFinite(value)) {
    if (value >= 0 && value <= 6) return value;
    if (value === 7) return 0;
    return null;
  }
  var text = String(value == null ? '' : value).trim().toLowerCase();
  if (!text) return null;
  if (Object.prototype.hasOwnProperty.call(DAY_NAMES, text)) return DAY_NAMES[text];
  if (/^\d+$/.test(text)) {
    var number = Number(text);
    if (number >= 0 && number <= 6) return number;
    if (number === 7) return 0;
  }
  return null;
}

function periodWeekdays(period) {
  var raw = Array.isArray(period.days) ? period.days : [];
  if (!raw.length) return { daily: true, days: [0, 1, 2, 3, 4, 5, 6], invalid: [] };
  var days = [];
  var invalid = [];
  raw.forEach(function (item) {
    var normalized = normalizeScheduleDay(item);
    if (normalized == null) invalid.push(item);
    else if (days.indexOf(normalized) < 0) days.push(normalized);
  });
  return { daily: false, days: days.sort(), invalid: invalid };
}

function dottedFieldAudit(data) {
  var prefixes = ['records.', 'periodRecords.', 'teacherPeriodRecords.', 'remarks.', 'late.', 'dailyLocks.'];
  var rows = [];
  Object.keys(data || {}).forEach(function (key) {
    var prefix = prefixes.find(function (candidate) { return key.indexOf(candidate) === 0; });
    if (!prefix) return;
    var nested = getNested(data, key.split('.'));
    var status = !nested.exists ? 'missing_nested' : (jsonValue(nested.value) === jsonValue(data[key]) ? 'same' : 'conflict');
    rows.push({ key: key, value: data[key], nestedStatus: status, nestedValue: nested.value });
  });
  return {
    count: rows.length,
    same: rows.filter(function (row) { return row.nestedStatus === 'same'; }).length,
    missingNested: rows.filter(function (row) { return row.nestedStatus === 'missing_nested'; }).length,
    conflicts: rows.filter(function (row) { return row.nestedStatus === 'conflict'; }).length,
    fields: rows
  };
}

function addDateCoverage(bucket, month, day, channel, docId) {
  if (!/^\d{1,2}$/.test(String(day))) return;
  var key = month + '-' + String(day).padStart(2, '0');
  if (!bucket[key]) bucket[key] = { dailyCells: 0, hourlyCells: 0, documents: Object.create(null) };
  if (channel === 'daily') bucket[key].dailyCells += 1;
  else bucket[key].hourlyCells += 1;
  bucket[key].documents[docId] = true;
}

async function main() {
  if (!(await setupCliCredentials())) throw new Error('Firebase CLI credentials not found');
  var admin = require(path.join(ROOT, 'functions', 'node_modules', 'firebase-admin'));
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  var db = admin.firestore();
  var tenantRef = db.collection('All_Madrasas').doc(TENANT);
  var timetableRef = tenantRef.collection('ModuleData').doc('Attendance__ems_att_periods');
  var reads = await Promise.all([
    tenantRef.get(),
    tenantRef.collection('Registrations').get(),
    tenantRef.collection('Attendance').get(),
    timetableRef.get()
  ]);
  if (!reads[0].exists) throw new Error('Target tenant does not exist');
  if (!reads[3].exists) throw new Error('Canonical timetable does not exist');

  var profile = reads[0].data() || {};
  var timetableDoc = reads[3].data() || {};
  var timetablePayload = String(timetableDoc.data || '');
  var periods = parseList(timetableDoc);
  var roster = Object.create(null);
  var rosterDocMismatches = [];
  var roleCounts = { teacher: 0, student: 0, staff: 0, other: 0 };
  reads[1].forEach(function (doc) {
    var row = doc.data() || {};
    if (!isActive(row)) return;
    var id = idOf(row, doc.id);
    var role = roleOf(row, id);
    roleCounts[role] = (roleCounts[role] || 0) + 1;
    roster[id] = { id: id, docId: doc.id, name: nameOf(row), role: role, className: row.className || row.class || row.grade || '' };
    if (String(doc.id) !== id) rosterDocMismatches.push({ id: id, docId: doc.id, role: role, name: nameOf(row) });
  });

  var teacherPeriods = Object.create(null);
  var periodById = Object.create(null);
  var invalidPeriodDays = [];
  var invalidPeriodTeachers = [];
  periods.forEach(function (period) {
    period = period || {};
    var periodId = String(period.id || period.periodId || '').trim();
    var teacherId = String(period.teacherId || period.teacherUid || '').trim();
    var weekdayInfo = periodWeekdays(period);
    if (periodId) periodById[periodId] = period;
    if (!teacherPeriods[teacherId]) teacherPeriods[teacherId] = [];
    teacherPeriods[teacherId].push({
      id: periodId,
      teacherId: teacherId,
      teacherName: String(period.teacherName || '').trim(),
      className: String(period.className || period.class || '').trim(),
      start: String(period.start || '').trim(),
      end: String(period.end || '').trim(),
      rawDays: Array.isArray(period.days) ? period.days : [],
      weekdays: weekdayInfo.days,
      daily: weekdayInfo.daily,
      invalidDays: weekdayInfo.invalid
    });
    if (weekdayInfo.invalid.length) invalidPeriodDays.push({ periodId: periodId, teacherId: teacherId, invalidDays: weekdayInfo.invalid });
    if (!teacherId || !roster[teacherId] || roster[teacherId].role !== 'teacher') {
      invalidPeriodTeachers.push({ periodId: periodId, teacherId: teacherId, teacherName: period.teacherName || '' });
    }
  });

  var attendanceDocs = [];
  var dateCoverage = Object.create(null);
  var savedPeriodsByTeacher = Object.create(null);
  var dottedTotals = { count: 0, same: 0, missingNested: 0, conflicts: 0, documents: 0 };
  reads[2].forEach(function (doc) {
    var data = doc.data() || {};
    var identity = parseIdentity(doc.id);
    var dotted = dottedFieldAudit(data);
    if (dotted.count) dottedTotals.documents += 1;
    dottedTotals.count += dotted.count;
    dottedTotals.same += dotted.same;
    dottedTotals.missingNested += dotted.missingNested;
    dottedTotals.conflicts += dotted.conflicts;
    var dailyCells = 0;
    var hourlyCells = 0;
    if (identity) {
      if (identity.period === 'all') {
        dailyCells += countDaily(data.records, function (uid, day) {
          addDateCoverage(dateCoverage, identity.month, day, 'daily', doc.id);
        });
      } else {
        hourlyCells += countDaily(data.records, function (uid, day, value) {
          addDateCoverage(dateCoverage, identity.month, day, 'hourly', doc.id);
          if (!savedPeriodsByTeacher[uid]) savedPeriodsByTeacher[uid] = [];
          savedPeriodsByTeacher[uid].push({ month: identity.month, day: day, periodId: identity.period, value: value, docId: doc.id, source: 'legacy_records' });
        });
      }
      hourlyCells += countPeriods(data.periodRecords || data.teacherPeriodRecords, function (uid, day, periodId, value) {
        addDateCoverage(dateCoverage, identity.month, day, 'hourly', doc.id);
        if (!savedPeriodsByTeacher[uid]) savedPeriodsByTeacher[uid] = [];
        savedPeriodsByTeacher[uid].push({ month: identity.month, day: day, periodId: periodId, value: value, docId: doc.id, source: 'periodRecords' });
      });
    }
    attendanceDocs.push({
      id: doc.id,
      identity: identity,
      timestamp: data.timestamp || null,
      updatedAt: data.updatedAt || null,
      dailyCells: dailyCells,
      hourlyCells: hourlyCells,
      topLevelKeys: Object.keys(data).sort(),
      dottedFields: dotted
    });
  });

  var teacherAudit = Object.keys(roster).filter(function (id) { return roster[id].role === 'teacher'; }).sort().map(function (id) {
    var list = teacherPeriods[id] || [];
    var byWeekday = [0, 1, 2, 3, 4, 5, 6].map(function (weekday) {
      return list.filter(function (period) { return period.weekdays.indexOf(weekday) >= 0; }).length;
    });
    var saved = savedPeriodsByTeacher[id] || [];
    var savedUnknownPeriods = saved.filter(function (entry) { return !periodById[entry.periodId]; });
    var savedDayScheduleMismatches = saved.filter(function (entry) {
      var period = periodById[entry.periodId];
      if (!period || String(period.teacherId || period.teacherUid || '').trim() !== id) return false;
      var weekdays = periodWeekdays(period).days;
      return weekdays.indexOf(dateWeekday(entry.month, entry.day)) < 0;
    });
    return {
      id: id,
      name: roster[id].name,
      registrationDocId: roster[id].docId,
      periodCount: list.length,
      periodsByWeekdaySundayToSaturday: byWeekday,
      schedulePeriods: list,
      savedHourlyCells: saved.length,
      savedUnknownPeriodCount: savedUnknownPeriods.length,
      savedUnknownPeriods: savedUnknownPeriods.slice(0, 100),
      savedDayScheduleMismatchCount: savedDayScheduleMismatches.length,
      savedDayScheduleMismatches: savedDayScheduleMismatches.slice(0, 100)
    };
  });

  var coverageList = Object.keys(dateCoverage).sort().map(function (date) {
    return {
      date: date,
      dailyCells: dateCoverage[date].dailyCells,
      hourlyCells: dateCoverage[date].hourlyCells,
      documentCount: Object.keys(dateCoverage[date].documents).length,
      documents: Object.keys(dateCoverage[date].documents).sort()
    };
  });
  var timetableTeacherIds = Object.keys(teacherPeriods).filter(Boolean);
  var report = {
    ok: true,
    mode: 'read_only',
    createdAt: new Date().toISOString(),
    project: PROJECT,
    tenantId: TENANT,
    tenantName: profile.name || profile.madrasaName || profile.instituteName || '',
    paths: {
      timetable: timetableRef.path,
      attendance: tenantRef.path + '/Attendance',
      registrations: tenantRef.path + '/Registrations'
    },
    timetableProtectionSnapshot: {
      exists: reads[3].exists,
      periodCount: periods.length,
      uniquePeriodCount: Object.keys(periodById).length,
      teacherCount: timetableTeacherIds.length,
      payloadSha256: sha256(timetablePayload),
      storedChecksum: timetableDoc.checksum || null,
      clientUpdatedAt: timetableDoc.clientUpdatedAt || null,
      recoverySourcePath: timetableDoc.recoverySourcePath || null,
      periods: periods
    },
    registrations: {
      documentCount: reads[1].size,
      activeRoleCounts: roleCounts,
      rowIdDifferentFromDocumentId: rosterDocMismatches
    },
    timetableReaderAudit: {
      invalidDayValueCount: invalidPeriodDays.length,
      invalidDayValues: invalidPeriodDays,
      invalidTeacherBindingCount: invalidPeriodTeachers.length,
      invalidTeacherBindings: invalidPeriodTeachers,
      registeredTeachersWithoutAnyPeriod: teacherAudit.filter(function (row) { return row.periodCount === 0; }).map(function (row) { return { id: row.id, name: row.name }; }),
      teachers: teacherAudit
    },
    attendanceFirestoreAudit: {
      documentCount: reads[2].size,
      registerDocumentCount: attendanceDocs.filter(function (row) { return !!row.identity; }).length,
      otherDocumentCount: attendanceDocs.filter(function (row) { return !row.identity; }).length,
      dottedTopLevelTotals: dottedTotals,
      dateCoverage: coverageList,
      documents: attendanceDocs
    },
    readerPaths: {
      markingWrite: 'All_Madrasas/{tenantId}/Attendance/att_rec_{YYYY-MM}_{type}_{classId}_{period}',
      canonicalTeachers: 'All_Madrasas/{tenantId}/Attendance/att_rec_{YYYY-MM}_teachers__all',
      canonicalStudents: 'All_Madrasas/{tenantId}/Attendance/att_rec_{YYYY-MM}_students_{classId}_all',
      cloudButton: 'All_Madrasas/{activeTenantId}/Attendance where document id starts att_rec_',
      smartRegister: 'one canonical month/type/class document after tenant-scoped cache reconciliation',
      collectiveRegister: 'same canonical document; teacher hours come from current ems_att_periods by exact teacherId + selected weekday',
      dashboard: 'all att_rec documents for selected month, aggregated across records and periodRecords'
    }
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({
    ok: true,
    mode: report.mode,
    output: OUT,
    tenantId: TENANT,
    timetable: report.timetableProtectionSnapshot,
    activeRoleCounts: roleCounts,
    rosterIdMismatches: rosterDocMismatches.length,
    invalidDayValues: invalidPeriodDays.length,
    invalidTeacherBindings: invalidPeriodTeachers.length,
    teachersWithoutPeriods: report.timetableReaderAudit.registeredTeachersWithoutAnyPeriod,
    attendanceDocuments: reads[2].size,
    coveredDates: coverageList.length,
    dottedTopLevelTotals: dottedTotals
  }, null, 2));
}

main().catch(function (error) {
  console.error(JSON.stringify({ ok: false, error: String(error && error.stack || error) }));
  process.exit(1);
});
