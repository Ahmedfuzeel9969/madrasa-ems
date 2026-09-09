#!/usr/bin/env node
'use strict';
/**
 * READ-ONLY: Extract unique PRD period references from Madrasa B Attendance collection.
 * Usage: node scripts/analyze-b-attendance-periods-readonly.js
 */
var fs = require('fs');
var os = require('os');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var PROJECT = 'madrasa-mangment-app';
var TENANT_B = 'bpV58OqWSKhRbvXL57CvihIlDj63';
var A_CONTAMINATED = ['PRD-35564', 'PRD-17050', 'PRD-54109', 'PRD-23887'];

async function setupCliCreds() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return true;
  var cfgPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
  if (!fs.existsSync(cfgPath)) {
    cfgPath = path.join(process.env.APPDATA || '', 'configstore', 'firebase-tools.json');
  }
  if (!fs.existsSync(cfgPath)) return false;
  var cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  var defaultCreds = require(path.join(ROOT, 'node_modules/firebase-tools/lib/defaultCredentials'));
  var credPath = await defaultCreds.getCredentialPathAsync({ user: cfg.user, tokens: cfg.tokens });
  if (!credPath) return false;
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credPath;
  process.env.GCLOUD_PROJECT = PROJECT;
  return true;
}

function parseDocId(docId) {
  // att_rec_{month}_{type}_{classId}_{period}
  if (!docId || docId.indexOf('att_rec_') !== 0) return null;
  var rest = docId.slice('att_rec_'.length);
  var parts = rest.split('_');
  if (parts.length < 4) return null;
  var month = parts[0];
  var type = parts[1];
  var period = parts[parts.length - 1];
  var classId = parts.slice(2, parts.length - 1).join('_');
  return { month: month, type: type, classId: classId, period: period, docId: docId };
}

function collectPeriodIdsFromData(data, out) {
  if (!data || typeof data !== 'object') return;
  if (data.periodRecords && typeof data.periodRecords === 'object') {
    Object.keys(data.periodRecords).forEach(function (uid) {
      var days = data.periodRecords[uid];
      if (!days || typeof days !== 'object') return;
      Object.keys(days).forEach(function (day) {
        var pmap = days[day];
        if (!pmap || typeof pmap !== 'object') return;
        Object.keys(pmap).forEach(function (pid) {
          if (/^PRD-/.test(pid)) out.add(pid);
        });
      });
    });
  }
  if (data.teacherPeriodRecords && typeof data.teacherPeriodRecords === 'object') {
    Object.keys(data.teacherPeriodRecords).forEach(function (uid) {
      var days = data.teacherPeriodRecords[uid];
      if (!days || typeof days !== 'object') return;
      Object.keys(days).forEach(function (day) {
        var pmap = days[day];
        if (!pmap || typeof pmap !== 'object') return;
        Object.keys(pmap).forEach(function (pid) {
          if (/^PRD-/.test(pid)) out.add(pid);
        });
      });
    });
  }
}

