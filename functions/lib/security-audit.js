/**
 * Security audit export — compliance CSV/JSON (Phase 7)
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');

function escapeCsv(val) {
    const s = String(val == null ? '' : val);
    if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

function eventsToCsv(events) {
    const header = ['action', 'uid', 'email', 'clientTs', 'details'];
    const lines = [header.join(',')];
    events.forEach(function (e) {
        lines.push([
            escapeCsv(e.action),
            escapeCsv(e.uid),
            escapeCsv(e.email),
            escapeCsv(e.clientTs),
            escapeCsv(typeof e.details === 'object' ? JSON.stringify(e.details) : e.details)
        ].join(','));
    });
    return lines.join('\n');
}

/**
 * data = { tenantId, limit?, format?: 'json'|'csv', sinceMs? }
 */
const exportSecurityLog = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    const limit = Math.min(Math.max(parseInt(data && data.limit, 10) || 500, 1), 2000);
    const format = String((data && data.format) || 'json').trim().toLowerCase();
    const sinceMs = parseInt(data && data.sinceMs, 10) || 0;

    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId درکار ہے۔');
    }

    const db = admin.firestore();
    const uid = context.auth.uid;
    const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    const isOwner = madrasaSnap.exists && madrasaSnap.data().ownerUid === uid;
    if (!isOwner) {
        throw new functions.https.HttpsError('permission-denied', 'صرف مالک audit export کر سکتا ہے۔');
    }

    const snap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('SecurityLog').orderBy('clientTs', 'desc').limit(limit).get();

    const events = [];
    snap.forEach(function (doc) {
        const e = doc.data() || {};
        if (sinceMs && e.clientTs && e.clientTs < sinceMs) return;
        events.push({
            id: doc.id,
            action: e.action,
            uid: e.uid,
            email: e.email,
            clientTs: e.clientTs,
            details: e.details || {}
        });
    });

    const exportedAt = Date.now();
    if (format === 'csv') {
        return {
            format: 'csv',
            content: eventsToCsv(events),
            count: events.length,
            exportedAt: exportedAt
        };
    }
    return {
        format: 'json',
        events: events,
        count: events.length,
        exportedAt: exportedAt
    };
});

async function exportTenantSecurityLogToStorage(db, tenantId, limit, now, source) {
    const snap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('SecurityLog').orderBy('clientTs', 'desc').limit(limit).get();
    const events = [];
    snap.forEach(function (doc) {
        const e = doc.data() || {};
        events.push({
            id: doc.id,
            action: e.action,
            uid: e.uid,
            email: e.email,
            clientTs: e.clientTs,
            details: e.details || {}
        });
    });
    const dateKey = new Date(now).toISOString().split('T')[0];
    const bucket = admin.storage().bucket();
    const path = 'ems-audit/' + tenantId + '/' + dateKey + '-' + now + '.json';
    const payload = JSON.stringify({
        tenantId: tenantId,
        exportedAt: now,
        count: events.length,
        events: events
    }, null, 2);
    await bucket.file(path).save(payload, {
        contentType: 'application/json',
        metadata: { cacheControl: 'private, max-age=0' }
    });
    const exportMeta = {
        path: path,
        count: events.length,
        exportedAt: now,
        format: 'json',
        source: source || 'manual'
    };
    await db.collection('All_Madrasas').doc(tenantId)
        .collection('TenantSettings').doc('auditExport')
        .set({
            lastExportAt: now,
            lastPath: path,
            lastCount: events.length,
            lastFormat: 'json'
        }, { merge: true });
    await db.collection('All_Madrasas').doc(tenantId)
        .collection('SecurityAuditExports').doc(String(now))
        .set(exportMeta, { merge: true });
    return exportMeta;
}

async function runScheduledAuditExports(now) {
    const db = admin.firestore();
    const totals = { tenants: 0, exported: 0 };
    const madrasaSnap = await db.collection('All_Madrasas').get();
    for (let i = 0; i < madrasaSnap.docs.length; i++) {
        const tenantId = madrasaSnap.docs[i].id;
        const policySnap = await db.collection('All_Madrasas').doc(tenantId)
            .collection('TenantSettings').doc('securityPolicy').get();
        const policy = policySnap.exists ? policySnap.data() : {};
        if (policy.enableScheduledAuditExport === false) continue;
        try {
            const res = await exportTenantSecurityLogToStorage(db, tenantId, 2000, now, 'scheduled');
            totals.tenants++;
            totals.exported += res.count;
        } catch (err) {
            console.error('audit export failed', tenantId, err.message);
        }
    }
    return totals;
}

