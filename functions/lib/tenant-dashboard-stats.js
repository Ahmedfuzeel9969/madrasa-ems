/**
 * Tenant Dashboard Stats — pre-aggregated KPIs (Phase 2 Sprint 2)
 * Path: All_Madrasas/{tenantId}/DashboardStats/current
 * Sub: All_Madrasas/{tenantId}/FeeSummary/{studentId}
 * E8: FinanceSummary/monthly_{YYYY-MM} · AttendanceSummary/{YYYY-MM}
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const logger = require('./logger');
const examCurSummaries = require('./tenant-exam-curriculum-summaries');

const PAGE = 500;

function statsRef(db, tenantId) {
    return db.collection('All_Madrasas').doc(tenantId).collection('DashboardStats').doc('current');
}

function feeSummaryRef(db, tenantId, studentId) {
    return db.collection('All_Madrasas').doc(tenantId).collection('FeeSummary').doc(String(studentId));
}

function financeSummaryRef(db, tenantId, monthKey) {
    return db.collection('All_Madrasas').doc(tenantId).collection('FinanceSummary').doc('monthly_' + monthKey);
}

function attendanceSummaryRef(db, tenantId, monthKey) {
    return db.collection('All_Madrasas').doc(tenantId).collection('AttendanceSummary').doc(monthKey);
}

function monthFromAttDocId(docId) {
    if (!docId || docId.indexOf('att_rec_') !== 0) return null;
    return docId.substring(8, 15);
}

function defaultFinanceSummary(monthKey) {
    var today = new Date().toISOString().split('T')[0];
    return {
        version: 1,
        monthKey: monthKey,
        totalCollected: 0,
        todayCollected: 0,
        todayDate: today,
        collectionCount: 0
    };
}

function defaultAttendanceSummary(monthKey) {
    var today = pakistanDateStr();
    return {
        version: 1,
        monthKey: monthKey,
        dailyPresent: {},
        monthPresentTotal: 0,
        todayPresent: 0,
        todayAbsent: 0,
        todayLeave: 0,
        todayDate: today
    };
}

function pakistanDateStr(d) {
    d = d || new Date();
    try {
        var fmt = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Karachi',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        var y = '', m = '', day = '';
        fmt.formatToParts(d).forEach(function (p) {
            if (p.type === 'year') y = p.value;
            if (p.type === 'month') m = p.value;
            if (p.type === 'day') day = p.value;
        });
        if (y && m && day) return y + '-' + m + '-' + day;
    } catch (e) { /* fall through */ }
    return d.toISOString().split('T')[0];
}

function attStatusBucket(st) {
    if (st == null || st === '') return null;
    var s = String(st).trim().toLowerCase();
    if (s === 'p' || s === 'present' || st === 'حاضر') return 'present';
    if (s === 'a' || s === 'absent' || st === 'غیرحاضر' || st === 'غیر حاضر') return 'absent';
    if (s === 'l' || s === 'leave' || st === 'رخصت') return 'leave';
    return null;
}

