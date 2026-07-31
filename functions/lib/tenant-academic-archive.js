/**
 * Tenant Academic Archive (E11-S1)
 * Moves year data to Archive_* collections; active tenant data stays current.
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const logger = require('./logger');

var BATCH = 400;

function tenantRef(db, tenantId) {
    return db.collection('All_Madrasas').doc(tenantId);
}

function archiveMonthsForYear(academicYear) {
    var parts = String(academicYear || '').split('-').map(function (x) { return parseInt(x, 10); });
    if (!parts[0] || isNaN(parts[0])) return [];
    var y1 = parts[0];
    var months = [];
    var m;
    for (m = 4; m <= 12; m++) months.push(y1 + '-' + String(m).padStart(2, '0'));
    for (m = 1; m <= 3; m++) months.push((y1 + 1) + '-' + String(m).padStart(2, '0'));
    return months;
}

function monthFromAttDocId(docId) {
    if (!docId || docId.indexOf('att_rec_') !== 0) return null;
    var parts = docId.split('_');
    return parts.length >= 3 ? parts[2] : null;
}

function recordInYear(dateStr, months) {
    if (!dateStr) return false;
    return months.indexOf(String(dateStr).slice(0, 7)) >= 0;
}

async function assertOwner(db, tenantId, uid) {
    var snap = await tenantRef(db, tenantId).get();
    if (!snap.exists || snap.data().ownerUid !== uid) {
        throw new functions.https.HttpsError('permission-denied', 'صرف مالک آرکائیو کر سکتا ہے۔');
    }
}

async function archiveAttendance(db, tenantId, academicYear, months, stats) {
    var col = tenantRef(db, tenantId).collection('Attendance');
    var archCol = tenantRef(db, tenantId).collection('Archive_Attendance').doc(academicYear).collection('docs');
    var snap = await col.get();
    var ops = [];
    snap.forEach(function (doc) {
        var month = monthFromAttDocId(doc.id);
        if (!month || months.indexOf(month) < 0) return;
        ops.push({ id: doc.id, data: doc.data() });
    });
    var n = 0;
    for (var i = 0; i < ops.length; i += BATCH) {
        var slice = ops.slice(i, i + BATCH);
        var b = db.batch();
        slice.forEach(function (item) {
            b.set(archCol.doc(item.id), Object.assign({}, item.data, {
                _archivedFrom: 'Attendance/' + item.id,
                _archivedAt: admin.firestore.FieldValue.serverTimestamp()
            }));
            b.delete(col.doc(item.id));
        });
        await b.commit();
        n += slice.length;
    }
    stats.attendanceDocs = n;
}

async function archiveModuleArray(db, tenantId, moduleDocId, archiveCollection, academicYear, months, stats, statKey) {
    var ref = tenantRef(db, tenantId).collection('ModuleData').doc(moduleDocId);
    var snap = await ref.get();
    if (!snap.exists) {
        stats[statKey] = 0;
        return;
    }
    var payload = snap.data() || {};
    var raw = payload.data;
    var arr = [];
    try {
        arr = typeof raw === 'string' ? JSON.parse(raw) : (Array.isArray(raw) ? raw : []);
    } catch (e) {
        arr = [];
    }
    if (!Array.isArray(arr)) {
        stats[statKey] = 0;
        return;
    }
    var keep = [];
    var arch = [];
    arr.forEach(function (r) {
        if (recordInYear(r && r.date, months)) arch.push(r);
        else keep.push(r);
    });
    if (!arch.length) {
        stats[statKey] = 0;
        return;
    }
    var parts = moduleDocId.split('__');
    var mod = parts[0] || 'General';
    var key = parts[1] || moduleDocId;
    var archRef = tenantRef(db, tenantId).collection(archiveCollection).doc(academicYear);
    await archRef.set({
        academicYear: academicYear,
        module: mod,
        key: key,
        recordCount: arch.length,
        data: JSON.stringify(arch),
        archivedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    await ref.set({
        key: key,
        module: mod,
        data: JSON.stringify(keep),
        archivedYear: academicYear,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    stats[statKey] = arch.length;
}

const archiveTenantAcademicYear = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    var tenantId = String((data && data.tenantId) || '').trim();
    var academicYear = String((data && data.academicYear) || '').trim();
    if (!tenantId || !academicYear) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId اور academicYear لازمی ہیں۔');
    }
    var months = archiveMonthsForYear(academicYear);
    if (!months.length) {
        throw new functions.https.HttpsError('invalid-argument', 'غلط تعلیمی سال فارمیٹ (مثلاً 2024-2025)۔');
    }
    var db = admin.firestore();
    await assertOwner(db, tenantId, context.auth.uid);

    var stats = {
        academicYear: academicYear,
        months: months,
        attendanceDocs: 0,
        feeRecords: 0,
        ledgerRecords: 0,
        examRecords: 0
    };

    await archiveAttendance(db, tenantId, academicYear, months, stats);
    await archiveModuleArray(db, tenantId, 'Finance__ems_fee_collections', 'Archive_Finance', academicYear, months, stats, 'feeRecords');
    await archiveModuleArray(db, tenantId, 'Ledger__ems_full_ledger', 'Archive_Ledger', academicYear, months, stats, 'ledgerRecords');
    await archiveModuleArray(db, tenantId, 'Exams__ems_full_exams', 'Archive_Exams', academicYear, months, stats, 'examRecords');

    await tenantRef(db, tenantId).collection('Archive_Meta').doc(academicYear).set({
        academicYear: academicYear,
        archivedAt: admin.firestore.FieldValue.serverTimestamp(),
        archivedBy: context.auth.uid,
        stats: stats
    }, { merge: true });

    await tenantRef(db, tenantId).collection('TenantSettings').doc('academicArchive').set({
        lastArchivedYear: academicYear,
        lastArchivedAt: admin.firestore.FieldValue.serverTimestamp(),
        activeAcademicYear: academicYear
    }, { merge: true });

    return { ok: true, stats: stats };
});

module.exports = {
    archiveTenantAcademicYear,
    archiveMonthsForYear,
    monthFromAttDocId
};
