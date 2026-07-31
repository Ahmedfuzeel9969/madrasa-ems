/**
 * Access key expiry scan — for admin dashboard (Phase 5)
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');

const WARN_DAYS_MS = 30 * 86400000;

function expiryStatus(expiresAt, now) {
    if (!expiresAt) return { status: 'none', daysLeft: null };
    const left = expiresAt - now;
    if (left <= 0) return { status: 'expired', daysLeft: 0 };
    const days = Math.ceil(left / 86400000);
    if (left <= WARN_DAYS_MS) return { status: 'expiring', daysLeft: days };
    return { status: 'ok', daysLeft: days };
}

async function scanTenantKeyExpiry(tenantId, now) {
    const db = admin.firestore();
    const items = [];

    const staffSnap = await db.collection('All_Madrasas').doc(tenantId).collection('StaffPermissions').get();
    staffSnap.forEach(function (doc) {
        const d = doc.data() || {};
        if (!d.accessKeyHash) return;
        const exp = d.accessKeyExpiresAt || null;
        const st = expiryStatus(exp, now);
        if (st.status === 'ok') return;
        items.push({
            type: 'teacher',
            id: doc.id,
            name: d.staffName || doc.id,
            expiresAt: exp,
            status: st.status,
            daysLeft: st.daysLeft
        });
    });

    const parentSnap = await db.collection('All_Madrasas').doc(tenantId).collection('ParentAccessKeys').get();
    parentSnap.forEach(function (doc) {
        const d = doc.data() || {};
        if (!d.accessKeyHash) return;
        const exp = d.accessKeyExpiresAt || null;
        const st = expiryStatus(exp, now);
        if (st.status === 'ok') return;
        items.push({
            type: 'parent',
            id: doc.id,
            name: d.studentName || doc.id,
            expiresAt: exp,
            status: st.status,
            daysLeft: st.daysLeft
        });
    });

    items.sort(function (a, b) {
        return (a.expiresAt || 0) - (b.expiresAt || 0);
    });
    return items;
}

/**
 * Callable — owner/staff admin dashboard
 * data = { tenantId }
 */
const getAccessKeyExpiryReport = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId درکار ہے۔');
    }

    const db = admin.firestore();
    const uid = context.auth.uid;
    const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    const isOwner = madrasaSnap.exists && madrasaSnap.data().ownerUid === uid;
    const staffLink = await db.collection('All_Madrasas').doc(tenantId)
        .collection('Staff_Links').doc(uid).get();
    const isStaff = staffLink.exists && staffLink.data().status === 'active';
    if (!isOwner && !isStaff) {
        throw new functions.https.HttpsError('permission-denied', 'رسائی نہیں۔');
    }

    const now = Date.now();
    const items = await scanTenantKeyExpiry(tenantId, now);
    const settingsSnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('TenantSettings').doc('accessKeys').get();
    const defaultTtlDays = settingsSnap.exists ? (settingsSnap.data().defaultTtlDays || 365) : 365;

    return {
        items: items,
        summary: {
            expired: items.filter(function (x) { return x.status === 'expired'; }).length,
            expiring: items.filter(function (x) { return x.status === 'expiring'; }).length,
            defaultTtlDays: defaultTtlDays
        },
        scannedAt: now
    };
});

module.exports = {
    expiryStatus,
    scanTenantKeyExpiry,
    getAccessKeyExpiryReport
};
