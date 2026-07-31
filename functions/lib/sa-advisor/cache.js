'use strict';

const admin = require('firebase-admin');
const crypto = require('crypto');

function normalizeQuestion(q) {
    return String(q || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function cacheKey(question, meta, opts) {
    opts = opts || {};
    return crypto.createHash('sha256').update(JSON.stringify({
        q: normalizeQuestion(question),
        v: meta && meta.cmiVersion,
        sha: meta && meta.gitSha,
        moduleId: opts.moduleId || '',
        language: opts.language || 'ur',
        intent: 'software_advice'
    })).digest('hex');
}

function ttlHoursForDomains(domains) {
    if ((domains || []).indexOf('roadmap') >= 0) return 168;
    return 24;
}

async function getCachedAnswer(key) {
    var snap = await admin.firestore().collection('Platform_AdvisorCache').doc(key).get();
    if (!snap.exists) return null;
    var data = snap.data();
    if (data.expiresAt && data.expiresAt.toDate && data.expiresAt.toDate() < new Date()) {
        return null;
    }
    return data;
}

async function setCachedAnswer(key, payload, ttlHours) {
    var expires = new Date();
    expires.setHours(expires.getHours() + (ttlHours || 24));
    await admin.firestore().collection('Platform_AdvisorCache').doc(key).set(
        Object.assign({}, payload, {
            cacheKey: key,
            expiresAt: admin.firestore.Timestamp.fromDate(expires),
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        }),
        { merge: true }
    );
}

module.exports = {
    cacheKey: cacheKey,
    ttlHoursForDomains: ttlHoursForDomains,
    getCachedAnswer: getCachedAnswer,
    setCachedAnswer: setCachedAnswer,
    normalizeQuestion: normalizeQuestion
};
