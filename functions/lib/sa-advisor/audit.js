'use strict';

const admin = require('firebase-admin');

async function writeSaAudit(entry) {
    var doc = {
        action: entry.action || 'sa.advisor.ask',
        actorUid: entry.actorUid || '',
        actorEmail: entry.actorEmail || '',
        questionPreview: String(entry.questionPreview || '').substring(0, 280),
        moduleId: entry.moduleId || '',
        language: entry.language || 'ur',
        intent: entry.intent || 'software_advice',
        cmiVersion: entry.cmiVersion || '',
        gitSha: entry.gitSha || '',
        pscBytes: entry.pscBytes || 0,
        retrievedFileIds: entry.retrievedFileIds || [],
        citationCount: entry.citationCount || 0,
        cacheHit: entry.cacheHit === true,
        provider: entry.provider || 'gemini',
        model: entry.model || '',
        tokensEst: entry.tokensEst || { input: 0, output: 0 },
        costEstUsd: entry.costEstUsd || 0,
        domains: entry.domains || [],
        ok: entry.ok !== false,
        errorCode: entry.errorCode || '',
        durationMs: entry.durationMs || 0,
        advisorMode: entry.advisorMode || 'staging',
        ip: entry.ip || '',
        timestamp: admin.firestore.FieldValue.serverTimestamp()
    };
    try {
        await admin.firestore().collection('Platform_AiAuditLog').add(doc);
    } catch (err) {
        console.warn('[SA Advisor] audit write failed', err.message);
    }
}

module.exports = { writeSaAudit: writeSaAudit };
