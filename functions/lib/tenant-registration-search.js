/**
 * Enterprise Registration Search (E9-S2)
 * RegistrationSearchIndex sync + callable multi-field search
 * Optional Typesense when TYPESENSE_HOST + TYPESENSE_API_KEY are set
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const logger = require('./logger');

var SEARCH_MIN = 2;
var SEARCH_LIMIT = 50;

function indexRef(db, tenantId, id) {
    return db.collection('All_Madrasas').doc(tenantId).collection('RegistrationSearchIndex').doc(String(id));
}

function regCol(db, tenantId) {
    return db.collection('All_Madrasas').doc(tenantId).collection('Registrations');
}

function getTypesenseConfig() {
    var cfg = {};
    try { cfg = functions.config().search || {}; } catch (e) { /* ignore */ }
    return {
        host: process.env.TYPESENSE_HOST || cfg.typesense_host || '',
        key: process.env.TYPESENSE_API_KEY || cfg.typesense_key || '',
        collection: process.env.TYPESENSE_COLLECTION || cfg.typesense_collection || 'ems_registrations'
    };
}

function buildIndexDoc(data, docId) {
    var id = data.id || docId;
    var name = String(data.name || data.fullName || '').trim();
    var cnic = String(data.cnic || '').trim();
    var phone = String(data.phone || data.contact || '').trim();
    return {
        id: id,
        name: name,
        nameLower: name.toLowerCase(),
        cnic: cnic,
        phone: phone,
        type: data.type || '',
        class: data.class || data.dept || '',
        fname: data.fname || data.fatherName || '',
        searchText: [name, id, cnic, phone, data.class, data.fname, data.fatherName]
            .map(function (x) { return String(x || '').toLowerCase(); }).join(' '),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
}

async function assertTenantAccess(context, tenantId) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
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
}

function mergeRows(parts, lower, limit) {
    var seen = Object.create(null);
    var merged = [];
    parts.forEach(function (arr) {
        (arr || []).forEach(function (r) {
            if (!r || !r.id || seen[r.id]) return;
            seen[r.id] = true;
            merged.push(r);
        });
    });
    if (lower) {
        merged = merged.filter(function (u) {
            var hay = [u.name, u.id, u.cnic, u.phone, u.class, u.fname, u.fatherName]
                .map(function (x) { return String(x || '').toLowerCase(); }).join(' ');
            return hay.indexOf(lower) >= 0;
        });
    }
    return merged.slice(0, limit);
}

function mapDoc(doc) {
    if (!doc || !doc.exists) return null;
    var data = doc.data();
    data.id = data.id || doc.id;
    return data;
}

async function firestoreSearch(db, tenantId, query) {
    var q = String(query || '').trim();
    if (q.length < SEARCH_MIN) return [];
    var col = regCol(db, tenantId);
    var lower = q.toLowerCase();
    var promises = [];

    if (/^(std|tch|stf)-/i.test(q)) {
        promises.push(col.doc(q.toUpperCase()).get().then(function (doc) {
            var row = mapDoc(doc);
            return row ? [row] : [];
        }).catch(function () { return []; }));
    }

    promises.push(
        col.orderBy('name').startAt(q).endAt(q + '\uf8ff').limit(SEARCH_LIMIT).get()
            .then(function (snap) {
                var rows = [];
                snap.forEach(function (doc) { rows.push(mapDoc(doc)); });
                return rows.filter(Boolean);
            }).catch(function () { return []; })
    );

    if (/[0-9-]{5,}/.test(q)) {
        promises.push(
            col.orderBy('cnic').startAt(q).endAt(q + '\uf8ff').limit(SEARCH_LIMIT).get()
                .then(function (snap) {
                    var rows = [];
                    snap.forEach(function (doc) { rows.push(mapDoc(doc)); });
                    return rows.filter(Boolean);
                }).catch(function () { return []; })
        );
        promises.push(
            col.orderBy('phone').startAt(q).endAt(q + '\uf8ff').limit(SEARCH_LIMIT).get()
                .then(function (snap) {
                    var rows = [];
                    snap.forEach(function (doc) { rows.push(mapDoc(doc)); });
                    return rows.filter(Boolean);
                }).catch(function () { return []; })
        );
    }

    var parts = await Promise.all(promises);
    return mergeRows(parts, lower, SEARCH_LIMIT);
}

