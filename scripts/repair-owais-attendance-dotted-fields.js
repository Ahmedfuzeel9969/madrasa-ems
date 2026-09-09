#!/usr/bin/env node
'use strict';

/**
 * Safe, tenant-bound repair for historical literal dotted attendance fields.
 *
 * Default: preview/read-only. Pass --apply only after reviewing the backup and
 * preview. Existing nested cells always win conflicts; only missing paths are
 * recovered. The current timetable document is read and fingerprinted before
 * and after, but is never written.
 */
var crypto = require('crypto');
var fs = require('fs');
var os = require('os');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var PROJECT = 'madrasa-mangment-app';
var EXPECTED_TENANT = 'bpV58OqWSKhRbvXL57CvihIlDj63';
var EXPECTED_TIMETABLE_COUNT = 102;
var EXPECTED_TIMETABLE_SHA256 = 'c28181a212c563b536f5d1caf99cd2dbedceda09448d684756ef0dc0996af0b9';
var apply = process.argv.indexOf('--apply') >= 0;
var tenantArg = process.argv.find(function (arg) { return arg.indexOf('--tenant=') === 0; });
var TENANT = tenantArg ? tenantArg.slice('--tenant='.length) : EXPECTED_TENANT;
var now = Date.now();
var BACKUP = path.join(ROOT, 'backups', 'owais-attendance-dotted-repair-prewrite-' + now + '.json');

var MAP_ROOTS = {
  records: true,
  periodRecords: true,
  teacherPeriodRecords: true,
  remarks: true,
  late: true,
  dailyLocks: true
};

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

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (!value || typeof value !== 'object') return value;
  var proto = Object.getPrototypeOf ? Object.getPrototypeOf(value) : Object.prototype;
  if (proto && proto !== Object.prototype) return value;
  var out = {};
  Object.keys(value).forEach(function (key) { out[key] = cloneValue(value[key]); });
  return out;
}

function getNested(target, parts) {
  var cursor = target;
  for (var i = 0; i < parts.length; i++) {
    if (!cursor || typeof cursor !== 'object' || !Object.prototype.hasOwnProperty.call(cursor, parts[i])) {
      return { exists: false, value: undefined };
    }
    cursor = cursor[parts[i]];
  }
  return { exists: true, value: cursor };
}

function fillMissing(target, parts, value) {
  var cursor = target;
  for (var i = 0; i < parts.length - 1; i++) {
    if (!cursor[parts[i]] || typeof cursor[parts[i]] !== 'object') cursor[parts[i]] = {};
    cursor = cursor[parts[i]];
  }
  var leaf = parts[parts.length - 1];
  if (Object.prototype.hasOwnProperty.call(cursor, leaf)) return false;
  cursor[leaf] = cloneValue(value);
  return true;
}

function sameValue(a, b) {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch (error) { return String(a) === String(b); }
}

function normalizeDocument(raw) {
  var out = Object.assign({}, raw || {});
  var cloned = Object.create(null);
  var stats = { dotted: 0, recoveredMissing: 0, same: 0, conflictsKeptNested: 0, conflictFields: [] };

  function rootMap(root) {
    if (!cloned[root]) {
      out[root] = cloneValue(out[root] && typeof out[root] === 'object' ? out[root] : {});
      cloned[root] = true;
    }
    return out[root];
  }

  Object.keys(raw || {}).forEach(function (key) {
    var dot = key.indexOf('.');
    if (dot <= 0) return;
    var root = key.slice(0, dot);
    if (!MAP_ROOTS[root]) return;
    var parts = key.slice(dot + 1).split('.').filter(Boolean);
    if (!parts.length) return;
    stats.dotted += 1;
    var existing = getNested(rootMap(root), parts);
    if (!existing.exists) {
      fillMissing(rootMap(root), parts, raw[key]);
      stats.recoveredMissing += 1;
    } else if (sameValue(existing.value, raw[key])) {
      stats.same += 1;
    } else {
      stats.conflictsKeptNested += 1;
      stats.conflictFields.push({ key: key, nestedValue: existing.value, dottedValue: raw[key] });
    }
    delete out[key];
  });
  return { data: out, stats: stats };
}

function countDotted(data) {
  return Object.keys(data || {}).filter(function (key) {
    var dot = key.indexOf('.');
    return dot > 0 && MAP_ROOTS[key.slice(0, dot)];
  }).length;
}

function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value, function (key, item) {
    if (item && typeof item.toDate === 'function') {
      return { _firestoreTimestamp: item.toDate().toISOString() };
    }
    return item;
  }));
}

