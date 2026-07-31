'use strict';

var TAG_RE = /\[(file|weak|bug|decision|roadmap|module|feature):([^\]]+)\]/gi;

function normalizeTagType(type) {
    var t = String(type || '').toLowerCase();
    if (t === 'weak') return 'weakness';
    return t;
}

function buildCitationsFromPsc(psc) {
    var out = [];
    var slices = (psc && psc.slices) || {};
    (slices.files || []).forEach(function (f) {
        out.push({ type: 'file', id: f.fileId, label: f.path, path: f.path, moduleId: f.moduleId });
    });
    (slices.modules || []).forEach(function (m) {
        out.push({ type: 'module', id: m.moduleId, label: m.labelUr || m.moduleId });
    });
    (slices.features || []).forEach(function (f) {
        out.push({ type: 'feature', id: f.featureId, label: f.label });
    });
    (slices.weaknesses || []).forEach(function (w) {
        out.push({ type: 'weakness', id: w.weakId, label: w.title, severity: w.severity });
    });
    (slices.bugs || []).forEach(function (b) {
        out.push({ type: 'bug', id: b.bugId, label: b.title, status: b.status });
    });
    (slices.decisions || []).forEach(function (d) {
        out.push({ type: 'decision', id: d.decisionId, label: d.title, docRefs: d.docRefs });
    });
    (slices.roadmap || []).forEach(function (r) {
        out.push({ type: 'roadmap', id: r.snapshotId, label: r.title });
    });
    return out;
}

function parseInlineCitations(answer) {
    var out = [];
    var m;
    var re = new RegExp(TAG_RE.source, TAG_RE.flags);
    while ((m = re.exec(answer)) !== null) {
        out.push({ type: m[1].toLowerCase(), id: m[2].trim(), label: m[2].trim(), source: 'inline' });
    }
    return out;
}

function buildValidIdSet(psc) {
    var set = Object.create(null);
    buildCitationsFromPsc(psc).forEach(function (c) {
        set[c.type + ':' + c.id] = true;
        if (c.type === 'file' && c.path) {
            set['file:' + c.path] = true;
        }
    });
    return set;
}

function mergeAndValidateCitations(psc, answer) {
    var structured = buildCitationsFromPsc(psc);
    var inline = parseInlineCitations(answer || '');
    var valid = buildValidIdSet(psc);
    var merged = structured.slice();
    var seen = Object.create(null);

    structured.forEach(function (c) {
        seen[c.type + ':' + c.id] = true;
    });

    inline.forEach(function (c) {
        var normType = normalizeTagType(c.type);
        var key = normType + ':' + c.id;
        if (!valid[key] && !(c.type === 'file' && valid['file:' + c.id])) return;
        var storeKey = normType + ':' + c.id;
        if (seen[storeKey]) return;
        seen[storeKey] = true;
        merged.push(Object.assign({}, c, { type: normType }));
    });

    return merged;
}

function stripInvalidCitationTags(answer, psc) {
    var valid = buildValidIdSet(psc);
    return String(answer || '').replace(TAG_RE, function (full, type, id) {
        var trimmed = String(id).trim();
        var normType = normalizeTagType(type);
        var key = normType + ':' + trimmed;
        if (valid[key]) return full;
        if (String(type).toLowerCase() === 'file' && valid['file:' + trimmed]) return full;
        return '';
    });
}

module.exports = {
    buildCitationsFromPsc: buildCitationsFromPsc,
    parseInlineCitations: parseInlineCitations,
    mergeAndValidateCitations: mergeAndValidateCitations,
    stripInvalidCitationTags: stripInvalidCitationTags
};
