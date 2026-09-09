#!/usr/bin/env node
'use strict';

/**
 * READ ONLY — deep Firebase forensic search for Jamia Arabia Owais Qarni.
 *
 * Searches every top-level collection and every direct subcollection of every
 * All_Madrasas tenant for misplaced timetable objects. It also reconstructs
 * period -> teacher/class/weekday evidence from the target tenant's Attendance
 * documents. No Firebase write API is used anywhere in this script.
 */
var fs = require('fs');
var os = require('os');
var path = require('path');
var ROOT = path.resolve(__dirname, '..');
var PROJECT = 'madrasa-mangment-app';
var TARGET = 'bpV58OqWSKhRbvXL57CvihIlDj63';
var OUT_ARG = process.argv.find(function (arg) { return arg.indexOf('--out=') === 0; });
var OUT = OUT_ARG
  ? path.resolve(ROOT, OUT_ARG.slice('--out='.length))
  : path.join(ROOT, 'backups', 'owais-qarnai-firebase-deep-forensic-2026-08-30.json');

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

function personId(row, fallback) {
  return String(row && (row.id || row.regId || row.uid || row.docId) || fallback || '').trim();
}

function personType(row, id) {
  var value = normalize(row && (row.type || row.role || row.userType));
  if (['teacher', 'teachers', 'استاد', 'اساتذہ'].indexOf(value) >= 0 || /^t(ch|cr)[_-]/i.test(id)) return 'teacher';
  if (['student', 'students', 'طالب علم', 'طالب'].indexOf(value) >= 0 || /^std[_-]/i.test(id)) return 'student';
  return 'other';
}

function parseAttendanceDocId(id) {
  if (!id || id.indexOf('att_rec_') !== 0) return null;
  var parts = id.slice('att_rec_'.length).split('_');
  if (parts.length < 4) return null;
  return {
    month: parts[0],
    type: parts[1],
    classId: parts.slice(2, -1).join('_'),
    periodId: parts[parts.length - 1]
  };
}

function present(value) {
  return value != null && String(value).trim() !== '';
}

function ensurePeriod(map, periodId) {
  if (!map[periodId]) {
    map[periodId] = {
      periodId: periodId,
      teacherMarks: Object.create(null),
      teacherDays: Object.create(null),
      studentMarks: 0,
      studentPeople: Object.create(null),
      classes: Object.create(null),
      registerTypes: Object.create(null),
      months: Object.create(null),
      dates: Object.create(null),
      weekdays: Object.create(null),
      sourceDocs: Object.create(null)
    };
  }
  return map[periodId];
}

function dateFromMonthDay(month, day) {
  var dayNumber = parseInt(day, 10);
  if (!/^\d{4}-\d{2}$/.test(month || '') || !dayNumber || dayNumber > 31) return '';
  return month + '-' + String(dayNumber).padStart(2, '0');
}

function weekdayFromDate(date) {
  if (!date) return null;
  var parts = date.split('-').map(Number);
  if (parts.length !== 3) return null;
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay();
}

function addPeriodObservation(periods, roster, parsed, docId, uid, day, periodId, status) {
  if (!/^PRD-/.test(periodId || '')) return;
  var row = ensurePeriod(periods, periodId);
  var date = dateFromMonthDay(parsed && parsed.month, day);
  var weekday = weekdayFromDate(date);
  if (parsed) {
    if (parsed.classId) row.classes[parsed.classId] = true;
    if (parsed.type) row.registerTypes[parsed.type] = true;
    if (parsed.month) row.months[parsed.month] = true;
  }
  if (date) row.dates[date] = true;
  if (weekday != null) row.weekdays[String(weekday)] = true;
  if (docId) row.sourceDocs[docId] = true;
  if (!present(status)) return;
  if (roster.teachers[uid]) {
    row.teacherMarks[uid] = (row.teacherMarks[uid] || 0) + 1;
    if (!row.teacherDays[uid]) row.teacherDays[uid] = Object.create(null);
    if (date) row.teacherDays[uid][date] = true;
  } else if (roster.students[uid]) {
    row.studentMarks += 1;
    row.studentPeople[uid] = true;
    var studentClass = roster.students[uid].className;
    if (studentClass) row.classes[studentClass] = true;
  }
}

