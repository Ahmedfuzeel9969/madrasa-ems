/**
 * Server-side SecurityLog writer (Phase 13)
 */
async function writeSecurityLog(db, tenantId, event) {
    if (!db || !tenantId || !event || !event.action) return null;
    const now = Date.now();
    const ref = await db.collection('All_Madrasas').doc(tenantId).collection('SecurityLog').add({
        action: String(event.action).slice(0, 80),
        uid: String(event.uid || '').slice(0, 128),
        email: String(event.email || '').slice(0, 256),
        clientTs: now,
        serverTs: now,
        source: 'cloud_function',
        details: event.details && typeof event.details === 'object' ? event.details : {}
    });
    try {
        const webhook = require('./security-webhook');
        webhook.maybeDispatch(db, tenantId, {
            action: event.action,
            uid: event.uid,
            email: event.email,
            details: event.details,
            logId: ref.id
        }).catch(function () { /* ignore */ });
    } catch (e) { /* ignore */ }
    return ref.id;
}

module.exports = { writeSecurityLog };
