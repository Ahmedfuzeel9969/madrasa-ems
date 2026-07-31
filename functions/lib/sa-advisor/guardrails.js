'use strict';

var OFF_DOMAIN = [
    /\b(hack|exploit|deploy now|git push|drop table|delete all)\b/i,
    /\b(write code for me|auto fix|commit this)\b/i
];

function validateQuestion(question) {
    var q = String(question || '').trim();
    if (!q) return { ok: false, reason: 'empty' };
    if (q.length > 2000) return { ok: false, reason: 'too_long' };
    for (var i = 0; i < OFF_DOMAIN.length; i++) {
        if (OFF_DOMAIN[i].test(q)) return { ok: false, reason: 'off_domain' };
    }
    return { ok: true };
}

function sanitizeOutput(text) {
    var out = String(text || '').trim();
    out = out.replace(/\bAIza[0-9A-Za-z\-_]{20,}\b/g, '[redacted]');
    out = out.replace(/\bsk-[a-zA-Z0-9]{20,}\b/g, '[redacted]');
    return out;
}

module.exports = {
    validateQuestion: validateQuestion,
    sanitizeOutput: sanitizeOutput
};