function extractPeriodEvidence(attendanceDocs, roster) {
  var periods = Object.create(null);
  attendanceDocs.forEach(function (entry) {
    var parsed = parseAttendanceDocId(entry.id);
    if (!parsed) return;
    var data = entry.data || {};
    if (/^PRD-/.test(parsed.periodId)) {
      Object.keys(data.records || {}).forEach(function (uid) {
        Object.keys(data.records[uid] || {}).forEach(function (day) {
          addPeriodObservation(periods, roster, parsed, entry.id, uid, day, parsed.periodId, data.records[uid][day]);
        });
      });
    }
    var periodMap = data.periodRecords || data.teacherPeriodRecords || {};
    Object.keys(periodMap).forEach(function (uid) {
      Object.keys(periodMap[uid] || {}).forEach(function (day) {
        Object.keys(periodMap[uid][day] || {}).forEach(function (periodId) {
          addPeriodObservation(periods, roster, parsed, entry.id, uid, day, periodId, periodMap[uid][day][periodId]);
        });
      });
    });
  });
  return periods;
}

function safeScalar(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.slice(0, 10);
  if (typeof value === 'object') return '';
  return String(value).slice(0, 240);
}

function timetableObjectSummary(obj, documentPath, fieldPath, target) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  var periodId = String(obj.id || obj.periodId || obj.period || obj.prdId || '').trim();
  var teacherId = String(obj.teacherId || obj.teacherUid || obj.teacher || '').trim();
  var teacherName = String(obj.teacherName || obj.ustadName || obj.teacher_label || '').trim();
  var name = String(obj.name || obj.periodName || obj.title || obj.label || '').trim();
  var className = String(obj.className || obj.classId || obj.grade || obj.class || '').trim();
  var book = String(obj.bookName || obj.book || obj.subject || obj.subjectName || '').trim();
  var start = String(obj.startTime || obj.start || obj.fromTime || '').trim();
  var end = String(obj.endTime || obj.end || obj.toTime || '').trim();
  var days = Array.isArray(obj.days) ? obj.days.slice(0, 10)
    : (Array.isArray(obj.weekdays) ? obj.weekdays.slice(0, 10) : []);
  var targetPeriod = !!target.periodIds[periodId];
  var targetTeacherId = !!target.teacherIds[teacherId];
  var targetTeacherName = !!target.teacherNames[normalize(teacherName)];
  var looksLikePeriod = /^PRD-/.test(periodId)
    || (!!teacherId && !!(name || className || book || start || end || days.length));
  if (!looksLikePeriod || (!targetPeriod && !targetTeacherId && !targetTeacherName)) return null;
  var metadataScore = [teacherId, teacherName, name, className, book, start, end]
    .filter(Boolean).length + (days.length ? 1 : 0);
  return {
    documentPath: documentPath,
    fieldPath: fieldPath,
    periodId: periodId,
    teacherId: teacherId,
    teacherName: teacherName,
    name: name,
    className: className,
    bookName: book,
    startTime: start,
    endTime: end,
    days: days,
    location: safeScalar(obj.location || obj.room || ''),
    metadataScore: metadataScore,
    matchedBy: {
      periodId: targetPeriod,
      teacherId: targetTeacherId,
      teacherName: targetTeacherName
    }
  };
}

function maybeParseJson(value) {
  if (typeof value !== 'string') return value;
  var trimmed = value.trim();
  if (!trimmed || (trimmed[0] !== '[' && trimmed[0] !== '{')) return value;
  if (trimmed.indexOf('PRD-') < 0 && trimmed.indexOf('teacherId') < 0) return value;
  try { return JSON.parse(trimmed); } catch (e) { return value; }
}

function forensicTextReasons(value, target) {
  var text = String(value || '');
  var lower = text.toLowerCase();
  var reasons = [];
  if (text.indexOf('PRD-') >= 0) reasons.push('period_id_text');
  if (lower.indexOf('ems_att_periods') >= 0) reasons.push('canonical_key_text');
  if (lower.indexOf('attendance__ems_att_periods') >= 0) reasons.push('canonical_doc_text');
  if (lower.indexOf('attendance_config') >= 0) reasons.push('legacy_path_text');
  if (lower.indexOf('timetable') >= 0 || text.indexOf('نظام الاوقات') >= 0 || text.indexOf('نظام اوقات') >= 0) {
    reasons.push('timetable_text');
  }
  if (target && target.tenantId && text.indexOf(target.tenantId) >= 0) reasons.push('target_tenant_text');
  return reasons;
}

function addTextHit(state, documentPath, fieldPath, value, reasons) {
  if (!reasons.length || state.textHits.length >= 10000) return;
  var text = String(value || '');
  state.textHits.push({
    documentPath: documentPath,
    fieldPath: fieldPath,
    reasons: reasons,
    length: text.length,
    excerpt: text.replace(/\s+/g, ' ').slice(0, 600)
  });
}

