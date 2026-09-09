#!/usr/bin/env node
'use strict';

/**
 * Safe, non-destructive timetable restore for Jamia Arabia Owais Qarni.
 *
 * Default: preview only. Pass --apply to write the validated 102-period backup
 * into the tenant's canonical ModuleData document. The source backup is never
 * changed or deleted. Before any write, the exact source and current target
 * documents are written to a local JSON recovery bundle.
 */
var fs = require('fs');
var os = require('os');
var path = require('path');
var ROOT = path.resolve(__dirname, '..');
var PROJECT = 'madrasa-mangment-app';
var TARGET = 'bpV58OqWSKhRbvXL57CvihIlDj63';
var SOURCE_BACKUP_ID = 'auto_1787985335491';
var EXPECTED_PERIODS = 102;

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
  return 'other';
}

function parseList(raw) {
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

function attendancePeriodIds(snap) {
  var ids = Object.create(null);
  snap.forEach(function (doc) {
    var docId = doc.id;
    var suffix = docId.indexOf('att_rec_') === 0 ? docId.split('_').pop() : '';
    if (/^PRD-/.test(suffix)) ids[suffix] = true;
    var data = doc.data() || {};
    [data.periodRecords, data.teacherPeriodRecords].forEach(function (map) {
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

function simpleHash(str) {
  var h = 0;
  for (var i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return String(h);
}

function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value, function (key, item) {
    if (item && typeof item.toDate === 'function') {
      return { _firestoreTimestamp: item.toDate().toISOString() };
    }
    return item;
  }));
}

async function main() {
  var apply = process.argv.indexOf('--apply') >= 0;
  if (!(await setupCliCredentials())) throw new Error('Firebase credentials not found');
  var admin = require(path.join(ROOT, 'functions', 'node_modules', 'firebase-admin'));
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  var db = admin.firestore();
  var tenantRef = db.collection('All_Madrasas').doc(TARGET);
  var sourceRef = tenantRef.collection('BackupSnapshots').doc(SOURCE_BACKUP_ID)
    .collection('modules').doc('ems_att_periods');
  var targetRef = tenantRef.collection('ModuleData').doc('Attendance__ems_att_periods');
  var reads = await Promise.all([
    tenantRef.get(),
    tenantRef.collection('Registrations').get(),
    tenantRef.collection('Attendance').get(),
    sourceRef.get(),
    targetRef.get()
  ]);
  if (!reads[0].exists) throw new Error('Target tenant does not exist');
  if (!reads[3].exists) throw new Error('Validated source backup is missing');

  var rosterById = Object.create(null);
  var idsByName = Object.create(null);
  reads[1].forEach(function (doc) {
    var row = doc.data() || {};
    var id = String(row.id || row.regId || row.uid || doc.id || '').trim();
    if (personType(row, id) !== 'teacher') return;
    var name = String(row.name || row.fullName || '').trim();
    rosterById[id] = { id: id, name: name };
    var nameKey = normalize(name);
    if (!idsByName[nameKey]) idsByName[nameKey] = [];
    idsByName[nameKey].push(id);
  });
  if (Object.keys(rosterById).length !== 47) {
    throw new Error('Safety stop: expected 47 current teachers, found ' + Object.keys(rosterById).length);
  }

  var sourceData = reads[3].data() || {};
  var sourceList = parseList(sourceData);
  if (sourceList.length !== EXPECTED_PERIODS) {
    throw new Error('Safety stop: expected ' + EXPECTED_PERIODS + ' source periods, found ' + sourceList.length);
  }
  var attIds = attendancePeriodIds(reads[2]);
  var remapped = [];
  var unmatched = [];
  var duplicateIds = [];
  var seenIds = Object.create(null);
  var repaired = sourceList.map(function (original, index) {
    var period = Object.assign({}, original || {});
    var periodId = String(period.id || '').trim();
    if (!periodId || seenIds[periodId]) {
      if (periodId && seenIds[periodId]) duplicateIds.push(periodId);
      else unmatched.push({ index: index, reason: 'missing_period_id' });
    }
    if (periodId) seenIds[periodId] = true;
    var teacherId = String(period.teacherId || '').trim();
    if (!rosterById[teacherId]) {
      var nameKey = normalize(period.teacherName || '');
      var nameMatches = idsByName[nameKey] || [];
      if (nameMatches.length === 1) {
        remapped.push({
          periodId: periodId,
          oldTeacherId: teacherId,
          newTeacherId: nameMatches[0],
          teacherName: period.teacherName || ''
        });
        period.teacherId = nameMatches[0];
      } else {
        unmatched.push({
          index: index,
          periodId: periodId,
          teacherId: teacherId,
          teacherName: period.teacherName || '',
          reason: nameMatches.length ? 'teacher_name_not_unique' : 'teacher_not_in_roster'
        });
      }
    }
    if (periodId && !attIds[periodId]) {
      unmatched.push({ index: index, periodId: periodId, reason: 'period_not_found_in_saved_attendance' });
    }
    return period;
  });

  var finalTeacherIds = Object.create(null);
  repaired.forEach(function (period) { finalTeacherIds[String(period.teacherId || '')] = true; });
  delete finalTeacherIds[''];
  var missingRosterTeachers = Object.keys(rosterById).filter(function (id) { return !finalTeacherIds[id]; }).map(function (id) {
    return rosterById[id];
  });
  var invalidTeacherIds = Object.keys(finalTeacherIds).filter(function (id) { return !rosterById[id]; });
  var validation = {
    sourcePeriodCount: sourceList.length,
    restoredPeriodCount: repaired.length,
    currentRosterTeacherCount: Object.keys(rosterById).length,
    timetableTeacherCount: Object.keys(finalTeacherIds).length,
    missingRosterTeachers: missingRosterTeachers,
    remappedTeacherIds: remapped,
    duplicatePeriodIds: duplicateIds,
    invalidTeacherIds: invalidTeacherIds,
    unmatched: unmatched,
    attendancePeriodOverlapCount: repaired.filter(function (period) { return !!attIds[period.id]; }).length,
    emptyDaysMeaningDailyCount: repaired.filter(function (period) { return !Array.isArray(period.days) || period.days.length === 0; }).length
  };
  if (unmatched.length || duplicateIds.length || invalidTeacherIds.length
      || validation.attendancePeriodOverlapCount !== EXPECTED_PERIODS) {
    throw new Error('Safety validation failed: ' + JSON.stringify(validation));
  }

  var targetData = reads[4].exists ? reads[4].data() || {} : null;
  var now = Date.now();
  var backupPath = path.join(ROOT, 'backups',
    'owais-qarnai-timetable-restore-prewrite-' + now + '.json');
  var dataString = JSON.stringify(repaired);
  var recoveryBundle = {
    mode: apply ? 'prewrite_backup_and_apply' : 'preview_only',
    createdAt: new Date(now).toISOString(),
    project: PROJECT,
    tenantId: TARGET,
    sourcePath: sourceRef.path,
    targetPath: targetRef.path,
    sourceDocument: jsonSafe(sourceData),
    targetDocumentBefore: jsonSafe(targetData),
    validation: validation,
    repairedTimetable: repaired,
    safetyNote: 'Source backup is read-only. No source or attendance document is deleted or changed.'
  };
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, JSON.stringify(recoveryBundle, null, 2), 'utf8');

  var result = {
    ok: true,
    mode: apply ? 'applied' : 'preview_only',
    backupPath: backupPath,
    sourcePath: sourceRef.path,
    targetPath: targetRef.path,
    validation: validation
  };
  if (apply) {
    await targetRef.set({
      key: 'ems_att_periods',
      module: 'Attendance',
      data: dataString,
      checksum: simpleHash(dataString),
      schemaVersion: targetData && targetData.schemaVersion || '1.0',
      clientUpdatedAt: now,
      recoverySourcePath: sourceRef.path,
      recoveryPeriodCount: repaired.length,
      recoveryRemappedTeacherCount: remapped.length,
      recoveryAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    var verifySnap = await targetRef.get();
    var verifyData = verifySnap.exists ? verifySnap.data() || {} : {};
    var verifyList = parseList(verifyData);
    var verifyIds = Object.create(null);
    verifyList.forEach(function (period) { if (period && period.id) verifyIds[period.id] = true; });
    var missingAfter = repaired.filter(function (period) { return !verifyIds[period.id]; }).map(function (period) { return period.id; });
    result.verification = {
      exists: verifySnap.exists,
      count: verifyList.length,
      checksumMatches: verifyData.checksum === simpleHash(String(verifyData.data || '')),
      exactPayloadMatches: String(verifyData.data || '') === dataString,
      missingPeriodIds: missingAfter,
      recoverySourcePath: verifyData.recoverySourcePath || null
    };
    if (!result.verification.exists || result.verification.count !== EXPECTED_PERIODS
        || !result.verification.checksumMatches || !result.verification.exactPayloadMatches
        || missingAfter.length) {
      throw new Error('Read-after-write verification failed: ' + JSON.stringify(result.verification));
    }
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch(function (error) {
  console.error(JSON.stringify({ ok: false, error: String(error && error.stack || error) }));
  process.exit(1);
});
