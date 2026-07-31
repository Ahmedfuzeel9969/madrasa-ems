'use strict';

const admin = require('firebase-admin');
const functions = require('firebase-functions');

function todayKey() {
    return new Date().toISOString().slice(0, 10);
}

function monthKey() {
    return new Date().toISOString().slice(0, 7);
}

async function checkRateLimits(uid, cfg, opts) {
    opts = opts || {};
    if (opts.cacheHit && cfg.cacheHitsFree !== false) {
        return { ok: true, cacheHitFree: true };
    }

    var dayRef = admin.firestore().collection('Platform_AdvisorLimits').doc(todayKey());
    var monthRef = admin.firestore().collection('Platform_AdvisorBudget').doc(monthKey());

    return admin.firestore().runTransaction(async function (tx) {
        var daySnap = await tx.get(dayRef);
        var monthSnap = await tx.get(monthRef);
        var day = daySnap.exists ? daySnap.data() : { platformQueryCount: 0, byAdmin: {} };
        var month = monthSnap.exists ? monthSnap.data() : { tokensUsedEst: 0, costUsdEst: 0 };

        var adminCount = (day.byAdmin && day.byAdmin[uid]) || 0;
        var platformCount = day.platformQueryCount || 0;
        var capUsd = Number(cfg.monthlyCostCapUsd) || 50;
        var costUsd = Number(month.costUsdEst) || 0;

        if (adminCount >= (cfg.queriesPerAdminPerDay || 30)) {
            throw new functions.https.HttpsError('resource-exhausted', 'آپ کی روزانہ SA Advisor حد مکمل ہو گئی۔');
        }
        if (platformCount >= (cfg.queriesPlatformPerDay || 100)) {
            throw new functions.https.HttpsError('resource-exhausted', 'Platform Advisor روزانہ حد مکمل۔');
        }
        if (cfg.hardStopAtCap !== false && costUsd >= capUsd) {
            throw new functions.https.HttpsError('resource-exhausted', 'ماہانہ AI budget ($' + capUsd + ') مکمل۔');
        }

        day.byAdmin = day.byAdmin || {};
        day.byAdmin[uid] = adminCount + 1;
        day.platformQueryCount = platformCount + 1;
        day.date = todayKey();
        day.lastUpdated = admin.firestore.FieldValue.serverTimestamp();

        tx.set(dayRef, day, { merge: true });

        return {
            ok: true,
            adminRemaining: (cfg.queriesPerAdminPerDay || 30) - day.byAdmin[uid],
            platformRemaining: (cfg.queriesPlatformPerDay || 100) - day.platformQueryCount,
            budgetRemainingUsd: Math.max(0, capUsd - costUsd)
        };
    });
}

async function recordUsage(tokensEst, costEstUsd) {
    var monthRef = admin.firestore().collection('Platform_AdvisorBudget').doc(monthKey());
    await admin.firestore().runTransaction(async function (tx) {
        var snap = await tx.get(monthRef);
        var month = snap.exists ? snap.data() : { tokensUsedEst: 0, costUsdEst: 0 };
        tx.set(monthRef, {
            month: monthKey(),
            tokensUsedEst: (Number(month.tokensUsedEst) || 0) + (Number(tokensEst) || 0),
            costUsdEst: (Number(month.costUsdEst) || 0) + (Number(costEstUsd) || 0),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    });
}

async function getLimitsSummary(uid, cfg) {
    var daySnap = await admin.firestore().collection('Platform_AdvisorLimits').doc(todayKey()).get();
    var monthSnap = await admin.firestore().collection('Platform_AdvisorBudget').doc(monthKey()).get();
    var day = daySnap.exists ? daySnap.data() : { byAdmin: {}, platformQueryCount: 0 };
    var month = monthSnap.exists ? monthSnap.data() : { costUsdEst: 0 };
    var adminUsed = (day.byAdmin && day.byAdmin[uid]) || 0;
    var capUsd = Number(cfg.monthlyCostCapUsd) || 50;
    return {
        adminUsed: adminUsed,
        adminRemaining: Math.max(0, (cfg.queriesPerAdminPerDay || 30) - adminUsed),
        platformUsed: day.platformQueryCount || 0,
        platformRemaining: Math.max(0, (cfg.queriesPlatformPerDay || 100) - (day.platformQueryCount || 0)),
        costUsdEst: Number(month.costUsdEst) || 0,
        budgetRemainingUsd: Math.max(0, capUsd - (Number(month.costUsdEst) || 0)),
        monthlyCostCapUsd: capUsd
    };
}

module.exports = {
    checkRateLimits: checkRateLimits,
    recordUsage: recordUsage,
    getLimitsSummary: getLimitsSummary
};
