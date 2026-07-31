/**
 * Compliance retention — purge old SecurityLog + audit exports (Phase 10)
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');

const DEFAULT_RETENTION_DAYS = 365;

async function purgeOldSecurityLogs(db, tenantId, cutoffMs, now) {
    const snap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('SecurityLog')
        .where('clientTs', '<', cutoffMs)
        .limit(200)
        .get();
    if (snap.empty) return 0;
    const batch = db.batch();
    snap.forEach(function (doc) { batch.delete(doc.ref); });
    await batch.commit();
    return snap.size;
}

async function purgeOldAuditExports(db, tenantId, cutoffMs, bucket) {
    let deleted = 0;
    const snap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('SecurityAuditExports')
        .where('exportedAt', '<', cutoffMs)
        .limit(100)
        .get();
    for (let i = 0; i < snap.docs.length; i++) {
        const d = snap.docs[i].data() || {};
        if (d.path && bucket) {
            try {
                await bucket.file(d.path).delete({ ignoreNotFound: true });
            } catch (e) { /* ignore */ }
        }
        await snap.docs[i].ref.delete();
        deleted++;
    }
    return deleted;
}

async function runRetentionForTenant(db, tenantId, retentionDays, now) {
    const days = Math.max(parseInt(retentionDays, 10) || DEFAULT_RETENTION_DAYS, 30);
    const cutoffMs = now - days * 86400000;
    const bucket = admin.storage().bucket();
    const logs = await purgeOldSecurityLogs(db, tenantId, cutoffMs, now);
    const exports = await purgeOldAuditExports(db, tenantId, cutoffMs, bucket);
    return { logsPurged: logs, exportsPurged: exports, retentionDays: days };
}

async function runComplianceRetention(now) {
    const db = admin.firestore();
    const totals = { tenants: 0, logsPurged: 0, exportsPurged: 0 };
    const madrasaSnap = await db.collection('All_Madrasas').get();
    for (let i = 0; i < madrasaSnap.docs.length; i++) {
        const tenantId = madrasaSnap.docs[i].id;
        const policySnap = await db.collection('All_Madrasas').doc(tenantId)
            .collection('TenantSettings').doc('securityPolicy').get();
        const policy = policySnap.exists ? policySnap.data() : {};
        if (policy.enableComplianceRetention === false) continue;
        const retentionDays = policy.auditRetentionDays || DEFAULT_RETENTION_DAYS;
        try {
            const res = await runRetentionForTenant(db, tenantId, retentionDays, now);
            if (res.logsPurged > 0 || res.exportsPurged > 0) {
                totals.tenants++;
                totals.logsPurged += res.logsPurged;
                totals.exportsPurged += res.exportsPurged;
            }
        } catch (err) {
            console.error('retention failed', tenantId, err.message);
        }
    }
    return totals;
}

const scheduledComplianceRetention = functions.pubsub.schedule('every 24 hours').onRun(async function () {
    try {
        await runComplianceRetention(Date.now());
    } catch (err) {
        console.error('scheduledComplianceRetention', err);
    }
    return null;
});

module.exports = {
    DEFAULT_RETENTION_DAYS,
    runRetentionForTenant,
    runComplianceRetention,
    scheduledComplianceRetention
};
