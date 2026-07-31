/**
 * Login session registry — device tracking + revoke (Phase 11)
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const { extractClientIp, extractCountryCode } = require('./login-ip-policy');
const { processSessionRegistrationAnomalies } = require('./login-session-anomaly');

function sessionsCol(db, tenantId) {
    return db.collection('All_Madrasas').doc(tenantId).collection('LoginSessions');
}

function buildDeviceLabel(userAgent) {
    const ua = String(userAgent || '').slice(0, 200);
    if (ua.indexOf('Windows') >= 0) return 'Windows';
    if (ua.indexOf('Android') >= 0) return 'Android';
    if (ua.indexOf('iPhone') >= 0 || ua.indexOf('iPad') >= 0) return 'iOS';
    if (ua.indexOf('Mac') >= 0) return 'Mac';
    if (ua.indexOf('Linux') >= 0) return 'Linux';
    return 'Unknown device';
}

async function assertOwnerOrSelf(db, tenantId, uid, targetUid) {
    const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    const isOwner = madrasaSnap.exists && madrasaSnap.data().ownerUid === uid;
    if (isOwner) return 'owner';
    if (targetUid && targetUid === uid) return 'self';
    throw new functions.https.HttpsError('permission-denied', 'رسائی نہیں۔');
}

async function enforceMaxSessions(db, tenantId, uid, maxSessions, now) {
    if (!maxSessions || maxSessions < 1) return 0;
    const snap = await sessionsCol(db, tenantId)
        .where('uid', '==', uid)
        .where('revoked', '==', false)
        .limit(50)
        .get();
    const active = [];
    snap.forEach(function (doc) {
        active.push({ id: doc.id, ref: doc.ref, lastSeenAt: (doc.data().lastSeenAt || 0) });
    });
    if (active.length < maxSessions) return 0;
    active.sort(function (a, b) { return a.lastSeenAt - b.lastSeenAt; });
    let revoked = 0;
    const toRevoke = active.length - maxSessions + 1;
    for (let i = 0; i < toRevoke; i++) {
        await active[i].ref.set({ revoked: true, revokedAt: now, revokedBy: 'max_sessions' }, { merge: true });
        revoked++;
    }
    return revoked;
}

const registerLoginSession = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    const deviceId = String((data && data.deviceId) || '').trim();
    const sessionId = String((data && data.sessionId) || '').trim();
    const portal = String((data && data.portal) || '').trim();
    const userAgent = String((data && data.userAgent) || '').slice(0, 240);
    if (!tenantId || !deviceId || !sessionId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId, deviceId, sessionId درکار ہیں۔');
    }
    const db = admin.firestore();
    const uid = context.auth.uid;
    const now = Date.now();
    const policySnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('TenantSettings').doc('securityPolicy').get();
    const policy = policySnap.exists ? policySnap.data() : {};
    if (policy.enableLoginSessionRegistry === false) {
        return { ok: true, skipped: true };
    }
    const maxSessions = parseInt(policy.maxActiveSessionsPerUser, 10) || 5;
    await enforceMaxSessions(db, tenantId, uid, maxSessions, now);
    const clientIp = extractClientIp(context.rawRequest);
    const countryCode = extractCountryCode(context.rawRequest);
    const deviceLabel = buildDeviceLabel(userAgent);
    await sessionsCol(db, tenantId).doc(sessionId).set({
        sessionId: sessionId,
        uid: uid,
        email: context.auth.token.email || '',
        deviceId: deviceId,
        deviceLabel: deviceLabel,
        userAgent: userAgent,
        portal: portal,
        clientIp: clientIp,
        countryCode: countryCode,
        revoked: false,
        createdAt: now,
        lastSeenAt: now,
        updatedAt: now
    }, { merge: true });
    const anomalyResult = await processSessionRegistrationAnomalies(
        db,
        tenantId,
        uid,
        context.auth.token.email || '',
        {
            sessionId: sessionId,
            uid: uid,
            deviceId: deviceId,
            deviceLabel: deviceLabel,
            portal: portal,
            clientIp: clientIp,
            countryCode: countryCode
        },
        policy
    );
    return {
        ok: true,
        sessionId: sessionId,
        anomalies: (anomalyResult && anomalyResult.count) || 0
    };
});

const listLoginSessions = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    const limit = Math.min(Math.max(parseInt(data && data.limit, 10) || 30, 1), 100);
    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId درکار ہے۔');
    }
    const db = admin.firestore();
    const uid = context.auth.uid;
    const role = await assertOwnerOrSelf(db, tenantId, uid, data && data.uid);
    const snap = await sessionsCol(db, tenantId).orderBy('lastSeenAt', 'desc').limit(limit).get();
    const sessions = [];
    snap.forEach(function (doc) {
        const s = doc.data() || {};
        if (role !== 'owner' && s.uid !== uid) return;
        if (data && data.activeOnly && s.revoked) return;
        sessions.push({
            sessionId: doc.id,
            uid: s.uid,
            email: s.email,
            deviceLabel: s.deviceLabel,
            portal: s.portal,
            revoked: !!s.revoked,
            lastSeenAt: s.lastSeenAt,
            createdAt: s.createdAt
        });
    });
    return { sessions: sessions, count: sessions.length };
});

const revokeLoginSession = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    const sessionId = String((data && data.sessionId) || '').trim();
    if (!tenantId || !sessionId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId اور sessionId درکار ہیں۔');
    }
    const db = admin.firestore();
    const uid = context.auth.uid;
    const ref = sessionsCol(db, tenantId).doc(sessionId);
    const snap = await ref.get();
    if (!snap.exists) {
        throw new functions.https.HttpsError('not-found', 'Session نہیں ملی۔');
    }
    const s = snap.data() || {};
    await assertOwnerOrSelf(db, tenantId, uid, s.uid);
    const now = Date.now();
    await ref.set({
        revoked: true,
        revokedAt: now,
        revokedBy: context.auth.token.email || uid
    }, { merge: true });
    return { ok: true };
});

const touchLoginSession = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    const sessionId = String((data && data.sessionId) || '').trim();
    if (!tenantId || !sessionId) return { ok: false };
    const db = admin.firestore();
    const ref = sessionsCol(db, tenantId).doc(sessionId);
    const snap = await ref.get();
    if (!snap.exists || snap.data().uid !== context.auth.uid || snap.data().revoked) {
        return { ok: false, revoked: true };
    }
    await ref.set({ lastSeenAt: Date.now(), updatedAt: Date.now() }, { merge: true });
    return { ok: true };
});

module.exports = {
    buildDeviceLabel,
    registerLoginSession,
    listLoginSessions,
    revokeLoginSession,
    touchLoginSession
};
