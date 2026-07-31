/**
 * Trusted devices — approval gate, revoke, expiry (Phase 12–13)
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const { writeSecurityLog } = require('./security-log-write');

function devicesCol(db, tenantId) {
    return db.collection('All_Madrasas').doc(tenantId).collection('TrustedDevices');
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

function isDeviceExpired(approvedAt, expiryDays, now) {
    const days = parseInt(expiryDays, 10) || 0;
    if (!days || !approvedAt) return false;
    return (now || Date.now()) > approvedAt + days * 86400000;
}

async function assertOwner(db, tenantId, uid) {
    const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    if (!madrasaSnap.exists || madrasaSnap.data().ownerUid !== uid) {
        throw new functions.https.HttpsError('permission-denied', 'صرف مالک یہ عمل کر سکتا ہے۔');
    }
}

async function getDeviceStatus(db, tenantId, deviceId, uid, expiryDays) {
    const snap = await devicesCol(db, tenantId).doc(deviceId).get();
    if (!snap.exists) return { status: 'unknown', trusted: false, pending: false };
    const d = snap.data() || {};
    if (d.uid && d.uid !== uid) return { status: 'other_user', trusted: false, pending: false };
    if (d.status === 'approved') {
        if (isDeviceExpired(d.approvedAt, expiryDays)) {
            return { status: 'expired', trusted: false, pending: false };
        }
        return { status: 'approved', trusted: true, pending: false };
    }
    if (d.status === 'pending') return { status: 'pending', trusted: false, pending: true };
    if (d.status === 'rejected') return { status: 'rejected', trusted: false, pending: false };
    if (d.status === 'revoked') return { status: 'revoked', trusted: false, pending: false };
    if (d.status === 'expired') return { status: 'expired', trusted: false, pending: false };
    return { status: d.status || 'unknown', trusted: false, pending: false };
}

async function loadSecurityPolicy(db, tenantId) {
    const policySnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('TenantSettings').doc('securityPolicy').get();
    return policySnap.exists ? policySnap.data() : {};
}

async function countRecentDeviceRequests(db, tenantId, uid, sinceMs) {
    const snap = await devicesCol(db, tenantId)
        .where('uid', '==', uid)
        .where('requestedAt', '>=', sinceMs)
        .limit(50)
        .get();
    return snap.size;
}

const checkTrustedDevice = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    const deviceId = String((data && data.deviceId) || '').trim();
    const portal = String((data && data.portal) || 'teacher').trim().toLowerCase();
    if (!tenantId || !deviceId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId اور deviceId درکار ہیں۔');
    }
    const db = admin.firestore();
    const uid = context.auth.uid;
    const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    if (madrasaSnap.exists && madrasaSnap.data().ownerUid === uid) {
        return { trusted: true, status: 'owner_bypass', pending: false };
    }
    const policy = await loadSecurityPolicy(db, tenantId);
    const isParent = portal === 'parent';
    const required = isParent ? !!policy.requireTrustedDeviceForParents : !!policy.requireTrustedDeviceForStaff;
    if (!required) {
        return { trusted: true, status: 'policy_off', pending: false };
    }
    const result = await getDeviceStatus(db, tenantId, deviceId, uid, policy.trustedDeviceExpiryDays);
    return {
        trusted: result.trusted,
        status: result.status,
        pending: result.pending
    };
});

const requestTrustedDevice = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    const deviceId = String((data && data.deviceId) || '').trim();
    const portal = String((data && data.portal) || '').trim();
    const userAgent = String((data && data.userAgent) || '').slice(0, 240);
    if (!tenantId || !deviceId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId اور deviceId درکار ہیں۔');
    }
    const db = admin.firestore();
    const uid = context.auth.uid;
    const now = Date.now();
    const policy = await loadSecurityPolicy(db, tenantId);
    const existing = await devicesCol(db, tenantId).doc(deviceId).get();
    if (existing.exists && existing.data().uid === uid) {
        const st = await getDeviceStatus(db, tenantId, deviceId, uid, policy.trustedDeviceExpiryDays);
        if (st.trusted) return { ok: true, status: st.status };
        if (st.pending) return { ok: true, status: 'pending' };
    }
    const maxPerDay = parseInt(policy.trustedDeviceMaxRequestsPerDay, 10) || 0;
    if (maxPerDay > 0) {
        const recent = await countRecentDeviceRequests(db, tenantId, uid, now - 86400000);
        if (recent >= maxPerDay) {
            await writeSecurityLog(db, tenantId, {
                action: 'trusted_device_rate_limited',
                uid: uid,
                email: context.auth.token.email || '',
                details: { count: recent, limit: maxPerDay, deviceId: deviceId, portal: portal }
            });
            throw new functions.https.HttpsError(
                'resource-exhausted',
                'آج کی device درخواستوں کی حد (' + maxPerDay + ') مکمل ہو چکی ہے۔ کل دوبارہ کوشش کریں۔'
            );
        }
    }
    await devicesCol(db, tenantId).doc(deviceId).set({
        deviceId: deviceId,
        uid: uid,
        email: context.auth.token.email || '',
        deviceLabel: buildDeviceLabel(userAgent),
        userAgent: userAgent,
        portal: portal,
        status: 'pending',
        requestedAt: now,
        updatedAt: now
    }, { merge: true });
    await writeSecurityLog(db, tenantId, {
        action: 'trusted_device_requested',
        uid: uid,
        email: context.auth.token.email || '',
        details: { deviceId: deviceId, portal: portal, deviceLabel: buildDeviceLabel(userAgent) }
    });
    try {
        const trustedNotify = require('./trusted-device-notify');
        await trustedNotify.dispatchTrustedDeviceRequestNotification(db, tenantId, {
            deviceId: deviceId,
            deviceLabel: buildDeviceLabel(userAgent),
            email: context.auth.token.email || '',
            uid: uid
        }, policy, now);
    } catch (e) { /* ignore notify errors */ }
    return { ok: true, status: 'pending' };
});

