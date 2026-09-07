#!/usr/bin/env node
'use strict';

/**
 * Attendance hardening — Phase 0 preservation snapshot.
 *
 * Firebase access is READ ONLY. The script writes only ignored local files
 * below backups/attendance-phase0-*. It inventories every tenant's attendance
 * partition and recursively exports the selected tenant document tree so no
 * timetable, registration, attendance, or nested recovery evidence is omitted.
 */
var crypto = require('crypto');
var fs = require('fs');
var os = require('os');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var DEFAULT_PROJECT = 'madrasa-mangment-app';
var DEFAULT_TARGET = 'bpV58OqWSKhRbvXL57CvihIlDj63';
var DEFAULT_EXPECTED = { teachers: 47, students: 180, periods: 103 };

function readArg(name, fallback) {
  var prefix = '--' + name + '=';
  var found = process.argv.find(function (arg) { return arg.indexOf(prefix) === 0; });
  return found ? found.slice(prefix.length) : fallback;
}

function positiveIntArg(name, fallback) {
  var value = Number(readArg(name, fallback));
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function stampNow() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function sha256(value) {
  var input = Buffer.isBuffer(value) ? value : Buffer.from(String(value == null ? '' : value), 'utf8');
  return crypto.createHash('sha256').update(input).digest('hex');
}

function normalize(value) {
  return String(value || '')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[ـ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function jsonSafe(value) {
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return { _firestoreType: 'bytes', base64: value.toString('base64') };
  }
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value.toDate === 'function') {
    return { _firestoreType: 'timestamp', iso: value.toDate().toISOString() };
  }
  if (value && typeof value.path === 'string' && value.firestore) {
    return { _firestoreType: 'reference', path: value.path };
  }
  if (value && typeof value.latitude === 'number' && typeof value.longitude === 'number') {
    return { _firestoreType: 'geopoint', latitude: value.latitude, longitude: value.longitude };
  }
  if (typeof value === 'object') {
    var out = {};
    Object.keys(value).sort().forEach(function (key) { out[key] = jsonSafe(value[key]); });
    return out;
  }
  return String(value);
}

function stableStringify(value) {
  return JSON.stringify(jsonSafe(value));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

async function setupCliCredentials(projectId) {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return true;
  var candidates = [
    path.join(process.env.APPDATA || '', 'configstore', 'firebase-tools.json'),
    path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json')
  ];
  var configPath = candidates.find(function (candidate) { return candidate && fs.existsSync(candidate); });
  if (!configPath) return false;
  var config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  var defaults = require(path.join(ROOT, 'node_modules', 'firebase-tools', 'lib', 'defaultCredentials'));
  var credentialPath = await defaults.getCredentialPathAsync({ user: config.user, tokens: config.tokens });
  if (!credentialPath) return false;
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialPath;
  process.env.GCLOUD_PROJECT = projectId;
  return true;
}

function loadAdmin(projectId) {
  var admin = require(path.join(ROOT, 'functions', 'node_modules', 'firebase-admin'));
  if (!admin.apps.length) admin.initializeApp({ projectId: projectId });
  return admin;
}

function personId(row, fallback) {
  return String(row && (row.id || row.regId || row.uid || row.docId) || fallback || '').trim();
}

function personKind(row, fallbackId) {
  var id = personId(row, fallbackId);
  var type = normalize(row && (row.type || row.role || row.userType));
  if (['teacher', 'teachers', 'استاد', 'اساتذہ'].indexOf(type) >= 0 || /^T(CH|CR)[\W_-]?/i.test(id)) {
    return 'teacher';
  }
  if (['student', 'students', 'طالب علم', 'طالب'].indexOf(type) >= 0 || /^ST(D|U)[\W_-]?/i.test(id)) {
    return 'student';
  }
  if (['staff', 'employee', 'عملہ', 'ملازم'].indexOf(type) >= 0 || /^STF[\W_-]?/i.test(id)) {
    return 'staff';
  }
  return 'other';
}

function parseTimetableList(data) {
  var value = data && data.data != null ? data.data : data;
  for (var i = 0; i < 4; i++) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object' && value.data != null) {
      value = value.data;
      continue;
    }
    if (typeof value !== 'string') return [];
    try { value = JSON.parse(value); } catch (e) { return []; }
  }
  return Array.isArray(value) ? value : [];
}

function parseAttendanceId(docId) {
  if (String(docId || '').indexOf('att_rec_') !== 0) return null;
  var parts = String(docId).slice('att_rec_'.length).split('_');
  if (parts.length < 4) return null;
  return {
    month: parts[0],
    type: parts[1],
    classId: parts.slice(2, -1).join('_'),
    periodId: parts[parts.length - 1],
    canonical: parts[parts.length - 1] === 'all'
  };
}