async function typesenseSearch(tenantId, query) {
    var ts = getTypesenseConfig();
    if (!ts.host || !ts.key) return null;
    var url = ts.host.replace(/\/$/, '') + '/collections/' + encodeURIComponent(ts.collection) +
        '/documents/search?q=' + encodeURIComponent(query) +
        '&query_by=name,id,cnic,phone,fname,class' +
        '&filter_by=tenantId:=' + encodeURIComponent(tenantId) +
        '&per_page=' + SEARCH_LIMIT;
    try {
        var res = await fetch(url, {
            headers: { 'X-TYPESENSE-API-KEY': ts.key }
        });
        if (!res.ok) return null;
        var body = await res.json();
        return (body.hits || []).map(function (hit) { return hit.document; });
    } catch (e) {
        return null;
    }
}

async function typesenseUpsert(tenantId, data, docId) {
    var ts = getTypesenseConfig();
    if (!ts.host || !ts.key) return;
    var payload = Object.assign({}, data, {
        id: data.id || docId,
        tenantId: tenantId
    });
    var url = ts.host.replace(/\/$/, '') + '/collections/' + encodeURIComponent(ts.collection) + '/documents?action=upsert';
    try {
        await fetch(url, {
            method: 'POST',
            headers: {
                'X-TYPESENSE-API-KEY': ts.key,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
    } catch (e) { /* optional backend */ }
}

async function typesenseDelete(tenantId, docId) {
    var ts = getTypesenseConfig();
    if (!ts.host || !ts.key) return;
    var url = ts.host.replace(/\/$/, '') + '/collections/' + encodeURIComponent(ts.collection) +
        '/documents/' + encodeURIComponent(docId);
    try {
        await fetch(url, {
            method: 'DELETE',
            headers: { 'X-TYPESENSE-API-KEY': ts.key }
        });
    } catch (e) { /* ignore */ }
}

async function syncSearchIndex(db, tenantId, before, after) {
    var id = (after && after.exists && after.id) || (before && before.exists && before.id);
    if (!id) return;
    if (!after.exists) {
        await indexRef(db, tenantId, id).delete().catch(function () { return null; });
        await typesenseDelete(tenantId, id);
        return;
    }
    var data = after.data() || {};
    var indexDoc = buildIndexDoc(data, id);
    await indexRef(db, tenantId, id).set(indexDoc, { merge: true });
    await typesenseUpsert(tenantId, indexDoc, id);
}

const searchTenantRegistrations = functions.https.onCall(async function (data, context) {
    var tenantId = String((data && data.tenantId) || (context.auth && context.auth.uid) || '').trim();
    var query = String((data && data.query) || '').trim();
    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId لازمی ہے۔');
    }
    if (query.length < SEARCH_MIN) {
        return { ok: true, results: [], source: 'none' };
    }
    await assertTenantAccess(context, tenantId);
    var db = admin.firestore();
    var started = Date.now();

    var tsRows = await typesenseSearch(tenantId, query);
    if (tsRows && tsRows.length) {
        return { ok: true, results: tsRows, source: 'typesense', ms: Date.now() - started };
    }

    var rows = await firestoreSearch(db, tenantId, query);
    return { ok: true, results: rows, source: 'firestore', ms: Date.now() - started };
});

function makeRegistrationSearchIndexHandler() {
    return functions.firestore
        .document('All_Madrasas/{tenantId}/Registrations/{docId}')
        .onWrite(async function (change, context) {
            try {
                await syncSearchIndex(admin.firestore(), context.params.tenantId, change.before, change.after);
            } catch (err) {
                await logger.logError('onRegistrationSearchIndexWrite', err, {
                    tenantId: context.params.tenantId,
                    docId: context.params.docId
                });
            }
            return null;
        });
}

module.exports = {
    buildIndexDoc,
    firestoreSearch,
    searchTenantRegistrations,
    onRegistrationSearchIndexWrite: makeRegistrationSearchIndexHandler(),
    getTypesenseConfig
};
