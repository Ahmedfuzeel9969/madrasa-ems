'use strict';

const fs = require('fs');
const path = require('path');
const { CMI_DIR } = require('./constants');
const { ensureDir, readJson, writeJson } = require('./utils');

function paths() {
  return {
    root: CMI_DIR,
    meta: path.join(CMI_DIR, 'meta', 'current.json'),
    filesDir: path.join(CMI_DIR, 'files'),
    modulesDir: path.join(CMI_DIR, 'modules'),
    featuresDir: path.join(CMI_DIR, 'features'),
    dependencies: path.join(CMI_DIR, 'dependencies', 'graph.json'),
    weaknessesDir: path.join(CMI_DIR, 'weaknesses'),
    testsDir: path.join(CMI_DIR, 'tests', 'history'),
    decisionsDir: path.join(CMI_DIR, 'decisions'),
    roadmapDir: path.join(CMI_DIR, 'roadmap', 'snapshots'),
    bugsDir: path.join(CMI_DIR, 'bugs'),
    cacheDir: path.join(CMI_DIR, 'cache', 'answers')
  };
}

function loadMeta() {
  return readJson(paths().meta, null);
}

function saveMeta(meta) {
  writeJson(paths().meta, meta);
}

function saveFileRecord(record) {
  writeJson(path.join(paths().filesDir, record.fileId + '.json'), record);
}

function loadFileRecord(fileId) {
  return readJson(path.join(paths().filesDir, fileId + '.json'), null);
}

function listFileRecords() {
  var dir = paths().filesDir;
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(function (f) { return f.endsWith('.json'); })
    .map(function (f) { return readJson(path.join(dir, f), null); })
    .filter(Boolean);
}

function saveModuleRecord(record) {
  writeJson(path.join(paths().modulesDir, record.moduleId + '.json'), record);
}

function loadModuleRecord(moduleId) {
  return readJson(path.join(paths().modulesDir, moduleId + '.json'), null);
}

function listModuleRecords() {
  var dir = paths().modulesDir;
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(function (f) { return f.endsWith('.json'); })
    .map(function (f) { return readJson(path.join(dir, f), null); })
    .filter(Boolean);
}

function saveFeatureRecord(record) {
  writeJson(path.join(paths().featuresDir, record.featureId + '.json'), record);
}

function listFeatureRecords() {
  var dir = paths().featuresDir;
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(function (f) { return f.endsWith('.json'); })
    .map(function (f) { return readJson(path.join(dir, f), null); })
    .filter(Boolean);
}

function saveDependencyGraph(graph) {
  writeJson(paths().dependencies, graph);
}

function loadDependencyGraph() {
  return readJson(paths().dependencies, { nodes: [], edges: [] });
}

function saveWeakness(record) {
  writeJson(path.join(paths().weaknessesDir, record.weakId + '.json'), record);
}

function listWeaknesses() {
  var dir = paths().weaknessesDir;
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(function (f) { return f.endsWith('.json'); })
    .map(function (f) { return readJson(path.join(dir, f), null); })
    .filter(Boolean);
}

function saveDecision(record) {
  writeJson(path.join(paths().decisionsDir, record.decisionId + '.json'), record);
}

function listDecisions() {
  var dir = paths().decisionsDir;
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(function (f) { return f.endsWith('.json'); })
    .map(function (f) { return readJson(path.join(dir, f), null); })
    .filter(Boolean);
}

function saveRoadmapSnapshot(record) {
  writeJson(path.join(paths().roadmapDir, record.snapshotId + '.json'), record);
}

function listRoadmapSnapshots() {
  var dir = paths().roadmapDir;
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(function (f) { return f.endsWith('.json'); })
    .map(function (f) { return readJson(path.join(dir, f), null); })
    .filter(Boolean);
}

function saveBugRecord(record) {
  writeJson(path.join(paths().bugsDir, record.bugId + '.json'), record);
}

function listBugRecords() {
  var dir = paths().bugsDir;
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(function (f) { return f.endsWith('.json'); })
    .map(function (f) { return readJson(path.join(dir, f), null); })
    .filter(Boolean);
}

function saveTestHistory(record) {
  writeJson(path.join(paths().testsDir, record.runId + '.json'), record);
}

function listTestHistory(limit) {
  limit = limit || 20;
  var dir = paths().testsDir;
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(function (f) { return f.endsWith('.json'); })
    .sort()
    .slice(-limit)
    .map(function (f) { return readJson(path.join(dir, f), null); })
    .filter(Boolean);
}

function ensureCmiDirs() {
  var p = paths();
  Object.keys(p).forEach(function (key) {
    if (key === 'root' || key === 'meta' || key === 'dependencies') return;
    ensureDir(p[key]);
  });
  ensureDir(path.dirname(p.meta));
  ensureDir(path.dirname(p.dependencies));
}

module.exports = {
  paths,
  loadMeta,
  saveMeta,
  saveFileRecord,
  loadFileRecord,
  listFileRecords,
  saveModuleRecord,
  loadModuleRecord,
  listModuleRecords,
  saveFeatureRecord,
  listFeatureRecords,
  saveDependencyGraph,
  loadDependencyGraph,
  saveWeakness,
  listWeaknesses,
  saveDecision,
  listDecisions,
  saveRoadmapSnapshot,
  listRoadmapSnapshots,
  saveBugRecord,
  listBugRecords,
  saveTestHistory,
  listTestHistory,
  ensureCmiDirs
};