function hasMark(value) {
  return value != null && String(value).trim() !== '';
}

function addDate(dateSet, month, day) {
  var number = parseInt(day, 10);
  if (!/^\d{4}-\d{2}$/.test(String(month || '')) || number < 1 || number > 31) return;
  dateSet[month + '-' + String(number).padStart(2, '0')] = true;
}

function countDayMap(map, month, dateSet) {
  var count = 0;
  Object.keys(map || {}).forEach(function (uid) {
    Object.keys(map[uid] || {}).forEach(function (day) {
      if (!hasMark(map[uid][day])) return;
      count++;
      addDate(dateSet, month, day);
    });
  });
  return count;
}

function countPeriodMap(map, month, dateSet, periodSet) {
  var count = 0;
  Object.keys(map || {}).forEach(function (uid) {
    Object.keys(map[uid] || {}).forEach(function (day) {
      Object.keys(map[uid][day] || {}).forEach(function (periodId) {
        if (!hasMark(map[uid][day][periodId])) return;
        count++;
        addDate(dateSet, month, day);
        if (periodId) periodSet[periodId] = true;
      });
    });
  });
  return count;
}

function summarizeAttendance(attendanceSnap) {
  var datesAll = Object.create(null);
  var datesCanonical = Object.create(null);
  var periods = Object.create(null);
  var docHashes = [];
  var summary = {
    documentCount: attendanceSnap.size,
    canonicalDocumentCount: 0,
    legacyDocumentCount: 0,
    unparsedDocumentCount: 0,
    dailyMarksAll: 0,
    periodMarksAll: 0,
    dailyMarksCanonical: 0,
    periodMarksCanonical: 0,
    maxDocumentBytes: 0,
    documentsOver700KiB: [],
    months: [],
    attendanceDates: [],
    attendancePeriodIds: [],
    checksumSha256: ''
  };
  var months = Object.create(null);
  attendanceSnap.docs.slice().sort(function (a, b) { return a.id.localeCompare(b.id); }).forEach(function (doc) {
    var data = doc.data() || {};
    var safeData = jsonSafe(data);
    var bytes = Buffer.byteLength(JSON.stringify(safeData), 'utf8');
    summary.maxDocumentBytes = Math.max(summary.maxDocumentBytes, bytes);
    if (bytes >= 700 * 1024) summary.documentsOver700KiB.push({ id: doc.id, bytes: bytes });
    docHashes.push({ id: doc.id, data: safeData });
    var parsed = parseAttendanceId(doc.id);
    if (!parsed) {
      summary.unparsedDocumentCount++;
      return;
    }
    months[parsed.month] = true;
    if (parsed.canonical) summary.canonicalDocumentCount++;
    else summary.legacyDocumentCount++;
    if (/^PRD-/.test(parsed.periodId)) periods[parsed.periodId] = true;
    var daily = countDayMap(data.records, parsed.month, datesAll);
    var period = countPeriodMap(data.periodRecords, parsed.month, datesAll, periods)
      + countPeriodMap(data.teacherPeriodRecords, parsed.month, datesAll, periods);
    summary.dailyMarksAll += daily;
    summary.periodMarksAll += period;
    if (parsed.canonical) {
      summary.dailyMarksCanonical += countDayMap(data.records, parsed.month, datesCanonical);
      summary.periodMarksCanonical += countPeriodMap(data.periodRecords, parsed.month, datesCanonical, periods)
        + countPeriodMap(data.teacherPeriodRecords, parsed.month, datesCanonical, periods);
    }
  });
  summary.months = Object.keys(months).sort();
  summary.attendanceDates = Object.keys(datesAll).sort();
  summary.canonicalAttendanceDates = Object.keys(datesCanonical).sort();
  summary.attendancePeriodIds = Object.keys(periods).sort();
  summary.checksumSha256 = sha256(stableStringify(docHashes));
  return summary;
}

function summarizeRegistrations(registrationSnap) {
  var counts = { documents: registrationSnap.size, teachers: 0, students: 0, staff: 0, other: 0 };
  var teacherIds = Object.create(null);
  registrationSnap.forEach(function (doc) {
    var row = doc.data() || {};
    var kind = personKind(row, doc.id);
    if (kind === 'teacher') {
      counts.teachers++;
      teacherIds[personId(row, doc.id)] = true;
    } else if (kind === 'student') counts.students++;
    else if (kind === 'staff') counts.staff++;
    else counts.other++;
  });
  counts.teacherIds = Object.keys(teacherIds).sort();
  return counts;
}