const approveTrustedDevice = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    const deviceId = String((data && data.deviceId) || '').trim();
    if (!tenantId || !deviceId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId اور deviceId درکار ہیں۔');
    }
    const db = admin.firestore();
    await assertOwner(db, tenantId, context.auth.uid);
    const now = Date.now();
    const devSnap = await devicesCol(db, tenantId).doc(deviceId).get();
    const dev = devSnap.exists ? devSnap.data() : {};
    await devicesCol(db, tenantId).doc(deviceId).set({
        status: 'approved',
        approvedAt: now,
        approvedBy: context.auth.token.email || context.auth.uid,
        updatedAt: now
    }, { merge: true });
    await writeSecurityLog(db, tenantId, {
        action: 'trusted_device_approved',
        uid: context.auth.uid,
        email: context.auth.token.email || '',
        details: { deviceId: deviceId, targetUid: dev.uid || '', targetEmail: dev.email || '' }
    });
    return { ok: true };
});

const rejectTrustedDevice = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    const deviceId = String((data && data.deviceId) || '').trim();
    if (!tenantId || !deviceId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId اور deviceId درکار ہیں۔');
    }
    const db = admin.firestore();
    await assertOwner(db, tenantId, context.auth.uid);
    const now = Date.now();
    const devSnap = await devicesCol(db, tenantId).doc(deviceId).get();
    const dev = devSnap.exists ? devSnap.data() : {};
    await devicesCol(db, tenantId).doc(deviceId).set({
        status: 'rejected',
        rejectedAt: now,
        rejectedBy: context.auth.token.email || context.auth.uid,
        updatedAt: now
    }, { merge: true });
    await writeSecurityLog(db, tenantId, {
        action: 'trusted_device_rejected',
        uid: context.auth.uid,
        email: context.auth.token.email || '',
        details: { deviceId: deviceId, targetUid: dev.uid || '', targetEmail: dev.email || '' }
    });
    return { ok: true };
});

const revokeTrustedDevice = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    const deviceId = String((data && data.deviceId) || '').trim();
    if (!tenantId || !deviceId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId اور deviceId درکار ہیں۔');
    }
    const db = admin.firestore();
    await assertOwner(db, tenantId, context.auth.uid);
    const now = Date.now();
    const devSnap = await devicesCol(db, tenantId).doc(deviceId).get();
    const dev = devSnap.exists ? devSnap.data() : {};
    await devicesCol(db, tenantId).doc(deviceId).set({
        status: 'revoked',
        revokedAt: now,
        revokedBy: context.auth.token.email || context.auth.uid,
        updatedAt: now
    }, { merge: true });
    await writeSecurityLog(db, tenantId, {
        action: 'trusted_device_revoked',
        uid: context.auth.uid,
        email: context.auth.token.email || '',
        details: { deviceId: deviceId, targetUid: dev.uid || '', targetEmail: dev.email || '' }
    });
    return { ok: true };
});

const approveAllPendingTrustedDevices = functions.https.onCall(async function (data, context) {
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
    const snap = await devicesCol(db, tenantId).where('status', '==', 'pending').limit(50).get();
    let approved = 0;
    for (let i = 0; i < snap.docs.length; i++) {
        const doc = snap.docs[i];
        const d = doc.data() || {};
        await doc.ref.set({
            status: 'approved',
            approvedAt: now,
            approvedBy: context.auth.token.email || context.auth.uid,
            updatedAt: now
        }, { merge: true });
        await writeSecurityLog(db, tenantId, {
            action: 'trusted_device_approved',
            uid: context.auth.uid,
            email: context.auth.token.email || '',
            details: { deviceId: doc.id, targetUid: d.uid || '', targetEmail: d.email || '', bulk: true }
        });
        approved++;
    }
    return { ok: true, approved: approved };
});

