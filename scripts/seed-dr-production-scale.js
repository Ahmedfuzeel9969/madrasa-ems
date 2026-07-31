/**
 * Seed production-scale tenant data into Firestore emulator for DR verification.
 *
 * Usage (emulator must be running):
 *   set FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
 *   node scripts/seed-dr-production-scale.js
 *   node scripts/seed-dr-production-scale.js --students=1000
 */
'use strict';

const path = require('path');
const fs = require('fs');

var SCALE = {
  students: 1000,
  feesPerStudent: 3,
  attendanceSheets: 12,
  complaints: 45,
  storagePhotos: 100
};

process.argv.slice(2).forEach(function (arg) {
  if (arg.indexOf('--students=') === 0) {
    SCALE.students = parseInt(arg.split('=')[1], 10) || 1000;
  }
});

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

var ROOT = path.resolve(__dirname, '..');
var admin = require(path.join(ROOT, 'functions', 'node_modules', 'firebase-admin'));
if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'demo-madrasa-ems' });
}
var db = admin.firestore();

var TENANT_ID = 'dr-verify-tenant-1';
var OWNER_UID = 'dr-owner-001';
var TEACHER_UID = 'dr-teacher-001';
var PARENT_UID = 'dr-parent-001';

async function commitBatches(writes) {
  var BATCH = 400;
  for (var i = 0; i < writes.length; i += BATCH) {
    var batch = db.batch();
    writes.slice(i, i + BATCH).forEach(function (w) {
      batch.set(w.ref, w.data, { merge: true });
    });
    await batch.commit();
  }
}

async function wipeTenant(tenantId) {
  var base = db.collection('All_Madrasas').doc(tenantId);
  var subs = [
    'Registrations', 'Rejected', 'Attendance', 'Complaints',
    'FeeCollections', 'StaffLinks', 'ParentLinks', 'StaffPermissions'
  ];
  for (var s = 0; s < subs.length; s++) {
    var snap = await base.collection(subs[s]).get();
    var writes = [];
    snap.forEach(function (doc) {
      writes.push({ ref: doc.ref, data: null, delete: true });
    });
    for (var i = 0; i < writes.length; i += 400) {
      var batch = db.batch();
      snap.docs.slice(i, i + 400).forEach(function (doc) {
        batch.delete(doc.ref);
      });
      if (snap.docs.slice(i, i + 400).length) await batch.commit();
    }
  }
}

async function seedScale() {
  var now = Date.now();
  var base = db.collection('All_Madrasas').doc(TENANT_ID);
  await base.set({
    madrasaName: 'DR Verification Madrasa',
    ownerUid: OWNER_UID,
    email: 'owner@dr-verify.test',
    subStatus: 'active',
    seededAt: now,
    scaleStudents: SCALE.students
  }, { merge: true });

  var writes = [];

  for (var i = 0; i < SCALE.students; i++) {
    var id = 'STD-' + String(i + 1).padStart(5, '0');
    writes.push({
      ref: base.collection('Registrations').doc(id),
      data: {
        id: id,
        type: 'student',
        name: 'طالب ' + (i + 1),
        fname: 'ولی ' + (i + 1),
        class: 'جماعت ' + ((i % 12) + 1),
        phone: '0300' + String(1000000 + i),
        cnic: String(3520000000000 + i),
        departmentId: 'boys_dars',
        timestamp: now - i * 1000
      }
    });
    if (i < 5) {
      writes.push({
        ref: base.collection('Rejected').doc('REJ-' + id),
        data: { id: 'REJ-' + id, name: 'Rejected ' + id, timestamp: now }
      });
    }
    for (var f = 0; f < SCALE.feesPerStudent; f++) {
      writes.push({
        ref: base.collection('FeeCollections').doc('FEE-' + i + '-' + f),
        data: {
          id: 'FEE-' + i + '-' + f,
          studentId: id,
          amount: 500 + f * 100,
          date: '2025-06-' + String((f % 28) + 1).padStart(2, '0')
        }
      });
    }
  }

  for (var a = 0; a < SCALE.attendanceSheets; a++) {
    var month = '2025-' + String((a % 12) + 1).padStart(2, '0');
    writes.push({
      ref: base.collection('Attendance').doc('ATT-' + month + '-sheet'),
      data: {
        month: month,
        present: Math.floor(SCALE.students * 0.85),
        absent: Math.floor(SCALE.students * 0.15),
        updatedAt: now
      }
    });
  }

  for (var c = 0; c < SCALE.complaints; c++) {
    writes.push({
      ref: base.collection('Complaints').doc('CMP-' + String(c + 1).padStart(4, '0')),
      data: {
        id: 'CMP-' + String(c + 1).padStart(4, '0'),
        subject: 'شکایت ' + (c + 1),
        status: c % 3 === 0 ? 'open' : 'closed',
        createdAt: now - c * 60000
      }
    });
  }

  writes.push({
    ref: base.collection('StaffLinks').doc(TEACHER_UID),
    data: {
      staffId: 'STF-DR-01',
      email: 'teacher@dr-verify.test',
      name: 'DR Teacher',
      status: 'active',
      linkedUid: TEACHER_UID
    }
  });
  writes.push({
    ref: base.collection('StaffPermissions').doc('STF-DR-01'),
    data: {
      staffId: 'STF-DR-01',
      modules: { attendance: true, admission: true, finance: true, complaints: true },
      updatedAt: now
    }
  });
  writes.push({
    ref: base.collection('ParentLinks').doc(PARENT_UID),
    data: {
      studentIds: ['STD-00001'],
      email: 'parent@dr-verify.test',
      status: 'active',
      linkedUid: PARENT_UID
    }
  });

  console.log('[seed-dr] Writing', writes.length, 'documents …');
  await commitBatches(writes);

  var storageManifest = [];
  for (var p = 0; p < SCALE.storagePhotos; p++) {
    storageManifest.push({
      path: 'registrations/' + TENANT_ID + '/STD-' + String(p + 1).padStart(5, '0') + '.jpg',
      bytes: 2048,
      contentType: 'image/jpeg'
    });
  }

  var counts = {
    tenantId: TENANT_ID,
    registrations: SCALE.students,
    rejected: 5,
    fee_collections: SCALE.students * SCALE.feesPerStudent,
    attendance_registers: SCALE.attendanceSheets,
    complaints: SCALE.complaints,
    staff_permissions: 1,
    staff_links: 1,
    parent_links: 1,
    storage_files: storageManifest.length
  };

  var outDir = path.join(ROOT, 'backups', '_dr-verify-seed');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'expected-counts.json'), JSON.stringify(counts, null, 2));
  fs.writeFileSync(path.join(outDir, 'storage-manifest.json'), JSON.stringify(storageManifest, null, 2));

  console.log('[seed-dr] Tenant:', TENANT_ID);
  console.log('[seed-dr] Expected counts:', JSON.stringify(counts));
  return counts;
}

if (require.main === module) {
  seedScale().then(function () { process.exit(0); }).catch(function (err) {
    console.error('[seed-dr] FAIL:', err.message);
    process.exit(1);
  });
}

module.exports = { TENANT_ID: TENANT_ID, seedScale: seedScale, SCALE: SCALE, wipeTenant: wipeTenant };