const scheduledSecurityLogExport = functions.pubsub.schedule('every 24 hours').onRun(async function () {
    try {
        await runScheduledAuditExports(Date.now());
    } catch (err) {
        console.error('scheduledSecurityLogExport', err);
    }
    return null;
});

/**
 * Callable — on-demand storage export
 * data = { tenantId, limit? }
 */
const triggerSecurityLogExport = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    const limit = Math.min(Math.max(parseInt(data && data.limit, 10) || 2000, 1), 5000);
    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId درکار ہے۔');
    }
    const db = admin.firestore();
    const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    if (!madrasaSnap.exists || madrasaSnap.data().ownerUid !== context.auth.uid) {
        throw new functions.https.HttpsError('permission-denied', 'صرف مالک export کر سکتا ہے۔');
    }
    const res = await exportTenantSecurityLogToStorage(db, tenantId, limit, Date.now(), 'manual');
    return { ok: true, path: res.path, count: res.count, exportedAt: res.exportedAt };
});

/**
 * Callable — signed URL for last audit export in Cloud Storage
 * data = { tenantId, path? }
 */
const getAuditExportDownloadUrl = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId درکار ہے۔');
    }
    const db = admin.firestore();
    const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    if (!madrasaSnap.exists || madrasaSnap.data().ownerUid !== context.auth.uid) {
        throw new functions.https.HttpsError('permission-denied', 'صرف مالک download کر سکتا ہے۔');
    }
    let path = String((data && data.path) || '').trim();
    if (!path) {
        const metaSnap = await db.collection('All_Madrasas').doc(tenantId)
            .collection('TenantSettings').doc('auditExport').get();
        if (!metaSnap.exists || !metaSnap.data().lastPath) {
            throw new functions.https.HttpsError('not-found', 'کوئی export نہیں ملا۔');
        }
        path = metaSnap.data().lastPath;
    }
    if (path.indexOf('ems-audit/' + tenantId + '/') !== 0) {
        throw new functions.https.HttpsError('permission-denied', 'غلط export path۔');
    }
    const bucket = admin.storage().bucket();
    const file = bucket.file(path);
    const existsArr = await file.exists();
    if (!existsArr[0]) {
        throw new functions.https.HttpsError('not-found', 'فائل Storage میں نہیں۔');
    }
    const expiresMs = Date.now() + 15 * 60 * 1000;
    const signed = await file.getSignedUrl({
        action: 'read',
        expires: expiresMs
    });
    return {
        ok: true,
        url: signed[0],
        path: path,
        expiresAt: expiresMs
    };
});

/**
 * Callable — list audit export history
 * data = { tenantId, limit? }
 */
const listAuditExportHistory = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    const limit = Math.min(Math.max(parseInt(data && data.limit, 10) || 20, 1), 50);
    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId درکار ہے۔');
    }
    const db = admin.firestore();
    const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    if (!madrasaSnap.exists || madrasaSnap.data().ownerUid !== context.auth.uid) {
        throw new functions.https.HttpsError('permission-denied', 'صرف مالک دیکھ سکتا ہے۔');
    }
    const snap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('SecurityAuditExports')
        .orderBy('exportedAt', 'desc')
        .limit(limit)
        .get();
    const exports = [];
    snap.forEach(function (doc) {
        const e = doc.data() || {};
        exports.push({
            id: doc.id,
            path: e.path,
            count: e.count,
            exportedAt: e.exportedAt,
            format: e.format || 'json',
            source: e.source || 'manual'
        });
    });
    return { exports: exports, count: exports.length };
});

module.exports = {
    escapeCsv,
    eventsToCsv,
    exportSecurityLog,
    exportTenantSecurityLogToStorage,
    runScheduledAuditExports,
    scheduledSecurityLogExport,
    triggerSecurityLogExport,
    getAuditExportDownloadUrl,
    listAuditExportHistory
};
