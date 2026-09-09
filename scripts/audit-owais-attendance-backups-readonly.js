#!/usr/bin/env node
'use strict';

/** READ ONLY — search Owais Qarnai backup locations for embedded att_rec sheets. */
var fs = require('fs');
var os = require('os');
var path = require('path');
var ROOT = path.resolve(__dirname, '..');
var PROJECT = 'madrasa-mangment-app';
var TENANT = 'bpV58OqWSKhRbvXL57CvihIlDj63';
var OUT = path.join(ROOT, 'backups', 'owais-attendance-backup-audit-' + Date.now() + '.json');

async function setupCliCredentials() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return true;
  var files = [
    path.join(process.env.APPDATA || '', 'configstore', 'firebase-tools.json'),
    path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json')
  ];
  var configPath = files.find(function (file) { return file && fs.existsSync(file); });
  if (!configPath) return false;
  var config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  var defaults = require(path.join(ROOT, 'node_modules', 'firebase-tools', 'lib', 'defaultCredentials'));
  var credentialPath = await defaults.getCredentialPathAsync({ user: config.user, tokens: config.tokens });
  if (!credentialPath) return false;
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialPath;
  process.env.GCLOUD_PROJECT = PROJECT;
  return true;
}

function parseIdentity(id) {
  var match = String(id || '').match(/^att_rec_(\d{4}-\d{2})_(.+)$/);
  return match ? { month: match[1] } : null;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== 'object') return value;
  var proto = Object.getPrototypeOf ? Object.getPrototypeOf(value) : Object.prototype;
  if (proto && proto !== Object.prototype) return value;
  var out = {};
  Object.keys(value).forEach(function (key) { out[key] = clone(value[key]); });
  return out;
}

function fillMissing(target, parts, value) {
  var cursor = target;
  for (var i = 0; i < parts.length - 1; i++) {
    if (!cursor[parts[i]] || typeof cursor[parts[i]] !== 'object') cursor[parts[i]] = {};
    cursor = cursor[parts[i]];
  }
  var leaf = parts[parts.length - 1];
  if (!Object.prototype.hasOwnProperty.call(cursor, leaf)) cursor[leaf] = clone(value);
}

function normalizeSheet(raw) {
  var out = clone(raw || {});
  ['records', 'periodRecords', 'teacherPeriodRecords', 'remarks', 'late', 'dailyLocks'].forEach(function (root) {
    if (!out[root] || typeof out[root] !== 'object') out[root] = {};
  });
  Object.keys(raw || {}).forEach(function (key) {
    var match = key.match(/^(records|periodRecords|teacherPeriodRecords|remarks|late|dailyLocks)\.(.+)$/);
    if (!match) return;
    fillMissing(out[match[1]], match[2].split('.').filter(Boolean), raw[key]);
  });
  return out;
}

function meaningful(value) {
  return value != null && String(value).trim() !== '';
}

function sheetDates(id, raw) {
  var identity = parseIdentity(id);
  if (!identity) return {};
  var data = normalizeSheet(raw);
  var dates = Object.create(null);
  function add(day, count) {
    if (!/^\d{1,2}$/.test(String(day))) return;
    var date = identity.month + '-' + String(day).padStart(2, '0');
    dates[date] = (dates[date] || 0) + (count || 1);
  }
  Object.keys(data.records || {}).forEach(function (uid) {
    Object.keys(data.records[uid] || {}).forEach(function (day) {
      if (meaningful(data.records[uid][day])) add(day, 1);
    });
  });
  [data.periodRecords, data.teacherPeriodRecords].forEach(function (map) {
    Object.keys(map || {}).forEach(function (uid) {
      Object.keys(map[uid] || {}).forEach(function (day) {
        Object.keys(map[uid][day] || {}).forEach(function (periodId) {
          if (meaningful(map[uid][day][periodId])) add(day, 1);
        });
      });
    });
  });
  return dates;
}

function parseJsonString(value) {
  if (typeof value !== 'string') return null;
  var text = value.trim();
  if (!text || (text[0] !== '{' && text[0] !== '[')) return null;
  try { return JSON.parse(text); } catch (error) { return null; }
}

function makeCollector() {
  var sheets = [];
  var seen = Object.create(null);
  function add(source, id, data) {
    if (!parseIdentity(id) || !data || typeof data !== 'object') return;
    var signature = source + '|' + id;
    if (seen[signature]) return;
    seen[signature] = true;
    sheets.push({ source: source, id: id, dates: sheetDates(id, data), data: data });
  }
  function walk(value, source, depth) {
    if (depth > 12 || value == null) return;
    var parsed = parseJsonString(value);
    if (parsed != null) return walk(parsed, source + '#json', depth + 1);
    if (Array.isArray(value)) {
      value.forEach(function (item, index) { walk(item, source + '[' + index + ']', depth + 1); });
      return;
    }
    if (typeof value !== 'object') return;
    var embeddedId = String(value.id || value.docId || value.key || '');
    if (parseIdentity(embeddedId)) add(source, embeddedId, value.data && typeof value.data === 'object' ? value.data : value);
    Object.keys(value).forEach(function (key) {
      var child = value[key];
      if (parseIdentity(key)) {
        var childParsed = parseJsonString(child);
        add(source + '.' + key, key, childParsed || child);
      }
      walk(child, source + '.' + key, depth + 1);
    });
  }
  return { sheets: sheets, walk: walk, add: add };
}

