'use strict';

var { PSC_MAX_BYTES } = require('./config');

function buildPSC(question, slices, maxBytes) {
    maxBytes = maxBytes || PSC_MAX_BYTES;
    var psc = {
        pscVersion: 1,
        intent: slices.intent || 'software_advice',
        cmiVersion: slices.cmiVersion,
        gitSha: slices.gitSha,
        retrievedAt: slices.retrievedAt,
        domains: slices.domains || [],
        question: String(question || '').trim(),
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
                return { decisionId: d.decisionId, title: d.title, docRefs: d.docRefs || [] };
            }),
            roadmap: (slices.roadmap || []).map(function (r) {
                return { snapshotId: r.snapshotId, title: r.title, phases: r.phases || [] };
            }),
            bugs: (slices.bugs || []).map(function (b) {
                return { bugId: b.bugId, title: b.title, status: b.status, category: b.category };
            }),
            tests: slices.tests || []
        }
    };

    var serialized = JSON.stringify(psc);
    while (serialized.length > maxBytes && psc.slices.files.length > 1) {
        psc.slices.files.pop();
        serialized = JSON.stringify(psc);
    }
    if (serialized.length > maxBytes) {
        psc.slices.files = psc.slices.files.map(function (f) {
            return Object.assign({}, f, { summaryShort: String(f.summaryShort || '').slice(0, 80) });
        });
        serialized = JSON.stringify(psc);
    }

    psc.bytes = serialized.length;
    psc.withinLimit = psc.bytes <= maxBytes;
    if (!psc.withinLimit) {
        var err = new Error('PSC exceeds max bytes');
        err.code = 'psc_too_large';
        throw err;
    }
    return psc;
}

module.exports = { buildPSC: buildPSC };
