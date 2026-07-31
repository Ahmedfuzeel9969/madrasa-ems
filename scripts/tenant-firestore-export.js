/**
 * Export a single tenant's Firestore business data (Admin SDK).
 *
 * Usage:
 *   set FIRESTORE_EMULATOR_HOST=127.0.0.1:8080   (optional, for emulator)
 *   node scripts/tenant-firestore-export.js --tenant=OWNER_UID [--out=path]
 *
 * Requires firebase-admin (functions/node_modules).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { inventoryTenantPayload, writeJson } = require('./backup-lib');

const ROOT = path.resolve(__dirname, '..');

function parseArgs() {
  var opts = { tenant: null, out: null, project: 'madrasa-mangment-app' };
  process.argv.slice(2).forEach(function (arg) {
    if (arg.indexOf('--tenant=') === 0) opts.tenant = arg.split('=')[1];
    if (arg.indexOf('--out=') === 0) opts.out = arg.split('=')[1];
    if (arg.indexOf('--project=') === 0) opts.project = arg.split('=')[1];
  });
  return opts;
}

function loadAdmin(projectId) {
  var adminPath = path.join(ROOT, 'functions', 'node_modules', 'firebase-admin');
  if (!fs.existsSync(adminPath)) {
    throw new Error('firebase-admin not found — run npm install in functions/');
  }
  var admin = require(adminPath);
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: projectId });
  }
  return admin;
}

async function exportCollection(db, tenantId, collectionName) {
  var snap = await db.collection('All_Madrasas').doc(tenantId).collection(collectionName).get();
  var rows = [];
  snap.forEach(function (doc) {
    rows.push(Object.assign({ id: doc.id }, doc.data()));
  });
  return rows;
}

async function exportTenant(db, tenantId) {
  var base = db.collection('All_Madrasas').doc(tenantId);
  var profile = await base.get();
  var registrations = await exportCollection(db, tenantId, 'Registrations');
  var rejected = await exportCollection(db, tenantId, 'Rejected');
  var feeCollections = await exportCollection(db, tenantId, 'FeeCollections');
  var staffLinks = await exportCollection(db, tenantId, 'StaffLinks');
  var parentLinks = await exportCollection(db, tenantId, 'ParentLinks');
  var staffPermissions = await exportCollection(db, tenantId, 'StaffPermissions');
  var attendanceSnap = await base.collection('Attendance').get();
  var attendance = [];
  attendanceSnap.forEach(function (doc) {
    attendance.push({ id: doc.id, data: doc.data() });
  });
  var complaints = [];
  try {
    complaints = await exportCollection(db, tenantId, 'Complaints');
  } catch (e) { /* collection may not exist */ }

  var storageFiles = [];
  var manifestPath = path.join(ROOT, 'backups', '_dr-verify-seed', 'storage-manifest.json');
  if (fs.existsSync(manifestPath)) {
    try { storageFiles = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (e) { /* ignore */ }
  }

  var payload = {
    version: '1.1',
    tenantId: tenantId,
    exportedAt: new Date().toISOString(),
    profile: profile.exists ? profile.data() : null,
    registration: { users: registrations, rejected: rejected },
    attendance: attendance,
    complaints: complaints,
    feeCollections: feeCollections,
    staffLinks: staffLinks,
    parentLinks: parentLinks,
    staffPermissions: staffPermissions,
    storageFiles: storageFiles,
    modules: {}
  };
  payload.inventory = inventoryTenantPayload(payload);
  return payload;
}

async function main() {
  var args = parseArgs();
  if (!args.tenant) {
    console.error('Usage: node scripts/tenant-firestore-export.js --tenant=TENANT_UID [--out=path]');
    process.exit(1);
  }
  var admin = loadAdmin(args.project);
  var db = admin.firestore();
  var payload = await exportTenant(db, args.tenant);
  payload.inventory = inventoryTenantPayload(payload);

  var outPath = args.out || path.join(ROOT, 'backups', 'tenant-exports', args.tenant + '-' + Date.now() + '.json');
  writeJson(outPath, payload);
  console.log('[tenant-export] wrote', outPath);
  console.log('[tenant-export] inventory:', JSON.stringify(payload.inventory));
  return payload;
}

if (require.main === module) {
  main().catch(function (err) {
    console.error('[tenant-export] FAILED:', err.message);
    process.exit(1);
  });
}

module.exports = { exportTenant: exportTenant, loadAdmin: loadAdmin };
