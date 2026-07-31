/**
 * Login session anomaly detection (Phase 25)
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const { writeSecurityLog } = require('./security-log-write');
const { dispatchWebhook } = require('./security-webhook');
const { extractClientIp, extractCountryCode } = require('./login-ip-policy');

const DEFAULT_MAX_PER_HOUR = 3;
const PORTAL_WINDOW_MS = 15 * 60000;

function anomaliesCol(db, tenantId) {
    return db.collection('All_Madrasas').doc(tenantId).collection('SessionAnomalies');
}

function detectSessionAnomalies(history, newSession, policy, now) {
    if (!policy || policy.enableSessionAnomalyDetection === false) return [];
    const anomalies = [];
    const maxPerHour = parseInt(policy.sessionAnomalyMaxPerHour, 10) || DEFAULT_MAX_PER_HOUR;
    const hourAgo = (now || Date.now()) - 3600000;
    const ts = now || Date.now();
    const prior = (history || []).filter(function (s) {
        return s.sessionId !== newSession.sessionId;
    });
    const knownDeviceIds = {};
    prior.forEach(function (s) {
        if (s.deviceId) knownDeviceIds[s.deviceId] = true;
    });

    if (prior.length && newSession.deviceId && !knownDeviceIds[newSession.deviceId]) {
        anomalies.push({
            type: 'new_device',
            severity: 'warn',
            detail: 'Login from new device: ' + (newSession.deviceLabel || newSession.deviceId)
        });
    }

    const recentHour = prior.filter(function (s) { return (s.createdAt || 0) >= hourAgo; }).length + 1;
    if (recentHour > maxPerHour) {
        anomalies.push({
            type: 'session_surge',
            severity: 'warn',
            detail: recentHour + ' sessions in last hour (max ' + maxPerHour + ')'
        });
    }

    const activeOther = prior.filter(function (s) {
        return !s.revoked && (s.lastSeenAt || 0) > ts - PORTAL_WINDOW_MS;
    });
    for (let i = 0; i < activeOther.length; i++) {
        const s = activeOther[i];
        if (s.portal && newSession.portal && s.portal !== newSession.portal && s.uid === newSession.uid) {
            anomalies.push({
                type: 'concurrent_portals',
                severity: 'warn',
                detail: 'Active on ' + s.portal + ' and ' + newSession.portal
            });
            break;
        }
    }

    const prevWithCountry = prior.find(function (s) { return s.countryCode; });
    if (newSession.countryCode && prevWithCountry && prevWithCountry.countryCode !== newSession.countryCode) {
        anomalies.push({
            type: 'new_country',
            severity: 'warn',
            detail: 'Country changed from ' + prevWithCountry.countryCode + ' to ' + newSession.countryCode
        });
    }

    return anomalies;
}

async function loadSessionHistory(db, tenantId, uid, limit) {
    const snap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('LoginSessions')
        .orderBy('lastSeenAt', 'desc')
        .limit(limit || 50)
        .get();
    const rows = [];
    snap.forEach(function (doc) {
        const s = doc.data() || {};
        if (s.uid !== uid) return;
        rows.push(Object.assign({ sessionId: doc.id }, s));
    });
    return rows;
}

async function queueOwnerAnomalyEmail(db, tenantId, anomaly, policy, now) {
    if (policy.notifyOwnerOnSessionAnomaly === false || policy.enableEmailDelivery === false) {
        return false;
    }
    const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    const madrasa = madrasaSnap.exists ? madrasaSnap.data() : {};
    const ownerEmail = madrasa.ownerEmail || madrasa.adminEmail || madrasa.email || '';
    if (!ownerEmail) return false;
    const notifyId = 'sess-anom-' + anomaly.id;
    await db.collection('All_Madrasas').doc(tenantId)
        .collection('KeyExpiryNotifications').doc(notifyId)
        .set({
            id: notifyId,
            tenantId: tenantId,
            type: 'session_anomaly',
            channel: 'email_queue',
            to: ownerEmail,
            subject: 'EMS Session Anomaly — ' + anomaly.type,
            body: anomaly.detail + '\nUser: ' + (anomaly.email || anomaly.uid || ''),
            deliveryStatus: 'queued',
            dateKey: new Date(now).toISOString().split('T')[0],
            createdAt: now,
            updatedAt: now
        }, { merge: true });
    return true;
}

async function persistAnomaly(db, tenantId, uid, email, newSession, item, now) {
    const ref = anomaliesCol(db, tenantId).doc();
    const payload = {
        id: ref.id,
        type: item.type,
        severity: item.severity || 'warn',
        detail: item.detail || '',
        uid: uid,
        email: email || '',
        sessionId: newSession.sessionId || '',
        deviceId: newSession.deviceId || '',
        deviceLabel: newSession.deviceLabel || '',
        portal: newSession.portal || '',
        clientIp: newSession.clientIp || '',
        countryCode: newSession.countryCode || '',
        dismissed: false,
        createdAt: now,
        updatedAt: now
    };
    await ref.set(payload);
    return payload;
}

async function processSessionRegistrationAnomalies(db, tenantId, uid, email, newSession, policy) {
    if (!policy || policy.enableSessionAnomalyDetection === false) {
        return { anomalies: [], skipped: true };
    }
    const now = Date.now();
    const history = await loadSessionHistory(db, tenantId, uid, 50);
    const found = detectSessionAnomalies(history, newSession, policy, now);
    if (!found.length) return { anomalies: [], count: 0 };

    const saved = [];
    for (let i = 0; i < found.length; i++) {
        const item = found[i];
        const row = await persistAnomaly(db, tenantId, uid, email, newSession, item, now);
        await writeSecurityLog(db, tenantId, {
            action: 'session_anomaly_detected',
            uid: uid,
            email: email,
            details: {
                type: item.type,
                detail: item.detail,
                sessionId: newSession.sessionId,
                deviceId: newSession.deviceId
            }
        });
        await dispatchWebhook(db, tenantId, {
            action: 'session_anomaly_detected',
            uid: uid,
            email: email,
            details: { type: item.type, detail: item.detail, sessionId: newSession.sessionId }
        }, policy);
        await queueOwnerAnomalyEmail(db, tenantId, row, policy, now);
        saved.push(row);
    }
    return { anomalies: saved, count: saved.length };
}

async function assertOwner(db, tenantId, uid) {
    const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    if (!madrasaSnap.exists || madrasaSnap.data().ownerUid !== uid) {
        throw new functions.https.HttpsError('permission-denied', 'صرف مالک یہ عمل کر سکتا ہے۔');
    }
}

const getSessionAnomalySummary = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId درکار ہے۔');
    }
    const db = admin.firestore();
    await assertOwner(db, tenantId, context.auth.uid);
    const policySnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('TenantSettings').doc('securityPolicy').get();
    const policy = policySnap.exists ? policySnap.data() : {};
    const sinceMs = Date.now() - 7 * 86400000;
    const snap = await anomaliesCol(db, tenantId).orderBy('createdAt', 'desc').limit(100).get();
    let open7d = 0;
    let total7d = 0;
    snap.forEach(function (doc) {
        const d = doc.data() || {};
        if (!d.createdAt || d.createdAt < sinceMs) return;
        total7d++;
        if (!d.dismissed) open7d++;
    });
    return {
        enabled: !!policy.enableSessionAnomalyDetection,
        maxPerHour: parseInt(policy.sessionAnomalyMaxPerHour, 10) || DEFAULT_MAX_PER_HOUR,
        notifyOwner: policy.notifyOwnerOnSessionAnomaly !== false,
        open7d: open7d,
        total7d: total7d,
        generatedAt: Date.now()
    };
});

const listSessionAnomalies = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    const limit = Math.min(Math.max(parseInt(data && data.limit, 10) || 25, 1), 100);
    const openOnly = !!(data && data.openOnly);
    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId درکار ہے۔');
    }
    const db = admin.firestore();
    await assertOwner(db, tenantId, context.auth.uid);
    const snap = await anomaliesCol(db, tenantId).orderBy('createdAt', 'desc').limit(100).get();
    const rows = [];
    snap.forEach(function (doc) {
        const d = doc.data() || {};
        if (openOnly && d.dismissed) return;
        rows.push({
            id: doc.id,
            type: d.type,
            severity: d.severity,
            detail: d.detail,
            email: d.email,
            uid: d.uid,
            portal: d.portal,
            deviceLabel: d.deviceLabel,
            countryCode: d.countryCode,
            dismissed: !!d.dismissed,
            createdAt: d.createdAt
        });
        if (rows.length >= limit) return;
    });
    return { anomalies: rows, count: rows.length };
});

const dismissSessionAnomaly = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    const anomalyId = String((data && data.anomalyId) || '').trim();
    if (!tenantId || !anomalyId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId اور anomalyId درکار ہیں۔');
    }
    const db = admin.firestore();
    await assertOwner(db, tenantId, context.auth.uid);
    const now = Date.now();
    await anomaliesCol(db, tenantId).doc(anomalyId).set({
        dismissed: true,
        dismissedAt: now,
        dismissedBy: context.auth.token.email || context.auth.uid
    }, { merge: true });
    await writeSecurityLog(db, tenantId, {
        action: 'session_anomaly_dismissed',
        uid: context.auth.uid,
        email: context.auth.token.email || '',
        details: { anomalyId: anomalyId }
    });
    return { ok: true };
});

module.exports = {
    DEFAULT_MAX_PER_HOUR,
    PORTAL_WINDOW_MS,
    detectSessionAnomalies,
    processSessionRegistrationAnomalies,
    getSessionAnomalySummary,
    listSessionAnomalies,
    dismissSessionAnomaly,
    extractClientIp,
    extractCountryCode
};
