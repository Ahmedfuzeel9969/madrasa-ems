/**
 * Import tenant export JSON into Firestore (Admin SDK) — clean restore target.
 *
 * Usage:
 *   set FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
 *   node scripts/tenant-firestore-import.js --file=backups/dr-XXX/tenant-export.json
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { readJson, inventoryTenantPayload } = require('./backup-lib');

const ROOT = path.resolve(__dirname, '..');

function parseArgs() {
  var opts = { file: null, project: 'demo-madrasa-ems', wipe: true };
  process.argv.slice(2).forEach(function (arg) {
    if (arg.indexOf('--file=') === 0) opts.file = arg.split('=')[1];
    if (arg.indexOf('--project=') === 0) opts.project = arg.split('=')[1];
    if (arg === '--no-wipe') opts.wipe = false;
  });
  return opts;
}

function loadAdmin(projectId) {
  var admin = require(path.join(ROOT, 'functions', 'node_modules', 'firebase-admin'));
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: projectId });
  }
  return admin;
}

async function deleteCollection(ref) {
  var snap = await ref.get();
  if (snap.empty) return 0;
  var deleted = 0;
  for (var i = 0; i < snap.docs.length; i += 400) {
    var batch = ref.firestore.batch();
    snap.docs.slice(i, i + 400).forEach(function (doc) {
      batch.delete(doc.ref);
      deleted++;
    });
    await batch.commit();
  }
  return deleted;
}

async function wipeTenantCollections(db, tenantId) {
  var base = db.collection('All_Madrasas').doc(tenantId);
  var subs = ['Registrations', 'Rejected', 'Attendance', 'Complaints',
    'FeeCollections', 'StaffLinks', 'ParentLinks', 'StaffPermissions'];
  var total = 0;
  for (var i = 0; i < subs.length; i++) {
    total += await deleteCollection(base.collection(subs[i]));
  }
  return total;
}

async function importRows(db, tenantId, collectionName, rows, idField) {
  if (!rows || !rows.length) return 0;
  var base = db.collection('All_Madrasas').doc(tenantId).collection(collectionName);
  var imported = 0;
  for (var i = 0; i < rows.length; i += 400) {
    var batch = db.batch();
    rows.slice(i, i + 400).forEach(function (row) {
      var id = row.id || (idField && row[idField]) || ('row-' + i);
      var data = Object.assign({}, row);
      delete data.id;
      batch.set(base.doc(String(id)), data, { merge: true });
      imported++;
    });
    await batch.commit();
  }
  return imported;
}

async function importTenant(db, payload, opts) {
  opts = opts || {};
  var tenantId = payload.tenantId;
  if (!tenantId) throw new Error('tenantId missing in export');

  if (opts.wipe !== false) {
    await wipeTenantCollections(db, tenantId);
  }

  if (payload.profile) {
    await db.collection('All_Madrasas').doc(tenantId).set(payload.profile, { merge: true });
  }

  var reg = payload.registration || {};
  await importRows(db, tenantId, 'Registrations', reg.users || []);
  await importRows(db, tenantId, 'Rejected', reg.rejected || []);

  var att = payload.attendance || [];
  for (var a = 0; a < att.length; a += 400) {
    var batch = db.batch();
    att.slice(a, a + 400).forEach(function (item) {
      batch.set(
        db.collection('All_Madrasas').doc(tenantId).collection('Attendance').doc(item.id),
        item.data || {},
        { merge: true }
      );
    });
    await batch.commit();
  }

  await importRows(db, tenantId, 'Complaints', payload.complaints || []);
  await importRows(db, tenantId, 'FeeCollections', payload.feeCollections || []);
  await importRows(db, tenantId, 'StaffLinks', payload.staffLinks || []);
  await importRows(db, tenantId, 'ParentLinks', payload.parentLinks || []);
  await importRows(db, tenantId, 'StaffPermissions', payload.staffPermissions || []);

  return inventoryTenantPayload(payload);
}

async function main() {
  var args = parseArgs();
  if (!args.file) {
    console.error('Usage: node scripts/tenant-firestore-import.js --file=path/to/tenant-export.json');
    process.exit(1);
  }
  var filePath = path.isAbsolute(args.file) ? args.file : path.join(ROOT, args.file);
  var payload = readJson(filePath);
  var admin = loadAdmin(args.project);
  var db = admin.firestore();
  var before = inventoryTenantPayload(payload);
  await importTenant(db, payload, { wipe: args.wipe });
  console.log('[tenant-import] restored tenant', payload.tenantId);
  console.log('[tenant-import] expected inventory:', JSON.stringify(before));
  return before;
}

if (require.main === module) {
  main().catch(function (err) {
    console.error('[tenant-import] FAILED:', err.message);
    process.exit(1);
  });
}

module.exports = { importTenant: importTenant, wipeTenantCollections: wipeTenantCollections };