function defaultStats(dateKey) {
    return {
        version: 2,
        dateKey: dateKey || new Date().toISOString().split('T')[0],
        counts: { students: 0, teachers: 0, staff: 0, announcements: 0 },
        finance: {
            ledgerIncome: 0,
            ledgerExpenseToday: 0,
            feeCollectionsTotal: 0,
            totalIncome: 0,
            totalArrears: 0
        },
        attendance: { todayPresent: 0, todayDate: dateKey || new Date().toISOString().split('T')[0] },
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
}

function userTypeCountsDelta(before, after) {
    var delta = { students: 0, teachers: 0, staff: 0 };
    function bump(type, n) {
        if (type === 'student') delta.students += n;
        else if (type === 'teacher') delta.teachers += n;
        else if (type === 'staff') delta.staff += n;
    }
    if (before && before.exists) bump(before.data().type, -1);
    if (after && after.exists) bump(after.data().type, 1);
    return delta;
}

function num(v) {
    return Number(v) || 0;
}

/** Voided fee receipts contribute Rs 0 to aggregates (audit record retained). */
function feeCollectionEffectiveAmount(data) {
    if (!data || data.isVoid === true) return 0;
    return num(data.amount);
}

function feeCollectionCountsTowardStats(data) {
    return !!(data && data.isVoid !== true);
}

function countPresentInAttendanceDoc(data, dayNum) {
    if (!data || !data.records) return 0;
    var set = new Set();
    Object.keys(data.records).forEach(function (uid) {
        var dayRec = data.records[uid];
        if (!dayRec) return;
        var st = dayRec[dayNum] || dayRec[String(dayNum)];
        if (st === 'P' || st === 'حاضر') set.add(uid);
    });
    return set.size;
}

async function mergeStatsDelta(db, tenantId, mutator) {
    var ref = statsRef(db, tenantId);
    await db.runTransaction(async function (tx) {
        var snap = await tx.get(ref);
        var stats = snap.exists ? snap.data() : defaultStats();
        if (!stats.counts) stats.counts = { students: 0, teachers: 0, staff: 0, announcements: 0 };
        if (!stats.finance) stats.finance = defaultStats().finance;
        if (!stats.attendance) stats.attendance = defaultStats().attendance;
        mutator(stats);
        stats.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        tx.set(ref, stats, { merge: true });
    });
}

async function applyFinanceSummaryDelta(db, tenantId, before, after) {
    var beforeAmt = before && before.exists ? feeCollectionEffectiveAmount(before.data()) : 0;
    var afterAmt = after && after.exists ? feeCollectionEffectiveAmount(after.data()) : 0;
    var delta = afterAmt - beforeAmt;
    var countDelta = (after && after.exists && feeCollectionCountsTowardStats(after.data()) ? 1 : 0)
        - (before && before.exists && feeCollectionCountsTowardStats(before.data()) ? 1 : 0);
    if (!delta && !countDelta) return;

    var today = new Date().toISOString().split('T')[0];
    var dateStr = (after && after.exists && after.data().date)
        || (before && before.exists && before.data().date)
        || today;
    var monthKey = String(dateStr).substring(0, 7) || today.substring(0, 7);
    var ref = financeSummaryRef(db, tenantId, monthKey);

    await db.runTransaction(async function (tx) {
        var snap = await tx.get(ref);
        var data = snap.exists ? snap.data() : defaultFinanceSummary(monthKey);
        data.version = 1;
        data.monthKey = monthKey;
        data.totalCollected = num(data.totalCollected) + delta;
        data.collectionCount = Math.max(0, num(data.collectionCount) + countDelta);
        if (dateStr === today) {
            if (data.todayDate !== today) {
                data.todayCollected = 0;
                data.todayDate = today;
            }
            data.todayCollected = num(data.todayCollected) + delta;
        }
        data.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        tx.set(ref, data, { merge: true });
    });
}

async function recomputeAttendanceSummaryForMonth(db, tenantId, monthKey) {
    if (!monthKey) return null;
    var prefix = 'att_rec_' + monthKey;
    var snap = await db.collection('All_Madrasas').doc(tenantId).collection('Attendance')
        .where(admin.firestore.FieldPath.documentId(), '>=', prefix)
        .where(admin.firestore.FieldPath.documentId(), '<=', prefix + '\uf8ff')
        .get();

    var dailyPresentSets = {};
    var dailyAbsentSets = {};
    var dailyLeaveSets = {};
    for (var d = 1; d <= 31; d++) {
        dailyPresentSets[d] = new Set();
        dailyAbsentSets[d] = new Set();
        dailyLeaveSets[d] = new Set();
    }

    snap.forEach(function (doc) {
        var data = doc.data();
        if (!data || !data.records) return;
        Object.keys(data.records).forEach(function (uid) {
            var dayRec = data.records[uid];
            if (!dayRec) return;
            for (var day = 1; day <= 31; day++) {
                var st = dayRec[day] || dayRec[String(day)];
                var bucket = attStatusBucket(st);
                if (bucket === 'present') dailyPresentSets[day].add(uid);
                else if (bucket === 'absent') dailyAbsentSets[day].add(uid);
                else if (bucket === 'leave') dailyLeaveSets[day].add(uid);
            }
        });
    });

    var dailyPresent = {};
    var monthPresentTotal = 0;
    for (var k = 1; k <= 31; k++) {
        var n = dailyPresentSets[k].size;
        if (n > 0) {
            dailyPresent[String(k)] = n;
            monthPresentTotal += n;
        }
    }

    var today = pakistanDateStr();
    var todayDay = parseInt(today.substring(8, 10), 10);
    var isCurrentMonth = monthKey === today.substring(0, 7);
    var todayPresent = 0;
    var todayAbsent = 0;
    var todayLeave = 0;
    if (isCurrentMonth) {
        var presentToday = dailyPresentSets[todayDay] || new Set();
        var absentToday = dailyAbsentSets[todayDay] || new Set();
        var leaveToday = dailyLeaveSets[todayDay] || new Set();
        todayPresent = presentToday.size;
        absentToday.forEach(function (id) {
            if (!presentToday.has(id)) todayAbsent++;
        });
        leaveToday.forEach(function (id) {
            if (!presentToday.has(id) && !absentToday.has(id)) todayLeave++;
        });
    }

    var payload = {
        version: 1,
        monthKey: monthKey,
        dailyPresent: dailyPresent,
        monthPresentTotal: monthPresentTotal,
        todayPresent: todayPresent,
        todayAbsent: todayAbsent,
        todayLeave: todayLeave,
        todayDate: today,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    await attendanceSummaryRef(db, tenantId, monthKey).set(payload, { merge: true });
    return payload;
}

async function recomputeFinanceSummaries(db, tenantId, feeSnap) {
    var today = new Date().toISOString().split('T')[0];
    var byMonth = {};
    feeSnap.forEach(function (doc) {
        var d = doc.data();
        if (!feeCollectionCountsTowardStats(d)) return;
        var mk = String(d.date || '').substring(0, 7) || today.substring(0, 7);
        if (!byMonth[mk]) {
            byMonth[mk] = { totalCollected: 0, collectionCount: 0, todayCollected: 0, todayDate: today };
        }
        byMonth[mk].totalCollected += feeCollectionEffectiveAmount(d);
        byMonth[mk].collectionCount++;
        if (d.date === today) byMonth[mk].todayCollected += feeCollectionEffectiveAmount(d);
    });
    var keys = Object.keys(byMonth);
    for (var i = 0; i < keys.length; i++) {
        var mk = keys[i];
        var row = byMonth[mk];
        await financeSummaryRef(db, tenantId, mk).set({
            version: 1,
            monthKey: mk,
            totalCollected: row.totalCollected,
            collectionCount: row.collectionCount,
            todayCollected: row.todayCollected,
            todayDate: row.todayDate,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    }
}

async function applyFeeDelta(db, tenantId, before, after) {
    await applyFinanceSummaryDelta(db, tenantId, before, after);

    var beforeAmt = before && before.exists ? feeCollectionEffectiveAmount(before.data()) : 0;
    var afterAmt = after && after.exists ? feeCollectionEffectiveAmount(after.data()) : 0;
    var delta = afterAmt - beforeAmt;
    if (!delta) return;

    var studentId = (after && after.exists && after.data().studentId)
        || (before && before.exists && before.data().studentId);
    if (studentId) {
        var fsRef = feeSummaryRef(db, tenantId, studentId);
        await db.runTransaction(async function (tx) {
            var snap = await tx.get(fsRef);
            var paid = snap.exists ? num(snap.data().totalPaid) : 0;
            tx.set(fsRef, {
                totalPaid: paid + delta,
                studentId: String(studentId),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        });
    }

    await mergeStatsDelta(db, tenantId, function (stats) {
        stats.finance.feeCollectionsTotal = num(stats.finance.feeCollectionsTotal) + delta;
        stats.finance.totalIncome = num(stats.finance.ledgerIncome) + num(stats.finance.feeCollectionsTotal);
    });
}

async function applyLedgerDelta(db, tenantId, before, after) {
    var today = new Date().toISOString().split('T')[0];
    var bAmt = before && before.exists ? num(before.data().amount) : 0;
    var aAmt = after && after.exists ? num(after.data().amount) : 0;
    var bType = before && before.exists ? before.data().type : null;
    var aType = after && after.exists ? after.data().type : null;
    var bDate = before && before.exists ? before.data().date : null;
    var aDate = after && after.exists ? after.data().date : null;

    await mergeStatsDelta(db, tenantId, function (stats) {
        if (bType === 'Income') stats.finance.ledgerIncome = num(stats.finance.ledgerIncome) - bAmt;
        if (aType === 'Income') stats.finance.ledgerIncome = num(stats.finance.ledgerIncome) + aAmt;
        if (bType === 'Expense' && bDate === today) {
            stats.finance.ledgerExpenseToday = num(stats.finance.ledgerExpenseToday) - bAmt;
        }
        if (aType === 'Expense' && aDate === today) {
            stats.finance.ledgerExpenseToday = num(stats.finance.ledgerExpenseToday) + aAmt;
        }
        stats.finance.totalIncome = num(stats.finance.ledgerIncome) + num(stats.finance.feeCollectionsTotal);
    });
}

async function refreshTodayAttendance(db, tenantId) {
    var today = new Date().toISOString().split('T')[0];
    var month = today.substring(0, 7);
    var dayNum = parseInt(today.substring(8, 10), 10);
    var prefix = 'att_rec_' + month;
    var col = db.collection('All_Madrasas').doc(tenantId).collection('Attendance');
    var snap = await col
        .where(admin.firestore.FieldPath.documentId(), '>=', prefix)
        .where(admin.firestore.FieldPath.documentId(), '<=', prefix + '\uf8ff')
        .get();
    var presentSet = new Set();
    snap.forEach(function (doc) {
        var data = doc.data();
        if (!data || !data.records) return;
        Object.keys(data.records).forEach(function (uid) {
            var dayRec = data.records[uid];
            if (!dayRec) return;
            var st = dayRec[dayNum] || dayRec[String(dayNum)];
            if (st === 'P' || st === 'حاضر') presentSet.add(uid);
        });
    });
    await mergeStatsDelta(db, tenantId, function (stats) {
        stats.attendance.todayPresent = presentSet.size;
        stats.attendance.todayDate = today;
    });
    await recomputeAttendanceSummaryForMonth(db, tenantId, month);
}

async function recomputeTenantStats(tenantId) {
    var db = admin.firestore();
    var today = new Date().toISOString().split('T')[0];
    var stats = defaultStats(today);
    var base = db.collection('All_Madrasas').doc(tenantId);

    var regSnap = await base.collection('Registrations').get();
    regSnap.forEach(function (doc) {
        var t = doc.data().type;
        if (t === 'student') stats.counts.students++;
        else if (t === 'teacher') stats.counts.teachers++;
        else if (t === 'staff') stats.counts.staff++;
    });

    var annSnap = await base.collection('Announcements').get();
    stats.counts.announcements = annSnap.size;

    var feeSnap = await base.collection('FeeCollections').get();
    feeSnap.forEach(function (doc) {
        stats.finance.feeCollectionsTotal += num(doc.data().amount);
    });

    var ledgerSnap = await base.collection('LedgerEntries').get();
    ledgerSnap.forEach(function (doc) {
        var d = doc.data();
        if (d.type === 'Income') stats.finance.ledgerIncome += num(d.amount);
        if (d.type === 'Expense' && d.date === today) stats.finance.ledgerExpenseToday += num(d.amount);
    });
    stats.finance.totalIncome = stats.finance.ledgerIncome + stats.finance.feeCollectionsTotal;

    var paidByStudent = {};
    feeSnap.forEach(function (doc) {
        var d = doc.data();
        if (!d.studentId) return;
        paidByStudent[d.studentId] = (paidByStudent[d.studentId] || 0) + num(d.amount);
    });

    var setupsSnap = await base.collection('FeeSetups').get();
    var totalArrears = 0;
    setupsSnap.forEach(function (doc) {
        var setup = doc.data();
        var net = num(setup.netPayable);
        var paid = paidByStudent[doc.id] || 0;
        totalArrears += Math.max(0, net - paid);
    });
    stats.finance.totalArrears = totalArrears;

    var month = today.substring(0, 7);
    var dayNum = parseInt(today.substring(8, 10), 10);
    var attSnap = await base.collection('Attendance')
        .where(admin.firestore.FieldPath.documentId(), '>=', 'att_rec_' + month)
        .where(admin.firestore.FieldPath.documentId(), '<=', 'att_rec_' + month + '\uf8ff')
        .get();
    var presentSet = new Set();
    attSnap.forEach(function (doc) {
        var data = doc.data();
        if (!data || !data.records) return;
        Object.keys(data.records).forEach(function (uid) {
            var dayRec = data.records[uid];
            if (!dayRec) return;
            var st = dayRec[dayNum] || dayRec[String(dayNum)];
            if (st === 'P' || st === 'حاضر') presentSet.add(uid);
        });
    });
    stats.attendance.todayPresent = presentSet.size;
    stats.attendance.todayDate = today;
    stats.updatedAt = admin.firestore.FieldValue.serverTimestamp();

    await statsRef(db, tenantId).set(stats, { merge: true });
    await recomputeFinanceSummaries(db, tenantId, feeSnap);
    await recomputeAttendanceSummaryForMonth(db, tenantId, month);
    await examCurSummaries.recomputeAllExamCurriculumSummaries(db, tenantId);
    return stats;
}

function makeRegistrationHandler() {
    return functions.firestore
        .document('All_Madrasas/{tenantId}/Registrations/{docId}')
        .onWrite(async function (change, context) {
            var tenantId = context.params.tenantId;
            var delta = userTypeCountsDelta(change.before, change.after);
            if (!delta.students && !delta.teachers && !delta.staff) return null;
            try {
                await mergeStatsDelta(admin.firestore(), tenantId, function (stats) {
                    stats.counts.students = Math.max(0, num(stats.counts.students) + delta.students);
                    stats.counts.teachers = Math.max(0, num(stats.counts.teachers) + delta.teachers);
                    stats.counts.staff = Math.max(0, num(stats.counts.staff) + delta.staff);
                });
            } catch (err) {
                await logger.logError('onRegistrationStatsWrite', err, { tenantId: tenantId });
            }
            return null;
        });
}

function makeFeeHandler() {
    return functions.firestore
        .document('All_Madrasas/{tenantId}/FeeCollections/{docId}')
        .onWrite(async function (change, context) {
            try {
                await applyFeeDelta(admin.firestore(), context.params.tenantId, change.before, change.after);
            } catch (err) {
                await logger.logError('onFeeCollectionStatsWrite', err, { tenantId: context.params.tenantId });
            }
            return null;
        });
}

function makeLedgerHandler() {
    return functions.firestore
        .document('All_Madrasas/{tenantId}/LedgerEntries/{docId}')
        .onWrite(async function (change, context) {
            try {
                await applyLedgerDelta(admin.firestore(), context.params.tenantId, change.before, change.after);
            } catch (err) {
                await logger.logError('onLedgerStatsWrite', err, { tenantId: context.params.tenantId });
            }
            return null;
        });
}

function makeAttendanceHandler() {
    return functions.firestore
        .document('All_Madrasas/{tenantId}/Attendance/{docId}')
        .onWrite(async function (change, context) {
            var docId = context.params.docId || '';
            if (docId.indexOf('att_rec_') !== 0) return null;
            var monthKey = monthFromAttDocId(docId);
            if (!monthKey) return null;
            var todayMonth = new Date().toISOString().split('T')[0].substring(0, 7);
            try {
                if (monthKey === todayMonth) {
                    await refreshTodayAttendance(admin.firestore(), context.params.tenantId);
                } else {
                    await recomputeAttendanceSummaryForMonth(admin.firestore(), context.params.tenantId, monthKey);
                }
            } catch (err) {
                await logger.logError('onAttendanceStatsWrite', err, { tenantId: context.params.tenantId });
            }
            return null;
        });
}

function makeAnnouncementHandler() {
    return functions.firestore
        .document('All_Madrasas/{tenantId}/Announcements/{docId}')
        .onWrite(async function (change, context) {
            var delta = (change.after.exists ? 1 : 0) - (change.before.exists ? 1 : 0);
            if (!delta) return null;
            try {
                await mergeStatsDelta(admin.firestore(), context.params.tenantId, function (stats) {
                    stats.counts.announcements = Math.max(0, num(stats.counts.announcements) + delta);
                });
            } catch (err) {
                await logger.logError('onAnnouncementStatsWrite', err, { tenantId: context.params.tenantId });
            }
            return null;
        });
}

const refreshTenantDashboardStats = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    var tenantId = String((data && data.tenantId) || context.auth.uid).trim();
    var madrasaSnap = await admin.firestore().collection('All_Madrasas').doc(tenantId).get();
    if (!madrasaSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'ادارہ نہیں ملا۔');
    }
    var ownerUid = madrasaSnap.data().ownerUid || tenantId;
    if (context.auth.uid !== ownerUid && context.auth.uid !== tenantId) {
        var linkSnap = await admin.firestore().collection('All_Madrasas').doc(tenantId)
            .collection('Staff_Links').doc(context.auth.uid).get();
        if (!linkSnap.exists || linkSnap.data().status !== 'active') {
            throw new functions.https.HttpsError('permission-denied', 'اجازت نہیں۔');
        }
    }
    var stats = await recomputeTenantStats(tenantId);
    return { ok: true, stats: stats };
});

const scheduledTenantDashboardStats = functions.pubsub.schedule('every 6 hours').onRun(async function () {
    var db = admin.firestore();
    try {
        var snap = await db.collection('All_Madrasas').select().limit(200).get();
        for (var i = 0; i < snap.docs.length; i++) {
            await recomputeTenantStats(snap.docs[i].id);
        }
    } catch (err) {
        await logger.logError('scheduledTenantDashboardStats', err, {});
    }
    return null;
});

module.exports = {
    recomputeTenantStats,
    refreshTenantDashboardStats,
    scheduledTenantDashboardStats,
    onRegistrationStatsWrite: makeRegistrationHandler(),
    onFeeCollectionStatsWrite: makeFeeHandler(),
    onLedgerStatsWrite: makeLedgerHandler(),
    onAttendanceStatsWrite: makeAttendanceHandler(),
    onAnnouncementStatsWrite: makeAnnouncementHandler(),
    monthFromAttDocId,
    defaultFinanceSummary,
    defaultAttendanceSummary
};
