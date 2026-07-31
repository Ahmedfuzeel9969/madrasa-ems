'use strict';

/**
 * Software Advisor — Phase 1 read-only internal API (no LLM, no mutations).
 * Future Phase 2 will attach saAdvisorAsk gateway to prepareRecommendation().
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const storage = require('./storage');
const retrieve = require('./retrieve');
const { PSC_MAX_BYTES } = require('./constants');

var READ_ONLY_CHARTER = Object.freeze({
  allowCodeMutation: false,
  allowDeploy: false,
  allowDatabaseMutation: false,
  allowPermissionMutation: false,
  allowMigration: false,
  piiDefault: false,
  financeDetailDefault: false
});

function assertReadOnlyCharter() {
  return Object.assign({}, READ_ONLY_CHARTER);
}

function getMemoryStatus() {
  var meta = storage.loadMeta();
  if (!meta) {
    return { ok: false, reason: 'cmi_not_built', hint: 'Run: npm run cmi:build' };
  }
  return {
    ok: true,
    schemaVersion: meta.schemaVersion,
    cmiVersion: meta.cmiVersion,
    gitSha: meta.gitSha,
    gitBranch: meta.gitBranch,
    indexedAt: meta.indexedAt,
    lastIncrementalAt: meta.lastIncrementalAt,
    lastFullRefreshAt: meta.lastFullRefreshAt,
    nextFullRefreshDue: meta.nextFullRefreshDue,
    fullRefreshMonths: meta.fullRefreshMonths,
    fileCount: meta.fileCount,
    charter: READ_ONLY_CHARTER
  };
}

function cacheKey(question, psc) {
  var meta = storage.loadMeta();
  var raw = JSON.stringify({
    q: String(question || '').trim().toLowerCase(),
    v: meta && meta.cmiVersion,
    sha: meta && meta.gitSha,
    intent: psc && psc.intent
  });
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function getCachedAnswer(question, intent) {
  var key = cacheKey(question, { intent: intent });
  var filePath = path.join(storage.paths().cacheDir, key + '.json');
  if (!fs.existsSync(filePath)) return null;
  try {
    var data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (data.expiresAt && new Date(data.expiresAt) < new Date()) return null;
    return data;
  } catch (e) {
    return null;
  }
}

function setCachedAnswer(question, intent, payload, ttlHours) {
  ttlHours = ttlHours || 24;
  storage.ensureCmiDirs();
  var key = cacheKey(question, { intent: intent });
  var filePath = path.join(storage.paths().cacheDir, key + '.json');
  var expires = new Date();
  expires.setHours(expires.getHours() + ttlHours);
  fs.writeFileSync(filePath, JSON.stringify({
    question: question,
    intent: intent,
    payload: payload,
    cachedAt: new Date().toISOString(),
    expiresAt: expires.toISOString()
  }, null, 2), 'utf8');
}

function prepareContext(question, opts) {
  opts = opts || {};
  var slices = retrieve.retrieveSlices(question, opts);
  var psc = retrieve.buildPSC(question, slices);
  return {
    ok: true,
    readOnly: true,
    charter: READ_ONLY_CHARTER,
    slices: slices,
    psc: psc,
    pscBytes: psc.bytes,
    withinLimit: psc.withinLimit,
    maxBytes: PSC_MAX_BYTES,
    note: 'Phase 1 — context only. LLM synthesis deferred to Phase 2 gateway.'
  };
}

function classifyAdviceDomain(question) {
  var q = String(question || '').toLowerCase();
  var domains = [];
  if (/ui|ux|rtl|mobile|interface|اسٹ|انٹرف|یوزر/.test(q)) domains.push('ui');
  if (/security|auth|rule|permission|safety|سیک|محفظ/.test(q)) domains.push('security');
  if (/test|coverage|vitest|e2e|ٹیسٹ/.test(q)) domains.push('testing');
  if (/performance|slow|bench|speed|perf|کارکرد/.test(q)) domains.push('performance');
  if (/roadmap|phase|priority|feature|missing|رود|.map|فیچ/.test(q)) domains.push('roadmap');
  if (/weak|bug|debt|issue|risk|کمز/.test(q)) domains.push('weakness');
  if (domains.length === 0) domains.push('general');
  return domains;
}

/**
 * Phase 1 local recommendation stub — deterministic hints without LLM.
 * Phase 2 replaces body with gateway LLM synthesis using same PSC.
 */
function prepareLocalRecommendation(question, opts) {
  opts = opts || {};
  var ctx = prepareContext(question, opts);
  if (!ctx.ok) return ctx;

  var domains = classifyAdviceDomain(question);
  var hints = [];
  (ctx.slices.weaknesses || []).slice(0, 5).forEach(function (w) {
    hints.push({ type: 'weakness', severity: w.severity, text: w.title, weakId: w.weakId });
  });
  (ctx.slices.bugs || []).slice(0, 3).forEach(function (b) {
    hints.push({ type: 'historical_bug', text: b.title, bugId: b.bugId, status: b.status });
  });
  if (domains.indexOf('testing') >= 0) {
    var untested = (ctx.slices.files || []).filter(function (f) {
      return (!f.linkedTests || f.linkedTests.length === 0) && /\.js$/.test(f.path);
    });
    untested.slice(0, 3).forEach(function (f) {
      hints.push({ type: 'testing_gap', text: 'Add tests for ' + f.path, path: f.path });
    });
  }
  if (domains.indexOf('roadmap') >= 0 && ctx.slices.roadmap && ctx.slices.roadmap.length) {
    hints.push({
      type: 'roadmap',
      text: 'Latest roadmap: ' + ctx.slices.roadmap[0].title,
      phases: ctx.slices.roadmap[0].phases
    });
  }

  var result = {
    ok: true,
    readOnly: true,
    mode: 'local_stub',
    domains: domains,
    hints: hints,
    pscBytes: ctx.pscBytes,
    cmiVersion: ctx.psc.cmiVersion,
    gitSha: ctx.psc.gitSha,
    disclaimer: 'Read-only recommendation stub — Phase 2 will add LLM synthesis via saAdvisorAsk.',
    charter: READ_ONLY_CHARTER
  };

  if (opts.useCache !== false) {
    var cached = getCachedAnswer(question, opts.intent || 'software_advice');
    if (cached) {
      return Object.assign({}, cached.payload, { cacheHit: true });
    }
    setCachedAnswer(question, opts.intent || 'software_advice', result, opts.cacheTtlHours || 24);
  }

  return result;
}

module.exports = {
  READ_ONLY_CHARTER,
  assertReadOnlyCharter,
  getMemoryStatus,
  prepareContext,
  prepareLocalRecommendation,
  classifyAdviceDomain,
  getCachedAnswer,
  setCachedAnswer,
  cacheKey
};
