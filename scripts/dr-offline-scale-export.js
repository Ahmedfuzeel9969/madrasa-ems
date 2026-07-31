/**
 * Generate production-scale tenant export JSON without Firestore (offline DR verify).
 */
'use strict';

function makeScaleExport(students, opts) {
  opts = opts || {};
  var feesPerStudent = opts.feesPerStudent || 3;
  var attendanceSheets = opts.attendanceSheets || 12;
  var complaints = opts.complaints || 45;
  var storagePhotos = opts.storagePhotos || 100;
  var tenantId = opts.tenantId || 'dr-offline-tenant-1';
  var now = Date.now();

  var users = [];
  var rejected = [];
  var feeCollections = [];
  for (var i = 0; i < students; i++) {
    var id = 'STD-' + String(i + 1).padStart(5, '0');
    users.push({
      id: id, type: 'student', name: 'طالب ' + (i + 1),
      class: 'جماعت ' + ((i % 12) + 1), timestamp: now - i
    });
    if (i < 5) rejected.push({ id: 'REJ-' + id, name: 'Rejected ' + id });
    for (var f = 0; f < feesPerStudent; f++) {
      feeCollections.push({
        id: 'FEE-' + i + '-' + f, studentId: id, amount: 500 + f * 100
      });
    }
  }

  var attendance = [];
  for (var a = 0; a < attendanceSheets; a++) {
    attendance.push({
      id: 'ATT-2025-' + String((a % 12) + 1).padStart(2, '0') + '-sheet',
      data: { present: Math.floor(students * 0.85), absent: Math.floor(students * 0.15) }
    });
  }

  var complaintRows = [];
  for (var c = 0; c < complaints; c++) {
    complaintRows.push({ id: 'CMP-' + String(c + 1).padStart(4, '0'), subject: 'شکایت ' + (c + 1) });
  }

  var storageFiles = [];
  for (var p = 0; p < storagePhotos; p++) {
    storageFiles.push({
      path: 'registrations/' + tenantId + '/STD-' + String(p + 1).padStart(5, '0') + '.jpg',
      bytes: 2048
    });
  }

  return {
    version: '1.1',
    tenantId: tenantId,
    exportedAt: new Date().toISOString(),
    profile: { madrasaName: 'DR Offline Scale Madrasa', ownerUid: 'dr-owner-001' },
    registration: { users: users, rejected: rejected },
    attendance: attendance,
    complaints: complaintRows,
    feeCollections: feeCollections,
    staffLinks: [{ id: 'dr-teacher-001', staffId: 'STF-DR-01', status: 'active' }],
    parentLinks: [{ id: 'dr-parent-001', studentIds: ['STD-00001'], status: 'active' }],
    staffPermissions: [{
      id: 'STF-DR-01',
      staffId: 'STF-DR-01',
      modules: { attendance: true, admission: true, finance: true, complaints: true }
    }],
    storageFiles: storageFiles,
    modules: {}
  };
}

module.exports = { makeScaleExport: makeScaleExport };
