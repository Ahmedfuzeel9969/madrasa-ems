'use strict';

const fs = require('fs');
const path = require('path');
const moduleRegistry = require('./module-registry');
const featureRegistry = require('./feature-registry');
const { CMI_VERSION, FULL_REFRESH_MONTHS_DEFAULT } = require('./constants');
const {
  sha256,
  fileIdFromPath,
  getGitSha,
  getGitBranch,
  walkIndexableFiles
} = require('./utils');
const { analyzeFile, buildLocalSummary, linkedTestFiles } = require('./extractors');
const storage = require('./storage');
const ingestDocs = require('./ingest-docs');

function addEdge(edges, from, to, type) {
  edges.push({ from: from, to: to, type: type });
}

function buildDependencyGraph(fileRecords) {
  var nodes = fileRecords.map(function (r) {
    return { id: r.fileId, path: r.path, moduleId: r.moduleId };
  });
  var edges = [];
  fileRecords.forEach(function (rec) {
    (rec.imports || []).forEach(function (imp) {
      if (imp.startsWith('.') || imp.startsWith('/')) {
        addEdge(edges, rec.path, imp, 'imports');
      }
    });
    (rec.callables || []).forEach(function (fn) {
      addEdge(edges, rec.path, 'callable:' + fn, 'calls');
    });
  });
  return { builtAt: new Date().toISOString(), nodes: nodes, edges: edges.slice(0, 5000) };
}

function autoWeaknesses(fileRecords) {
  var list = [];
  fileRecords.forEach(function (rec) {
    if (rec.lineCount > 2000) {
      list.push({
        weakId: 'weak-size-' + rec.fileId,
        severity: 'medium',
        category: 'maintainability',
        title: 'Large file (' + rec.lineCount + ' lines): ' + rec.path,
        fileIds: [rec.fileId],
        moduleIds: rec.moduleId ? [rec.moduleId] : [],
        status: 'open',
        source: 'cmi-auto',
        discoveredAt: new Date().toISOString().slice(0, 10)
      });
    }
    if (rec.todoCount > 3) {
      list.push({
        weakId: 'weak-todo-' + rec.fileId,
        severity: 'low',
        category: 'quality',
        title: rec.todoCount + ' TODO/FIXME in ' + rec.path,
        fileIds: [rec.fileId],
        moduleIds: rec.moduleId ? [rec.moduleId] : [],
        status: 'open',
        source: 'cmi-auto',
        discoveredAt: new Date().toISOString().slice(0, 10)
      });
    }
    (rec.securityHints || []).forEach(function (hint, idx) {
      list.push({
        weakId: 'weak-sec-' + rec.fileId + '-' + idx,
        severity: hint.severity,
        category: 'security',
        title: 'Security pattern ' + hint.id + ' in ' + rec.path,
        fileIds: [rec.fileId],
        moduleIds: rec.moduleId ? [rec.moduleId] : [],
        status: 'open',
        source: 'cmi-auto',
        discoveredAt: new Date().toISOString().slice(0, 10)
      });
    });
    var tests = rec.linkedTests || [];
    if (/\.js$/.test(rec.path) && !rec.path.startsWith('tests/') && tests.length === 0
        && rec.lineCount > 80 && !/vendor\//.test(rec.path)) {
      list.push({
        weakId: 'weak-notest-' + rec.fileId,
        severity: 'medium',
        category: 'testing',
        title: 'No linked unit test detected: ' + rec.path,
        fileIds: [rec.fileId],
        moduleIds: rec.moduleId ? [rec.moduleId] : [],
        status: 'open',
        source: 'cmi-auto',
        discoveredAt: new Date().toISOString().slice(0, 10)
      });
    }
  });
  return list;
}

function rollupModules(fileRecords, registry) {
  registry.forEach(function (mod) {
    var files = fileRecords.filter(function (r) { return r.moduleId === mod.moduleId; });
    var testCount = 0;
    files.forEach(function (f) { testCount += (f.linkedTests || []).length; });
    storage.saveModuleRecord({
      moduleId: mod.moduleId,
      labelUr: mod.labelUr,
      fileIds: files.map(function (f) { return f.fileId; }),
      fileCount: files.length,
      entryPoints: mod.entryPoints || [],
      summary: mod.moduleId + ' module with ' + files.length + ' indexed files.',
      summaryDetailed: files.slice(0, 12).map(function (f) {
        return f.path + ': ' + f.summaryShort;
      }).join('\n'),
      linkedTestCount: testCount,
      lastRollupAt: new Date().toISOString()
    });
  });
}

function rollupFeatures(fileRecords) {
  featureRegistry.forEach(function (feat) {
    var fileIds = [];
    fileRecords.forEach(function (rec) {
      if (featureRegistry.featuresForPath(rec.path).indexOf(feat.featureId) >= 0) {
        fileIds.push(rec.fileId);
      }
    });
    storage.saveFeatureRecord({
      featureId: feat.featureId,
      label: feat.label,
      moduleIds: feat.moduleIds,
      fileIds: fileIds,
      flagKeys: feat.flagKeys || [],
      status: feat.status,
      summary: feat.label + ' — ' + fileIds.length + ' related files indexed.',
      lastRollupAt: new Date().toISOString()
    });
  });
}

