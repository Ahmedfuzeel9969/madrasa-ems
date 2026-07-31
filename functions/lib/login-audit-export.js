/**
 * Login audit export — combined compliance bundle (Phase 26)
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

async function assertOwner(db, tenantId, uid) {
    const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    if (!madrasaSnap.exists || madrasaSnap.data().ownerUid !== uid) {
        throw new functions.https.HttpsError('permission-denied', 'صرف مالک login audit export کر سکتا ہے۔');
    }
}

async function loadSecurityEvents(db, tenantId, sinceMs, limit) {
    const snap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('SecurityLog').orderBy('clientTs', 'desc').limit(limit).get();
    const rows = [];
    snap.forEach(function (doc) {
        const e = doc.data() || {};
        if (sinceMs && e.clientTs && e.clientTs < sinceMs) return;
        rows.push({
            id: doc.id,
            action: e.action,
            uid: e.uid,
            email: e.email,
            clientTs: e.clientTs,
            details: e.details || {}
        });
    });
    return rows;
}

async function loadSessions(db, tenantId, sinceMs, limit) {
    const snap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('LoginSessions').orderBy('lastSeenAt', 'desc').limit(limit).get();
    const rows = [];
    snap.forEach(function (doc) {
        const s = doc.data() || {};
        if (sinceMs && s.lastSeenAt && s.lastSeenAt < sinceMs) return;
        rows.push({
            sessionId: doc.id,
            uid: s.uid,
            email: s.email,
            deviceLabel: s.deviceLabel,
            portal: s.portal,
            clientIp: s.clientIp,
            countryCode: s.countryCode,
            revoked: !!s.revoked,
            lastSeenAt: s.lastSeenAt,
            createdAt: s.createdAt
        });
    });
    return rows;
}

async function loadAnomalies(db, tenantId, sinceMs, limit) {
    const snap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('SessionAnomalies').orderBy('createdAt', 'desc').limit(limit).get();
    const rows = [];
    snap.forEach(function (doc) {
        const d = doc.data() || {};
        if (sinceMs && d.createdAt && d.createdAt < sinceMs) return;
        rows.push(Object.assign({ id: doc.id }, d));
    });
    return rows;
}

async function loadLockouts(db, tenantId, limit) {
    const snap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('LoginFailures').limit(limit).get();
    const rows = [];
    const now = Date.now();
    snap.forEach(function (doc) {
        const d = doc.data() || {};
        rows.push({
            email: d.email || doc.id,
            count: d.count || 0,
            lockedUntil: d.lockedUntil || 0,
            active: !!(d.lockedUntil && d.lockedUntil > now),
            lastFailureAt: d.lastFailureAt || 0
        });
    });
    return rows;
}

const getLoginAuditSummary = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId درکار ہے۔');
    }
    const db = admin.firestore();
    await assertOwner(db, tenantId, context.auth.uid);
    const days = Math.min(Math.max(parseInt(data && data.days, 10) || 30, 1), 365);
    const sinceMs = Date.now() - days * 86400000;
    const security = await loadSecurityEvents(db, tenantId, sinceMs, 200);
    const sessions = await loadSessions(db, tenantId, sinceMs, 100);
    const anomalies = await loadAnomalies(db, tenantId, sinceMs, 100);
    const lockouts = await loadLockouts(db, tenantId, 100);
    return {
        generatedAt: Date.now(),
        tenantId: tenantId,
        periodDays: days,
        counts: {
            securityEvents: security.length,
            sessions: sessions.length,
            anomalies: anomalies.length,
            lockouts: lockouts.filter(function (l) { return l.active; }).length
        }
    };
});

const exportLoginAudit = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    const format = String((data && data.format) || 'json').trim().toLowerCase();
    const days = Math.min(Math.max(parseInt(data && data.days, 10) || 30, 1), 365);
    const sinceMs = Date.now() - days * 86400000;
    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId درکار ہے۔');
    }
    const db = admin.firestore();
    await assertOwner(db, tenantId, context.auth.uid);
    const bundle = {
        exportedAt: Date.now(),
        tenantId: tenantId,
        periodDays: days,
        securityLog: await loadSecurityEvents(db, tenantId, sinceMs, 1000),
        loginSessions: await loadSessions(db, tenantId, sinceMs, 500),
        sessionAnomalies: await loadAnomalies(db, tenantId, sinceMs, 200),
        loginLockouts: await loadLockouts(db, tenantId, 200)
    };
    if (format === 'csv') {
        const lines = ['section,id,action,email,ts,detail'];
        bundle.securityLog.forEach(function (e) {
            lines.push(['security', e.id, e.action, e.email, e.clientTs, JSON.stringify(e.details || {})].map(escapeCsv).join(','));
        });
        bundle.loginSessions.forEach(function (s) {
            lines.push(['session', s.sessionId, s.portal, s.email, s.lastSeenAt, s.deviceLabel || ''].map(escapeCsv).join(','));
        });
        bundle.sessionAnomalies.forEach(function (a) {
            lines.push(['anomaly', a.id, a.type, a.email, a.createdAt, a.detail || ''].map(escapeCsv).join(','));
        });
        bundle.loginLockouts.forEach(function (l) {
            lines.push(['lockout', l.email, l.count, l.email, l.lastFailureAt, l.active ? 'active' : ''].map(escapeCsv).join(','));
        });
        return { format: 'csv', content: lines.join('\n'), exportedAt: bundle.exportedAt };
    }
    return { format: 'json', bundle: bundle, exportedAt: bundle.exportedAt };
});

module.exports = {
    getLoginAuditSummary,
    exportLoginAudit
};
