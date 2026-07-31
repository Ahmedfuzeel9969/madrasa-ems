/**
 * Phase C — server-side tenant suspension enforcement (kill switch)
 */
const functions = require('firebase-functions');

async function assertMadrasaActive(db, tenantId) {
    const id = String(tenantId || '').trim();
    if (!id) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId درکار ہے۔');
    }
    const snap = await db.collection('All_Madrasas').doc(id).get();
    if (!snap.exists) {
        throw new functions.https.HttpsError('not-found', 'ادارہ نہیں ملا۔');
    }
    if ((snap.data().subStatus || 'default') === 'suspended') {
        throw new functions.https.HttpsError('madrassa-suspended', 'یہ مدرسہ معطل کر دیا گیا ہے۔');
    }
    return snap.data();
}

module.exports = {
    assertMadrasaActive
};
