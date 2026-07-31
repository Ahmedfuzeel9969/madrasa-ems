/**
 * Temporary grant lifecycle — purge expired entries (Phase 4)
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const logger = require('./logger');

function tempEntryExpiryMs(entry) {
    if (!entry) return 0;
    if (entry.expiryAt && typeof entry.expiryAt === 'number') return entry.expiryAt;
    if (entry.expiry) {
        var t = new Date(entry.expiry).getTime();
        return isNaN(t) ? 0 : t;
    }
    return 0;
}

/** Pure helper — returns cleaned temporary map + whether anything was removed */
function purgeExpiredTemporary(temporary, nowMs) {
    nowMs = nowMs || Date.now();
    if (!temporary || typeof temporary !== 'object') {
        return { temporary: temporary || {}, removed: [] };
    }
    var next = Object.assign({}, temporary);
    var removed = [];
    Object.keys(next).forEach(function (key) {
        var exp = tempEntryExpiryMs(next[key]);
        if (exp && exp <= nowMs) {
            removed.push(key);
            delete next[key];
        }
    });
    return { temporary: next, removed: removed };
}

function purgeDataTemporaryFields(data, nowMs) {
    if (!data || !data.temporary) return { changed: false, data: data };
    var result = purgeExpiredTemporary(data.temporary, nowMs);
    if (!result.removed.length) return { changed: false, data: data };
    return {
        changed: true,
        data: Object.assign({}, data, { temporary: result.temporary }),
        removed: result.removed
    };
}

async function purgeTenantTempGrants(db, madrasaId, nowMs) {
    var stats = { staff: 0, parent: 0, removed: 0 };
    var staffSnap = await db.collection('All_Madrasas').doc(madrasaId).collection('StaffPermissions').get();
    for (var i = 0; i < staffSnap.docs.length; i++) {
        var sdoc = staffSnap.docs[i];
        var sresult = purgeDataTemporaryFields(sdoc.data(), nowMs);
        if (sresult.changed) {
            await sdoc.ref.set({ temporary: sresult.data.temporary }, { merge: true });
            stats.staff++;
            stats.removed += sresult.removed.length;
        }
    }
    var parentSnap = await db.collection('All_Madrasas').doc(madrasaId).collection('ParentPermissions').get();
    for (var j = 0; j < parentSnap.docs.length; j++) {
        var pdoc = parentSnap.docs[j];
        var presult = purgeDataTemporaryFields(pdoc.data(), nowMs);
        if (presult.changed) {
            await pdoc.ref.set({ temporary: presult.data.temporary }, { merge: true });
            stats.parent++;
            stats.removed += presult.removed.length;
        }
    }
    return stats;
}

async function purgeAllTenantsTempGrants(nowMs) {
    var db = admin.firestore();
    var totals = { tenants: 0, staff: 0, parent: 0, removed: 0 };
    var madrasaSnap = await db.collection('All_Madrasas').get();
    for (var i = 0; i < madrasaSnap.docs.length; i++) {
        var mid = madrasaSnap.docs[i].id;
        var stats = await purgeTenantTempGrants(db, mid, nowMs);
        if (stats.staff || stats.parent) totals.tenants++;
        totals.staff += stats.staff;
        totals.parent += stats.parent;
        totals.removed += stats.removed;
    }
    return totals;
}

/** Scheduled daily purge across all tenants */
const purgeExpiredTempGrantsScheduled = functions.pubsub.schedule('every 24 hours').onRun(async function () {
    try {
        var totals = await purgeAllTenantsTempGrants(Date.now());
        if (totals.removed > 0) {
            await logger.audit({
                action: 'tempGrants.purgeScheduled',
                actorUid: 'system',
                actorEmail: 'system',
                meta: totals
            });
        }
    } catch (err) {
        await logger.logError('purgeExpiredTempGrantsScheduled', err, {});
    }
    return null;
});

function makePermissionsWriteHandler(collectionName) {
    return functions.firestore
        .document('All_Madrasas/{madrasaId}/' + collectionName + '/{docId}')
        .onWrite(async function (change) {
            if (!change.after.exists) return null;
            var data = change.after.data();
            var result = purgeDataTemporaryFields(data, Date.now());
            if (!result.changed) return null;
            await change.after.ref.set({ temporary: result.data.temporary }, { merge: true });
            return null;
        });
}

const onStaffPermissionsWrite = makePermissionsWriteHandler('StaffPermissions');
const onParentPermissionsWrite = makePermissionsWriteHandler('ParentPermissions');

module.exports = {
    tempEntryExpiryMs,
    purgeExpiredTemporary,
    purgeDataTemporaryFields,
    purgeTenantTempGrants,
    purgeAllTenantsTempGrants,
    purgeExpiredTempGrantsScheduled,
    onStaffPermissionsWrite,
    onParentPermissionsWrite
};
