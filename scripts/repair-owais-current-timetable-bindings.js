#!/usr/bin/env node
'use strict';

/**
 * Narrow, non-destructive repair for the current Owais Qarni timetable.
 *
 * Default: preview only. Pass --apply to change only the two proven stale
 * teacherId fields in the current 103-period canonical document. The full
 * before/after payload is saved locally before the transaction. Attendance,
 * registrations, period ids, period order, days, books and times are untouched.
 */
var crypto = require('crypto');
var fs = require('fs');
var os = require('os');
var path = require('path');
var ROOT = path.resolve(__dirname, '..');
var PROJECT = 'madrasa-mangment-app';
var TARGET = 'bpV58OqWSKhRbvXL57CvihIlDj63';
var EXPECTED_PERIODS = 103;
var EXPECTED_TEACHERS = 47;
var EXPECTED_REPAIRS = {
  'PRD-22911': { from: 'CTCH-32054', to: 'TCH-69' },
  'PRD-25421': { from: 'CTCH-61910', to: 'TCH-69' }
};

async function setupCliCredentials() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return true;
  var candidates = [
    path.join(process.env.APPDATA || '', 'configstore', 'firebase-tools.json'),
    path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json')
  ];
  var configPath = candidates.find(function (candidate) {
    return candidate && fs.existsSync(candidate);
  });
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

function isTeacher(row, id) {
  var type = normalize(row && (row.type || row.role || row.userType));
  return ['teacher', 'teachers', 'استاد', 'اساتذہ'].indexOf(type) >= 0
    || /^T(CH|CR)-/i.test(String(id || ''));
}

function parseList(data) {
  var value = data && data.data != null ? data.data : data;
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

function simpleHash(str) {
  var h = 0;
  for (var i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return String(h);
}

function sha256(str) {
  return crypto.createHash('sha256').update(String(str || ''), 'utf8').digest('hex');
}

function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value, function (key, item) {
    if (item && typeof item.toDate === 'function') {
      return { _firestoreTimestamp: item.toDate().toISOString() };
    }
    return item;
  }));
}

