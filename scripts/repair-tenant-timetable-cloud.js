#!/usr/bin/env node
'use strict';

/**
 * One-shot admin repair: archive foreign ModuleData timetable and clear canonical doc.
 *
 * Usage:
 *   node scripts/repair-tenant-timetable-cloud.js --tenant=OWNER_UID [--dry-run]
 *
 * Requires firebase-admin + Firebase CLI credentials (same bridge as tenant export).
 */
var fs = require('fs');
var os = require('os');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var PROJECT = 'madrasa-mangment-app';
var CANONICAL_DOC = 'Attendance__ems_att_periods';
var ARCHIVE_DOC = 'periods_foreign_archive';

function parseArgs() {
  var opts = { tenant: null, dryRun: false };
  process.argv.slice(2).forEach(function (arg) {
    if (arg.indexOf('--tenant=') === 0) opts.tenant = arg.split('=')[1];
    if (arg === '--dry-run') opts.dryRun = true;
  });
  return opts;
}

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

function parsePeriodList(data) {
  if (!data) return [];
  if (data.data != null) {
    try {
      var parsed = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  }
  if (Array.isArray(data.list)) return data.list;
  return [];
}

async function main() {
  var opts = parseArgs();
  if (!opts.tenant) {
    console.error('Usage: node scripts/repair-tenant-timetable-cloud.js --tenant=OWNER_UID [--dry-run]');
    process.exit(1);
  }
  if (!(await setupCliCreds())) {
    console.error('No Firebase credentials available.');
    process.exit(2);
  }

  var admin = require(path.join(ROOT, 'functions', 'node_modules', 'firebase-admin'));
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  var db = admin.firestore();
  var tenantRef = db.collection('All_Madrasas').doc(opts.tenant);
  var canonRef = tenantRef.collection('ModuleData').doc(CANONICAL_DOC);
  var archiveRef = tenantRef.collection('Attendance_Config').doc(ARCHIVE_DOC);

  var canonSnap = await canonRef.get();
  if (!canonSnap.exists) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: 'no_canonical_doc' }, null, 2));
    return;
  }

  var canonData = canonSnap.data() || {};
  var periods = parsePeriodList(canonData);
  var report = {
    tenant: opts.tenant,
    dryRun: opts.dryRun,
    canonicalPath: canonRef.path,
    archivePath: archiveRef.path,
    archivedPeriodCount: periods.length,
    archivedPeriodIds: periods.map(function (p) { return p && p.id; }).filter(Boolean)
  };

  if (opts.dryRun) {
    report.ok = true;
    report.action = 'dry_run_only';
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  var batch = db.batch();
  batch.set(archiveRef, {
    list: periods,
    archivedAt: admin.firestore.FieldValue.serverTimestamp(),
    archivedFrom: 'ModuleData/' + CANONICAL_DOC,
    reason: 'foreign_canonical_timetable_purge',
    periodCount: periods.length
  }, { merge: true });
  batch.set(canonRef, {
    schemaVersion: canonData.schemaVersion || '1.0',
    module: 'Attendance',
    key: 'ems_att_periods',
    data: '[]',
    checksum: '0',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    repairedBy: 'repair-tenant-timetable-cloud.js',
    repairNote: 'Cleared foreign canonical copy; re-enter timetable in app.'
  }, { merge: false });
  await batch.commit();

  report.ok = true;
  report.action = 'archived_and_cleared';
  console.log(JSON.stringify(report, null, 2));
}

main().catch(function (e) {
  console.error('ERR', e.message);
  process.exit(1);
});
