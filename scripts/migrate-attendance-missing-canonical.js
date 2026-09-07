#!/usr/bin/env node
'use strict';

/**
 * Safely fills ONLY empty cells in canonical attendance sheets from legacy
 * attendance sheets. Existing canonical values, including conflicts, are never
 * overwritten. Default mode is a read-only preview; use --apply to write.
 */
var fs = require('fs');
var os = require('os');
var path = require('path');
var ROOT = path.resolve(__dirname, '..');
var PROJECT = 'madrasa-mangment-app';

function args() {
  var out = { tenant: null, apply: false };
  process.argv.slice(2).forEach(function (a) {
    if (a.indexOf('--tenant=') === 0) out.tenant = a.slice(9);
    if (a === '--apply') out.apply = true;
  });
  return out;
}

async function cliCredentials() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return true;
  var candidates = [path.join(process.env.APPDATA || '', 'configstore', 'firebase-tools.json'), path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json')];
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

function parseId(id) {
  if (!id || id.indexOf('att_rec_') !== 0) return null;
  var p = id.slice(8).split('_');
  if (p.length < 4) return null;
  if (['students', 'teachers', 'staff'].indexOf(p[1]) < 0) return null;
  return { month: p[0], type: p[1], classId: p.slice(2, -1).join('_'), period: p[p.length - 1] };
}

function canonicalId(info) {
  var classId = info.type === 'teachers' || info.type === 'staff' ? '' : info.classId;
  return 'att_rec_' + info.month + '_' + info.type + '_' + classId + '_all';
}

function nonEmpty(v) { return v != null && String(v) !== ''; }
function get(obj, parts) {
  var cur = obj;
  for (var i = 0; i < parts.length; i++) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = cur[parts[i]];
  }
  return cur;
}

