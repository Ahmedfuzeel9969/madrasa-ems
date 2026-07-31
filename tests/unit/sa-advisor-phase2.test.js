/**
 * SA Platform Advisor Phase 2 unit tests
 */
import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

var __dirname = path.dirname(fileURLToPath(import.meta.url));
var ROOT = path.resolve(__dirname, '..', '..');
var require = createRequire(import.meta.url);

var config = require(path.join(ROOT, 'functions/lib/sa-advisor/config.js'));
var guardrails = require(path.join(ROOT, 'functions/lib/sa-advisor/guardrails.js'));
var pscBuilder = require(path.join(ROOT, 'functions/lib/sa-advisor/psc-builder.js'));
var citations = require(path.join(ROOT, 'functions/lib/sa-advisor/citations.js'));
var cache = require(path.join(ROOT, 'functions/lib/sa-advisor/cache.js'));
var retrieve = require(path.join(ROOT, 'functions/lib/sa-advisor/retrieve.js'));
var costTracker = require(path.join(ROOT, 'functions/lib/sa-advisor/cost-tracker.js'));

function mockBundle() {
    var files = [];
    for (var i = 0; i < 40; i++) {
        files.push({
            fileId: 'f' + i,
            path: 'mod/file-' + i + '.js',
            moduleId: 'registration',
            summaryShort: 'Summary for file ' + i + ' security registration tests',
            exports: ['fn' + i],
            linkedTests: []
        });
    }
    return {
        meta: { cmiVersion: 'test-1', gitSha: 'abc1234', fileCount: 40 },
        files: files,
        modules: [{ moduleId: 'registration', labelUr: 'رجسٹریشن', fileCount: 40, summary: 'reg module' }],
        features: [{ featureId: 'registration-drafts', label: 'Drafts', status: 'staging' }],
        weaknesses: [{ weakId: 'w1', severity: 'high', title: 'Missing validation', category: 'security' }],
        decisions: [{ decisionId: 'd1', title: 'Draft SSOT split', docRefs: ['ADR-1'] }],
        bugs: [{ bugId: 'b1', title: 'Regression in fee calc', status: 'open', category: 'finance' }],
        roadmap: [{ snapshotId: 'r1', title: 'Phase 2', phases: ['A', 'B'] }],
        tests: [{ runId: 't1', passed: 500, failed: 0 }]
    };
}

describe('SA Advisor config & staging flag', function () {
    it('allows staging when stagingEnabled true and enabled false', function () {
        var r = config.isAdvisorAllowed({ enabled: false, stagingEnabled: true });
        expect(r.ok).toBe(true);
        expect(r.mode).toBe('staging');
    });

    it('blocks when both flags false', function () {
        var r = config.isAdvisorAllowed({ enabled: false, stagingEnabled: false });
        expect(r.ok).toBe(false);
        expect(r.mode).toBe('disabled');
    });

    it('production mode only when enabled true', function () {
        var r = config.isAdvisorAllowed({ enabled: true, stagingEnabled: true });
        expect(r.ok).toBe(true);
        expect(r.mode).toBe('production');
    });

    it('keeps default monthly cap at $50', function () {
        expect(config.DEFAULT_CONFIG.monthlyCostCapUsd).toBe(50);
        expect(config.DEFAULT_CONFIG.enabled).toBe(false);
        expect(config.DEFAULT_CONFIG.cacheHitsFree).toBe(true);
    });

    it('PSC cap is 32 KB', function () {
        expect(config.PSC_MAX_BYTES).toBe(32768);
    });
});

describe('SA Advisor guardrails', function () {
    it('rejects empty and off-domain questions', function () {
        expect(guardrails.validateQuestion('').ok).toBe(false);
        expect(guardrails.validateQuestion('deploy now to production').ok).toBe(false);
        expect(guardrails.validateQuestion('write code for me').ok).toBe(false);
    });

    it('accepts valid platform questions', function () {
        expect(guardrails.validateQuestion('registration security weaknesses کیا ہیں؟').ok).toBe(true);
    });

    it('redacts API keys from output', function () {
        var out = guardrails.sanitizeOutput('Key: AIzaSyABCDEF012345678901234567890123456789');
        expect(out).not.toMatch(/AIza/);
        expect(out).toContain('[redacted]');
    });
});

describe('SA Advisor PSC builder', function () {
    it('builds PSC within 32KB and excludes full file contents', function () {
        var bundle = mockBundle();
        var slices = retrieve.retrieveSlices(bundle, 'registration security weaknesses', {});
        var psc = pscBuilder.buildPSC('registration security weaknesses', slices);
        expect(psc.bytes).toBeLessThanOrEqual(config.PSC_MAX_BYTES);
        expect(psc.withinLimit).toBe(true);
        var json = JSON.stringify(psc);
        expect(json).not.toMatch(/function\s*\(/);
        expect(psc.slices.files.length).toBeGreaterThan(0);
        psc.slices.files.forEach(function (f) {
            expect(f.summaryShort).toBeTruthy();
            expect(f.path).toBeTruthy();
        });
    });
});

describe('SA Advisor citations', function () {
    it('strips hallucinated citation tags', function () {
        var bundle = mockBundle();
        var slices = retrieve.retrieveSlices(bundle, 'registration security', {});
        var psc = pscBuilder.buildPSC('registration security', slices);
        var answer = 'See [file:fake/path.js] and [weak:w1] and [weak:FAKE]';
        var stripped = citations.stripInvalidCitationTags(answer, psc);
        expect(stripped).not.toContain('[file:fake/path.js]');
        expect(stripped).not.toContain('[weak:FAKE]');
        expect(stripped).toContain('[weak:w1]');
    });

    it('merges structured and valid inline citations', function () {
        var bundle = mockBundle();
        var slices = retrieve.retrieveSlices(bundle, 'registration', {});
        var psc = pscBuilder.buildPSC('registration', slices);
        var merged = citations.mergeAndValidateCitations(psc, 'Ref [weak:w1]');
        expect(merged.some(function (c) { return c.type === 'weakness' && c.id === 'w1'; })).toBe(true);
    });
});

describe('SA Advisor cache', function () {
    it('normalizes question whitespace for cache key', function () {
        var k1 = cache.cacheKey('  Hello   World  ', { cmiVersion: 'v1', gitSha: 'abc' }, { language: 'ur' });
        var k2 = cache.cacheKey('hello world', { cmiVersion: 'v1', gitSha: 'abc' }, { language: 'ur' });
        expect(k1).toBe(k2);
    });

    it('uses longer TTL for roadmap domains', function () {
        expect(cache.ttlHoursForDomains(['roadmap'])).toBe(168);
        expect(cache.ttlHoursForDomains(['security'])).toBe(24);
    });
});

describe('SA Advisor cost tracker', function () {
    it('estimates cost from token counts', function () {
        var cost = costTracker.estimateCostUsd(10000, 2000);
        expect(cost).toBeGreaterThan(0);
        expect(cost).toBeLessThan(1);
    });
});