async function snapshotDocumentTree(docRef, knownSnap) {
  var snap = knownSnap || await docRef.get();
  var collections = {};
  var subcollections = await docRef.listCollections();
  subcollections.sort(function (a, b) { return a.id.localeCompare(b.id); });
  for (var i = 0; i < subcollections.length; i++) {
    var collection = subcollections[i];
    var collectionSnap = await collection.get();
    var sortedDocs = collectionSnap.docs.slice().sort(function (a, b) { return a.id.localeCompare(b.id); });
    // listCollections() is a network request even when a document has no
    // children. A small bounded pool keeps the complete recursive scan usable
    // without creating an unbounded burst against production Firestore.
    var documents = await mapWithConcurrency(sortedDocs, 8, function (doc) {
      return snapshotDocumentTree(doc.ref, doc);
    });
    collections[collection.id] = documents;
  }
  return {
    id: docRef.id,
    path: docRef.path,
    exists: snap.exists,
    data: snap.exists ? jsonSafe(snap.data() || {}) : null,
    collections: collections
  };
}

async function inventoryTenant(db, tenantDoc) {
  var tenantId = tenantDoc.id;
  var base = tenantDoc.ref;
  var reads = await Promise.all([
    base.collection('Registrations').get(),
    base.collection('Attendance').get(),
    base.collection('ModuleData').doc('Attendance__ems_att_periods').get()
  ]);
  var profile = tenantDoc.data() || {};
  var registrations = summarizeRegistrations(reads[0]);
  var attendance = summarizeAttendance(reads[1]);
  var timetableData = reads[2].exists ? reads[2].data() || {} : {};
  var timetable = parseTimetableList(timetableData);
  var periodIds = Object.create(null);
  var boundTeachers = 0;
  timetable.forEach(function (period) {
    var periodId = String(period && (period.id || period.periodId) || '').trim();
    if (periodId) periodIds[periodId] = true;
    if (period && registrations.teacherIds.indexOf(String(period.teacherId || '').trim()) >= 0) boundTeachers++;
  });
  var timetablePayload = String(timetableData.data == null ? '' : timetableData.data);
  return {
    tenantId: tenantId,
    tenantName: profile.name || profile.madrasaName || profile.instituteName || '',
    profileStatus: profile.status || profile.accountStatus || '',
    registrations: registrations,
    attendance: attendance,
    timetable: {
      exists: reads[2].exists,
      documentPath: reads[2].ref.path,
      periodCount: timetable.length,
      uniquePeriodCount: Object.keys(periodIds).length,
      registeredTeacherBindingCount: boundTeachers,
      payloadSha256: sha256(timetablePayload)
    }
  };
}

async function mapWithConcurrency(items, limit, handler) {
  var output = new Array(items.length);
  var next = 0;
  async function worker() {
    while (true) {
      var index = next++;
      if (index >= items.length) return;
      output[index] = await handler(items[index], index);
    }
  }
  var workers = [];
  for (var i = 0; i < Math.min(limit, items.length); i++) workers.push(worker());
  await Promise.all(workers);
  return output;
}

function fileManifest(filePath) {
  var data = fs.readFileSync(filePath);
  return {
    file: path.relative(ROOT, filePath).replace(/\\/g, '/'),
    bytes: data.length,
    sha256: sha256(data)
  };
}

function hashSourceFiles() {
  var names = [
    'firestore.rules', 'firestore.indexes.json', 'attendance.js', 'attendance-helper.js',
    'att-collective.js', 'att-collective-view.js', 'att-dashboard.js', 'att-metrics.js',
    'ems-offline-write.js', 'ems-tenant-storage.js',
    'functions/lib/tenant-dashboard-stats.js', 'functions/lib/attendance-final-state.js'
  ];
  return names.filter(function (name) { return fs.existsSync(path.join(ROOT, name)); }).map(function (name) {
    return fileManifest(path.join(ROOT, name));
  });
}