function set(obj, parts, value) {
  var cur = obj;
  for (var i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function normalizeDottedFields(data) {
  data = data || {};
  var out = Object.assign({}, data);
  ['records', 'periodRecords', 'teacherPeriodRecords', 'remarks', 'late', 'dailyLocks', 'clearedCells']
    .forEach(function (field) {
      if (data[field] && typeof data[field] === 'object') {
        out[field] = JSON.parse(JSON.stringify(data[field]));
      }
    });
  Object.keys(data).forEach(function (pathKey) {
    if (!/^(records|periodRecords|teacherPeriodRecords|remarks|late|dailyLocks|clearedCells)\./.test(pathKey)) return;
    if (get(out, pathKey.split('.')) === undefined) set(out, pathKey.split('.'), data[pathKey]);
  });
  return out;
}

function isTombstoned(current, fieldPath) {
  var p = String(fieldPath || '').split('.');
  if (p[0] === 'records' && p.length >= 3) {
    return get(current, ['clearedCells', 'days', p[1], p[2]]) === true;
  }
  if (p[0] === 'periodRecords' && p.length >= 4) {
    return get(current, ['clearedCells', 'days', p[1], p[2]]) === true
      || get(current, ['clearedCells', 'periods', p[1], p[2], p[3]]) === true;
  }
  if ((p[0] === 'remarks' || p[0] === 'late') && p.length >= 3) {
    return get(current, ['clearedCells', 'days', p[1], p[2]]) === true;
  }
  return false;
}

function addCandidate(bucket, targetId, pathKey, value, sourceId) {
  if (!nonEmpty(value)) return;
  if (!bucket[targetId]) bucket[targetId] = { sourceIds: {}, values: {}, pathSources: {} };
  bucket[targetId].sourceIds[sourceId] = true;
  // Same legacy cell may be repeated. Last equal value is harmless; a differing
  // legacy source becomes a conflict during the transaction and is not written.
  if (!bucket[targetId].values[pathKey]) bucket[targetId].values[pathKey] = [];
  bucket[targetId].values[pathKey].push(value);
  if (!bucket[targetId].pathSources[pathKey]) bucket[targetId].pathSources[pathKey] = [];
  bucket[targetId].pathSources[pathKey].push({ sourceId: sourceId, value: value });
}

function collectCandidates(docs) {
  var bucket = Object.create(null);
  docs.forEach(function (doc) {
    var info = parseId(doc.id);
    if (!info) return;
    var targetId = canonicalId(info);
    if (doc.id === targetId) return;
    var data = normalizeDottedFields(doc.data || {});
    var period = info.period !== 'all' ? info.period : '';
    Object.keys(data.records || {}).forEach(function (uid) {
      Object.keys(data.records[uid] || {}).forEach(function (day) {
        var pathKey = period ? ('periodRecords.' + uid + '.' + day + '.' + period) : ('records.' + uid + '.' + day);
        addCandidate(bucket, targetId, pathKey, data.records[uid][day], doc.id);
      });
    });
    [data.periodRecords || {}, data.teacherPeriodRecords || {}].forEach(function (periodRoot) {
      Object.keys(periodRoot).forEach(function (uid) {
        var days = periodRoot[uid] || {};
        Object.keys(days).forEach(function (day) {
          Object.keys(days[day] || {}).forEach(function (pid) {
            addCandidate(bucket, targetId, 'periodRecords.' + uid + '.' + day + '.' + pid, days[day][pid], doc.id);
          });
        });
      });
    });
    ['remarks', 'late'].forEach(function (field) {
      Object.keys(data[field] || {}).forEach(function (uid) {
        Object.keys(data[field][uid] || {}).forEach(function (day) {
          addCandidate(bucket, targetId, field + '.' + uid + '.' + day, data[field][uid][day], doc.id);
        });
      });
    });
  });
  return bucket;
}

function resolveValues(values) {
  var unique = Object.create(null);
  (values || []).forEach(function (v) { unique[String(v)] = v; });
  var keys = Object.keys(unique);
  return keys.length === 1 ? { value: unique[keys[0]], conflict: false } : { value: null, conflict: true };
}

function planTarget(current, candidate) {
  current = normalizeDottedFields(current || {});
  candidate = candidate || { sourceIds: {}, values: {}, pathSources: {} };
  var patch = {};
  var added = 0;
  var existing = 0;
  var canonicalDifferences = 0;
  var unresolvedSourceConflicts = 0;
  var tombstoned = 0;
  var canonicalDifferenceDetails = [];
  var unresolvedSourceConflictDetails = [];
  Object.keys(candidate.values || {}).forEach(function (fieldPath) {
    var choice = resolveValues(candidate.values[fieldPath]);
    var existingValue = get(current, fieldPath.split('.'));
    if (choice.conflict) {
      if (nonEmpty(existingValue)) {
        existing += 1;
        canonicalDifferences += 1;
        canonicalDifferenceDetails.push({
          fieldPath: fieldPath,
          canonicalValue: existingValue,
          legacyCandidates: candidate.pathSources[fieldPath] || []
        });
      } else {
        unresolvedSourceConflicts += 1;
        unresolvedSourceConflictDetails.push({
          fieldPath: fieldPath,
          legacyCandidates: candidate.pathSources[fieldPath] || []
        });
      }
      return;
    }
    if (nonEmpty(existingValue)) {
      if (String(existingValue) !== String(choice.value)) {
        canonicalDifferences += 1;
        canonicalDifferenceDetails.push({
          fieldPath: fieldPath,
          canonicalValue: existingValue,
          legacyCandidates: candidate.pathSources[fieldPath] || []
        });
      } else existing += 1;
      return;
    }
    if (isTombstoned(current, fieldPath)) {
      tombstoned += 1;
      return;
    }
    patch[fieldPath] = choice.value;
    added += 1;
  });
  return {
    patch: patch,
    added: added,
    existing: existing,
    canonicalDifferences: canonicalDifferences,
    canonicalDifferenceDetails: canonicalDifferenceDetails,
    unresolvedSourceConflicts: unresolvedSourceConflicts,
    unresolvedSourceConflictDetails: unresolvedSourceConflictDetails,
    tombstoned: tombstoned,
    canMarkComplete: unresolvedSourceConflicts === 0
  };
}

async function evaluateTarget(db, tenantRef, targetId, candidate, apply, admin) {
  var ref = tenantRef.collection('Attendance').doc(targetId);
  return db.runTransaction(async function (tx) {
    var snap = await tx.get(ref);
    var current = normalizeDottedFields(snap.exists ? snap.data() || {} : {});
    var plan = planTarget(current, candidate);
    var patch = Object.assign({}, plan.patch);
    if (apply && (plan.added || (plan.canMarkComplete && current.canonicalComplete !== true))) {
      var nextVersion = Number(current._version || 0) + 1;
      var migrationTimestamp = admin.firestore.FieldValue.serverTimestamp();
      if (!snap.exists) {
        var created = {
          records: {}, periodRecords: {}, remarks: {}, late: {}, dailyLocks: {}, locked: false,
          clearedCells: { days: {}, periods: {} }, canonicalComplete: plan.canMarkComplete,
          clientUpdatedAt: Date.now(), updatedAt: migrationTimestamp, _version: nextVersion
        };
        if (plan.canMarkComplete) created.canonicalMigratedAt = migrationTimestamp;
        Object.keys(patch).forEach(function (fieldPath) {
          set(created, fieldPath.split('.'), patch[fieldPath]);
        });
        tx.set(ref, created, { merge: false });
      } else {
        if (plan.canMarkComplete) {
          patch.canonicalComplete = true;
          patch.canonicalMigratedAt = migrationTimestamp;
        }
        patch.clientUpdatedAt = Date.now();
        patch.updatedAt = migrationTimestamp;
        patch._version = nextVersion;
        tx.update(ref, patch);
      }
    }
    return {
      targetId: targetId,
      sourceDocCount: Object.keys(candidate.sourceIds).length,
      added: plan.added,
      existing: plan.existing,
      canonicalDifferences: plan.canonicalDifferences,
      canonicalDifferenceDetails: plan.canonicalDifferenceDetails,
      unresolvedSourceConflicts: plan.unresolvedSourceConflicts,
      unresolvedSourceConflictDetails: plan.unresolvedSourceConflictDetails,
      tombstoned: plan.tombstoned,
      canonicalComplete: plan.canMarkComplete,
      created: !snap.exists && plan.added > 0
    };
  });
}

async function main() {
  var opt = args();
  if (!opt.tenant) throw new Error('Usage: --tenant=TENANT_ID [--apply]');
  if (!(await cliCredentials())) throw new Error('Firebase CLI credentials not found');
  var admin = require(path.join(ROOT, 'functions', 'node_modules', 'firebase-admin'));
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  var db = admin.firestore();
  var tenantRef = db.collection('All_Madrasas').doc(opt.tenant);
  var snap = await tenantRef.collection('Attendance').get();
  var docs = [];
  snap.forEach(function (d) { docs.push({ id: d.id, data: d.data() || {} }); });
  var candidates = collectCandidates(docs);
  var results = [];
  for (var targetId of Object.keys(candidates).sort()) {
    results.push(await evaluateTarget(db, tenantRef, targetId, candidates[targetId], opt.apply, admin));
  }
  var report = {
    ok: true, mode: opt.apply ? 'applied_missing_cells_only' : 'preview_only', tenant: opt.tenant,
    sourceAttendanceDocumentCount: docs.length,
    targets: results,
    totals: results.reduce(function (a, r) {
      a.added += r.added;
      a.existing += r.existing;
      a.canonicalDifferences += r.canonicalDifferences;
      a.unresolvedSourceConflicts += r.unresolvedSourceConflicts;
      a.tombstoned += r.tombstoned;
      a.completeTargets += r.canonicalComplete ? 1 : 0;
      a.created += r.created ? 1 : 0;
      return a;
    }, {
      added: 0, existing: 0, canonicalDifferences: 0,
      unresolvedSourceConflicts: 0, tombstoned: 0, completeTargets: 0, created: 0
    })
  };
  var reportPath = path.join(ROOT, 'backups', 'attendance-canonical-migration-' + opt.tenant + '-' + Date.now() + '.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({ report: reportPath, mode: report.mode, totals: report.totals }, null, 2));
}

if (require.main === module) {
  main().catch(function (err) {
    console.error('[attendance-canonical-migration] FAILED:', err.message);
    process.exit(1);
  });
}

module.exports = {
  parseId: parseId,
  canonicalId: canonicalId,
  normalizeDottedFields: normalizeDottedFields,
  isTombstoned: isTombstoned,
  collectCandidates: collectCandidates,
  resolveValues: resolveValues,
  planTarget: planTarget
};
