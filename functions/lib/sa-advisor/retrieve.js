'use strict';

var STOP = new Set([
    'the', 'a', 'an', 'is', 'are', 'what', 'how', 'where', 'why', 'which',
    'کیا', 'کیسے', 'کہاں', 'کون', 'سے', 'میں', 'کے', 'کی', 'کو', 'یہ', 'ہے', 'کا'
]);

var DOMAIN_BUDGETS = {
    security: { files: 6, modules: 2, weaknesses: 8, bugs: 3 },
    testing: { files: 10, modules: 2, weaknesses: 4, bugs: 2 },
    roadmap: { files: 4, modules: 2, weaknesses: 2, bugs: 2 },
    performance: { files: 8, modules: 2, weaknesses: 4, bugs: 2 },
    ui: { files: 10, modules: 1, weaknesses: 3, bugs: 1 },
    general: { files: 12, modules: 3, weaknesses: 6, bugs: 4 }
};

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

function classifyDomains(question) {
    var q = String(question || '').toLowerCase();
    var domains = [];
    if (/ui|ux|rtl|mobile|interface|اسٹ|یوزر/.test(q)) domains.push('ui');
    if (/security|auth|rule|permission|safety|سیک|محفظ/.test(q)) domains.push('security');
    if (/test|coverage|vitest|e2e|ٹیسٹ/.test(q)) domains.push('testing');
    if (/performance|slow|bench|speed|perf|کارکرد/.test(q)) domains.push('performance');
    if (/roadmap|phase|priority|feature|missing|رود|فیچ/.test(q)) domains.push('roadmap');
    if (/weak|bug|debt|issue|risk|کمز|regression|fix/.test(q)) domains.push('weakness');
    if (domains.length === 0) domains.push('general');
    return domains;
}

function rankList(items, tokens, fields, limit) {
    return items.map(function (rec) {
        return { rec: rec, score: scoreRecord(tokens, rec, fields) };
    }).sort(function (a, b) { return b.score - a.score; })
        .slice(0, limit)
        .map(function (x) { return x.rec; });
}

function retrieveSlices(bundle, question, opts) {
    opts = opts || {};
    var tokens = tokenize(question);
    var domains = opts.domains || classifyDomains(question);
    var primary = domains[0] || 'general';
    var budget = DOMAIN_BUDGETS[primary] || DOMAIN_BUDGETS.general;

    var files = bundle.files.slice();
    if (opts.moduleId) {
        files = files.filter(function (f) { return f.moduleId === opts.moduleId; });
    }

    var rankedFiles = rankList(files, tokens,
        ['path', 'summaryShort', 'summaryDetailed', 'moduleId'], budget.files);
    if (rankedFiles.length === 0 && tokens.length === 0) {
        rankedFiles = files.slice(0, Math.min(8, files.length));
    }

    var rankedModules = rankList(bundle.modules, tokens,
        ['moduleId', 'summary', 'summaryDetailed'], budget.modules);
    var rankedFeatures = rankList(bundle.features, tokens,
        ['featureId', 'label', 'summary'], 5);
    var rankedWeaknesses = rankList(bundle.weaknesses, tokens,
        ['title', 'category', 'severity'], budget.weaknesses);
    var rankedBugs = rankList(bundle.bugs, tokens,
        ['title', 'summary', 'category'], budget.bugs);

    var rankedDecisions = bundle.decisions.filter(function (d) {
        return scoreRecord(tokens, d, ['title', 'context']) > 0
            || /roadmap|phase|architecture|why/i.test(question);
    }).slice(0, 4);

    var rankedRoadmap = bundle.roadmap.filter(function (r) {
        return scoreRecord(tokens, r, ['title', 'excerpt', 'phases']) > 0
            || /roadmap|phase|priority/i.test(question);
    }).slice(0, 2);

    return {
        intent: opts.intent || 'software_advice',
        cmiVersion: bundle.meta && bundle.meta.cmiVersion,
        gitSha: bundle.meta && bundle.meta.gitSha,
        retrievedAt: new Date().toISOString(),
        domains: domains,
        files: rankedFiles,
        modules: rankedModules,
        features: rankedFeatures,
        weaknesses: rankedWeaknesses,
        decisions: rankedDecisions,
        roadmap: rankedRoadmap,
        bugs: rankedBugs,
        tests: (bundle.tests || []).slice(0, 3)
    };
}

module.exports = {
    tokenize: tokenize,
    classifyDomains: classifyDomains,
    retrieveSlices: retrieveSlices,
    DOMAIN_BUDGETS: DOMAIN_BUDGETS
};