function assertTimetable(snapshot, phase) {
  if (!snapshot.exists) throw new Error('Safety stop (' + phase + '): timetable missing');
  var data = snapshot.data() || {};
  var payload = String(data.data || '');
  var count = parseList(data).length;
  var hash = sha256(payload);
  if (count !== EXPECTED_TIMETABLE_COUNT || hash !== EXPECTED_TIMETABLE_SHA256) {
    throw new Error('Safety stop (' + phase + '): timetable fingerprint changed: ' + count + ' / ' + hash);
  }
  return { count: count, sha256: hash, path: snapshot.ref.path };
}

async function main() {
  if (TENANT !== EXPECTED_TENANT) throw new Error('Safety stop: unexpected tenant ' + TENANT);
  if (!(await setupCliCredentials())) throw new Error('Firebase CLI credentials not found');
  var admin = require(path.join(ROOT, 'functions', 'node_modules', 'firebase-admin'));
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  var db = admin.firestore();
  var tenantRef = db.collection('All_Madrasas').doc(TENANT);
  var attendanceCol = tenantRef.collection('Attendance');
  var timetableRef = tenantRef.collection('ModuleData').doc('Attendance__ems_att_periods');
  var reads = await Promise.all([tenantRef.get(), attendanceCol.get(), timetableRef.get()]);
  if (!reads[0].exists) throw new Error('Safety stop: tenant not found');
  var timetableBefore = assertTimetable(reads[2], 'before');
  var affected = [];
  var totals = { documents: reads[1].size, affected: 0, dotted: 0, recoveredMissing: 0, same: 0, conflictsKeptNested: 0 };
  reads[1].forEach(function (doc) {
    if (doc.id.indexOf('att_rec_') !== 0) return;
    var raw = doc.data() || {};
    var normalized = normalizeDocument(raw);
    if (!normalized.stats.dotted) return;
    totals.affected += 1;
    totals.dotted += normalized.stats.dotted;
    totals.recoveredMissing += normalized.stats.recoveredMissing;
    totals.same += normalized.stats.same;
    totals.conflictsKeptNested += normalized.stats.conflictsKeptNested;
    affected.push({
      id: doc.id,
      path: doc.ref.path,
      stats: normalized.stats,
      before: jsonSafe(raw),
      afterPreview: jsonSafe(normalized.data)
    });
  });

  var backup = {
    mode: apply ? 'prewrite_backup_and_apply' : 'preview_only',
    createdAt: new Date(now).toISOString(),
    project: PROJECT,
    tenantId: TENANT,
    attendancePath: attendanceCol.path,
    timetableBefore: timetableBefore,
    rules: {
      recoverOnlyMissingNestedPaths: true,
      keepExistingNestedOnConflict: true,
      removeLiteralDottedFieldsAfterBackup: true,
      timetableWrites: false
    },
    totals: totals,
    affectedDocuments: affected
  };
  fs.mkdirSync(path.dirname(BACKUP), { recursive: true });
  fs.writeFileSync(BACKUP, JSON.stringify(backup, null, 2), 'utf8');

  var applied = 0;
  if (apply) {
    for (var i = 0; i < affected.length; i++) {
      var docId = affected[i].id;
      var docRef = attendanceCol.doc(docId);
      var changed = await db.runTransaction(async function (transaction) {
        var current = await transaction.get(docRef);
        if (!current.exists) return false;
        var normalized = normalizeDocument(current.data() || {});
        if (!normalized.stats.dotted) return false;
        transaction.set(docRef, normalized.data, { merge: false });
        return true;
      });
      if (changed) applied += 1;
    }
  }

  var verifyReads = await Promise.all([attendanceCol.get(), timetableRef.get()]);
  var timetableAfter = assertTimetable(verifyReads[1], 'after');
  var remainingDotted = 0;
  verifyReads[0].forEach(function (doc) {
    if (doc.id.indexOf('att_rec_') === 0) remainingDotted += countDotted(doc.data() || {});
  });
  var result = {
    ok: true,
    mode: apply ? 'applied' : 'preview_only',
    tenantId: TENANT,
    attendancePath: attendanceCol.path,
    backupPath: BACKUP,
    totals: totals,
    appliedDocuments: applied,
    remainingDottedFields: remainingDotted,
    timetableBefore: timetableBefore,
    timetableAfter: timetableAfter,
    timetableUnchanged: timetableBefore.count === timetableAfter.count && timetableBefore.sha256 === timetableAfter.sha256
  };
  if (apply && remainingDotted !== 0) throw new Error('Post-write verification failed: ' + JSON.stringify(result));
  console.log(JSON.stringify(result, null, 2));
}

main().catch(function (error) {
  console.error(JSON.stringify({ ok: false, error: String(error && error.stack || error) }));
  process.exit(1);
});
