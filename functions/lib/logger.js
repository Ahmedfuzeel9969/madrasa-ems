/**
 * ============================================================================
 * Logger — Immutable Audit Logging + Error/Monitoring
 * ----------------------------------------------------------------------------
 * Audit records are written ONLY here (server-side). Firestore rules forbid
 * client writes to Platform_AuditLog so the trail cannot be tampered with.
 * ============================================================================
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');

const COL_AUDIT = 'Platform_AuditLog';
const COL_SECURITY = 'Platform_SecurityEvents';
const COL_ERRORS = 'Platform_ErrorLog';

/**
 * Write an immutable audit entry.
 * @param {object} entry
 * @param {string} entry.action      machine action key e.g. 'users.suspend'
 * @param {string} entry.actorUid    who performed it
 * @param {string} entry.actorEmail
 * @param {string} [entry.targetUid]
 * @param {string} [entry.targetName]
 * @param {string} [entry.reason]
 * @param {object} [entry.details]
 * @param {string} [entry.ip]
 */
async function audit(entry) {
    const db = admin.firestore();
    const doc = {
        action: entry.action || 'unknown',
        actorUid: entry.actorUid || '',
        actorEmail: entry.actorEmail || '',
        targetUid: entry.targetUid || '',
        targetName: entry.targetName || '',
        reason: entry.reason || '',
        details: entry.details || {},
        ip: entry.ip || '',
        timestamp: admin.firestore.FieldValue.serverTimestamp()
    };
    try {
        await db.collection(COL_AUDIT).add(doc);
    } catch (err) {
        functions.logger.error('Audit write failed', { action: doc.action, error: err.message });
    }
}

/**
 * Record a security-relevant event (failed login, suspicious activity...).
 */
async function security(event) {
    const db = admin.firestore();
    try {
        await db.collection(COL_SECURITY).add({
            type: event.type || 'unknown',
            severity: event.severity || 'info', // info | warning | critical
            uid: event.uid || '',
            email: event.email || '',
            ip: event.ip || '',
            details: event.details || {},
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (err) {
        functions.logger.error('Security event write failed', { error: err.message });
    }
}

/**
 * Persist an application error for the Developer Console.
 */
async function logError(scope, err, context) {
    functions.logger.error(scope, { message: err && err.message, context });
    const db = admin.firestore();
    try {
        await db.collection(COL_ERRORS).add({
            scope: scope,
            message: (err && err.message) || String(err),
            stack: (err && err.stack) || '',
            context: context || {},
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (e) {
        functions.logger.error('Error log write failed', { error: e.message });
    }
}

module.exports = { audit, security, logError, COL_AUDIT, COL_SECURITY, COL_ERRORS };
