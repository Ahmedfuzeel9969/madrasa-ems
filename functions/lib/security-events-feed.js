/**
 * Security events feed — device + SSO audit for admin dashboard (Phase 14)
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');

const DEVICE_ACTIONS = [
    'trusted_device_requested',
    'trusted_device_approved',
    'trusted_device_rejected',
    'trusted_device_revoked',
    'trusted_device_expired',
    'trusted_device_rate_limited'
];
const SSO_ACTIONS = ['sso_domain_denied', 'sso_provider_denied', 'login_ip_denied', 'login_country_denied', 'login_lockout_triggered', 'login_lockout_cleared', 'session_anomaly_detected', 'session_anomaly_dismissed'];
const MFA_ACTIONS = ['mfa_session_required', 'mfa_policy_updated'];
const ALL_FILTER_ACTIONS = DEVICE_ACTIONS.concat(SSO_ACTIONS).concat(MFA_ACTIONS);

function filterByCategory(action, category) {
    const cat = String(category || 'all').trim().toLowerCase();
    if (cat === 'device') return DEVICE_ACTIONS.indexOf(action) >= 0;
    if (cat === 'sso') return SSO_ACTIONS.indexOf(action) >= 0;
    if (cat === 'mfa') return MFA_ACTIONS.indexOf(action) >= 0;
    return ALL_FILTER_ACTIONS.indexOf(action) >= 0;
}

const getRecentSecurityEvents = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    const category = String((data && data.category) || 'all').trim();
    const limit = Math.min(Math.max(parseInt(data && data.limit, 10) || 25, 1), 100);
    const sinceMs = parseInt(data && data.sinceMs, 10) || (Date.now() - 7 * 86400000);
    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId درکار ہے۔');
    }

    const db = admin.firestore();
    const uid = context.auth.uid;
    const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    const isOwner = madrasaSnap.exists && madrasaSnap.data().ownerUid === uid;
    if (!isOwner) {
        throw new functions.https.HttpsError('permission-denied', 'صرف مالک security events دیکھ سکتا ہے۔');
    }

    const snap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('SecurityLog')
        .orderBy('clientTs', 'desc')
        .limit(200)
        .get();

    const events = [];
    snap.forEach(function (doc) {
        const e = doc.data() || {};
        if (e.clientTs && e.clientTs < sinceMs) return;
        if (!filterByCategory(e.action, category)) return;
        events.push({
            id: doc.id,
            action: e.action,
            uid: e.uid,
            email: e.email,
            clientTs: e.clientTs,
            details: e.details || {}
        });
        if (events.length >= limit) return;
    });

    return { events: events, count: events.length, category: category };
});

function escapeCsv(val) {
    const s = String(val == null ? '' : val);
    if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

const exportSecurityEvents = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    const category = String((data && data.category) || 'all').trim();
    const format = String((data && data.format) || 'json').trim().toLowerCase();
    const limit = Math.min(Math.max(parseInt(data && data.limit, 10) || 100, 1), 500);
    const sinceMs = parseInt(data && data.sinceMs, 10) || (Date.now() - 7 * 86400000);
    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId درکار ہے۔');
    }

    const db = admin.firestore();
    const uid = context.auth.uid;
    const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    const isOwner = madrasaSnap.exists && madrasaSnap.data().ownerUid === uid;
    if (!isOwner) {
        throw new functions.https.HttpsError('permission-denied', 'صرف مالک export کر سکتا ہے۔');
    }

    const snap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('SecurityLog')
        .orderBy('clientTs', 'desc')
        .limit(300)
        .get();

    const events = [];
    snap.forEach(function (doc) {
        const e = doc.data() || {};
        if (e.clientTs && e.clientTs < sinceMs) return;
        if (!filterByCategory(e.action, category)) return;
        events.push({
            id: doc.id,
            action: e.action,
            uid: e.uid,
            email: e.email,
            clientTs: e.clientTs,
            details: e.details || {}
        });
        if (events.length >= limit) return;
    });

    const exportedAt = Date.now();
    if (format === 'csv') {
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
        return { format: 'csv', content: lines.join('\n'), count: events.length, exportedAt: exportedAt };
    }
    return { format: 'json', events: events, count: events.length, exportedAt: exportedAt };
});

module.exports = {
    DEVICE_ACTIONS,
    SSO_ACTIONS,
    MFA_ACTIONS,
    filterByCategory,
    getRecentSecurityEvents,
    exportSecurityEvents
};
