'use strict';

const admin = require('firebase-admin');
const functions = require('firebase-functions');

/**
 * Immutable tenant-scoped AI audit trail (server writes only).
 */
async function writeAiAudit(tenantId, entry) {
    if (!tenantId) return;
    var db = admin.firestore();
    var doc = {
        action: entry.action || 'ai.ask',
        intent: entry.intent || '',
        actorUid: entry.actorUid || '',
        actorEmail: entry.actorEmail || '',
        provider: entry.provider || 'gemini',
        model: entry.model || '',
        questionPreview: String(entry.questionPreview || '').substring(0, 280),
        scpBytes: entry.scpBytes || 0,
        responseChars: entry.responseChars || 0,
        ok: entry.ok !== false,
        errorCode: entry.errorCode || '',
        ip: entry.ip || '',
        timestamp: admin.firestore.FieldValue.serverTimestamp()
    };
    try {
        await db.collection('All_Madrasas').doc(tenantId)
            .collection('AiAuditLog').add(doc);
    } catch (err) {
        functions.logger.warn('[AI] audit write failed', { tenantId: tenantId, err: err.message });
    }
}

module.exports = { writeAiAudit: writeAiAudit };
