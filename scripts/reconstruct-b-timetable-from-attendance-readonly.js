#!/usr/bin/env node
'use strict';
/**
 * READ-ONLY: Reconstruct Madrasa B timetable evidence from Attendance collection only.
 * Usage: node scripts/reconstruct-b-timetable-from-attendance-readonly.js
 */
var fs = require('fs');
var os = require('os');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var PROJECT = 'madrasa-mangment-app';
var TENANT_B = 'bpV58OqWSKhRbvXL57CvihIlDj63';
var A_CONTAMINATED = ['PRD-35564', 'PRD-17050', 'PRD-54109', 'PRD-23887'];
var OUT_PATH = path.resolve(__dirname, '..', '..', '..', 'b-timetable-reconstruction-report.json');

async function setupCliCreds() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return true;
  var cfgPath = path.join(process.env.APPDATA || '', 'configstore', 'firebase-tools.json');
  if (!fs.existsSync(cfgPath)) {
    cfgPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
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
  if (!docId || docId.indexOf('att_rec_') !== 0) return null;
  var rest = docId.slice('att_rec_'.length);
  var parts = rest.split('_');
  if (parts.length < 4) return null;
  return {
    month: parts[0],
    type: parts[1],
    classId: parts.slice(2, parts.length - 1).join('_'),
    period: parts[parts.length - 1],
    docId: docId
  };
}

function isoDate(month, day) {
  var d = String(day).padStart(2, '0');
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  return month + '-' + d;
}

function addSet(setObj, key) {
  if (key == null || key === '') return;
  setObj[String(key)] = true;
}

function ensureRow(bucket, pid) {
  if (!bucket[pid]) {
    bucket[pid] = {
      periodId: pid,
      classIds: Object.create(null),
      classNames: Object.create(null),
      teacherIds: Object.create(null),
      teacherNames: Object.create(null),
      books: Object.create(null),
      slotNumbers: Object.create(null),
      startTimes: Object.create(null),
      endTimes: Object.create(null),
      dates: Object.create(null),
      registerTypes: Object.create(null),
      months: Object.create(null),
      sourceDocs: Object.create(null),
      docRefCount: 0,
      referenceCount: 0,
      markCount: 0,
      studentUids: Object.create(null),
      evidence: [],
      conflicts: [],
      isAContamination: A_CONTAMINATED.indexOf(pid) >= 0,
      onlyOrphanRef: false
    };
  }
  return bucket[pid];
}

function scanPeriodRecords(data, parsed, bucket, classNameById) {
  if (!data || !data.periodRecords) return;
  var month = parsed ? parsed.month : '';
  var sourceDocId = parsed ? parsed.docId : '';
  Object.keys(data.periodRecords).forEach(function (uid) {
    var days = data.periodRecords[uid];
    if (!days || typeof days !== 'object') return;
    Object.keys(days).forEach(function (day) {
      var pmap = days[day];
      if (!pmap || typeof pmap !== 'object') return;
      Object.keys(pmap).forEach(function (pid) {
        if (!/^PRD-/.test(pid)) return;
        var row = ensureRow(bucket, pid);
        row.referenceCount += 1;
        if (parsed) {
          addSet(row.classIds, parsed.classId);
          addSet(row.registerTypes, parsed.type);
          addSet(row.months, parsed.month);
          addSet(row.sourceDocs, parsed.docId);
          if (parsed.classId) {
            addSet(row.classNames, classNameById[parsed.classId] || parsed.classId);
          }
        }
        var status = pmap[pid];
        if (status == null || status === '') return;
        row.markCount += 1;
        addSet(row.dates, isoDate(month, day));
        addSet(row.studentUids, uid);
        row.evidence.push({
          source: 'periodRecords',
          docId: sourceDocId,
          month: month,
          day: day,
          classId: parsed ? parsed.classId : null,
          type: parsed ? parsed.type : null,
          studentUid: uid,
          status: status
        });
      });
    });
  });
}

