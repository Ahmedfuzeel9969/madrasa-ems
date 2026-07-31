// ============================================================================
// Complaints Firestore Service — per-document sync (Phase 4)
// Path: All_Madrasas/{tenantId}/Complaints/{complaintId}
// ============================================================================
(function (global) {
    'use strict';

    var QUEUE_STORE = 'complaints_sync_queue';
    var IDB_NAME = 'EMS_ComplaintsSyncDB';
    var IDB_VER = 1;

    function getDb() {
        return typeof global.getDbOrNull === 'function' ? global.getDbOrNull() : null;
    }

    function getTenantId() {
        if (global.emsGetTenantId) return global.emsGetTenantId();
        if (typeof firebase === 'undefined' || !firebase.auth) return null;
        var u = firebase.auth().currentUser;
        return u ? u.uid : null;
    }

    function complaintsRef(tenantId, id) {
        return getDb().collection('All_Madrasas').doc(tenantId).collection('Complaints').doc(id);
    }

    function openQueueIdb() {
        return new Promise(function (resolve, reject) {
            var req = indexedDB.open(IDB_NAME, IDB_VER);
            req.onupgradeneeded = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(QUEUE_STORE)) {
                    db.createObjectStore(QUEUE_STORE, { keyPath: 'id' });
                }
            };
            req.onsuccess = function (e) { resolve(e.target.result); };
            req.onerror = function () { reject(req.error); };
        });
    }

    function queueOp(op) {
        return openQueueIdb().then(function (idb) {
            return new Promise(function (resolve, reject) {
                var tx = idb.transaction(QUEUE_STORE, 'readwrite');
                tx.objectStore(QUEUE_STORE).put(op);
                tx.oncomplete = resolve;
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    function getQueuedOps() {
        return openQueueIdb().then(function (idb) {
            return new Promise(function (resolve, reject) {
                var tx = idb.transaction(QUEUE_STORE, 'readonly');
                var req = tx.objectStore(QUEUE_STORE).getAll();
                req.onsuccess = function () { resolve(req.result || []); };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    function removeQueuedOp(id) {
        return openQueueIdb().then(function (idb) {
            return new Promise(function (resolve, reject) {
                var tx = idb.transaction(QUEUE_STORE, 'readwrite');
                tx.objectStore(QUEUE_STORE).delete(id);
                tx.oncomplete = resolve;
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    function writeDoc(tenantId, record) {
        var db = getDb();
        if (!db || !tenantId || !record || !record.id) {
            return Promise.reject(new Error('Firestore یا record ID دستیاب نہیں'));
        }
        var payload = Object.assign({}, record, {
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            clientTs: Date.now()
        });
        return complaintsRef(tenantId, record.id).set(payload, { merge: true });
    }

    function deleteDoc(tenantId, id) {
        var db = getDb();
        if (!db || !tenantId || !id) return Promise.reject(new Error('delete: invalid params'));
        return complaintsRef(tenantId, id).delete();
    }

    global.CmpCloud = {
        getPath: function (complaintId) {
            var tid = getTenantId();
            if (!tid) return null;
            return 'All_Madrasas/' + tid + '/Complaints/' + (complaintId || '{id}');
        },

        save: function (record) {
            var tenantId = getTenantId();
            if (!tenantId) return Promise.reject(new Error('tenant ID نہیں'));
            if (!navigator.onLine) {
                return queueOp({ id: record.id, op: 'upsert', record: record, at: Date.now() })
                    .then(function () { return { status: 'offline_queued', id: record.id }; });
            }
            return writeDoc(tenantId, record).then(function () {
                return removeQueuedOp(record.id).catch(function () {});
            }).then(function () {
                return { status: 'synced', id: record.id };
            }).catch(function (err) {
                return queueOp({ id: record.id, op: 'upsert', record: record, at: Date.now() })
                    .then(function () {
                        if (global.emsLogSecurityEvent) {
                            global.emsLogSecurityEvent('complaint_sync_queued', { id: record.id, err: err.message });
                        }
                        return { status: 'queued', id: record.id, error: err.message };
                    });
            });
        },

        remove: function (complaintId) {
            var tenantId = getTenantId();
            if (!tenantId) return Promise.reject(new Error('tenant ID نہیں'));
            if (!navigator.onLine) {
                return queueOp({ id: complaintId, op: 'delete', at: Date.now() })
                    .then(function () { return { status: 'offline_queued' }; });
            }
            return deleteDoc(tenantId, complaintId).then(function () {
                return removeQueuedOp(complaintId).catch(function () {});
            }).then(function () {
                return { status: 'deleted', id: complaintId };
            }).catch(function (err) {
                return queueOp({ id: complaintId, op: 'delete', at: Date.now() })
                    .then(function () { return { status: 'queued', error: err.message }; });
            });
        },

        pullAll: function () {
            if (typeof firebase === 'undefined' || global.EMS_OFFLINE_ONLY === true) {
                return Promise.resolve([]);
            }
            var tenantId = getTenantId();
            var db = getDb();
            if (!db || !tenantId) return Promise.resolve([]);
            return db.collection('All_Madrasas').doc(tenantId).collection('Complaints')
                .get({ source: 'server' })
                .then(function (snap) {
                    var items = [];
                    snap.forEach(function (doc) {
                        var d = doc.data();
                        if (d && d.id) items.push(d);
                    });
                    return items;
                });
        },

        flushQueue: function () {
            var tenantId = getTenantId();
            if (!tenantId || !navigator.onLine) return Promise.resolve({ flushed: 0 });
            return getQueuedOps().then(function (ops) {
                var chain = Promise.resolve();
                var flushed = 0;
                ops.forEach(function (op) {
                    chain = chain.then(function () {
                        if (op.op === 'delete') {
                            return deleteDoc(tenantId, op.id).then(function () {
                                flushed++;
                                return removeQueuedOp(op.id);
                            });
                        }
                        if (op.op === 'upsert' && op.record) {
                            return writeDoc(tenantId, op.record).then(function () {
                                flushed++;
                                return removeQueuedOp(op.id);
                            });
                        }
                        return Promise.resolve();
                    }).catch(function () { return Promise.resolve(); });
                });
                return chain.then(function () { return { flushed: flushed }; });
            });
        },

        /** Legacy blob → per-doc migration */
        migrateFromLegacyBlob: function () {
            var tenantId = getTenantId();
            if (!tenantId || !global.EmsSyncEngine) return Promise.resolve({ migrated: 0 });
            return global.EmsSyncEngine.pullBlob('Complaints', 'data').then(function (blob) {
                if (!blob || !blob.length) return { migrated: 0 };
                var chain = Promise.resolve();
                var count = 0;
                blob.forEach(function (rec) {
                    if (!rec || !rec.id) return;
                    chain = chain.then(function () {
                        return writeDoc(tenantId, rec).then(function () { count++; });
                    });
                });
                return chain.then(function () { return { migrated: count }; });
            }).catch(function () { return { migrated: 0 }; });
        },

        init: function () {
            return global.CmpCloud.migrateFromLegacyBlob()
                .then(function () { return global.CmpCloud.flushQueue(); });
        },
    };

    window.addEventListener('online', function () {
        if (global.CmpCloud) global.CmpCloud.flushQueue();
    });
})(window);
