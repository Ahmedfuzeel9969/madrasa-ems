/**
 * EMS Deploy Preflight — cache clean, build, verify, index audit
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function run(cmd, opts) {
  console.log('[preflight] ' + cmd);
  return execSync(cmd, Object.assign({ cwd: ROOT, stdio: 'inherit', shell: true }, opts || {}));
}

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

console.log('=== EMS Firebase Deploy Preflight ===\n');

try {
  const ver = execSync('firebase --version', { encoding: 'utf8' }).trim();
  console.log('[OK] Firebase CLI:', ver);
  const major = parseInt(ver.split('.')[0], 10);
  if (major < 13) {
    console.warn('[WARN] Firebase CLI < 13 — upgrade: npm i -g firebase-tools@latest');
  }
} catch (e) {
  console.error('[FAIL] firebase CLI not found. Install: npm i -g firebase-tools');
  process.exit(1);
}

try {
  const nodeVer = process.version;
  console.log('[OK] Node:', nodeVer);
} catch (e) { /* ignore */ }

const fbRc = path.join(ROOT, '.firebaserc');
const fbJson = path.join(ROOT, 'firebase.json');
if (!fs.existsSync(fbRc) || !fs.existsSync(fbJson)) {
  console.error('[FAIL] .firebaserc or firebase.json missing');
  process.exit(1);
}
const project = readJson('.firebaserc').projects.default;
console.log('[OK] Firebase project:', project);

const hostingPublic = readJson('firebase.json').hosting.public;
if (hostingPublic !== 'dist') {
  console.error('[FAIL] firebase.json hosting.public must be "dist" (got: ' + hostingPublic + ')');
  process.exit(1);
}
console.log('[OK] Hosting public folder: dist/');

const indexes = readJson('firestore.indexes.json');
const hasSecurityIdx = (indexes.indexes || []).some(function (idx) {
  return idx.collectionGroup === 'Platform_SecurityEvents';
}) || (indexes.fieldOverrides || []).some(function (fo) {
  return fo.collectionGroup === 'Platform_SecurityEvents';
});
if (!hasSecurityIdx) {
  console.error('[FAIL] Platform_SecurityEvents index missing from firestore.indexes.json');
  process.exit(1);
}
console.log('[OK] Platform_SecurityEvents index declared');

const fbCache = path.join(ROOT, '.firebase');
if (fs.existsSync(fbCache)) {
  console.log('[EMS] Clearing .firebase/ cache (prevents hash mismatch) …');
  fs.rmSync(fbCache, { recursive: true, force: true });
}

console.log('\n[EMS] Building hosting artifact …');
run('node scripts/prepare-hosting.js --verify-after');

const m = readJson('dist/.hosting-manifest.json');
const required = ['index.html', 'style.css', 'core.js', 'auth.js', 'ems-utils.js', 'service-worker.js', 'sa/sa-api.js'];
const missing = required.filter(function (f) { return !m.files[f]; });
if (missing.length) {
  console.error('[FAIL] Required files not in dist:', missing.join(', '));
  process.exit(1);
}
console.log('[OK] Required assets present in dist/');

console.log('\n=== Preflight PASSED — safe to deploy ===');
console.log('  firebase deploy --only hosting');
console.log('  firebase deploy --only firestore');
console.log('  firebase deploy --only functions');
console.log('  npm run deploy:all\n');