const listTrustedDevices = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    const statusFilter = String((data && data.status) || '').trim();
    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId درکار ہے۔');
    }
    const db = admin.firestore();
    const uid = context.auth.uid;
    const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    const isOwner = madrasaSnap.exists && madrasaSnap.data().ownerUid === uid;
    const policy = await loadSecurityPolicy(db, tenantId);
    const snap = await devicesCol(db, tenantId).orderBy('updatedAt', 'desc').limit(50).get();
    const devices = [];
    snap.forEach(function (doc) {
        const d = doc.data() || {};
        if (!isOwner && d.uid !== uid) return;
        var status = d.status;
        if (status === 'approved' && isDeviceExpired(d.approvedAt, policy.trustedDeviceExpiryDays)) {
            status = 'expired';
        }
        if (statusFilter && status !== statusFilter) return;
        devices.push({
            deviceId: doc.id,
            uid: d.uid,
            email: d.email,
            deviceLabel: d.deviceLabel,
            status: status,
            portal: d.portal,
            requestedAt: d.requestedAt,
            approvedAt: d.approvedAt,
            revokedAt: d.revokedAt,
            updatedAt: d.updatedAt
        });
    });
    return { devices: devices, count: devices.length };
});

async function expireDevicesForTenant(db, tenantId, expiryDays, now) {
    const days = parseInt(expiryDays, 10) || 0;
    if (!days) return 0;
    const cutoff = now - days * 86400000;
    const snap = await devicesCol(db, tenantId)
        .where('status', '==', 'approved')
        .where('approvedAt', '<', cutoff)
        .limit(100)
        .get();
    let count = 0;
    for (let i = 0; i < snap.docs.length; i++) {
        const doc = snap.docs[i];
        const d = doc.data() || {};
        await doc.ref.set({
            status: 'expired',
            expiredAt: now,
            updatedAt: now
        }, { merge: true });
        await writeSecurityLog(db, tenantId, {
            action: 'trusted_device_expired',
            uid: d.uid || '',
            email: d.email || '',
            details: { deviceId: doc.id, approvedAt: d.approvedAt, expiryDays: days }
        });
        count++;
    }
    return count;
}

async function runTrustedDeviceExpiry(now) {
    const db = admin.firestore();
    const totals = { tenants: 0, expired: 0 };
    const madrasaSnap = await db.collection('All_Madrasas').get();
    for (let i = 0; i < madrasaSnap.docs.length; i++) {
        const tenantId = madrasaSnap.docs[i].id;
        const policy = await loadSecurityPolicy(db, tenantId);
        if (!policy.requireTrustedDeviceForStaff && !policy.requireTrustedDeviceForParents) continue;
        const days = parseInt(policy.trustedDeviceExpiryDays, 10) || 0;
        if (!days) continue;
        totals.tenants++;
        totals.expired += await expireDevicesForTenant(db, tenantId, days, now);
    }
    return totals;
}

const scheduledTrustedDeviceExpiry = functions.pubsub
    .schedule('every 24 hours')
    .onRun(async function () {
        const now = Date.now();
        const result = await runTrustedDeviceExpiry(now);
        console.log('[trusted-device-expiry]', JSON.stringify(result));
        return result;
    });

const getTrustedDeviceStats = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId درکار ہے۔');
    }
    const db = admin.firestore();
    await assertOwner(db, tenantId, context.auth.uid);
    const policy = await loadSecurityPolicy(db, tenantId);
    const snap = await devicesCol(db, tenantId).limit(200).get();
    const stats = { pending: 0, approved: 0, rejected: 0, revoked: 0, expired: 0, total: 0 };
    snap.forEach(function (doc) {
        const d = doc.data() || {};
        var status = d.status || 'unknown';
        if (status === 'approved' && isDeviceExpired(d.approvedAt, policy.trustedDeviceExpiryDays)) {
            status = 'expired';
        }
        if (stats[status] !== undefined) stats[status]++;
        stats.total++;
    });
    return { stats: stats, generatedAt: Date.now() };
});

module.exports = {
    buildDeviceLabel,
    isDeviceExpired,
    getDeviceStatus,
    countRecentDeviceRequests,
    expireDevicesForTenant,
    runTrustedDeviceExpiry,
    checkTrustedDevice,
    requestTrustedDevice,
    approveTrustedDevice,
    rejectTrustedDevice,
    revokeTrustedDevice,
    approveAllPendingTrustedDevices,
    listTrustedDevices,
    getTrustedDeviceStats,
    scheduledTrustedDeviceExpiry
};
