#!/usr/bin/env node
'use strict';

/** READ ONLY — compares canonical attendance timetables across all tenants. */
var fs = require('fs');
var os = require('os');
var path = require('path');
var ROOT = path.resolve(__dirname, '..');
var PROJECT = 'madrasa-mangment-app';
var TARGET = 'bpV58OqWSKhRbvXL57CvihIlDj63';
var NAMES = ['سیف الرحمن', 'مطیع الرحمن'];

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

function norm(v) {
  return String(v || '').replace(/[\u064B-\u065F\u0670]/g, '').replace(/\s+/g, ' ').trim();
}

function parsePeriods(data) {
  if (!data) return [];
  var raw = data.data != null ? data.data : data.list;
  try {
    var parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) { return []; }
}

function profileName(profile) {
  return profile.name || profile.madrasaName || profile.instituteName || profile.organizationName || '';
}

async function main() {
  if (!(await setupCliCreds())) throw new Error('Firebase credentials not found');
  var admin = require(path.join(ROOT, 'functions', 'node_modules', 'firebase-admin'));
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  var db = admin.firestore();
  var tenants = await db.collection('All_Madrasas').get();
  var rows = [];
  for (var i = 0; i < tenants.docs.length; i++) {
    var tenantDoc = tenants.docs[i];
    var profile = tenantDoc.data() || {};
    var timetable = await tenantDoc.ref.collection('ModuleData').doc('Attendance__ems_att_periods').get();
    var periods = timetable.exists ? parsePeriods(timetable.data()) : [];
    var teacherIds = Object.create(null);
    var periodIds = Object.create(null);
    var nameHits = [];
    periods.forEach(function (period) {
      if (!period) return;
      if (period.id) periodIds[String(period.id)] = true;
      if (period.teacherId) teacherIds[String(period.teacherId)] = true;
      var teacherName = norm(period.teacherName);
      if (NAMES.some(function (name) { return teacherName.indexOf(norm(name)) >= 0; })) {
        nameHits.push({ teacherId: period.teacherId || '', teacherName: period.teacherName || '', periodId: period.id || '' });
      }
    });
    if (periods.length || nameHits.length || tenantDoc.id === TARGET) {
      rows.push({
        tenantId: tenantDoc.id,
        name: profileName(profile),
        email: profile.email || profile.ownerEmail || '',
        ownerUid: profile.ownerUid || '',
        timetableExists: timetable.exists,
        periodCount: periods.length,
        uniqueTeacherIdCount: Object.keys(teacherIds).length,
        uniquePeriodIdCount: Object.keys(periodIds).length,
        targetNameHits: nameHits
      });
    }
  }
  var target = rows.find(function (row) { return row.tenantId === TARGET; }) || null;
  var targetPeriodIds = Object.create(null);
  if (target) {
    var targetSnap = await db.collection('All_Madrasas').doc(TARGET).collection('ModuleData')
      .doc('Attendance__ems_att_periods').get();
    parsePeriods(targetSnap.exists ? targetSnap.data() : null).forEach(function (p) {
      if (p && p.id) targetPeriodIds[p.id] = true;
    });
  }
  for (var j = 0; j < rows.length; j++) {
    var row = rows[j];
    if (row.tenantId === TARGET || !Object.keys(targetPeriodIds).length) { row.sharedTargetPeriodIds = 0; continue; }
    var otherSnap = await db.collection('All_Madrasas').doc(row.tenantId).collection('ModuleData')
      .doc('Attendance__ems_att_periods').get();
    var shared = 0;
    parsePeriods(otherSnap.exists ? otherSnap.data() : null).forEach(function (p) {
      if (p && targetPeriodIds[p.id]) shared++;
    });
    row.sharedTargetPeriodIds = shared;
  }
  console.log(JSON.stringify({
    ok: true,
    tenantCountScanned: tenants.size,
    targetTenant: target,
    tenantsWithTimetable: rows,
    otherTenantsWithNamedTeachers: rows.filter(function (r) { return r.tenantId !== TARGET && r.targetNameHits.length; }),
    otherTenantsSharingTargetPeriodIds: rows.filter(function (r) { return r.tenantId !== TARGET && r.sharedTargetPeriodIds > 0; })
  }, null, 2));
}

main().catch(function (err) {
  console.error(JSON.stringify({ ok: false, error: String(err && err.message || err) }));
  process.exit(1);
});
