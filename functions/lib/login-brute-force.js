/**
 * Tenant-scoped login brute-force protection (Phase 24)
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const { writeSecurityLog } = require('./security-log-write');

const DEFAULT_MAX = 5;
const DEFAULT_LOCKOUT_MIN = 15;

function emailDocId(email) {
    return String(email || '').toLowerCase().replace(/[^a-z0-9@._-]/g, '_').slice(0, 120);
}

function failuresCol(db, tenantId) {
    return db.collection('All_Madrasas').doc(tenantId).collection('LoginFailures');
}

async function assertOwner(db, tenantId, uid) {
    const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    if (!madrasaSnap.exists || madrasaSnap.data().ownerUid !== uid) {
        throw new functions.https.HttpsError('permission-denied', 'صرف مالک یہ عمل کر سکتا ہے۔');
    }
}

async function loadPolicy(db, tenantId) {
    const snap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('TenantSettings').doc('securityPolicy').get();
    return snap.exists ? snap.data() : {};
}

async function readFailureState(db, tenantId, email) {
    const snap = await failuresCol(db, tenantId).doc(emailDocId(email)).get();
    if (!snap.exists) return { count: 0, lockedUntil: 0 };
    const d = snap.data() || {};
    return { count: d.count || 0, lockedUntil: d.lockedUntil || 0 };
}

function isLocked(state, now) {
    return !!(state.lockedUntil && state.lockedUntil > (now || Date.now()));
}

const checkTenantLoginAllowed = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    const email = String((data && data.email) || context.auth.token.email || '').trim().toLowerCase();
    if (!tenantId || !email) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId اور email درکار ہیں۔');
    }
    const db = admin.firestore();
    const policy = await loadPolicy(db, tenantId);
    if (!policy.enableLoginBruteForceProtection) {
        return { allowed: true, skipped: true, attempts: 0 };
    }
    const state = await readFailureState(db, tenantId, email);
    const now = Date.now();
    if (isLocked(state, now)) {
        return {
            allowed: false,
            attempts: state.count,
            lockedUntil: state.lockedUntil,
            locked: true
        };
    }
    return { allowed: true, attempts: state.count || 0 };
});

const recordTenantLoginFailure = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    const email = String((data && data.email) || context.auth.token.email || '').trim().toLowerCase();
    if (!tenantId || !email) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId اور email درکار ہیں۔');
    }
    const db = admin.firestore();
    const policy = await loadPolicy(db, tenantId);
    if (!policy.enableLoginBruteForceProtection) {
        return { ok: true, skipped: true };
    }
    const max = parseInt(policy.maxLoginFailuresPerEmail, 10) || DEFAULT_MAX;
    const lockMin = parseInt(policy.loginLockoutMinutes, 10) || DEFAULT_LOCKOUT_MIN;
    const now = Date.now();
    const ref = failuresCol(db, tenantId).doc(emailDocId(email));
    const result = await db.runTransaction(async function (tx) {
        const snap = await tx.get(ref);
        const prev = snap.exists ? snap.data() : {};
        if (prev.lockedUntil && prev.lockedUntil > now) {
            return { count: prev.count || max, locked: true, lockedUntil: prev.lockedUntil };
        }
        const count = (prev.count || 0) + 1;
        const payload = {
            email: email,
            count: count,
            lastFailureAt: now,
            updatedAt: now
        };
        let locked = false;
        if (count >= max) {
            payload.lockedUntil = now + lockMin * 60000;
            locked = true;
        }
        tx.set(ref, payload, { merge: true });
        return { count: count, locked: locked, lockedUntil: payload.lockedUntil || 0 };
    });
    if (result.locked) {
        await writeSecurityLog(db, tenantId, {
            action: 'login_lockout_triggered',
            uid: context.auth.uid,
            email: email,
            details: { count: result.count, max: max, lockoutMinutes: lockMin }
        });
    }
    return { ok: true, count: result.count, locked: result.locked, lockedUntil: result.lockedUntil || 0 };
});

const clearTenantLoginSuccess = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    const email = String((data && data.email) || context.auth.token.email || '').trim().toLowerCase();
    if (!tenantId || !email) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId اور email درکار ہیں۔');
    }
    const db = admin.firestore();
    await failuresCol(db, tenantId).doc(emailDocId(email)).delete();
    return { ok: true };
});

const getTenantLoginLockouts = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId درکار ہے۔');
    }
    const db = admin.firestore();
    await assertOwner(db, tenantId, context.auth.uid);
    const now = Date.now();
    const snap = await failuresCol(db, tenantId).limit(100).get();
    const rows = [];
    snap.forEach(function (doc) {
        const d = doc.data() || {};
        if (d.lockedUntil && d.lockedUntil > now) {
            rows.push({
                email: d.email || doc.id,
                count: d.count || 0,
                lockedUntil: d.lockedUntil,
                lastFailureAt: d.lastFailureAt || 0
            });
        }
    });
    return { lockouts: rows, generatedAt: now };
});

const unlockTenantLoginLockout = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    const email = String((data && data.email) || '').trim().toLowerCase();
    if (!tenantId || !email) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId اور email درکار ہیں۔');
    }
    const db = admin.firestore();
    await assertOwner(db, tenantId, context.auth.uid);
    await failuresCol(db, tenantId).doc(emailDocId(email)).delete();
    await writeSecurityLog(db, tenantId, {
        action: 'login_lockout_cleared',
        uid: context.auth.uid,
        email: context.auth.token.email || '',
        details: { targetEmail: email }
    });
    return { ok: true };
});

module.exports = {
    emailDocId,
    isLocked,
    checkTenantLoginAllowed,
    recordTenantLoginFailure,
    clearTenantLoginSuccess,
    getTenantLoginLockouts,
    unlockTenantLoginLockout
};