function indexFile(absPath, relPath, gitSha) {
  var content = fs.readFileSync(absPath, 'utf8');
  var contentHash = sha256(content);
  var fileId = fileIdFromPath(relPath);
  var analysis = analyzeFile(relPath, content);
  var moduleId = moduleRegistry.moduleForPath(relPath);
  var featureIds = featureRegistry.featuresForPath(relPath);
  var tests = linkedTestFiles(relPath).filter(function (t) {
    return fs.existsSync(path.join(require('./constants').ROOT, t));
  });
  var summaries = buildLocalSummary(relPath, content, Object.assign({}, analysis, { moduleId: moduleId }));

  return {
    fileId: fileId,
    path: relPath,
    gitSha: gitSha,
    contentHash: contentHash,
    language: path.extname(relPath).slice(1),
    moduleId: moduleId,
    featureIds: featureIds,
    linkedTests: tests,
    indexMethod: 'local',
    indexedAt: new Date().toISOString(),
    status: 'active',
    summaryShort: summaries.summaryShort,
    summaryDetailed: summaries.summaryDetailed,
    lineCount: analysis.lineCount,
    imports: analysis.imports,
    exports: analysis.exports,
    flags: analysis.flags,
    callables: analysis.callables,
    securityHints: analysis.securityHints,
    todoCount: analysis.todoCount
  };
}

function computeNextFullRefresh(fromIso, months) {
  months = months || FULL_REFRESH_MONTHS_DEFAULT;
  var d = fromIso ? new Date(fromIso) : new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

function buildIndex(opts) {
  opts = opts || {};
  var mode = opts.mode || 'full';
  var onlyPaths = opts.onlyPaths || null;
  var gitSha = getGitSha();
  var gitBranch = getGitBranch();
  var prevMeta = storage.loadMeta();
  var fullRefreshMonths = opts.fullRefreshMonths
    || (prevMeta && prevMeta.fullRefreshMonths)
    || FULL_REFRESH_MONTHS_DEFAULT;

  storage.ensureCmiDirs();

  var fileRecords = [];
  var scanned = 0;
  var updated = 0;
  var skipped = 0;

  walkIndexableFiles(function (abs, rel) {
    if (onlyPaths && onlyPaths.indexOf(rel) === -1) return;
    scanned++;
    var rec = indexFile(abs, rel, gitSha);
    var prev = storage.loadFileRecord(rec.fileId);
    if (mode === 'incremental' && prev && prev.contentHash === rec.contentHash) {
      fileRecords.push(prev);
      skipped++;
      return;
    }
    storage.saveFileRecord(rec);
    fileRecords.push(rec);
    updated++;
  });

  if (mode === 'incremental' && prevMeta) {
    storage.listFileRecords().forEach(function (existing) {
      if (fileRecords.some(function (r) { return r.fileId === existing.fileId; })) return;
      fileRecords.push(existing);
    });
  }

  rollupModules(fileRecords, moduleRegistry);
  rollupFeatures(fileRecords);
  storage.saveDependencyGraph(buildDependencyGraph(fileRecords));

  autoWeaknesses(fileRecords).forEach(function (w) { storage.saveWeakness(w); });
  var ingested = ingestDocs.ingestAll();

  var version = prevMeta ? prevMeta.cmiVersion : '1.0.0';
  if (mode === 'full') {
    var parts = version.split('.').map(Number);
    parts[1] = (parts[1] || 0) + 1;
    parts[2] = 0;
    version = parts.join('.');
  } else {
    var p2 = version.split('.').map(Number);
    p2[2] = (p2[2] || 0) + 1;
    version = p2.join('.');
  }

  var now = new Date().toISOString();
  var meta = {
    schemaVersion: CMI_VERSION,
    cmiVersion: version,
    gitSha: gitSha,
    gitBranch: gitBranch,
    buildMode: mode,
    indexedAt: now,
    lastIncrementalAt: mode === 'incremental' ? now : (prevMeta && prevMeta.lastIncrementalAt) || now,
    lastFullRefreshAt: mode === 'full' ? now : (prevMeta && prevMeta.lastFullRefreshAt) || now,
    nextFullRefreshDue: mode === 'full'
      ? computeNextFullRefresh(now, fullRefreshMonths)
      : (prevMeta && prevMeta.nextFullRefreshDue) || computeNextFullRefresh(now, fullRefreshMonths),
    fullRefreshMonths: fullRefreshMonths,
    fileCount: fileRecords.length,
    filesScanned: scanned,
    filesUpdated: updated,
    filesSkipped: skipped,
    ingested: ingested
  };

  storage.saveMeta(meta);

  return {
    ok: true,
    meta: meta,
    ingested: ingested
  };
}

function buildIncremental(changedPaths) {
  return buildIndex({ mode: 'incremental', onlyPaths: changedPaths });
}

module.exports = {
  buildIndex,
  buildIncremental,
  indexFile,
  computeNextFullRefresh
};
