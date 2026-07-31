'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT } = require('./constants');
const { sha256, summarizeText } = require('./utils');
const storage = require('./storage');

function parseDocTitle(content) {
  var m = content.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : '';
}

function ingestDecisions() {
  var count = 0;
  var docsDir = path.join(ROOT, 'docs');
  if (!fs.existsSync(docsDir)) return count;

  fs.readdirSync(docsDir).forEach(function (name) {
    if (!/ARCHITECTURE|LESSONS|MIGRATION|DESIGN|PHASEA|PHASE1/i.test(name)) return;
    if (!name.endsWith('.md')) return;
    var rel = 'docs/' + name;
    var content = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    var decisionId = 'adr-' + sha256(rel).slice(0, 10);
    storage.saveDecision({
      decisionId: decisionId,
      title: parseDocTitle(content) || name,
      date: (content.match(/\*\*Date:\*\*\s*([^\n]+)/) || [])[1] || null,
      status: /LOCKED|approved|Phase A/i.test(content) ? 'accepted' : 'documented',
      context: summarizeText(content.slice(0, 500), 300),
      docRefs: [rel],
      source: 'cmi-doc-ingest',
      ingestedAt: new Date().toISOString()
    });
    count++;
  });
  return count;
}

function ingestRoadmap() {
  var count = 0;
  var docsDir = path.join(ROOT, 'docs');
  if (!fs.existsSync(docsDir)) return count;

  fs.readdirSync(docsDir).forEach(function (name) {
    if (!/ROADMAP|PHASE2|IMPLEMENTATION_PLAN|AI_ROADMAP/i.test(name)) return;
    if (!name.endsWith('.md')) return;
    var rel = 'docs/' + name;
    var content = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    var snapshotId = 'road-' + sha256(content).slice(0, 12);
    var locked = (content.match(/LOCKED/gi) || []).length;
    var phases = (content.match(/Phase [A-E]/g) || []).filter(function (v, i, a) {
      return a.indexOf(v) === i;
    });
    storage.saveRoadmapSnapshot({
      snapshotId: snapshotId,
      docPath: rel,
      title: parseDocTitle(content) || name,
      contentHash: sha256(content),
      lockedMentions: locked,
      phases: phases,
      excerpt: summarizeText(content.replace(/[#*`]/g, ''), 400),
      capturedAt: new Date().toISOString()
    });
    count++;
  });
  return count;
}

function ingestWeaknessesFromDocs() {
  var count = 0;
  var securityDoc = path.join(ROOT, 'docs', 'AI_SYSTEM_SECURITY_REPORT.md');
  if (fs.existsSync(securityDoc)) {
    var content = fs.readFileSync(securityDoc, 'utf8');
    var rows = content.match(/\|\s*R\d+\s*\|[^|]+\|\s*\*\*(\w+)\*\*/g) || [];
    rows.forEach(function (row, idx) {
      storage.saveWeakness({
        weakId: 'weak-doc-' + String(idx + 1).padStart(3, '0'),
        severity: 'high',
        category: 'security',
        title: summarizeText(row, 120),
        fileIds: [],
        moduleIds: ['ai-assistant'],
        status: 'open',
        source: 'AI_SYSTEM_SECURITY_REPORT',
        discoveredAt: new Date().toISOString().slice(0, 10)
      });
      count++;
    });
  }
  return count;
}

function ingestHistoricalBugs() {
  var count = 0;
  var docsDir = path.join(ROOT, 'docs');
  if (!fs.existsSync(docsDir)) return count;

  fs.readdirSync(docsDir).forEach(function (name) {
    if (!/FIX|REPORT|LEGACY|BUG|INCIDENT|LESSONS/i.test(name)) return;
    if (!name.endsWith('.md')) return;
    var rel = 'docs/' + name;
    var content = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    if (!/fix|bug|regression|fail|issue|weakness/i.test(content)) return;
    var bugId = 'bug-' + sha256(rel + content.slice(0, 200)).slice(0, 12);
    storage.saveBugRecord({
      bugId: bugId,
      title: parseDocTitle(content) || name,
      docRefs: [rel],
      category: /security/i.test(content) ? 'security' : /performance/i.test(content) ? 'performance' : 'general',
      status: /fixed|resolved|closed/i.test(content) ? 'resolved' : 'documented',
      summary: summarizeText(content.replace(/[#*`]/g, ''), 350),
      lessons: summarizeText((content.match(/lesson|learned|root cause/gi) || []).join(' '), 200),
      contentHash: sha256(content),
      recordedAt: new Date().toISOString()
    });
    count++;
  });
  return count;
}

function ingestTestHistoryFromVitest() {
  var outDir = path.join(ROOT, 'node_modules', '.vite', 'vitest');
  var resultsPath = path.join(ROOT, 'docs', 'cmi-last-vitest.json');
  if (fs.existsSync(resultsPath)) {
    try {
      var data = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
      storage.saveTestHistory(data);
      return 1;
    } catch (e) { /* skip */ }
  }
  return 0;
}

function ingestAll() {
  return {
    decisions: ingestDecisions(),
    roadmap: ingestRoadmap(),
    weaknesses: ingestWeaknessesFromDocs(),
    bugs: ingestHistoricalBugs(),
    tests: ingestTestHistoryFromVitest()
  };
}

module.exports = {
  ingestDecisions,
  ingestRoadmap,
  ingestWeaknessesFromDocs,
  ingestHistoricalBugs,
  ingestTestHistoryFromVitest,
  ingestAll
};