async function main() {
  if (!(await setupCliCreds())) {
    console.error(JSON.stringify({ ok: false, error: 'no_credentials' }));
    process.exit(2);
  }
  var admin = require(path.join(ROOT, 'functions', 'node_modules', 'firebase-admin'));
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  var db = admin.firestore();
  var attRef = db.collection('All_Madrasas').doc(TENANT_B).collection('Attendance');

  var periodMeta = Object.create(null);
  var docIdRefs = Object.create(null);
  var allPrd = new Set();
  var docCount = 0;

  var snap = await attRef.get();
  snap.forEach(function (doc) {
    docCount += 1;
    var parsed = parseDocId(doc.id);
    var data = doc.data() || {};
    var bodyPrd = new Set();
    collectPeriodIdsFromData(data, bodyPrd);
    bodyPrd.forEach(function (pid) { allPrd.add(pid); });

    if (parsed && /^PRD-/.test(parsed.period)) {
      allPrd.add(parsed.period);
      if (!docIdRefs[parsed.period]) docIdRefs[parsed.period] = [];
      docIdRefs[parsed.period].push({
        docId: doc.id,
        month: parsed.month,
        type: parsed.type,
        classId: parsed.classId,
        period: parsed.period
      });
      if (!periodMeta[parsed.period]) {
        periodMeta[parsed.period] = {
          periodId: parsed.period,
          classIds: new Set(),
          classNames: new Set(),
          types: new Set(),
          months: new Set(),
          docCount: 0
        };
      }
      var m = periodMeta[parsed.period];
      m.docCount += 1;
      if (parsed.classId) m.classIds.add(parsed.classId);
      if (data.className) m.classNames.add(String(data.className));
      if (data.classId) m.classIds.add(String(data.classId));
      if (parsed.type) m.types.add(parsed.type);
      if (parsed.month) m.months.add(parsed.month);
      if (data.teacherId) m.teacherId = data.teacherId;
      if (data.teacherName) m.teacherName = data.teacherName;
    }
  });

  // Load B registration for class/teacher name resolution
  var regSnap = await db.collection('All_Madrasas').doc(TENANT_B).collection('Registration').get();
  var classMap = Object.create(null);
  var teacherMap = Object.create(null);
  regSnap.forEach(function (doc) {
    var u = doc.data() || {};
    var id = u.id || doc.id;
    if (u.classId) classMap[u.classId] = u.className || u.class || classMap[u.classId] || '';
    if (u.class) classMap[u.class] = u.className || u.class;
    if (u.type === 'teacher' || u.role === 'teacher' || u.userType === 'teacher') {
      teacherMap[id] = u.name || '';
    }
    if (u.name && (u.type === 'teacher' || u.role === 'teacher')) teacherMap[id] = u.name;
  });

  // Load canonical + archive + legacy for comparison (read-only)
  var canonSnap = await db.collection('All_Madrasas').doc(TENANT_B)
    .collection('ModuleData').doc('Attendance__ems_att_periods').get();
  var archiveSnap = await db.collection('All_Madrasas').doc(TENANT_B)
    .collection('Attendance_Config').doc('periods_foreign_archive').get();
  var legacySnap = await db.collection('All_Madrasas').doc(TENANT_B)
    .collection('Attendance_Config').doc('periods').get();

  function parseCanon(data) {
    if (!data) return [];
    try {
      var raw = data.data != null ? data.data : data.list;
      var parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return Array.isArray(parsed) ? parsed : (Array.isArray(data.list) ? data.list : []);
    } catch (e) { return []; }
  }

  var canonPeriods = canonSnap.exists ? parseCanon(canonSnap.data()) : [];
  var archivePeriods = archiveSnap.exists ? parseCanon(archiveSnap.data()) : [];
  var legacyPeriods = legacySnap.exists ? parseCanon(legacySnap.data()) : [];
  var canonIds = new Set(canonPeriods.map(function (p) { return p && p.id; }).filter(Boolean));
  var archiveIds = new Set(archivePeriods.map(function (p) { return p && p.id; }).filter(Boolean));

  var uniqueSorted = Array.from(allPrd).sort();
  var recoverable = uniqueSorted.filter(function (id) {
    return A_CONTAMINATED.indexOf(id) < 0;
  });

  var report = {
    ok: true,
    tenant: TENANT_B,
    attendanceDocCount: docCount,
    uniquePrdCount: uniqueSorted.length,
    recoverablePrdCount: recoverable.length,
    aContaminatedInRefs: uniqueSorted.filter(function (id) { return A_CONTAMINATED.indexOf(id) >= 0; }),
    cloudTimetable: {
      canonicalCount: canonPeriods.length,
      canonicalIds: canonPeriods.map(function (p) { return p.id; }),
      archiveCount: archivePeriods.length,
      archiveIds: archivePeriods.map(function (p) { return p.id; }),
      legacyExists: legacySnap.exists,
      legacyCount: legacyPeriods.length
    },
    periods: recoverable.map(function (pid) {
      var m = periodMeta[pid] || { periodId: pid, classIds: new Set(), classNames: new Set(), types: new Set(), months: new Set(), docCount: 0 };
      var classIds = Array.from(m.classIds || []);
      var classNames = Array.from(m.classNames || []);
      classIds.forEach(function (cid) {
        if (classMap[cid] && classNames.indexOf(classMap[cid]) < 0) classNames.push(classMap[cid]);
      });
      return {
        periodId: pid,
        inCanonicalTimetable: canonIds.has(pid),
        inArchive: archiveIds.has(pid),
        docRefCount: (docIdRefs[pid] || []).length,
        classIds: classIds,
        classNames: classNames,
        teacherId: m.teacherId || null,
        teacherName: m.teacherName || null,
        registerTypes: Array.from(m.types || []),
        monthsSeen: Array.from(m.months || []).sort(),
        sampleDocIds: (docIdRefs[pid] || []).slice(0, 3).map(function (r) { return r.docId; }),
        hasTimeSlot: false,
        hasPeriodName: false,
        hasBookLocation: false,
        hasDaysOfWeek: false
      };
    }),
    missingMetadata: [
      'name (period label)',
      'start/end time',
      'days[] (weekday schedule)',
      'bookName',
      'location',
      'teacherId/teacherName (unless present on attendance sheet doc body — usually absent)',
      'archived flag / archivedAt'
    ],
    note: 'Attendance doc IDs encode month+type+classId+periodId; body periodRecords give usage but not timetable definition fields.'
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch(function (e) {
  console.error(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
  process.exit(1);
});