async function main() {
  var projectId = readArg('project', DEFAULT_PROJECT);
  var targetTenantId = readArg('target', DEFAULT_TARGET);
  var expected = {
    teachers: positiveIntArg('expected-teachers', DEFAULT_EXPECTED.teachers),
    students: positiveIntArg('expected-students', DEFAULT_EXPECTED.students),
    periods: positiveIntArg('expected-periods', DEFAULT_EXPECTED.periods)
  };
  var outDir = path.resolve(ROOT, readArg('out', path.join('backups', 'attendance-phase0-' + stampNow())));
  if (!(await setupCliCredentials(projectId))) throw new Error('Firebase CLI credentials not found');
  var admin = loadAdmin(projectId);
  var db = admin.firestore();

  console.error('[phase0] reading tenant list — Firebase writes are disabled by design');
  var tenantSnap = await db.collection('All_Madrasas').get();
  var tenantDocs = tenantSnap.docs.slice().sort(function (a, b) { return a.id.localeCompare(b.id); });
  var inventories = await mapWithConcurrency(tenantDocs, 6, async function (tenantDoc, index) {
    console.error('[phase0] tenant ' + (index + 1) + '/' + tenantDocs.length + ' · ' + tenantDoc.id);
    return inventoryTenant(db, tenantDoc);
  });
  var targetInventory = inventories.find(function (row) { return row.tenantId === targetTenantId; });
  if (!targetInventory) throw new Error('Target tenant not found: ' + targetTenantId);

  var targetDoc = tenantDocs.find(function (doc) { return doc.id === targetTenantId; });
  console.error('[phase0] recursively exporting target tenant tree');
  var targetTree = await snapshotDocumentTree(targetDoc.ref, targetDoc);
  var targetTreeChecksum = sha256(stableStringify(targetTree));

  var inventoryPath = path.join(outDir, 'all-tenants-attendance-inventory.json');
  var targetPath = path.join(outDir, 'target-full-tenant-tree.json');
  var baselinePath = path.join(outDir, 'target-attendance-baseline.json');
  writeJson(inventoryPath, {
    version: 1,
    mode: 'read_only',
    createdAt: new Date().toISOString(),
    projectId: projectId,
    tenantCount: inventories.length,
    tenants: inventories,
    safetyNote: 'No Firebase document was created, updated, moved, or deleted.'
  });
  writeJson(targetPath, {
    version: 1,
    mode: 'read_only_full_tenant_tree',
    createdAt: new Date().toISOString(),
    projectId: projectId,
    tenantId: targetTenantId,
    treeSha256: targetTreeChecksum,
    tree: targetTree,
    safetyNote: 'Complete recursive tenant document tree. No Firebase write API is used.'
  });

  var checks = {
    targetNameMatches: normalize(targetInventory.tenantName).indexOf(normalize('اویس قرنی')) >= 0,
    teacherCountMatches: targetInventory.registrations.teachers === expected.teachers,
    studentCountMatches: targetInventory.registrations.students === expected.students,
    timetableCountMatches: targetInventory.timetable.periodCount === expected.periods,
    timetableIdsUnique: targetInventory.timetable.uniquePeriodCount === expected.periods,
    timetableTeachersBound: targetInventory.timetable.registeredTeacherBindingCount === expected.periods,
    noLargeAttendanceDocument: targetInventory.attendance.documentsOver700KiB.length === 0
  };
  var checksOk = Object.keys(checks).every(function (key) { return checks[key]; });
  writeJson(baselinePath, {
    version: 1,
    mode: 'read_only_verified_baseline',
    createdAt: new Date().toISOString(),
    projectId: projectId,
    tenantId: targetTenantId,
    expected: expected,
    checks: checks,
    ok: checksOk,
    inventory: targetInventory,
    targetTreeSha256: targetTreeChecksum,
    safetyNote: 'Baseline must pass before any attendance hardening write or migration.'
  });

  var files = [inventoryPath, targetPath, baselinePath].map(fileManifest);
  var manifestPath = path.join(outDir, 'phase0-manifest.json');
  var manifest = {
    version: 1,
    type: 'attendance-phase0-preservation',
    mode: 'read_only',
    createdAt: new Date().toISOString(),
    projectId: projectId,
    targetTenantId: targetTenantId,
    tenantCount: inventories.length,
    checksOk: checksOk,
    checks: checks,
    target: targetInventory,
    files: files,
    sourceFiles: hashSourceFiles(),
    recoveryGate: checksOk ? 'PASS' : 'STOP',
    safetyNote: 'No Firebase writes. All output is local under backups/.'
  };
  writeJson(manifestPath, manifest);

  console.log(JSON.stringify({
    ok: checksOk,
    mode: 'read_only',
    outputDirectory: outDir,
    manifest: manifestPath,
    tenantCount: inventories.length,
    target: targetInventory,
    targetTreeSha256: targetTreeChecksum,
    checks: checks
  }, null, 2));
  if (!checksOk) process.exitCode = 2;
}

if (require.main === module) {
  main().catch(function (error) {
    console.error(JSON.stringify({ ok: false, error: String(error && error.stack || error) }));
    process.exit(1);
  });
}

module.exports = {
  jsonSafe: jsonSafe,
  stableStringify: stableStringify,
  parseTimetableList: parseTimetableList,
  parseAttendanceId: parseAttendanceId,
  summarizeAttendance: summarizeAttendance,
  summarizeRegistrations: summarizeRegistrations,
  snapshotDocumentTree: snapshotDocumentTree,
  sha256: sha256,
  setupCliCredentials: setupCliCredentials,
  loadAdmin: loadAdmin
};
