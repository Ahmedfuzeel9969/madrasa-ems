/**
 * ============================================================================
 * Security — Account locking, password reset, device/session control
 * ----------------------------------------------------------------------------
 * Foundation for the Security Center (Phase 5). Provides server-enforced
 * primitives; richer monitoring (IP anomaly, brute-force lockout) builds on
 * Platform_SecurityEvents written via logger.security().
 * ============================================================================
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const guard = require('./guard');
const logger = require('./logger');

/**
 * Callable: send a password reset link (requires security.manage).
 * data = { email, reason }
 */
const forcePasswordReset = functions.https.onCall(async (data, context) => {
    const caller = await guard.requirePermission(context, 'security.manage');
    const email = guard.requireString(data && data.email, 'email');
    const link = await admin.auth().generatePasswordResetLink(email);
    await logger.audit({
        action: 'security.password_reset',
        actorUid: caller.uid,
        actorEmail: caller.email,
        reason: (data && data.reason) || '',
        details: { email },
        ip: caller.ip
    });
    // The link is returned so a notification function can email it (Phase 6).
    return { ok: true, link };
});

/**
 * Callable: lock or unlock an account (requires security.manage).
 * data = { targetUid, locked, reason }
 */
const setAccountLock = functions.https.onCall(async (data, context) => {
    const caller = await guard.requirePermission(context, 'security.manage');
    const targetUid = guard.requireString(data && data.targetUid, 'targetUid');
    const locked = !!(data && data.locked);
    await admin.auth().updateUser(targetUid, { disabled: locked });
    if (locked) await admin.auth().revokeRefreshTokens(targetUid);
    await admin.firestore().collection('Platform_Users').doc(targetUid).set({
        accountStatus: locked ? 'suspended' : 'active',
        statusUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    await logger.audit({
        action: locked ? 'security.lock' : 'security.unlock',
        actorUid: caller.uid,
        actorEmail: caller.email,
        targetUid: targetUid,
        reason: (data && data.reason) || '',
        ip: caller.ip
    });
    return { ok: true, locked };
});

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const IP_RATE_MAX = 40;
const IP_RATE_WINDOW_MS = 60 * 60 * 1000;

function clientIp(rawRequest) {
    if (!rawRequest) return 'unknown';
    var fwd = rawRequest.headers && (rawRequest.headers['x-forwarded-for'] || rawRequest.headers['X-Forwarded-For']);
    if (fwd) return String(fwd).split(',')[0].trim();
    return rawRequest.ip || rawRequest.connection?.remoteAddress || 'unknown';
}

async function assertIpRateLimit(ip, action) {
    const safeIp = String(ip || 'unknown').replace(/[^a-zA-Z0-9:._-]/g, '_').substring(0, 120);
    const docId = action + '_' + safeIp;
    const ref = admin.firestore().collection('LoginRateLimit').doc(docId);
    const now = Date.now();

    return admin.firestore().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const prev = snap.exists ? snap.data() : {};
        const windowStart = prev.windowStart && prev.windowStart.toMillis ? prev.windowStart.toMillis() : 0;
        let count = prev.count || 0;
        if (!windowStart || (now - windowStart) > IP_RATE_WINDOW_MS) {
            count = 0;
        }
        count += 1;
        if (count > IP_RATE_MAX) {
            throw new functions.https.HttpsError('resource-exhausted', 'بہت زیادہ کوششیں۔ بعد میں کوشش کریں۔');
        }
        tx.set(ref, {
            count: count,
            windowStart: admin.firestore.Timestamp.fromMillis(
                (!windowStart || (now - windowStart) > IP_RATE_WINDOW_MS) ? now : windowStart
            ),
            action: action,
            ip: safeIp,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        return { ok: true, count: count };
    });
}

/**
 * Callable: check if login is allowed (server-side rate limit).
 * data = { email }
 */
const checkLoginAllowed = functions.https.onCall(async (data, context) => {
    await assertIpRateLimit(clientIp(context.rawRequest), 'check_login');
    const email = guard.requireString(data && data.email, 'email').toLowerCase();
    const docId = email.replace(/[^a-z0-9@._-]/g, '_');
    const ref = admin.firestore().collection('LoginAttempts').doc(docId);
    const snap = await ref.get();
    if (!snap.exists) return { allowed: true, attempts: 0 };

    const d = snap.data();
    if (d.lockedUntil && d.lockedUntil.toMillis() > Date.now()) {
        return {
            allowed: false,
            attempts: d.count || MAX_ATTEMPTS,
            lockedUntil: d.lockedUntil.toMillis()
        };
    }
    return { allowed: true, attempts: d.count || 0 };
});

/**
 * Callable: record failed login attempt.
 * data = { email }
 */
const recordLoginFailure = functions.https.onCall(async (data, context) => {
    await assertIpRateLimit(clientIp(context.rawRequest), 'record_failure');
    const email = guard.requireString(data && data.email, 'email').toLowerCase();
    const docId = email.replace(/[^a-z0-9@._-]/g, '_');
    const ref = admin.firestore().collection('LoginAttempts').doc(docId);

    return admin.firestore().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const prev = snap.exists ? snap.data() : {};
        const count = (prev.count || 0) + 1;
        const payload = {
            email: email,
            count: count,
            lastAt: admin.firestore.FieldValue.serverTimestamp()
        };
        if (count >= MAX_ATTEMPTS) {
            payload.lockedUntil = admin.firestore.Timestamp.fromMillis(
                Date.now() + LOCKOUT_MINUTES * 60 * 1000
            );
        }
        tx.set(ref, payload, { merge: true });
        return { count, locked: count >= MAX_ATTEMPTS };
    });
});

/**
 * Callable: clear login attempts after success.
 * data = { email }
 */
const clearLoginAttempts = functions.https.onCall(async (data, context) => {
    guard.requireAuth(context);
    const email = guard.requireString(data && data.email, 'email').toLowerCase();
    const docId = email.replace(/[^a-z0-9@._-]/g, '_');
    await admin.firestore().collection('LoginAttempts').doc(docId).delete();
    return { ok: true };
});

module.exports = {
    forcePasswordReset,
    setAccountLock,
    checkLoginAllowed,
    recordLoginFailure,
    clearLoginAttempts
};