function confidenceFor(row) {
  if (row.isAContamination) return 'LOW';
  var classIds = Object.keys(row.classIds);
  var hasClassScope = classIds.length > 0;
  var hasMarks = row.markCount > 0;
  var hasConflict = classIds.length > 1;
  var hasDocPeriodBinding = row.docRefCount > 0;

  if (hasClassScope && hasMarks && !hasConflict && classIds.length === 1) return 'HIGH';
  if (hasClassScope && hasMarks && hasConflict) return 'MEDIUM';
  if (hasDocPeriodBinding && hasMarks) return 'HIGH';
  if (hasDocPeriodBinding && !hasMarks) return 'MEDIUM';
  if (hasClassScope && !hasMarks) return 'MEDIUM';
  if (!hasClassScope && hasMarks) return 'LOW';
  return 'LOW';
}

async function main() {
  if (!(await setupCliCreds())) {
    console.error(JSON.stringify({ ok: false, error: 'no_credentials' }));
    process.exit(2);
  }

  var admin = require(path.join(ROOT, 'functions', 'node_modules', 'firebase-admin'));
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  var db = admin.firestore();

  var attSnap = await db.collection('All_Madrasas').doc(TENANT_B).collection('Attendance').get();
  var regSnap = await db.collection('All_Madrasas').doc(TENANT_B).collection('Registration').get();

  var classNameById = Object.create(null);
  regSnap.forEach(function (doc) {
    var u = doc.data() || {};
    var cid = String(u.classId || u.class || '').trim();
    var cname = String(u.className || u.class || u.grade || '').trim();
    if (cid && cname && !classNameById[cid]) classNameById[cid] = cname;
    if (cname && !classNameById[cname]) classNameById[cname] = cname;
  });

  var bucket = Object.create(null);
  var seenDocs = Object.create(null);

  attSnap.forEach(function (doc) {
    if (seenDocs[doc.id]) return;
    seenDocs[doc.id] = true;
    var parsed = parseDocId(doc.id);
    var data = doc.data() || {};
    var month = parsed ? parsed.month : '';

    if (parsed && /^PRD-/.test(parsed.period)) {
      var pid = parsed.period;
      var row = ensureRow(bucket, pid);
      row.docRefCount += 1;
      addSet(row.classIds, parsed.classId);
      addSet(row.registerTypes, parsed.type);
      addSet(row.months, parsed.month);
      addSet(row.sourceDocs, doc.id);
      if (parsed.classId) {
        addSet(row.classNames, classNameById[parsed.classId] || parsed.classId);
      }
      row.evidence.push({
        source: 'docId',
        docId: doc.id,
        month: parsed.month,
        type: parsed.type,
        classId: parsed.classId,
        period: parsed.period
      });
    }

    scanPeriodRecords(data, parsed, bucket, classNameById);
  });

  Object.keys(bucket).forEach(function (pid) {
    var row = bucket[pid];
    if (Object.keys(row.classIds).length === 0 && row.markCount > 0) row.onlyOrphanRef = true;
    var classIds = Object.keys(row.classIds);
    if (classIds.length > 1) {
      row.conflicts.push({
        field: 'classId',
        values: classIds,
        note: 'Same periodId appears under multiple class scopes in attendance doc IDs'
      });
    }
    if (Object.keys(row.teacherIds).length > 1) {
      row.conflicts.push({ field: 'teacherId', values: Object.keys(row.teacherIds) });
    }
    if (Object.keys(row.teacherNames).length > 1) {
      row.conflicts.push({ field: 'teacherName', values: Object.keys(row.teacherNames) });
    }
    row.confidence = confidenceFor(row);
    row.classId = classIds.length === 1 ? classIds[0] : (classIds.length ? classIds.join(' | ') : null);
    row.className = Object.keys(row.classNames).length === 1
      ? Object.keys(row.classNames)[0]
      : (Object.keys(row.classNames).length ? Object.keys(row.classNames).join(' | ') : null);
    row.teacherId = Object.keys(row.teacherIds).length ? Object.keys(row.teacherIds).join(' | ') : null;
    row.teacherName = Object.keys(row.teacherNames).length ? Object.keys(row.teacherNames).join(' | ') : null;
    row.book = Object.keys(row.books).length ? Object.keys(row.books).join(' | ') : null;
    row.slotNumber = Object.keys(row.slotNumbers).length ? Object.keys(row.slotNumbers).join(' | ') : null;
    row.startTime = Object.keys(row.startTimes).length ? Object.keys(row.startTimes).join(' | ') : null;
    row.endTime = Object.keys(row.endTimes).length ? Object.keys(row.endTimes).join(' | ') : null;
    row.dates = Object.keys(row.dates).sort();
    row.attendanceRecordCount = row.markCount;
    row.periodReferenceCount = row.referenceCount;
    row.registerTypes = Object.keys(row.registerTypes);
    row.monthsSeen = Object.keys(row.months).sort();
    row.sampleDocIds = Object.keys(row.sourceDocs).slice(0, 5);
    delete row.classIds;
    delete row.classNames;
    delete row.teacherIds;
    delete row.teacherNames;
    delete row.books;
    delete row.slotNumbers;
    delete row.startTimes;
    delete row.endTimes;
    delete row.sourceDocs;
    delete row.studentUids;
    delete row.months;
    delete row.onlyOrphanRef;
    if (row.evidence.length > 8) row.evidence = row.evidence.slice(0, 8);
  });

  var all = Object.keys(bucket).sort().map(function (k) { return bucket[k]; });
  var recoverable = all.filter(function (r) { return !r.isAContamination; });
  var high = recoverable.filter(function (r) { return r.confidence === 'HIGH'; });
  var medium = recoverable.filter(function (r) { return r.confidence === 'MEDIUM'; });
  var low = recoverable.filter(function (r) { return r.confidence === 'LOW'; });
  var partial = recoverable.filter(function (r) {
    return !r.teacherId && !r.teacherName && !r.book && !r.startTime && !r.endTime && !r.slotNumber;
  });

  var draft = high.concat(medium).map(function (r) {
    return {
      periodId: r.periodId,
      classId: r.classId,
      className: r.className,
      teacherId: r.teacherId,
      teacherName: r.teacherName,
      book: r.book,
      slotNumber: r.slotNumber,
      startTime: r.startTime,
      endTime: r.endTime,
      confidence: r.confidence,
      conflicts: r.conflicts,
      note: 'REPORT ONLY — metadata gaps must be filled manually before save'
    };
  });

  var report = {
    ok: true,
    tenant: TENANT_B,
    attendanceDocCount: attSnap.size,
    deduplicatedDocCount: Object.keys(seenDocs).length,
    totalUniquePrdIds: all.length,
    recoverableUniquePrdIds: recoverable.length,
    excludedAContamination: all.filter(function (r) { return r.isAContamination; }),
    confidenceSummary: {
      HIGH: high.length,
      MEDIUM: medium.length,
      LOW: low.length
    },
    partialMetadataOnlyCount: partial.length,
    permanentlyMissingFields: [
      'name (period label) — not stored on attendance sheets',
      'start/end time — not stored on attendance sheets',
      'days[] weekday schedule — not stored on attendance sheets',
      'bookName — not stored on attendance sheets',
      'location — not stored on attendance sheets',
      'teacherId/teacherName — not stored on attendance sheets (timetable-only fields)'
    ],
    reconstructionTable: recoverable,
    proposedRecoveredTimetableDraftReportOnly: draft
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({
    ok: true,
    written: OUT_PATH,
    totalUniquePrdIds: report.totalUniquePrdIds,
    recoverable: report.recoverableUniquePrdIds,
    confidenceSummary: report.confidenceSummary,
    partialMetadataOnlyCount: report.partialMetadataOnlyCount
  }, null, 2));
}

main().catch(function (e) {
  console.error(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
  process.exit(1);
});
