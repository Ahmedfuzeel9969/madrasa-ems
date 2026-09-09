#!/usr/bin/env node
'use strict';
var fs = require('fs');
var path = require('path');
var os = require('os');

var ROOT = path.resolve(__dirname, '..');
var PROJECT = 'madrasa-mangment-app';
var B = 'bpV58OqWSKhRbvXL57CvihIlDj63';
var A_IDS = ['PRD-35564', 'PRD-17050', 'PRD-54109', 'PRD-23887'];

async function setupCliCreds() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return true;
  var cfgPath = path.join(process.env.APPDATA || '', 'configstore', 'firebase-tools.json');
  if (!fs.existsSync(cfgPath)) return false;
  var cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  var defaultCreds = require(path.join(ROOT, 'node_modules/firebase-tools/lib/defaultCredentials'));
  var credPath = await defaultCreds.getCredentialPathAsync({ user: cfg.user, tokens: cfg.tokens });
  if (!credPath) return false;
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credPath;
  return true;
}

function parseDocId(docId) {
  if (!docId || docId.indexOf('att_rec_') !== 0) return null;
  var rest = docId.slice('att_rec_'.length);
  var parts = rest.split('_');
  if (parts.length < 4) return null;
  return {
    month: parts[0],
    type: parts[1],
    classId: parts.slice(2, parts.length - 1).join('_'),
    period: parts[parts.length - 1],
    docId: docId
  };
}

function addPeriod(map, pid, meta) {
  if (!map[pid]) {
    map[pid] = { periodId: pid, classIds: {}, months: {}, types: {}, docIds: [], fromBodyOnly: true };
  }
  var p = map[pid];
  if (meta.classId) { p.classIds[meta.classId] = true; p.fromBodyOnly = false; }
  if (meta.month) p.months[meta.month] = true;
  if (meta.type) p.types[meta.type] = true;
  if (meta.docId && p.docIds.length < 5) p.docIds.push(meta.docId);
  if (meta.fromBody) p.fromBody = true;
}

function scanBody(data, map) {
  if (!data || !data.periodRecords) return;
  Object.keys(data.periodRecords).forEach(function (uid) {
    var days = data.periodRecords[uid] || {};
    Object.keys(days).forEach(function (day) {
      var pmap = days[day] || {};
      Object.keys(pmap).forEach(function (pid) {
        if (/^PRD-/.test(pid)) addPeriod(map, pid, { fromBody: true });
      });
    });
  });
}

async function main() {
  if (!(await setupCliCreds())) {
    console.error('no credentials');
    process.exit(2);
  }
  var admin = require(path.join(ROOT, 'functions', 'node_modules', 'firebase-admin'));
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  var db = admin.firestore();
  var map = Object.create(null);

  var attSnap = await db.collection('All_Madrasas').doc(B).collection('Attendance').get();
  attSnap.forEach(function (doc) {
    var parsed = parseDocId(doc.id);
    var data = doc.data() || {};
    if (parsed && /^PRD-/.test(parsed.period)) {
      addPeriod(map, parsed.period, {
        classId: parsed.classId,
        month: parsed.month,
        type: parsed.type,
        docId: doc.id
      });
    }
    scanBody(data, map);
  });

  var periods = Object.keys(map).sort().map(function (pid) {
    var p = map[pid];
    return {
      periodId: pid,
      isAContamination: A_IDS.indexOf(pid) >= 0,
      classIds: Object.keys(p.classIds),
      months: Object.keys(p.months).sort(),
      registerTypes: Object.keys(p.types),
      docRefCount: p.docIds.length,
      sampleDocIds: p.docIds,
      fromBodyOnly: p.fromBodyOnly && !p.docIds.length
    };
  });

  var recoverable = periods.filter(function (p) { return !p.isAContamination; });
  var withClass = recoverable.filter(function (p) { return p.classIds.length; });

  var out = {
    tenant: B,
    attendanceDocCount: attSnap.size,
    uniquePrdCount: periods.length,
    recoverablePrdCount: recoverable.length,
    withClassBindingCount: withClass.length,
    bodyOnlyCount: recoverable.filter(function (p) { return p.fromBodyOnly; }).length,
    aContaminated: periods.filter(function (p) { return p.isAContamination; }),
    periods: recoverable
  };

  var outPath = path.resolve(__dirname, '..', '..', '..', 'b-period-recovery-map.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify({
    written: outPath,
    uniquePrdCount: out.uniquePrdCount,
    recoverablePrdCount: out.recoverablePrdCount,
    withClassBindingCount: out.withClassBindingCount
  }, null, 2));
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