function collectAttendancePeriodIds(snapshot) {
  var ids = Object.create(null);
  snapshot.forEach(function (doc) {
    var suffix = doc.id.indexOf('att_rec_') === 0 ? doc.id.split('_').pop() : '';
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

async function main() {
  var apply = process.argv.indexOf('--apply') >= 0;
  if (!(await setupCliCredentials())) throw new Error('Firebase credentials not found');
  var admin = require(path.join(ROOT, 'functions', 'node_modules', 'firebase-admin'));
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  var db = admin.firestore();
  var tenantRef = db.collection('All_Madrasas').doc(TARGET);
  var targetRef = tenantRef.collection('ModuleData').doc('Attendance__ems_att_periods');
  var reads = await Promise.all([
    tenantRef.get(),
    tenantRef.collection('Registrations').get(),
    tenantRef.collection('Attendance').get(),
    targetRef.get()
  ]);
  if (!reads[0].exists) throw new Error('Safety stop: target tenant does not exist');
  var profile = reads[0].data() || {};
  var tenantName = profile.name || profile.madrasaName || profile.instituteName || '';
  if (normalize(tenantName).indexOf(normalize('اویس قرنی')) < 0) {
    throw new Error('Safety stop: target profile is not Jamia Arabia Owais Qarni');
  }
  if (!reads[3].exists) throw new Error('Safety stop: canonical timetable is missing');

  var teachersById = Object.create(null);
  var teacherIdsByName = Object.create(null);
  reads[1].forEach(function (doc) {
    var row = doc.data() || {};
    var id = String(row.id || row.regId || row.uid || doc.id || '').trim();
    if (!isTeacher(row, id)) return;
    var name = String(row.name || row.fullName || '').trim();
    teachersById[id] = { id: id, name: name, documentId: doc.id };
    var key = normalize(name);
    if (!teacherIdsByName[key]) teacherIdsByName[key] = [];
    teacherIdsByName[key].push(id);
  });
  if (Object.keys(teachersById).length !== EXPECTED_TEACHERS) {
    throw new Error('Safety stop: expected 47 teachers, found ' + Object.keys(teachersById).length);
  }

  var targetData = reads[3].data() || {};
  var beforePayload = String(targetData.data || '');
  var before = parseList(targetData);
  if (before.length !== EXPECTED_PERIODS) {
    throw new Error('Safety stop: expected 103 current periods, found ' + before.length);
  }
  var seenPeriodIds = Object.create(null);
  var duplicatePeriodIds = [];
  var validBindings = 0;
  var repairs = [];
  var unresolved = [];
  var after = before.map(function (source, index) {
    var period = Object.assign({}, source || {});
    var periodId = String(period.id || '').trim();
    if (!periodId || seenPeriodIds[periodId]) duplicatePeriodIds.push(periodId || '(missing)');
    if (periodId) seenPeriodIds[periodId] = true;
    var teacherId = String(period.teacherId || '').trim();
    if (teachersById[teacherId]) {
      validBindings++;
      return period;
    }
    var nameMatches = teacherIdsByName[normalize(period.teacherName || '')] || [];
    if (nameMatches.length === 1) {
      repairs.push({
        index: index,
        periodId: periodId,
        teacherName: period.teacherName || '',
        from: teacherId,
        to: nameMatches[0]
      });
      period.teacherId = nameMatches[0];
      return period;
    }
    unresolved.push({
      index: index,
      periodId: periodId,
      teacherId: teacherId,
      teacherName: period.teacherName || '',
      nameMatches: nameMatches
    });
    return period;
  });

  var repairByPeriod = Object.create(null);
  repairs.forEach(function (repair) { repairByPeriod[repair.periodId] = repair; });
  var expectedIds = Object.keys(EXPECTED_REPAIRS).sort();
  var actualIds = Object.keys(repairByPeriod).sort();
  var exactExpectedRepairs = JSON.stringify(actualIds) === JSON.stringify(expectedIds)
    && expectedIds.every(function (periodId) {
      var expected = EXPECTED_REPAIRS[periodId];
      var actual = repairByPeriod[periodId];
      return actual && actual.from === expected.from && actual.to === expected.to;
    });
  var attendancePeriodIds = collectAttendancePeriodIds(reads[2]);
  var attendanceOverlap = before.filter(function (period) {
    return period && attendancePeriodIds[period.id];
  }).length;
  var validation = {
    tenantId: TARGET,
    tenantName: tenantName,
    registeredTeacherCount: Object.keys(teachersById).length,
    periodCount: before.length,
    uniquePeriodCount: Object.keys(seenPeriodIds).length,
    validTeacherBindingCountBefore: validBindings,
    repairCount: repairs.length,
    repairs: repairs,
    unresolved: unresolved,
    duplicatePeriodIds: duplicatePeriodIds,
    attendanceDocumentCount: reads[2].size,
    attendancePeriodOverlapCount: attendanceOverlap,
    beforeSha256: sha256(beforePayload),
    exactExpectedRepairs: exactExpectedRepairs
  };
  if (duplicatePeriodIds.length || unresolved.length || !exactExpectedRepairs
      || validBindings !== 101 || attendanceOverlap !== 102) {
    throw new Error('Safety validation failed: ' + JSON.stringify(validation));
  }

  var afterPayload = JSON.stringify(after);
  var now = Date.now();
  var backupPath = path.join(ROOT, 'backups',
    'owais-current-timetable-binding-repair-prewrite-' + now + '.json');
  var recoveryBundle = {
    mode: apply ? 'prewrite_backup_and_apply' : 'preview_only',
    createdAt: new Date(now).toISOString(),
    project: PROJECT,
    tenantId: TARGET,
    targetPath: targetRef.path,
    validation: validation,
    targetDocumentBefore: jsonSafe(targetData),
    repairedTimetable: after,
    afterSha256: sha256(afterPayload),
    safetyNote: 'Only two teacherId fields are changed. No attendance, registration, period id, order, day, book or time is changed.'
  };
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, JSON.stringify(recoveryBundle, null, 2), 'utf8');

  var result = {
    ok: true,
    mode: apply ? 'applied' : 'preview_only',
    backupPath: backupPath,
    targetPath: targetRef.path,
    validation: validation,
    afterSha256: recoveryBundle.afterSha256
  };

  if (apply) {
    await db.runTransaction(async function (transaction) {
      var fresh = await transaction.get(targetRef);
      if (!fresh.exists) throw new Error('Transaction safety stop: timetable disappeared');
      var freshData = fresh.data() || {};
      if (String(freshData.data || '') !== beforePayload) {
        throw new Error('Transaction safety stop: timetable changed after preview');
      }
      transaction.set(targetRef, {
        data: afterPayload,
        checksum: simpleHash(afterPayload),
        clientUpdatedAt: now,
        teacherBindingRepairAt: admin.firestore.FieldValue.serverTimestamp(),
        teacherBindingRepairPeriodIds: expectedIds,
        teacherBindingRepairSource: 'registered_teacher_unique_name_match',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });

    var verifySnap = await targetRef.get();
    var verifyData = verifySnap.exists ? verifySnap.data() || {} : {};
    var verifyList = parseList(verifyData);
    var verifyById = Object.create(null);
    verifyList.forEach(function (period) {
      if (period && period.id) verifyById[period.id] = period;
    });
    var exactTeacherIds = expectedIds.every(function (periodId) {
      return verifyById[periodId]
        && verifyById[periodId].teacherId === EXPECTED_REPAIRS[periodId].to;
    });
    result.verification = {
      exists: verifySnap.exists,
      count: verifyList.length,
      exactPayloadMatches: String(verifyData.data || '') === afterPayload,
      checksumMatches: verifyData.checksum === simpleHash(String(verifyData.data || '')),
      exactTeacherIds: exactTeacherIds,
      afterSha256: sha256(String(verifyData.data || ''))
    };
    if (!result.verification.exists || result.verification.count !== EXPECTED_PERIODS
        || !result.verification.exactPayloadMatches || !result.verification.checksumMatches
        || !result.verification.exactTeacherIds) {
      throw new Error('Read-after-write verification failed: ' + JSON.stringify(result.verification));
    }
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch(function (error) {
  console.error(JSON.stringify({ ok: false, error: String(error && error.stack || error) }));
  process.exit(1);
});
