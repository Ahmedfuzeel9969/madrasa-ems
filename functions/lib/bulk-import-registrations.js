/**
 * Bulk registration import via Cloud Function (Import Phase 2)
 * Server-side chunked writes — same document shape as client commit().
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');

const MAX_BATCH = 500;
const MAX_RECORDS = 2000;

async function assertOwner(db, tenantId, uid) {
    const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    if (!madrasaSnap.exists || madrasaSnap.data().ownerUid !== uid) {
        throw new functions.https.HttpsError('permission-denied', 'صرف مالک bulk import کر سکتا ہے۔');
    }
}

function cleanRecord(r) {
    const out = {};
    Object.keys(r || {}).forEach(function (k) {
        if (k.charAt(0) !== '_' && r[k] != null) out[k] = r[k];
    });
    return out;
}

const bulkImportRegistrations = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    const records = Array.isArray(data && data.records) ? data.records : [];
    const conflict = String((data && data.conflict) || 'skip').trim();
    const type = String((data && data.type) || 'student').trim();
    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId درکار ہے۔');
    }
    if (!records.length) {
        throw new functions.https.HttpsError('invalid-argument', 'records خالی ہیں۔');
    }
    if (records.length > MAX_RECORDS) {
        throw new functions.https.HttpsError('invalid-argument', 'زیادہ سے زیادہ ' + MAX_RECORDS + ' ریکارڈ');
    }
    const db = admin.firestore();
    await assertOwner(db, tenantId, context.auth.uid);
    const ref = db.collection('All_Madrasas').doc(tenantId).collection('Registrations');
    const report = { added: 0, updated: 0, skipped: 0, errors: 0, total: records.length };
    const toWrite = [];

    for (let i = 0; i < records.length; i++) {
        const r = records[i];
        if (!r || !r.name) { report.skipped++; continue; }
        const id = String(r.id || ('BULK-' + type.toUpperCase().slice(0, 3) + '-' + i));
        const existing = await ref.doc(id).get();
        if (existing.exists && conflict === 'skip') { report.skipped++; continue; }
        const payload = cleanRecord(Object.assign({}, r, { type: type, id: id }));
        toWrite.push({ id: id, payload: payload, merge: conflict === 'update' || existing.exists });
        if (existing.exists) report.updated++; else report.added++;
    }

    for (let i = 0; i < toWrite.length; i += MAX_BATCH) {
        const slice = toWrite.slice(i, i + MAX_BATCH);
        const batch = db.batch();
        slice.forEach(function (item) {
            batch.set(ref.doc(item.id), item.payload, { merge: item.merge });
        });
        try {
            await batch.commit();
        } catch (e) {
            report.errors += slice.length;
            report.added = Math.max(0, report.added - slice.length);
        }
    }

    return { ok: true, report: report, importedAt: Date.now() };
});

module.exports = {
    bulkImportRegistrations,
    MAX_RECORDS
};
