/**
 * Production backup orchestrator — Phase 4
 * Snapshots rules/indexes/config + optional workspace copy + cloud export instructions.
 *
 * Usage:
 *   node scripts/backup-production.js              # full local snapshot
 *   node scripts/backup-production.js --snapshot-only
 *   node scripts/backup-production.js --workspace   # also copy source tree
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const DEST = path.join(ROOT, 'backups', stamp);

const RULE_FILES = [
  'firestore.rules',
  'storage.rules',
  'firestore.indexes.json',
  'firebase.json',
  '.firebaserc'
];

const OPTIONAL_META = [
  'docs/BENCHMARK-RESULTS.md',
  'docs/ENTERPRISE-PERFORMANCE-AUDIT.md',
  'docs/PRE-REFACTOR-BACKUP-CHECKLIST.md'
];

function parseArgs() {
  var opts = { snapshotOnly: false, workspace: false, verify: false, strict: false, skipCloud: false };
  process.argv.slice(2).forEach(function (arg) {
    if (arg === '--snapshot-only') opts.snapshotOnly = true;
    if (arg === '--workspace') opts.workspace = true;
    if (arg === '--verify') opts.verify = true;
    if (arg === '--strict') opts.strict = true;
    if (arg === '--skip-cloud-checks') opts.skipCloud = true;
  });
  if (process.env.EMS_SKIP_STORAGE_CHECK === '1') opts.skipCloud = true;
  return opts;
}

function readJsonSafe(rel) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  } catch (e) {
    return null;
  }
}

function copyFile(rel, destDir) {
  var src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) return false;
  var dest = path.join(destDir, rel.replace(/\//g, '__'));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return true;
}

function hasCommand(cmd) {
  try {
    execSync(cmd + ' --version', { stdio: 'ignore', shell: true });
    return true;
  } catch (e) {
    return false;
  }
}

function checkStorageApi(project, skip) {
  if (skip) return { ok: false, reason: 'skipped (fast snapshot)' };
  var r = spawnSync('firebase', ['deploy', '--only', 'storage', '--dry-run'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
    timeout: 12000
  });
  var out = (r.stdout || '') + (r.stderr || '');
  if (/has not been set up/i.test(out)) {
    return { ok: false, reason: 'Storage not initialized in Firebase Console' };
  }
  if (r.status === 0 || /would deploy/i.test(out)) {
    return { ok: true, reason: 'Storage rules deployable' };
  }
  return { ok: false, reason: out.trim().slice(0, 200) || 'unknown' };
}

function runVerify() {
  console.log('[backup] Running npm test …');
  try {
    execSync('npm test', { cwd: ROOT, stdio: 'inherit', shell: true });
    return true;
  } catch (e) {
    return false;
  }
}

function main() {
  var args = parseArgs();
  fs.mkdirSync(DEST, { recursive: true });

  var copied = [];
  RULE_FILES.forEach(function (f) {
    if (copyFile(f, DEST)) copied.push(f);
  });
  OPTIONAL_META.forEach(function (f) {
    if (copyFile(f, DEST)) copied.push(f);
  });

  var manifestPath = path.join(ROOT, 'dist', '.hosting-manifest.json');
  if (fs.existsSync(manifestPath)) {
    fs.copyFileSync(manifestPath, path.join(DEST, 'hosting-manifest.json'));
    copied.push('dist/.hosting-manifest.json');
  }

  var project = (readJsonSafe('.firebaserc') || {}).projects;
  project = project && project.default ? project.default : 'unknown';
  var storageCheck = checkStorageApi(project, args.skipCloud);

  var tools = args.skipCloud
    ? { skipped: true }
    : {
      firebaseCli: hasCommand('firebase'),
      gcloud: hasCommand('gcloud'),
      gsutil: hasCommand('gsutil')
    };

  var manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    project: project,
    release: '20260621-perf5',
    files: copied,
    storage: storageCheck,
    tools: tools,
    cloudExportCommands: {
      firestore: 'gcloud firestore export gs://YOUR_BUCKET/backups/firestore-' + stamp.slice(0, 10),
      firestoreAlt: '# Firebase: export via Google Cloud Console → Firestore → Import/Export',
      storage: 'gsutil -m cp -r gs://' + project + '.firebasestorage.app/registrations ./backups/storage-' + stamp.slice(0, 10),
      hostingRollback: 'Redeploy previous dist from backups/' + stamp + '/hosting-manifest.json reference'
    },
    disasterRecovery: {
      fullBackupCommand: 'npm run backup:full -- --tenant=OWNER_UID',
      verifyCommand: 'npm run backup:verify-dr',
      procedure: 'docs/DISASTER-RECOVERY-PROCEDURE.md',
      businessDataIncluded: false,
      note: 'This snapshot is config-only. Run backup:full for tenant data + encrypted bundle.'
    },
    checklist: [
      { id: 'rules-snapshot', done: copied.length >= 4, label: 'Rules & indexes snapshot' },
      { id: 'unit-tests', done: args.verify ? runVerify() : null, label: 'npm test (use --verify)' },
      { id: 'storage-live', done: storageCheck.ok, label: 'Firebase Storage initialized' },
      { id: 'firestore-export', done: false, label: 'Cloud Firestore export — use npm run backup:full + EMS_DR_GCS_BUCKET' },
      { id: 'tenant-json', done: false, label: 'Tenant JSON — use npm run backup:full -- --tenant=UID' },
      { id: 'dr-verify', done: false, label: 'DR verification — npm run backup:verify-dr' }
    ]
  };

  fs.writeFileSync(path.join(DEST, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  fs.writeFileSync(path.join(ROOT, 'backups', 'LATEST.txt'), stamp + '\n', 'utf8');

  console.log('\n=== EMS Production Backup Snapshot ===');
  console.log('Destination:', DEST);
  console.log('Project:', project);
  console.log('Files:', copied.length);
  console.log('Storage:', storageCheck.ok ? 'OK' : 'PENDING — ' + storageCheck.reason);
  console.log('\nCloud export (run manually before migration):');
  console.log(' ', manifest.cloudExportCommands.firestore);
  console.log('\nManifest:', path.join(DEST, 'manifest.json'));

  if (args.workspace && !args.snapshotOnly) {
    console.log('\n[backup] Workspace copy …');
    execSync('node scripts/backup-workspace.js', { cwd: ROOT, stdio: 'inherit', shell: true });
  }

  if (!storageCheck.ok && !args.skipCloud) {
    console.warn('\n[WARN] Initialize Storage: https://console.firebase.google.com/project/' + project + '/storage');
    if (args.strict) process.exitCode = 2;
  }
}

main();