function scanValue(value, documentPath, fieldPath, target, state, depth) {
  if (depth > 12 || state.candidates.length >= 10000) return;
  if (typeof value === 'string') {
    addTextHit(state, documentPath, fieldPath, value, forensicTextReasons(value, target));
  }
  value = maybeParseJson(value);
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach(function (item, index) {
      scanValue(item, documentPath, fieldPath + '[' + index + ']', target, state, depth + 1);
    });
    return;
  }
  var summary = timetableObjectSummary(value, documentPath, fieldPath, target);
  if (summary) state.candidates.push(summary);
  Object.keys(value).forEach(function (key) {
    addTextHit(state, documentPath, fieldPath ? fieldPath + '.' + key : key, key,
      forensicTextReasons(key, target));
    scanValue(value[key], documentPath, fieldPath ? fieldPath + '.' + key : key, target, state, depth + 1);
  });
}

async function scanCollection(collectionRef, target, state, tenantId) {
  var snap = await collectionRef.get();
  state.collectionInventory.push({
    path: collectionRef.path,
    tenantId: tenantId || '',
    documents: snap.size
  });
  snap.forEach(function (doc) {
    state.documentsScanned += 1;
    scanValue(doc.data() || {}, doc.ref.path, '', target, state, 0);
  });
  return snap;
}

