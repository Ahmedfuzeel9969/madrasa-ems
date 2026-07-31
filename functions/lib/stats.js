/**
 * ============================================================================
 * Stats — Pre-aggregated dashboard metrics (scalable to millions of users)
 * ----------------------------------------------------------------------------
 * Reading millions of docs on every dashboard load does not scale. Instead a
 * scheduled job aggregates counts into Platform_Stats/current (+ daily
 * snapshots). The dashboard reads ONE document.
 *
 * NOTE: For very large datasets this should migrate to Firestore aggregation
 * queries / distributed counters / BigQuery (Phase 15). The interface here
 * stays the same.
 * ============================================================================
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const guard = require('./guard');
const logger = require('./logger');

const COL_USERS = 'Platform_Users';
const COL_PAYMENTS = 'Platform_Payments';

async function computeStats() {
    const db = admin.firestore();
    const stats = {
        totalUsers: 0,
        activeUsers: 0,
        suspendedUsers: 0,
        bannedUsers: 0,
        inactiveUsers: 0,
        trialUsers: 0,
        paidUsers: 0,
        newToday: 0,
        revenueToday: 0,
        revenueMonth: 0,
        revenueYear: 0,
        activeSubscriptions: 0,
        expiredSubscriptions: 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startYear = new Date(now.getFullYear(), 0, 1);

    // Users — paginated scan keeps memory bounded.
    let last = null;
    /* eslint-disable no-await-in-loop */
    while (true) {
        let q = db.collection(COL_USERS).orderBy(admin.firestore.FieldPath.documentId()).limit(1000);
        if (last) q = q.startAfter(last);
        const snap = await q.get();
        if (snap.empty) break;
        snap.forEach((doc) => {
            const u = doc.data();
            stats.totalUsers++;
            switch (u.accountStatus) {
                case 'suspended': stats.suspendedUsers++; break;
                case 'banned': stats.bannedUsers++; break;
                case 'inactive': stats.inactiveUsers++; break;
                default: stats.activeUsers++;
            }
            const sub = u.subscription || {};
            if (sub.plan === 'trial') stats.trialUsers++;
            if (sub.status === 'active' && sub.plan && sub.plan !== 'free' && sub.plan !== 'trial') stats.paidUsers++;
            if (sub.status === 'active') stats.activeSubscriptions++;
            if (sub.status === 'expired') stats.expiredSubscriptions++;
            if (u.createdAt && u.createdAt.toDate && u.createdAt.toDate() >= startToday) stats.newToday++;
        });
        last = snap.docs[snap.docs.length - 1].ref;
        if (snap.size < 1000) break;
    }

    // Revenue — only paid payments.
    const paySnap = await db.collection(COL_PAYMENTS).where('status', '==', 'paid').get();
    paySnap.forEach((doc) => {
        const p = doc.data();
        const when = p.paidAt && p.paidAt.toDate ? p.paidAt.toDate() : null;
        const amt = Number(p.amount) || 0;
        if (!when) return;
        if (when >= startToday) stats.revenueToday += amt;
        if (when >= startMonth) stats.revenueMonth += amt;
        if (when >= startYear) stats.revenueYear += amt;
    });
    /* eslint-enable no-await-in-loop */

    stats.totalTenants = 0;
    try {
        const metricsDoc = await db.collection('Platform_Config').doc('sa_tenant_metrics').get();
        if (metricsDoc.exists && metricsDoc.data().metrics) {
            stats.totalTenants = metricsDoc.data().metrics.total || 0;
        }
    } catch (e) { /* optional */ }

    return stats;
}

async function persistStats(stats) {
    const db = admin.firestore();
    const dateKey = new Date().toISOString().split('T')[0];
    await db.collection('Platform_Stats').doc('current').set(stats, { merge: true });
    await db.collection('Platform_Stats').doc('daily_' + dateKey).set(stats, { merge: true });
}

/**
 * Scheduled: refresh aggregated stats every hour.
 */
const scheduledAggregate = functions.pubsub.schedule('every 60 minutes').onRun(async () => {
    try {
        const stats = await computeStats();
        await persistStats(stats);
    } catch (err) {
        await logger.logError('scheduledAggregate', err, {});
    }
    return null;
});

/**
 * Callable: on-demand recompute (requires dashboard.view).
 */
const refreshStats = functions.https.onCall(async (data, context) => {
    const caller = await guard.requirePermission(context, 'dashboard.view');
    const stats = await computeStats();
    await persistStats(stats);
    await logger.audit({
        action: 'stats.refresh',
        actorUid: caller.uid,
        actorEmail: caller.email,
        ip: caller.ip
    });
    return { ok: true };
});

module.exports = { scheduledAggregate, refreshStats, computeStats, persistStats };
