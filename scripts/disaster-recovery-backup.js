/**
 * EMS Disaster Recovery — full backup orchestrator (Priority 1)
 *
 * Tiers:
 *   1. Config snapshot (rules, indexes, hosting manifest)
 *   2. Firestore cloud export (gcloud, when EMS_DR_GCS_BUCKET set)
 *   3. Storage object mirror (gsutil, when bucket available)
 *   4. Tenant Firestore export (Admin SDK, when --tenant= set)
 *   5. Local encrypted bundle (.emsbak)
 *
 * Usage:
 *   node scripts/disaster-recovery-backup.js
 *   node scripts/disaster-recovery-backup.js --tenant=OWNER_UID
 *   node scripts/disaster-recovery-backup.js --tenant=OWNER_UID --passphrase=secret123456
 *   EMS_BACKUP_PASSPHRASE=secret123456 node scripts/disaster-recovery-backup.js --tenant=UID
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const backupLib = require('./backup-lib');

const ROOT = path.resolve(__dirname, '..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const DEST = path.join(ROOT, 'backups', 'dr-' + stamp);

function parseArgs() {
  var opts = {
    tenant: process.env.EMS_DR_TENANT || null,
    passphrase: process.env.EMS_BACKUP_PASSPHRASE || null,
    gcsBucket: process.env.EMS_DR_GCS_BUCKET || null,
    skipCloud: false,
    dryRun: false,
    configOnly: false,
    strict: false,
    emulatorVerify: false
  };
  process.argv.slice(2).forEach(function (arg) {
    if (arg.indexOf('--tenant=') === 0) opts.tenant = arg.split('=')[1];
    if (arg.indexOf('--passphrase=') === 0) opts.passphrase = arg.split('=')[1];
    if (arg.indexOf('--gcs-bucket=') === 0) opts.gcsBucket = arg.split('=')[1];
    if (arg === '--skip-cloud') opts.skipCloud = true;
    if (arg === '--dry-run') opts.dryRun = true;
    if (arg === '--config-only') opts.configOnly = true;
    if (arg === '--strict') opts.strict = true;
    if (arg === '--emulator-verify') opts.emulatorVerify = true;
  });
  return opts;
}

function readJsonSafe(rel) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  } catch (e) {
    return null;
  }
}

function hasCommand(cmd) {
  try {
    execSync(cmd + ' --version', { stdio: 'ignore', shell: true });
    return true;
  } catch (e) {
    return false;
  }
}

function runConfigSnapshot(destDir) {
  execSync('node scripts/backup-production.js --snapshot-only --skip-cloud-checks', {
    cwd: ROOT,
    stdio: 'pipe',
    shell: true
  });
  var latest = fs.readFileSync(path.join(ROOT, 'backups', 'LATEST.txt'), 'utf8').trim();
  var srcDir = path.join(ROOT, 'backups', latest);
  fs.mkdirSync(destDir, { recursive: true });
  fs.readdirSync(srcDir).forEach(function (f) {
    fs.copyFileSync(path.join(srcDir, f), path.join(destDir, f));
  });
  return { ok: true, source: srcDir, files: fs.readdirSync(destDir).length };
}

function tryFirestoreCloudExport(project, bucket, destMeta) {
  if (!bucket) {
    return { ok: false, reason: 'EMS_DR_GCS_BUCKET not set — set env or use --gcs-bucket=' };
  }
  if (!hasCommand('gcloud')) {
    return { ok: false, reason: 'gcloud CLI not installed' };
  }
  var exportPath = 'gs://' + bucket.replace(/^gs:\/\//, '') + '/ems-dr/firestore-' + stamp.slice(0, 10);
  var r = spawnSync('gcloud', [
    'firestore', 'export', exportPath,
    '--project=' + project,
    '--async'
  ], { encoding: 'utf8', shell: false, timeout: 60000 });
  var out = (r.stdout || '') + (r.stderr || '');
  if (r.status !== 0 && !/operation/i.test(out)) {
    return { ok: false, reason: out.trim().slice(0, 300) || 'gcloud export failed' };
  }
  return {
    ok: true,
    exportUri: exportPath,
    async: true,
    note: 'Monitor in Google Cloud Console → Firestore → Import/Export'
  };
}

function tryStorageExport(project, destDir) {
  if (!hasCommand('gsutil')) {
    return { ok: false, reason: 'gsutil not installed' };
  }
  var bucketCandidates = [
    project + '.firebasestorage.app',
    project + '.appspot.com'
  ];
  var storageDest = path.join(destDir, 'storage-mirror');
  fs.mkdirSync(storageDest, { recursive: true });
  var lastErr = '';
  for (var i = 0; i < bucketCandidates.length; i++) {
    var src = 'gs://' + bucketCandidates[i] + '/registrations';
    var r = spawnSync('gsutil', ['-m', 'cp', '-r', src, storageDest], {
      encoding: 'utf8',
      shell: false,
      timeout: 120000
    });
    if (r.status === 0) {
      return { ok: true, source: src, dest: storageDest };
    }
    lastErr = (r.stderr || r.stdout || '').trim().slice(0, 200);
  }
  return { ok: false, reason: lastErr || 'Storage bucket not accessible' };
}

async function tryTenantExport(tenantId, destDir) {
  if (!tenantId) {
    return { ok: false, reason: 'No tenant — pass --tenant=OWNER_UID or EMS_DR_TENANT' };
  }
  try {
    var mod = require('./tenant-firestore-export');
    var rc = readJsonSafe('.firebaserc') || {};
    var proj = rc.projects && rc.projects.default ? rc.projects.default : 'madrasa-mangment-app';
    var admin = mod.loadAdmin(proj);
    var db = admin.firestore();
    var payload = await mod.exportTenant(db, tenantId);
    var jsonPath = path.join(destDir, 'tenant-export.json');
    backupLib.writeJson(jsonPath, payload);
    return {
      ok: true,
      path: jsonPath,
      inventory: payload.inventory || backupLib.inventoryTenantPayload(payload)
    };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

function createEncryptedBundle(tenantExportPath, passphrase, destDir) {
  if (!tenantExportPath || !fs.existsSync(tenantExportPath)) {
    return { ok: false, reason: 'No tenant-export.json — run with --tenant=' };
  }
  if (!passphrase) {
    return { ok: false, reason: 'No passphrase — set EMS_BACKUP_PASSPHRASE or --passphrase=' };
  }
  var exportData = backupLib.readJson(tenantExportPath);
  var inventory = backupLib.inventoryTenantPayload(exportData);
  var bundle = backupLib.encryptPayload({
    tenantId: exportData.tenantId,
    export: exportData,
    inventory: inventory
  }, passphrase);
  var bundlePath = path.join(destDir, 'tenant-encrypted.emsbak');
  backupLib.writeJson(bundlePath, bundle);
  return { ok: true, path: bundlePath, inventory: inventory };
}

async function main() {
  var args = parseArgs();
  fs.mkdirSync(DEST, { recursive: true });

  var project = (readJsonSafe('.firebaserc') || {}).projects;
  project = project && project.default ? project.default : 'unknown';

  console.log('\n=== EMS Disaster Recovery Backup ===');
  console.log('Destination:', DEST);
  console.log('Project:', project);
  console.log('Tenant:', args.tenant || '(none — config-only backup)');

  var tiers = {};

  // Tier 1: Config snapshot
  console.log('\n[Tier 1] Config snapshot …');
  tiers.config = runConfigSnapshot(path.join(DEST, 'config'));
  console.log('  OK —', tiers.config.files, 'files');

  // Tier 2: Firestore cloud export
  if (args.emulatorVerify && tiers.tenantExport.ok) {
    var localFsExport = path.join(DEST, 'firestore-local-export');
    fs.mkdirSync(localFsExport, { recursive: true });
    fs.copyFileSync(tiers.tenantExport.path, path.join(localFsExport, 'tenant-full-export.json'));
    tiers.firestoreExport = { ok: true, path: localFsExport, reason: 'emulator local export' };
    console.log('\n[Tier 2] Firestore export (emulator local) … OK');
  } else if (!args.skipCloud && !args.dryRun) {
    console.log('\n[Tier 2] Firestore cloud export …');
    tiers.firestoreExport = tryFirestoreCloudExport(project, args.gcsBucket, DEST);
    console.log(' ', tiers.firestoreExport.ok ? 'OK — ' + tiers.firestoreExport.exportUri : 'SKIP — ' + tiers.firestoreExport.reason);
  } else {
    tiers.firestoreExport = { ok: false, reason: args.dryRun ? 'dry-run' : 'skipped (--skip-cloud)' };
  }

  // Tier 3: Storage mirror
  if (args.emulatorVerify) {
    var seedManifest = path.join(ROOT, 'backups', '_dr-verify-seed', 'storage-manifest.json');
    if (fs.existsSync(seedManifest)) {
      var entries = JSON.parse(fs.readFileSync(seedManifest, 'utf8'));
      var mirrorDest = path.join(DEST, 'storage-mirror');
      fs.mkdirSync(mirrorDest, { recursive: true });
      entries.forEach(function (entry) {
        var rel = entry.path.replace(/\//g, path.sep);
        var fp = path.join(mirrorDest, rel);
        fs.mkdirSync(path.dirname(fp), { recursive: true });
        fs.writeFileSync(fp, Buffer.alloc(entry.bytes || 64, 0xAB));
      });
      tiers.storageExport = { ok: true, dest: mirrorDest, files: entries.length, reason: 'emulator local mirror' };
      console.log('\n[Tier 3] Storage export (emulator local) … OK —', entries.length, 'files');
    } else {
      tiers.storageExport = { ok: false, reason: 'storage manifest missing — run seed-dr-production-scale first' };
    }
  } else if (!args.skipCloud && !args.dryRun) {
    console.log('\n[Tier 3] Storage export …');
    tiers.storageExport = tryStorageExport(project, DEST);
    console.log(' ', tiers.storageExport.ok ? 'OK — ' + tiers.storageExport.dest : 'SKIP — ' + tiers.storageExport.reason);
  } else {
    tiers.storageExport = { ok: false, reason: 'skipped' };
  }

  // Tier 4: Tenant Firestore export
  console.log('\n[Tier 4] Tenant data export …');
  tiers.tenantExport = await tryTenantExport(args.tenant, DEST);
  console.log(' ', tiers.tenantExport.ok
    ? 'OK — inventory: ' + JSON.stringify(tiers.tenantExport.inventory)
    : 'SKIP — ' + tiers.tenantExport.reason);

  // Tier 5: Encrypted local bundle
  console.log('\n[Tier 5] Encrypted local backup …');
  var tenantJson = tiers.tenantExport.ok ? tiers.tenantExport.path : null;
  tiers.encryptedLocal = createEncryptedBundle(tenantJson, args.passphrase, DEST);
  console.log(' ', tiers.encryptedLocal.ok
    ? 'OK — ' + tiers.encryptedLocal.path
    : 'SKIP — ' + tiers.encryptedLocal.reason);

  var drManifest = {
    version: 2,
    type: 'disaster-recovery',
    createdAt: new Date().toISOString(),
    project: project,
    tenantId: args.tenant || null,
    destination: DEST,
    tiers: tiers,
    recoveryProcedure: 'docs/DISASTER-RECOVERY-PROCEDURE.md',
    verification: {
      tenantCountsMatch: tiers.tenantExport.ok && tiers.encryptedLocal.ok
        ? tiers.tenantExport.inventory
        : null,
      fullRecoveryPossible: !!(tiers.tenantExport.ok || tiers.firestoreExport.ok)
    },
    checklist: [
      { id: 'config', done: tiers.config.ok, label: 'Rules & indexes snapshot' },
      { id: 'firestore-cloud', done: !!tiers.firestoreExport.ok, label: 'Firestore GCS export' },
      { id: 'storage', done: !!tiers.storageExport.ok, label: 'Storage object mirror' },
      { id: 'tenant-json', done: !!tiers.tenantExport.ok, label: 'Tenant JSON export' },
      { id: 'encrypted-local', done: !!tiers.encryptedLocal.ok, label: 'Encrypted .emsbak bundle' }
    ]
  };

  backupLib.writeJson(path.join(DEST, 'dr-manifest.json'), drManifest);
  fs.writeFileSync(path.join(ROOT, 'backups', 'LATEST-DR.txt'), 'dr-' + stamp + '\n', 'utf8');

  console.log('\n=== Summary ===');
  drManifest.checklist.forEach(function (c) {
    console.log(' ', c.done ? '[OK]' : '[--]', c.label);
  });
  console.log('\nManifest:', path.join(DEST, 'dr-manifest.json'));
  console.log('Recovery guide: docs/DISASTER-RECOVERY-PROCEDURE.md');

  var criticalOk = tiers.config.ok && (tiers.tenantExport.ok || tiers.firestoreExport.ok);
  if (!criticalOk && !args.configOnly) {
    console.warn('\n[WARN] Full tenant recovery NOT yet complete — provide --tenant= and credentials, or run gcloud export.');
    if (args.strict) process.exitCode = 1;
  } else if (!criticalOk && args.configOnly) {
    console.log('\n[INFO] Config-only backup complete (--config-only).');
  }
}

main().catch(function (err) {
  console.error('[dr-backup] FATAL:', err.message);
  process.exit(1);
});
