/**
 * CMI Phase 1 foundation tests
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

var __dirname = path.dirname(fileURLToPath(import.meta.url));
var ROOT = path.resolve(__dirname, '..', '..');
var require = createRequire(import.meta.url);

var buildIndex = require(path.join(ROOT, 'scripts/cmi/build-index.js')).buildIndex;
var advisor = require(path.join(ROOT, 'scripts/cmi/advisor-api.js'));
var storage = require(path.join(ROOT, 'scripts/cmi/storage.js'));
var retrieve = require(path.join(ROOT, 'scripts/cmi/retrieve.js'));
var { PSC_MAX_BYTES } = require(path.join(ROOT, 'scripts/cmi/constants.js'));

describe('CMI Phase 1 foundation', function () {
  beforeAll(function () {
    if (!storage.loadMeta()) {
      buildIndex({ mode: 'full', fullRefreshMonths: 6 });
    }
  });

  it('builds local index with meta', function () {
    var meta = storage.loadMeta();
    expect(meta).toBeTruthy();
    expect(meta.fileCount).toBeGreaterThan(50);
    expect(meta.gitSha).toBeTruthy();
    expect(meta.nextFullRefreshDue).toBeTruthy();
    expect(meta.fullRefreshMonths).toBe(6);
  });

  it('stores file records on disk', function () {
    var files = storage.listFileRecords();
    expect(files.length).toBeGreaterThan(50);
    var admission = files.find(function (f) { return f.path === 'admission.js'; });
    expect(admission).toBeTruthy();
    expect(admission.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(admission.summaryShort).toBeTruthy();
  });

  it('creates module and feature roll-ups', function () {
    var mods = storage.listModuleRecords();
    expect(mods.some(function (m) { return m.moduleId === 'registration'; })).toBe(true);
    var feats = storage.listFeatureRecords();
    expect(feats.some(function (f) { return f.featureId === 'registration-drafts'; })).toBe(true);
  });

  it('builds dependency graph', function () {
    var g = storage.loadDependencyGraph();
    expect(g.nodes.length).toBeGreaterThan(10);
    expect(Array.isArray(g.edges)).toBe(true);
  });

  it('ingests decisions roadmap and bugs', function () {
    expect(storage.listDecisions().length).toBeGreaterThan(0);
    expect(storage.listRoadmapSnapshots().length).toBeGreaterThan(0);
    expect(storage.listBugRecords().length).toBeGreaterThan(0);
  });

  it('retrieves slices and enforces PSC 32KB cap', function () {
    var slices = retrieve.retrieveSlices('registration security tests', { maxFiles: 15 });
    expect(slices.files.length).toBeGreaterThan(0);
    var psc = retrieve.buildPSC('registration security tests', slices);
    expect(psc.bytes).toBeLessThanOrEqual(PSC_MAX_BYTES);
    expect(psc.withinLimit).toBe(true);
  });

  it('advisor API is read-only charter', function () {
    var charter = advisor.assertReadOnlyCharter();
    expect(charter.allowCodeMutation).toBe(false);
    expect(charter.allowDeploy).toBe(false);
    expect(charter.piiDefault).toBe(false);
  });

  it('prepareLocalRecommendation returns hints without mutation APIs', function () {
    var res = advisor.prepareLocalRecommendation('registration security weaknesses', { useCache: false });
    expect(res.ok).toBe(true);
    expect(res.readOnly).toBe(true);
    expect(res.mode).toBe('local_stub');
    expect(res.pscBytes).toBeLessThanOrEqual(PSC_MAX_BYTES);
  });

  it('cmi scripts exist in package.json', function () {
    var pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['cmi:build']).toContain('cmi-build');
    expect(pkg.scripts['cmi:incremental']).toContain('cmi-incremental');
  });

  it('.cmi is gitignored', function () {
    var gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    expect(gi).toContain('.cmi/');
  });
});