async function scanCollection(collectionRef, collector, paths, depth) {
  if (depth > 6) return;
  var snap = await collectionRef.get();
  paths.push({ path: collectionRef.path, documents: snap.size });
  for (var i = 0; i < snap.docs.length; i++) {
    var doc = snap.docs[i];
    collector.walk(doc.data() || {}, doc.ref.path, 0);
    var subs = await doc.ref.listCollections();
    for (var j = 0; j < subs.length; j++) await scanCollection(subs[j], collector, paths, depth + 1);
  }
}

function combineCoverage(sheets) {
  var coverage = Object.create(null);
  (sheets || []).forEach(function (sheet) {
    Object.keys(sheet.dates || {}).forEach(function (date) {
      if (!coverage[date]) coverage[date] = { cells: 0, sources: Object.create(null) };
      coverage[date].cells += sheet.dates[date];
      coverage[date].sources[sheet.source + '|' + sheet.id] = true;
    });
  });
  return Object.keys(coverage).sort().map(function (date) {
    return { date: date, cells: coverage[date].cells, sourceCount: Object.keys(coverage[date].sources).length };
  });
}

function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value, function (key, item) {
    if (item && typeof item.toDate === 'function') return { _firestoreTimestamp: item.toDate().toISOString() };
    return item;
  }));
}

async function main() {
  if (!(await setupCliCredentials())) throw new Error('Firebase CLI credentials not found');
  var admin = require(path.join(ROOT, 'functions', 'node_modules', 'firebase-admin'));
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  var db = admin.firestore();
  var tenantRef = db.collection('All_Madrasas').doc(TENANT);
  var tenantSnap = await tenantRef.get();
  if (!tenantSnap.exists) throw new Error('Target tenant missing');

  var currentCollector = makeCollector();
  var currentSnap = await tenantRef.collection('Attendance').get();
  currentSnap.forEach(function (doc) { currentCollector.add(doc.ref.path, doc.id, doc.data() || {}); });

  var backupCollector = makeCollector();
  var scannedPaths = [];
  var targetCollections = ['Backup', 'BackupSnapshots', 'Attendance_Config', 'ModuleData'];
  for (var i = 0; i < targetCollections.length; i++) {
    await scanCollection(tenantRef.collection(targetCollections[i]), backupCollector, scannedPaths, 0);
  }
  var rootCollections = ['Madrasa_Backup', 'Platform_Backups'];
  for (var r = 0; r < rootCollections.length; r++) {
    var rootSnap = await db.collection(rootCollections[r]).get();
    scannedPaths.push({ path: rootCollections[r], documents: rootSnap.size });
    for (var d = 0; d < rootSnap.docs.length; d++) {
      var rootDoc = rootSnap.docs[d];
      var raw = rootDoc.data() || {};
      var text = JSON.stringify(jsonSafe(raw));
      if (text.indexOf(TENANT) < 0) continue;
      backupCollector.walk(raw, rootDoc.ref.path, 0);
      var nested = await rootDoc.ref.listCollections();
      for (var n = 0; n < nested.length; n++) await scanCollection(nested[n], backupCollector, scannedPaths, 1);
    }
  }

  var currentCoverage = combineCoverage(currentCollector.sheets);
  var backupCoverage = combineCoverage(backupCollector.sheets);
  var currentDates = Object.create(null);
  currentCoverage.forEach(function (row) { currentDates[row.date] = true; });
  var backupOnlyDates = backupCoverage.filter(function (row) { return !currentDates[row.date]; });
  var focusDates = backupCoverage.filter(function (row) { return /^2026-08-(26|27|28|29|30)$/.test(row.date); });
  var report = {
    ok: true,
    mode: 'read_only',
    createdAt: new Date().toISOString(),
    project: PROJECT,
    tenantId: TENANT,
    scannedPaths: scannedPaths,
    current: { sheets: currentCollector.sheets.length, coverage: currentCoverage },
    backups: {
      sheets: backupCollector.sheets.length,
      coverage: backupCoverage,
      backupOnlyDates: backupOnlyDates,
      focusDates2026Aug26To30: focusDates,
      sheetSources: backupCollector.sheets.map(function (sheet) {
        return { source: sheet.source, id: sheet.id, dates: sheet.dates };
      })
    },
    safetyNote: 'Read-only. No Firestore document was written, updated, or deleted.'
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({
    ok: true,
    mode: 'read_only',
    output: OUT,
    scannedCollectionCount: scannedPaths.length,
    currentSheets: currentCollector.sheets.length,
    currentDates: currentCoverage.length,
    backupSheets: backupCollector.sheets.length,
    backupDates: backupCoverage.length,
    backupOnlyDates: backupOnlyDates,
    focusDates2026Aug26To30: focusDates
  }, null, 2));
}

main().catch(function (error) {
  console.error(JSON.stringify({ ok: false, error: String(error && error.stack || error) }));
  process.exit(1);
});
