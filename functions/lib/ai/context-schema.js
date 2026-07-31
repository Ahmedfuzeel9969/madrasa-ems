'use strict';

var ALLOWED_INTENTS = Object.freeze([
    'student_performance',
    'class_compare',
    'institution_kpi',
    'institutional_deep_dive'
]);

var MAX_SCP_BYTES = 64 * 1024;
var MAX_QUESTION_LEN = 2000;

/**
 * Validate Structured Context Pack (SCP) — no raw dumps, schema-bound payloads only.
 */
function validateContextPack(pack) {
    if (!pack || typeof pack !== 'object') {
        return { ok: false, reason: 'context_pack_missing' };
    }
    if (pack.scpVersion !== 1) {
        return { ok: false, reason: 'scp_version_invalid' };
    }
    if (ALLOWED_INTENTS.indexOf(pack.intent) === -1) {
        return { ok: false, reason: 'intent_not_allowed' };
    }
    if (!pack.generatedAt || typeof pack.generatedAt !== 'string') {
        return { ok: false, reason: 'generated_at_missing' };
    }
    if (!pack.summary || typeof pack.summary !== 'object') {
        return { ok: false, reason: 'summary_missing' };
    }
    var serialized = JSON.stringify(pack);
    if (serialized.length > MAX_SCP_BYTES) {
        return { ok: false, reason: 'context_pack_too_large' };
    }
    return { ok: true, bytes: serialized.length };
}

function validateQuestion(question) {
    if (typeof question !== 'string' || !question.trim()) {
        return { ok: false, reason: 'question_empty' };
    }
    if (question.length > MAX_QUESTION_LEN) {
        return { ok: false, reason: 'question_too_long' };
    }
    return { ok: true };
}

module.exports = {
    ALLOWED_INTENTS: ALLOWED_INTENTS,
    MAX_SCP_BYTES: MAX_SCP_BYTES,
    validateContextPack: validateContextPack,
    validateQuestion: validateQuestion
};
