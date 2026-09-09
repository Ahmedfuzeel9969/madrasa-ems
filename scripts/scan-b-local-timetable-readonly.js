#!/usr/bin/env node
'use strict';
var fs = require('fs');
var path = require('path');

var B = 'bpV58OqWSKhRbvXL57CvihIlDj63';
var SCOPED = 'ems_t_' + B + '__ems_att_periods';
var QUAR = SCOPED + '_quarantine_v1';
var RECOVERY = 'ems_timetable_recovery_v1__' + B;
var GLOBAL = 'ems_att_periods';
var A_IDS = ['PRD-35564', 'PRD-17050', 'PRD-54109', 'PRD-23887'];

var roots = [
  path.join(process.env.APPDATA || '', 'madrasa-ems'),
  path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data'),
  path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'User Data')
];

function walk(dir, out) {
  var ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  ents.forEach(function (ent) {
    var p = path.join(dir, ent.name);
    if (ent.isDirectory()) return walk(p, out);
    if (!ent.isFile()) return;
    try {
      var st = fs.statSync(p);
      if (st.size > 30 * 1024 * 1024) return;
      out.push(p);
    } catch (e2) { /* ignore */ }
  });
}

function tryParsePeriodArray(text, key) {
  var idx = text.indexOf(key);
  if (idx < 0) return null;
  var chunk = text.slice(idx, idx + 3000000);
  var best = null;
  for (var i = 0; i < chunk.length; i++) {
    if (chunk.charAt(i) !== '[') continue;
    var depth = 0;
    var end = -1;
    for (var j = i; j < chunk.length; j++) {
      var c = chunk.charAt(j);
      if (c === '[') depth++;
      else if (c === ']') {
        depth--;
        if (depth === 0) { end = j + 1; break; }
      }
    }
    if (end <= i) continue;
    try {
      var arr = JSON.parse(chunk.slice(i, end));
      if (!Array.isArray(arr) || !arr.length || !arr[0] || !arr[0].id) continue;
      if (!best || arr.length > best.count) {
        best = { count: arr.length, ids: arr.map(function (p) { return p && p.id; }).filter(Boolean), sample: arr[0] };
      }
    } catch (e) { /* ignore */ }
  }
  return best;
}

var files = [];
roots.forEach(function (r) { if (r && fs.existsSync(r)) walk(r, files); });

var report = {
  rootsChecked: roots.filter(function (r) { return r && fs.existsSync(r); }),
  filesScanned: files.length,
  scopedKeyFound: false,
  quarantineKeyFound: false,
  recoveryKeyFound: false,
  globalLegacyFound: false,
  sources: [],
  bestCandidate: null
};

var keys = [
  { key: SCOPED, label: 'scoped_localStorage' },
  { key: QUAR, label: 'quarantine_local' },
  { key: RECOVERY, label: 'recovery_audit' },
  { key: GLOBAL, label: 'global_legacy' }
];

files.forEach(function (f) {
  var buf;
  try { buf = fs.readFileSync(f); } catch (e) { return; }
  var text = buf.toString('utf8');
  keys.forEach(function (item) {
    if (!text.includes(item.key)) return;
    if (item.label === 'scoped_localStorage') report.scopedKeyFound = true;
    if (item.label === 'quarantine_local') report.quarantineKeyFound = true;
    if (item.label === 'recovery_audit') report.recoveryKeyFound = true;
    if (item.label === 'global_legacy') report.globalLegacyFound = true;
    var parsed = tryParsePeriodArray(text, item.key);
    report.sources.push({
      file: f,
      source: item.label,
      key: item.key,
      periodCount: parsed ? parsed.count : 0,
      periodIds: parsed ? parsed.ids.slice(0, 30) : [],
      aContaminationIds: parsed ? parsed.ids.filter(function (id) { return A_IDS.indexOf(id) >= 0; }) : [],
      sample: parsed ? parsed.sample : null
    });
  });
});

report.sources.sort(function (a, b) { return (b.periodCount || 0) - (a.periodCount || 0); });
report.bestCandidate = report.sources.find(function (s) { return s.periodCount > 0; }) || null;
report.fullLocalRecovery = !!(report.bestCandidate && report.bestCandidate.periodCount >= 10
  && (!report.bestCandidate.aContaminationIds || !report.bestCandidate.aContaminationIds.length));

console.log(JSON.stringify(report, null, 2));
