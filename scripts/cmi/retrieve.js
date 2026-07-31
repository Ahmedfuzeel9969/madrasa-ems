'use strict';

const { PSC_MAX_BYTES } = require('./constants');
const storage = require('./storage');

var STOP = new Set([
  'the', 'a', 'an', 'is', 'are', 'what', 'how', 'where', 'why', 'which',
  'کیا', 'کیسے', 'کہاں', 'کون', 'سے', 'میں', 'کے', 'کی', 'کو', 'یہ', 'ہے', 'کا'
]);

function tokenize(q) {
  return String(q || '').toLowerCase()
    .replace(/[^\w\u0600-\u06FF\s-]/g, ' ')
    .split(/\s+/)
    .filter(function (t) { return t.length > 2 && !STOP.has(t); });
}

function scoreRecord(tokens, rec, fields) {
  var text = fields.map(function (f) { return String(rec[f] || ''); }).join(' ').toLowerCase();
  var score = 0;
  tokens.forEach(function (t) {
    if (text.indexOf(t) >= 0) score += 1;
  });
  return score;
}

function retrieveSlices(query, opts) {
  opts = opts || {};
  var tokens = tokenize(query);
  var maxFiles = opts.maxFiles || 12;
  var maxModules = opts.maxModules || 3;
  var intent = opts.intent || 'software_advice';

  var files = storage.listFileRecords();
  var modules = storage.listModuleRecords();
  var features = storage.listFeatureRecords();
  var weaknesses = storage.listWeaknesses();
  var decisions = storage.listDecisions();
  var roadmap = storage.listRoadmapSnapshots();
  var bugs = storage.listBugRecords();
  var tests = storage.listTestHistory(3);

  if (opts.moduleId) {
    files = files.filter(function (f) { return f.moduleId === opts.moduleId; });
  }

  var rankedFiles = files.map(function (f) {
    return { rec: f, score: scoreRecord(tokens, f, ['path', 'summaryShort', 'summaryDetailed', 'moduleId']) };
  }).filter(function (x) { return x.score > 0 || tokens.length === 0; })
    .sort(function (a, b) { return b.score - a.score; })
    .slice(0, maxFiles)
    .map(function (x) { return x.rec; });

  if (rankedFiles.length === 0 && tokens.length === 0) {
    rankedFiles = files.slice(0, Math.min(8, files.length));
  }

  var rankedModules = modules.map(function (m) {
    return { rec: m, score: scoreRecord(tokens, m, ['moduleId', 'summary', 'summaryDetailed']) };
  }).sort(function (a, b) { return b.score - a.score; })
    .slice(0, maxModules)
    .map(function (x) { return x.rec; });

  var rankedWeaknesses = weaknesses.map(function (w) {
    return { rec: w, score: scoreRecord(tokens, w, ['title', 'category', 'moduleIds']) };
  }).sort(function (a, b) { return b.score - a.score; })
    .slice(0, 8)
    .map(function (x) { return x.rec; });

  var rankedFeatures = features.map(function (f) {
    return { rec: f, score: scoreRecord(tokens, f, ['featureId', 'label', 'summary']) };
  }).sort(function (a, b) { return b.score - a.score; })
    .slice(0, 5)
    .map(function (x) { return x.rec; });

  var rankedDecisions = decisions.filter(function (d) {
    return scoreRecord(tokens, d, ['title', 'context']) > 0 || /roadmap|phase|architecture|why/i.test(query);
  }).slice(0, 4);

  var rankedRoadmap = roadmap.filter(function (r) {
    return scoreRecord(tokens, r, ['title', 'excerpt', 'phases']) > 0 || /roadmap|phase|priority/i.test(query);
  }).slice(0, 2);

  var rankedBugs = bugs.map(function (b) {
    return { rec: b, score: scoreRecord(tokens, b, ['title', 'summary', 'category']) };
  }).sort(function (a, b) { return b.score - a.score; })
    .slice(0, 5)
    .map(function (x) { return x.rec; });

  var meta = storage.loadMeta();

  return {
    intent: intent,
    cmiVersion: meta && meta.cmiVersion,
    gitSha: meta && meta.gitSha,
    retrievedAt: new Date().toISOString(),
    files: rankedFiles,
    modules: rankedModules,
    features: rankedFeatures,
    weaknesses: rankedWeaknesses,
    decisions: rankedDecisions,
    roadmap: rankedRoadmap,
    bugs: rankedBugs,
    tests: tests
  };
}

function buildPSC(query, slices) {
  var meta = storage.loadMeta();
  var psc = {
    pscVersion: 1,
    intent: slices.intent || 'software_advice',
    cmiVersion: (meta && meta.cmiVersion) || slices.cmiVersion,
    gitSha: (meta && meta.gitSha) || slices.gitSha,
    retrievedAt: slices.retrievedAt,
    question: String(query || '').trim(),
    slices: {
      files: (slices.files || []).map(function (f) {
        return {
          fileId: f.fileId,
          path: f.path,
          moduleId: f.moduleId,
          summaryShort: f.summaryShort,
          exports: (f.exports || []).slice(0, 8),
          linkedTests: f.linkedTests || []
        };
      }),
      modules: (slices.modules || []).map(function (m) {
        return {
          moduleId: m.moduleId,
          labelUr: m.labelUr,
          fileCount: m.fileCount,
          summary: m.summary,
          linkedTestCount: m.linkedTestCount
        };
      }),
      features: (slices.features || []).map(function (f) {
        return { featureId: f.featureId, label: f.label, status: f.status };
      }),
      weaknesses: (slices.weaknesses || []).map(function (w) {
        return { weakId: w.weakId, severity: w.severity, title: w.title, category: w.category };
      }),
      decisions: (slices.decisions || []).map(function (d) {
        return { decisionId: d.decisionId, title: d.title, docRefs: d.docRefs };
      }),
      roadmap: (slices.roadmap || []).map(function (r) {
        return { snapshotId: r.snapshotId, title: r.title, phases: r.phases };
      }),
      bugs: (slices.bugs || []).map(function (b) {
        return { bugId: b.bugId, title: b.title, status: b.status, category: b.category };
      }),
      tests: slices.tests || []
    }
  };

  var serialized = JSON.stringify(psc);
  while (serialized.length > PSC_MAX_BYTES && psc.slices.files.length > 1) {
    psc.slices.files.pop();
    serialized = JSON.stringify(psc);
  }
  if (serialized.length > PSC_MAX_BYTES) {
    psc.slices.files = psc.slices.files.map(function (f) {
      return Object.assign({}, f, { summaryShort: String(f.summaryShort).slice(0, 80) });
    });
    serialized = JSON.stringify(psc);
  }

  psc.bytes = serialized.length;
  psc.withinLimit = psc.bytes <= PSC_MAX_BYTES;
  return psc;
}

module.exports = {
  tokenize,
  retrieveSlices,
  buildPSC
};
