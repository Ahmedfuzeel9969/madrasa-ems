#!/usr/bin/env node
'use strict';

/** READ ONLY — searches known timetable/teacher locations without writing to Firebase. */
var fs = require('fs');
var os = require('os');
var path = require('path');
var ROOT = path.resolve(__dirname, '..');
var PROJECT = 'madrasa-mangment-app';
var TENANT = process.argv.find(function (a) { return a.indexOf('--tenant=') === 0; });
TENANT = TENANT ? TENANT.split('=').slice(1).join('=') : 'bpV58OqWSKhRbvXL57CvihIlDj63';
var NAMES = ['قاری سیف الرحمن', 'سیف الرحمن', 'مطیع الرحمن'];

async function setupCliCreds() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return true;
  var candidates = [
    path.join(process.env.APPDATA || '', 'configstore', 'firebase-tools.json'),
    path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json')
  ];
  var cfgPath = candidates.find(function (p) { return p && fs.existsSync(p); });
  if (!cfgPath) return false;
  var cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  var defaults = require(path.join(ROOT, 'node_modules/firebase-tools/lib/defaultCredentials'));
  var credPath = await defaults.getCredentialPathAsync({ user: cfg.user, tokens: cfg.tokens });
  if (!credPath) return false;
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credPath;
  process.env.GCLOUD_PROJECT = PROJECT;
  return true;
}

function normalize(value) {
  return String(value || '').replace(/[\u064B-\u065F\u0670]/g, '').replace(/\s+/g, ' ').trim();
}

function matchesName(value) {
  var text = normalize(value);
  return NAMES.some(function (name) { return text.indexOf(normalize(name)) >= 0; });
}

function scanValue(value, pathParts, hits, docPath) {
  if (typeof value === 'string' && matchesName(value)) {
    hits.push({
      document: docPath,
      field: pathParts.join('.'),
      value: value.length > 300 ? '[matching large data blob omitted]' : value
    });
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach(function (item, i) { scanValue(item, pathParts.concat(String(i)), hits, docPath); });
    return;
  }
  Object.keys(value).forEach(function (key) {
    scanValue(value[key], pathParts.concat(key), hits, docPath);
  });
}

function parsePeriods(data) {
  if (!data) return [];
  var raw = data.data != null ? data.data : data.list;
  try {
    var parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) { return []; }
}

async function scanCollection(base, name, hits, counts) {
  var snap = await base.collection(name).get();
  counts[name] = snap.size;
  snap.forEach(function (doc) { scanValue(doc.data() || {}, [], hits, doc.ref.path); });
}

async function main() {
  if (!(await setupCliCreds())) throw new Error('Firebase credentials not found');
  var admin = require(path.join(ROOT, 'functions', 'node_modules', 'firebase-admin'));
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  var db = admin.firestore();
  var base = db.collection('All_Madrasas').doc(TENANT);
  var tenantProfileSnap = await base.get();
  var tenantProfile = tenantProfileSnap.exists ? tenantProfileSnap.data() || {} : {};
  var hits = [];
  var counts = {};
  var collections = ['Registration', 'Registrations', 'Staff_Links', 'StaffLinks', 'Attendance', 'ModuleData', 'Attendance_Config'];
  for (var i = 0; i < collections.length; i++) {
    await scanCollection(base, collections[i], hits, counts);
  }
  var canonical = await base.collection('ModuleData').doc('Attendance__ems_att_periods').get();
  var legacy = await base.collection('Attendance_Config').doc('periods').get();
  var foreignArchive = await base.collection('Attendance_Config').doc('periods_foreign_archive').get();
  var canonicalPeriods = canonical.exists ? parsePeriods(canonical.data()) : [];
  var legacyPeriods = legacy.exists ? parsePeriods(legacy.data()) : [];
  var archivePeriods = foreignArchive.exists ? parsePeriods(foreignArchive.data()) : [];
  var teacherIds = Object.create(null);
  var teacherNames = Object.create(null);
  canonicalPeriods.forEach(function (period) {
    if (period && period.teacherId) teacherIds[String(period.teacherId)] = true;
    if (period && period.teacherName) teacherNames[normalize(period.teacherName)] = true;
  });
  var registrationsSnap = await base.collection('Registrations').get();
  var registeredTeachers = [];
  registrationsSnap.forEach(function (doc) {
    var data = doc.data() || {};
    var kind = normalize(data.type || data.role || data.userType).toLowerCase();
    var id = String(data.id || doc.id);
    if (kind === 'teacher' || /^TCH-|^CTCH-/.test(id)) {
      registeredTeachers.push({ id: id, name: data.name || '', type: kind });
    }
  });
  console.log(JSON.stringify({
    ok: true,
    project: PROJECT,
    tenant: TENANT,
    tenantProfile: {
      name: tenantProfile.name || tenantProfile.madrasaName || tenantProfile.instituteName || tenantProfile.organizationName || '',
      email: tenantProfile.email || tenantProfile.ownerEmail || '',
      ownerUid: tenantProfile.ownerUid || '',
      city: tenantProfile.city || tenantProfile.address || ''
    },
    searchedNames: NAMES,
    collectionCounts: counts,
    nameHits: hits,
    timetable: {
      canonicalPath: base.path + '/ModuleData/Attendance__ems_att_periods',
      canonicalExists: canonical.exists,
      canonicalCount: canonicalPeriods.length,
      canonicalUniqueTeacherIdCount: Object.keys(teacherIds).length,
      canonicalUniqueTeacherNameCount: Object.keys(teacherNames).length,
      registeredTeacherCount: registeredTeachers.length,
      registeredNameHits: registeredTeachers.filter(function (t) { return matchesName(t.name); }),
      canonicalNameHits: canonicalPeriods.filter(function (p) { return matchesName(JSON.stringify(p)); }),
      legacyPath: base.path + '/Attendance_Config/periods',
      legacyExists: legacy.exists,
      legacyCount: legacyPeriods.length,
      legacyNameHits: legacyPeriods.filter(function (p) { return matchesName(JSON.stringify(p)); }),
      foreignArchiveExists: foreignArchive.exists,
      foreignArchiveCount: archivePeriods.length,
      foreignArchiveNameHits: archivePeriods.filter(function (p) { return matchesName(JSON.stringify(p)); })
    }
  }, null, 2));
}

main().catch(function (err) {
  console.error(JSON.stringify({ ok: false, error: String(err && err.message || err) }));
  process.exit(1);
});