async function main() {
  if (!(await setupCliCredentials())) throw new Error('Firebase credentials not found');
  var admin = require(path.join(ROOT, 'functions', 'node_modules', 'firebase-admin'));
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  var db = admin.firestore();
  var targetRef = db.collection('All_Madrasas').doc(TARGET);
  var baseline = await Promise.all([
    targetRef.get(),
    targetRef.collection('Registrations').get(),
    targetRef.collection('Attendance').get()
  ]);
  var profile = baseline[0].exists ? baseline[0].data() || {} : {};
  var roster = { teachers: Object.create(null), students: Object.create(null), others: Object.create(null) };
  var teacherIds = Object.create(null);
  var teacherNames = Object.create(null);
  var allPersonIds = Object.create(null);
  var allPersonNames = Object.create(null);
  baseline[1].forEach(function (doc) {
    var row = doc.data() || {};
    var id = personId(row, doc.id);
    var name = String(row.name || '').trim();
    var kind = personType(row, id);
    var record = {
      id: id,
      name: name,
      className: String(row.className || row.class || row.grade || '').trim()
    };
    roster[kind === 'teacher' ? 'teachers' : (kind === 'student' ? 'students' : 'others')][id] = record;
    allPersonIds[id] = true;
    if (name) allPersonNames[normalize(name)] = true;
    if (kind === 'teacher') {
      teacherIds[id] = true;
      if (name) teacherNames[normalize(name)] = true;
    }
  });
  var attendanceDocs = baseline[2].docs.map(function (doc) { return { id: doc.id, data: doc.data() || {} }; });
  var periodEvidence = extractPeriodEvidence(attendanceDocs, roster);
  var periodIds = Object.create(null);
  Object.keys(periodEvidence).forEach(function (id) { periodIds[id] = true; });
  var target = {
    tenantId: TARGET,
    tenantName: normalize(profile.name || profile.madrasaName || profile.instituteName || 'جامعہ عربیہ اویس قرنی'),
    email: normalize(profile.email || profile.ownerEmail || ''),
    periodIds: periodIds,
    teacherIds: teacherIds,
    teacherNames: teacherNames,
    allPersonIds: allPersonIds,
    allPersonNames: allPersonNames
  };
  var state = {
    documentsScanned: 0,
    collectionInventory: [],
    candidates: [],
    textHits: []
  };

  var rootCollections = await db.listCollections();
  for (var r = 0; r < rootCollections.length; r++) {
    var root = rootCollections[r];
    if (root.id === 'All_Madrasas') continue;
    console.error('[forensic] root ' + (r + 1) + '/' + rootCollections.length + ' · ' + root.id);
    await scanCollection(root, target, state, '');
  }

  console.error('[forensic] loading All_Madrasas tenants');
  var tenants = await db.collection('All_Madrasas').get();
  state.collectionInventory.push({ path: 'All_Madrasas', tenantId: '', documents: tenants.size });
  for (var t = 0; t < tenants.docs.length; t++) {
    var tenantDoc = tenants.docs[t];
    state.documentsScanned += 1;
    scanValue(tenantDoc.data() || {}, tenantDoc.ref.path, '', target, state, 0);
    var subcollections = await tenantDoc.ref.listCollections();
    console.error('[forensic] tenant ' + (t + 1) + '/' + tenants.size + ' · ' + tenantDoc.id + ' · collections=' + subcollections.length);
    for (var c = 0; c < subcollections.length; c++) {
      await scanCollection(subcollections[c], target, state, tenantDoc.id);
    }
  }

  var dedupe = Object.create(null);
  var candidates = state.candidates.filter(function (candidate) {
    var key = [candidate.documentPath, candidate.fieldPath, candidate.periodId, candidate.teacherId].join('|');
    if (dedupe[key]) return false;
    dedupe[key] = true;
    return true;
  });
  candidates.sort(function (a, b) {
    if (b.metadataScore !== a.metadataScore) return b.metadataScore - a.metadataScore;
    return a.documentPath.localeCompare(b.documentPath);
  });

  var evidenceRows = Object.keys(periodEvidence).sort().map(function (periodId) {
    var row = periodEvidence[periodId];
    var teacherRows = Object.keys(row.teacherMarks).map(function (teacherId) {
      var teacher = roster.teachers[teacherId] || {};
      return {
        teacherId: teacherId,
        teacherName: teacher.name || '',
        markCount: row.teacherMarks[teacherId],
        attendanceDates: Object.keys(row.teacherDays[teacherId] || {}).sort()
      };
    }).sort(function (a, b) { return b.markCount - a.markCount; });
    return {
      periodId: periodId,
      teachers: teacherRows,
      teacherConflict: teacherRows.length > 1,
      studentMarkCount: row.studentMarks,
      studentPeopleCount: Object.keys(row.studentPeople).length,
      classes: Object.keys(row.classes).filter(Boolean).sort(),
      registerTypes: Object.keys(row.registerTypes).sort(),
      months: Object.keys(row.months).sort(),
      dates: Object.keys(row.dates).sort(),
      inferredWeekdays: Object.keys(row.weekdays).map(Number).sort(),
      sourceDocuments: Object.keys(row.sourceDocs).sort()
    };
  });
  var teacherCoverage = Object.keys(roster.teachers).sort().map(function (teacherId) {
    var ids = evidenceRows.filter(function (row) {
      return row.teachers.some(function (teacher) { return teacher.teacherId === teacherId; });
    }).map(function (row) { return row.periodId; });
    return {
      teacherId: teacherId,
      teacherName: roster.teachers[teacherId].name,
      periodIds: ids,
      periodCount: ids.length
    };
  });

  var result = {
    ok: true,
    mode: 'read_only',
    createdAt: new Date().toISOString(),
    project: PROJECT,
    targetTenant: {
      tenantId: TARGET,
      name: profile.name || profile.madrasaName || profile.instituteName || '',
      registrations: baseline[1].size,
      teachers: Object.keys(roster.teachers).length,
      students: Object.keys(roster.students).length,
      attendanceDocuments: baseline[2].size,
      attendancePeriodIds: Object.keys(periodIds).length
    },
    scan: {
      rootCollectionCount: rootCollections.length,
      tenantCount: tenants.size,
      collectionCount: state.collectionInventory.length,
      documentsScanned: state.documentsScanned,
      collectionInventory: state.collectionInventory
    },
    misplacedTimetableCandidates: candidates,
    timetableTextHits: state.textHits,
    candidatesWithCompleteMetadata: candidates.filter(function (candidate) {
      return candidate.periodId && candidate.teacherId && candidate.className
        && (candidate.startTime || candidate.endTime) && candidate.days.length;
    }),
    periodEvidenceFromAttendance: evidenceRows,
    teacherPeriodCoverage: teacherCoverage,
    teachersWithoutAnyPeriodEvidence: teacherCoverage.filter(function (row) { return row.periodCount === 0; }),
    safetyNote: 'No Firebase data was created, updated, moved, or deleted.'
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify({
    ok: true,
    written: OUT,
    targetTenant: result.targetTenant,
    scan: {
      rootCollectionCount: result.scan.rootCollectionCount,
      tenantCount: result.scan.tenantCount,
      collectionCount: result.scan.collectionCount,
      documentsScanned: result.scan.documentsScanned
    },
    candidateCount: result.misplacedTimetableCandidates.length,
    completeCandidateCount: result.candidatesWithCompleteMetadata.length,
    timetableTextHitCount: result.timetableTextHits.length,
    attendanceEvidencePeriodCount: result.periodEvidenceFromAttendance.length,
    teachersWithPeriodEvidence: result.teacherPeriodCoverage.filter(function (row) { return row.periodCount > 0; }).length,
    teachersWithoutPeriodEvidence: result.teachersWithoutAnyPeriodEvidence.length
  }, null, 2));
}

main().catch(function (error) {
  console.error(JSON.stringify({ ok: false, error: String(error && error.stack || error) }));
  process.exit(1);
});
