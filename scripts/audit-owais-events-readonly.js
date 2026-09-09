#!/usr/bin/env node
'use strict';

/** READ ONLY — compare Owais Qarni canonical, legacy and nested-backup events. */
var fs = require('fs');
var os = require('os');
var path = require('path');
var ROOT = path.resolve(__dirname, '..');
var PROJECT = 'madrasa-mangment-app';
var TARGET = 'bpV58OqWSKhRbvXL57CvihIlDj63';
var SOURCE_BACKUP_ID = 'auto_1787985335491';

async function creds() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return true;
  var paths = [
    path.join(process.env.APPDATA || '', 'configstore', 'firebase-tools.json'),
    path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json')
  ];
  var p = paths.find(function (candidate) { return candidate && fs.existsSync(candidate); });
  if (!p) return false;
  var config = JSON.parse(fs.readFileSync(p, 'utf8'));
  var defaults = require(path.join(ROOT, 'node_modules', 'firebase-tools', 'lib', 'defaultCredentials'));
  var credentialPath = await defaults.getCredentialPathAsync({ user: config.user, tokens: config.tokens });
  if (!credentialPath) return false;
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialPath;
  process.env.GCLOUD_PROJECT = PROJECT;
  return true;
}

function parseList(raw) {
  var value = raw;
  for (var i = 0; i < 3; i++) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object' && value.data != null) { value = value.data; continue; }
    if (typeof value !== 'string') return [];
    try { value = JSON.parse(value); } catch (e) { return []; }
  }
  return Array.isArray(value) ? value : [];
}

function eventSummary(event) {
  event = event || {};
  return {
    id: String(event.id || ''),
    name: String(event.name || ''),
    date: String(event.date || ''),
    time: String(event.time || ''),
    participantCount: Array.isArray(event.participants) ? event.participants.length : 0,
    participantIds: (event.participants || []).map(function (p) { return String(p && p.id || ''); }).filter(Boolean).sort()
  };
}

async function main() {
  if (!(await creds())) throw new Error('Firebase credentials not found');
  var admin = require(path.join(ROOT, 'functions', 'node_modules', 'firebase-admin'));
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  var db = admin.firestore();
  var tenant = db.collection('All_Madrasas').doc(TARGET);
  var refs = [
    tenant.collection('ModuleData').doc('Attendance__ems_att_events_db'),
    tenant.collection('BackupSnapshots').doc(SOURCE_BACKUP_ID).collection('modules').doc('ems_att_events_db'),
    tenant.collection('Attendance')
  ];
  var reads = await Promise.all([refs[0].get(), refs[1].get(), refs[2].get()]);
  var canonical = reads[0].exists ? parseList(reads[0].data() || {}) : [];
  var backup = reads[1].exists ? parseList(reads[1].data() || {}) : [];
  var legacy = [];
  reads[2].forEach(function (doc) {
    if (doc.id.indexOf('att_evt_') !== 0) return;
    var data = doc.data() || {};
    legacy.push(Object.assign({ id: data.id || doc.id.slice('att_evt_'.length) }, data));
  });
  var canonRows = canonical.map(eventSummary);
  var backupRows = backup.map(eventSummary);
  var legacyRows = legacy.map(eventSummary);
  var canonicalById = Object.create(null);
  canonRows.forEach(function (row) { canonicalById[row.id] = row; });
  var legacyById = Object.create(null);
  legacyRows.forEach(function (row) { legacyById[row.id] = row; });
  var backupById = Object.create(null);
  backupRows.forEach(function (row) { backupById[row.id] = row; });
  var union = Object.create(null);
  canonRows.concat(backupRows, legacyRows).forEach(function (row) { if (row.id) union[row.id] = true; });
  var comparisons = Object.keys(union).sort().map(function (id) {
    var c = canonicalById[id] || null;
    var b = backupById[id] || null;
    var l = legacyById[id] || null;
    return {
      id: id,
      inCanonical: !!c,
      inBackup: !!b,
      inLegacy: !!l,
      canonicalMatchesBackup: !!(c && b && JSON.stringify(c) === JSON.stringify(b)),
      canonicalMatchesLegacy: !!(c && l && JSON.stringify(c) === JSON.stringify(l)),
      canonicalParticipantCount: c && c.participantCount,
      backupParticipantCount: b && b.participantCount,
      legacyParticipantCount: l && l.participantCount
    };
  });
  var result = {
    ok: true,
    mode: 'read_only',
    tenantId: TARGET,
    canonicalPath: refs[0].path,
    backupPath: refs[1].path,
    canonicalCount: canonRows.length,
    backupCount: backupRows.length,
    legacyCount: legacyRows.length,
    comparisons: comparisons,
    canonicalEvents: canonRows,
    backupEvents: backupRows,
    legacyEvents: legacyRows,
    safetyNote: 'No Firebase data was created, updated, or deleted.'
  };
  var out = path.join(ROOT, 'backups', 'owais-qarnai-events-audit-' + Date.now() + '.json');
  fs.writeFileSync(out, JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify({
    ok: true,
    report: out,
    canonicalCount: result.canonicalCount,
    backupCount: result.backupCount,
    legacyCount: result.legacyCount,
    comparisons: comparisons
  }, null, 2));
}

main().catch(function (error) {
  console.error(JSON.stringify({ ok: false, error: String(error && error.stack || error) }));
  process.exit(1);
});
