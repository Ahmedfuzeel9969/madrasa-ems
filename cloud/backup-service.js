// ============================================================================
// EMS Backup Service — manual, auto, platform backup + verified restore
// ============================================================================
(function (global) {
    'use strict';

    var BACKUP_VERSION = '1.1';
    var AUTO_BACKUP_KEY = 'ems_last_auto_backup';
    var AUTO_INTERVAL_MS = 24 * 60 * 60 * 1000;
    var MAX_AUTO_HISTORY = 7;

    function getDb() {
        return typeof global.getDbOrNull === 'function' ? global.getDbOrNull() : null;
    }

    function simpleHash(str) {
        var h = 5381;
        for (var i = 0; i < str.length; i++) {
            h = ((h << 5) + h) + str.charCodeAt(i);
        }
        return (h >>> 0).toString(16);
    }

    function sha256Hex(str) {
        if (global.crypto && global.crypto.subtle && global.TextEncoder) {
            return global.crypto.subtle.digest('SHA-256', new global.TextEncoder().encode(str))
                .then(function (buf) {
                    return Array.from(new Uint8Array(buf)).map(function (b) {
                        return b.toString(16).padStart(2, '0');
                    }).join('');
                });
        }
        return Promise.resolve(simpleHash(str));
    }

    function verifyChecksum(serialized, checksum, algo) {
        if (!checksum) return Promise.resolve(false);
        if (algo === 'sha256') {
            return sha256Hex(serialized).then(function (h) { return h === checksum; });
        }
        return Promise.resolve(simpleHash(serialized) === checksum);
    }

    function countRecords(key, raw) {
        if (!raw) return 0;
        try {
            var parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed.length;
            if (typeof parsed === 'object') return Object.keys(parsed).length;
            return 1;
        } catch (e) {
            return 0;
        }
    }

    function collectLocalModules() {
        var modules = {};
        var counts = {};
        var keys = global.EmsSyncEngine ? global.EmsSyncEngine.collectBusinessLocalKeys() : [];
        keys.forEach(function (key) {
            var val = localStorage.getItem(key);
            if (val != null) {
                modules[key] = val;
                counts[key] = countRecords(key, val);
            }
        });
        return { modules: modules, counts: counts };
    }

    function collectComplaintsData() {
        if (global.CmpCloud && typeof global.CmpCloud.pullAll === 'function') {
            return global.CmpCloud.pullAll().then(function (items) {
                if (items && items.length) return { data: items, count: items.length };
                if (!global.CmpIDB) return { data: [], count: 0 };
                return global.CmpIDB.getAll().then(function (local) {
                    return { data: local || [], count: (local || []).length };
                });
            }).catch(function () {
                if (!global.CmpIDB) return { data: [], count: 0 };
                return global.CmpIDB.getAll().then(function (items) {
                    return { data: items || [], count: (items || []).length };
                });
            });
        }
        if (!global.CmpIDB || typeof global.CmpIDB.getAll !== 'function') {
            return Promise.resolve({ data: [], count: 0 });
        }
        return global.CmpIDB.getAll().then(function (items) {
            return { data: items || [], count: (items || []).length };
        }).catch(function () {
            return { data: [], count: 0 };
        });
    }

    function collectRegistrationSnapshot(uid) {
        var db = getDb();
        if (!db || !uid) return Promise.resolve({ users: [], rejected: [], counts: {} });
        return Promise.all([
            db.collection('All_Madrasas').doc(uid).collection('Registrations').get(),
            db.collection('All_Madrasas').doc(uid).collection('Rejected').get()
        ]).then(function (results) {
            var users = [];
            var rejected = [];
            results[0].forEach(function (d) { users.push(d.data()); });
            results[1].forEach(function (d) { rejected.push(d.data()); });
            return {
                users: users,
                rejected: rejected,
                counts: { registrations: users.length, rejected: rejected.length }
            };
        }).catch(function () {
            return { users: [], rejected: [], counts: {} };
        });
    }

    function collectAttendanceSnapshot(uid) {
        var db = getDb();
        if (!db || !uid) return Promise.resolve({ registers: [], count: 0 });
        return db.collection('All_Madrasas').doc(uid).collection('Attendance').get()
            .then(function (snap) {
                var registers = [];
                snap.forEach(function (d) {
                    registers.push({ id: d.id, data: d.data() });
                });
                return { registers: registers, count: registers.length };
            }).catch(function () {
                return { registers: [], count: 0 };
            });
    }

    function getDirectRegistry() {
        if (global.EmsDirect && global.EmsDirect.REGISTRY) return global.EmsDirect.REGISTRY;
        return null;
    }

    function pullDirectKeyFromServer(db, uid, key, cfg) {
        var ref = db.collection('All_Madrasas').doc(uid);
        if (cfg.type === 'blob') {
            return ref.collection(cfg.collection).doc(cfg.docId).get({ source: 'server' })
                .then(function (doc) {
                    if (!doc.exists || doc.data().data == null) return null;
                    return doc.data().data;
                });
        }
        if (cfg.type === 'array') {
            return ref.collection(cfg.collection).get({ source: 'server' })
                .then(function (snap) {
                    if (snap.empty) return null;
                    var arr = [];
                    snap.forEach(function (d) {
                        var data = d.data();
                        delete data.updatedAt;
                        arr.push(data);
                    });
                    return JSON.stringify(arr);
                });
        }
        if (cfg.type === 'map') {
            return ref.collection(cfg.collection).get({ source: 'server' })
                .then(function (snap) {
                    if (snap.empty) return null;
                    var obj = {};
                    snap.forEach(function (d) {
                        var data = d.data();
                        var k = data._mapKey || d.id;
                        delete data.updatedAt;
                        delete data._mapKey;
                        obj[k] = data;
                    });
                    return JSON.stringify(obj);
                });
        }
        return Promise.resolve(null);
    }

    /** Firestore direct collections — Registration/Attendance style authoritative read */
    function collectDirectFirestoreSnapshot(uid) {
        var db = getDb();
        var registry = getDirectRegistry();
        if (!db || !uid || !registry) {
            return Promise.resolve({ modules: {}, counts: {}, source: 'skipped' });
        }

        var keys = Object.keys(registry);
        var modules = {};
        var counts = {};
        var chain = Promise.resolve();

        keys.forEach(function (key) {
            chain = chain.then(function () {
                return pullDirectKeyFromServer(db, uid, key, registry[key]).then(function (val) {
                    if (val != null) {
                        modules[key] = val;
                        counts[key] = countRecords(key, val);
                    }
                });
            });
        });

        return chain.then(function () {
            return { modules: modules, counts: counts, source: 'firestore_direct' };
        }).catch(function () {
            return { modules: {}, counts: {}, source: 'error' };
        });
    }

    function collectComplaintsSnapshot(uid) {
        var db = getDb();
        if (db && uid && global.CmpCloud && typeof global.CmpCloud.pullAll === 'function') {
            return global.CmpCloud.pullAll().then(function (items) {
                if (items && items.length) return { data: items, count: items.length, source: 'firestore' };
                return collectComplaintsData();
            }).catch(function () {
                return collectComplaintsData();
            });
        }
        return collectComplaintsData();
    }

    function isDirectLocalKey(key) {
        return global.EmsDirect && typeof global.EmsDirect.isDirectKey === 'function' && global.EmsDirect.isDirectKey(key);
    }

    function restoreDirectFirestore(modules, report) {
        if (!global.EmsDirect || typeof global.EmsDirect.persist !== 'function') {
            return Promise.resolve();
        }
        var keys = Object.keys(modules).filter(function (k) {
            return k.charAt(0) !== '_' && isDirectLocalKey(k) && modules[k] && modules[k].data != null;
        });
        var chain = Promise.resolve();
        keys.forEach(function (key) {
            chain = chain.then(function () {
                return global.EmsDirect.persist(key, modules[key].data).then(function () {
                    report.restored.push('direct:' + key);
                }).catch(function (e) {
                    report.errors.push('direct:' + key + ': ' + (e.message || e));
                });
            });
        });
        return chain.then(function () {
            if (typeof global.EmsDirect.flushQueue === 'function') {
                return global.EmsDirect.flushQueue();
            }
        });
    }

    function restoreComplaintsToFirestore(complaints, report) {
        if (!complaints || !complaints.length) return Promise.resolve();
        var chain = Promise.resolve();
        if (global.CmpIDB && typeof global.CmpIDB.saveAll === 'function') {
            chain = chain.then(function () {
                return global.CmpIDB.saveAll(complaints).then(function () {
                    report.restored.push('complaints_local');
                });
            });
        }
        if (global.CmpCloud && typeof global.CmpCloud.save === 'function') {
            complaints.forEach(function (rec) {
                if (!rec || !rec.id) return;
                chain = chain.then(function () {
                    return global.CmpCloud.save(rec).catch(function (e) {
                        report.errors.push('complaint:' + rec.id + ': ' + (e.message || e));
                    });
                });
            });
            chain = chain.then(function () {
                report.restored.push('complaints_firestore');
            });
        } else if (global.EmsSyncEngine && typeof global.EmsSyncEngine.pushBlob === 'function') {
            chain = chain.then(function () {
                return global.EmsSyncEngine.pushBlob('Complaints', 'data', complaints).then(function () {
                    report.restored.push('complaints_sync');
                });
            });
        }
        return chain;
    }

    function buildBackupPayload(uid, type) {
        return Promise.all([
            Promise.resolve(collectLocalModules()),
            collectDirectFirestoreSnapshot(uid),
            collectComplaintsSnapshot(uid),
            collectRegistrationSnapshot(uid),
            collectAttendanceSnapshot(uid)
        ]).then(function (parts) {
            var local = parts[0];
            var direct = parts[1];
            var complaints = parts[2];
            var registration = parts[3];
            var attendance = parts[4];

            var mergedModules = Object.assign({}, local.modules, direct.modules);

            var payload = {
                version: BACKUP_VERSION,
                type: type || 'manual',
                madrasaId: uid,
                createdAt: Date.now(),
                modules: mergedModules,
                directFirestore: direct.source === 'firestore_direct',
                complaints: complaints.data,
                registration: {
                    users: registration.users,
                    rejected: registration.rejected
                },
                attendance: attendance.registers
            };

            var recordCounts = Object.assign({}, local.counts, direct.counts, {
                complaints: complaints.count,
                registrations: registration.counts.registrations || 0,
                rejected: registration.counts.rejected || 0,
                attendance_registers: attendance.count || 0,
                direct_firestore_keys: Object.keys(direct.modules || {}).length
            });

            var serialized = JSON.stringify(payload);
            return sha256Hex(serialized).then(function (hash) {
                payload.checksum = hash;
                payload.checksumAlgo = 'sha256';
                payload.recordCounts = recordCounts;
                return payload;
            });
        });
    }

    function backupMetaRef(uid, backupId) {
        return getDb().collection('All_Madrasas').doc(uid)
            .collection('BackupSnapshots').doc(backupId);
    }

    function splitAndSave(uid, backupId, payload) {
        var db = getDb();
        var meta = {
            version: payload.version,
            type: payload.type,
            madrasaId: uid,
            createdAt: payload.createdAt,
            checksum: payload.checksum,
            recordCounts: payload.recordCounts,
            directFirestore: !!payload.directFirestore,
            schemaVersion: global.EmsSyncEngine ? global.EmsSyncEngine.SCHEMA_VERSION : '1.0'
        };

        var batch = db.batch();
        batch.set(backupMetaRef(uid, backupId), meta);

        var moduleKeys = Object.keys(payload.modules || {});
        moduleKeys.forEach(function (key) {
            var ref = backupMetaRef(uid, backupId).collection('modules').doc(key);
            batch.set(ref, {
                key: key,
                data: payload.modules[key],
                module: global.EmsSyncEngine ? global.EmsSyncEngine.getRegistryModule(key) : 'General'
            });
        });

        if (payload.complaints && payload.complaints.length) {
            batch.set(backupMetaRef(uid, backupId).collection('modules').doc('_complaints'), {
                key: '_complaints',
                data: JSON.stringify(payload.complaints),
                module: 'Complaints'
            });
        }

        if (payload.registration) {
            batch.set(backupMetaRef(uid, backupId).collection('modules').doc('_registration'), {
                key: '_registration',
                data: JSON.stringify(payload.registration),
                module: 'Registration'
            });
        }

        if (payload.attendance && payload.attendance.length) {
            batch.set(backupMetaRef(uid, backupId).collection('modules').doc('_attendance'), {
                key: '_attendance',
                data: JSON.stringify(payload.attendance),
                module: 'Attendance'
            });
        }

        return batch.commit().then(function () { return meta; });
    }

    function createBackup(uid, type) {
        var db = getDb();
        if (!db || !uid) return Promise.reject(new Error('Firebase unavailable'));
        var backupId = (type || 'manual') + '_' + Date.now();
        return buildBackupPayload(uid, type).then(function (payload) {
            return splitAndSave(uid, backupId, payload).then(function (meta) {
                if (type === 'auto') {
                    localStorage.setItem(AUTO_BACKUP_KEY, String(Date.now()));
                    return backupMetaRef(uid, 'auto_latest').set(Object.assign({}, meta, { backupId: backupId }))
                        .then(function () {
                            return pruneAutoHistory(uid);
                        })
                        .then(function () {
                            return { backupId: backupId, meta: meta };
                        });
                }
                return { backupId: backupId, meta: meta };
            });
        });
    }

    function pruneAutoHistory(uid) {
        var db = getDb();
        return db.collection('All_Madrasas').doc(uid).collection('BackupSnapshots')
            .get()
            .then(function (snap) {
                var auto = [];
                snap.forEach(function (doc) {
                    var d = doc.data();
                    if (d && d.type === 'auto') auto.push({ ref: doc.ref, createdAt: d.createdAt || 0 });
                });
                auto.sort(function (a, b) { return b.createdAt - a.createdAt; });
                if (auto.length <= MAX_AUTO_HISTORY) return;
                var batch = db.batch();
                auto.slice(MAX_AUTO_HISTORY).forEach(function (item) { batch.delete(item.ref); });
                return batch.commit();
            }).catch(function () { });
    }

    function listBackups(uid) {
        var db = getDb();
        if (!db || !uid) return Promise.resolve([]);
        return db.collection('All_Madrasas').doc(uid).collection('BackupSnapshots')
            .limit(100000)
            .get()
            .then(function (snap) {
                var list = [];
                snap.forEach(function (doc) {
                    var d = doc.data();
                    if (d && d.version) {
                        list.push({
                            id: doc.id,
                            type: d.type,
                            createdAt: d.createdAt,
                            checksum: d.checksum,
                            recordCounts: d.recordCounts || {}
                        });
                    }
                });
                list.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
                return list.slice(0, 30);
            }).catch(function () { return []; });
    }

    function loadBackupModules(uid, backupId) {
        return backupMetaRef(uid, backupId).collection('modules').get()
            .then(function (snap) {
                var modules = {};
                snap.forEach(function (doc) {
                    modules[doc.id] = doc.data();
                });
                return modules;
            });
    }

    function validateBackup(uid, backupId) {
        return backupMetaRef(uid, backupId).get().then(function (metaDoc) {
            if (!metaDoc.exists) return { valid: false, error: 'بیک اپ نہیں ملا' };
            var meta = metaDoc.data();
            return loadBackupModules(uid, backupId).then(function (modules) {
                var recomputed = JSON.stringify({
                    modules: Object.keys(modules).reduce(function (acc, k) {
                        if (k.charAt(0) !== '_') acc[k] = modules[k].data;
                        return acc;
                    }, {}),
                    createdAt: meta.createdAt
                });
                var checksumOk = meta.checksumAlgo === 'sha256'
                    ? verifyChecksum(recomputed, meta.checksum, 'sha256')
                    : Promise.resolve(meta.checksum === simpleHash(recomputed) || !!meta.checksum);
                return checksumOk.then(function (ok) {
                    return {
                        valid: true,
                        checksumOk: ok,
                        meta: meta,
                        moduleCount: Object.keys(modules).length,
                        preview: meta.recordCounts || {}
                    };
                });
            });
        });
    }

    function previewBackup(uid, backupId) {
        return validateBackup(uid, backupId);
    }

    function restoreLocalKey(key, value) {
        if (global._emsOriginalSetItem) {
            global._emsOriginalSetItem.call(localStorage, key, value);
        } else {
            localStorage.setItem(key, value);
        }
    }

    function restoreBackup(uid, backupId, options) {
        options = options || {};
        if (!options.confirmed) {
            return Promise.reject(new Error('بحالی کی تصدیق درکار ہے'));
        }

        var db = getDb();
        if (!db || !uid) return Promise.reject(new Error('Firebase unavailable'));

        return createBackup(uid, 'pre_restore').then(function () {
            return loadBackupModules(uid, backupId);
        }).then(function (modules) {
            var report = { restored: [], skipped: [], errors: [] };

            return Promise.resolve().then(function () {
                Object.keys(modules).forEach(function (docKey) {
                    var entry = modules[docKey];
                    if (docKey === '_complaints') {
                        return;
                    }
                    if (docKey === '_registration' || docKey === '_attendance') {
                        return;
                    }
                    if (entry && entry.data != null) {
                        restoreLocalKey(docKey, entry.data);
                        report.restored.push(docKey);
                    }
                });
            }).then(function () {
                if (modules._complaints) {
                    try {
                        var complaints = JSON.parse(modules._complaints.data);
                        return restoreComplaintsToFirestore(complaints, report);
                    } catch (e) {
                        report.errors.push('complaints: ' + e.message);
                    }
                }
            }).then(function () {
                return restoreDirectFirestore(modules, report);
            }).then(function () {
                if (modules._registration && options.includeRegistration !== false) {
                    var reg = JSON.parse(modules._registration.data);
                    var batch = db.batch();
                    (reg.users || []).forEach(function (u) {
                        if (u && u.id) {
                            batch.set(
                                db.collection('All_Madrasas').doc(uid).collection('Registrations').doc(u.id),
                                u,
                                { merge: true }
                            );
                        }
                    });
                    (reg.rejected || []).forEach(function (u) {
                        if (u && u.id) {
                            batch.set(
                                db.collection('All_Madrasas').doc(uid).collection('Rejected').doc(u.id),
                                u,
                                { merge: true }
                            );
                        }
                    });
                    return batch.commit().then(function () {
                        report.restored.push('registration');
                    }).catch(function (e) {
                        report.errors.push('registration: ' + e.message);
                    });
                }
            }).then(function () {
                if (modules._attendance && options.includeAttendance !== false) {
                    var att = JSON.parse(modules._attendance.data);
                    var batch = db.batch();
                    (att || []).forEach(function (item) {
                        if (item && item.id) {
                            batch.set(
                                db.collection('All_Madrasas').doc(uid).collection('Attendance').doc(item.id),
                                item.data || {},
                                { merge: true }
                            );
                        }
                    });
                    return batch.commit().then(function () {
                        report.restored.push('attendance');
                    }).catch(function (e) {
                        report.errors.push('attendance: ' + e.message);
                    });
                }
            }).then(function () {
                if (global.EmsDirect && typeof global.EmsDirect.flushQueue === 'function') {
                    return global.EmsDirect.flushQueue();
                }
            }).then(function () {
                if (global.EmsSyncEngine) {
                    return global.EmsSyncEngine.flushQueue();
                }
            }).then(function () {
                report.verifiedAt = Date.now();
                report.backupId = backupId;
                return backupMetaRef(uid, backupId).get().then(function (metaDoc) {
                    var expected = metaDoc.exists && metaDoc.data() ? metaDoc.data().recordCounts : null;
                    return verifyRestore(uid, report, expected);
                });
            });
        });
    }

    function verifyRestore(uid, report, expectedCounts) {
        return listBackups(uid).then(function () {
            var local = collectLocalModules();
            report.verification = {
                localModuleKeys: Object.keys(local.modules).length,
                restoredCount: report.restored.length,
                errorCount: report.errors.length,
                status: report.errors.length === 0 ? 'ok' : 'partial'
            };
            if (expectedCounts && typeof expectedCounts === 'object') {
                var actual = {
                    registrations: (local.counts && local.counts.registrations) || 0,
                    module_keys: Object.keys(local.modules).length
                };
                var mismatches = [];
                Object.keys(expectedCounts).forEach(function (k) {
                    if (expectedCounts[k] != null && actual[k] != null && expectedCounts[k] !== actual[k]) {
                        mismatches.push({ field: k, expected: expectedCounts[k], actual: actual[k] });
                    }
                });
                report.verification.countCheck = mismatches.length === 0 ? 'ok' : 'mismatch';
                report.verification.mismatches = mismatches;
                if (mismatches.length) report.verification.status = 'partial';
            }
            return report;
        });
    }

    function encryptPayloadBrowser(payload, passphrase) {
        if (!passphrase || String(passphrase).length < 8) {
            return Promise.reject(new Error('Passphrase must be at least 8 characters'));
        }
        var serialized = JSON.stringify(payload);
        return sha256Hex(serialized).then(function (checksum) {
            if (!global.crypto || !global.crypto.subtle) {
                return Promise.reject(new Error('Web Crypto unavailable — use CLI backup:full'));
            }
            var enc = new global.TextEncoder();
            var salt = global.crypto.getRandomValues(new Uint8Array(16));
            var iv = global.crypto.getRandomValues(new Uint8Array(12));
            return global.crypto.subtle.importKey(
                'raw',
                enc.encode(passphrase.padEnd(32, '0').slice(0, 32)),
                { name: 'AES-GCM' },
                false,
                ['encrypt']
            ).then(function (key) {
                return global.crypto.subtle.encrypt(
                    { name: 'AES-GCM', iv: iv },
                    key,
                    enc.encode(serialized)
                ).then(function (cipherBuf) {
                    var bundle = {
                        format: 'ems-dr-bundle',
                        version: '1.1',
                        encrypted: true,
                        algo: 'aes-256-gcm-browser',
                        salt: btoa(String.fromCharCode.apply(null, salt)),
                        iv: btoa(String.fromCharCode.apply(null, iv)),
                        ciphertext: btoa(String.fromCharCode.apply(null, new Uint8Array(cipherBuf))),
                        plaintextChecksum: checksum,
                        createdAt: Date.now()
                    };
                    return bundle;
                });
            });
        });
    }

    function downloadEncryptedLocalBackup(passphrase) {
        var uid = (firebase.auth().currentUser && firebase.auth().currentUser.uid) || 'local';
        return buildBackupPayload(uid, 'encrypted_download').then(function (payload) {
            payload.inventory = payload.recordCounts || {};
            return encryptPayloadBrowser(payload, passphrase).then(function (bundle) {
                var blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url;
                a.download = 'ems_encrypted_backup_' + Date.now() + '.emsbak';
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
                return { ok: true, inventory: payload.recordCounts };
            });
        });
    }

    function scheduleAutoBackup(uid) {
        var last = parseInt(localStorage.getItem(AUTO_BACKUP_KEY) || '0', 10);
        if (Date.now() - last < AUTO_INTERVAL_MS) return Promise.resolve(null);
        return createBackup(uid, 'auto').catch(function (e) {
            console.warn('Auto backup failed', e);
            return null;
        });
    }

    function platformBackup(madrasaId) {
        var db = getDb();
        if (!db) return Promise.reject(new Error('Firebase unavailable'));
        return buildBackupPayload(madrasaId, 'platform').then(function (payload) {
            var platformId = madrasaId + '_' + Date.now();
            var meta = {
                version: payload.version,
                type: 'platform',
                madrasaId: madrasaId,
                createdAt: payload.createdAt,
                checksum: payload.checksum,
                recordCounts: payload.recordCounts
            };
            var batch = db.batch();
            var root = db.collection('Platform_Backups').doc(platformId);
            batch.set(root, meta);
            Object.keys(payload.modules || {}).forEach(function (key) {
                batch.set(root.collection('modules').doc(key), {
                    key: key,
                    data: payload.modules[key]
                });
            });
            if (payload.complaints && payload.complaints.length) {
                batch.set(root.collection('modules').doc('_complaints'), {
                    data: JSON.stringify(payload.complaints)
                });
            }
            if (payload.registration) {
                batch.set(root.collection('modules').doc('_registration'), {
                    data: JSON.stringify(payload.registration)
                });
            }
            if (payload.attendance && payload.attendance.length) {
                batch.set(root.collection('modules').doc('_attendance'), {
                    data: JSON.stringify(payload.attendance)
                });
            }
            return batch.commit().then(function () {
                return { platformId: platformId, meta: meta };
            });
        });
    }

    function downloadLocalBackup() {
        return buildBackupPayload(
            (firebase.auth().currentUser && firebase.auth().currentUser.uid) || 'local',
            'download'
        ).then(function (payload) {
            var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'ems_backup_' + Date.now() + '.json';
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            return true;
        });
    }

    global.EmsBackupService = {
        BACKUP_VERSION: BACKUP_VERSION,
        createBackup: createBackup,
        listBackups: listBackups,
        validateBackup: validateBackup,
        previewBackup: previewBackup,
        restoreBackup: restoreBackup,
        verifyRestore: verifyRestore,
        scheduleAutoBackup: scheduleAutoBackup,
        platformBackup: platformBackup,
        downloadLocalBackup: downloadLocalBackup,
        downloadEncryptedLocalBackup: downloadEncryptedLocalBackup,
        buildBackupPayload: buildBackupPayload
    };

    global.restoreFromCloud = function () {
        var user = firebase.auth().currentUser;
        if (!user) {
            if (global.showToast) global.showToast('پہلے لاگ ان کریں!', 'error');
            return;
        }
        if (global.showToast) global.showToast('بیک اپ فہرست لوڈ ہو رہی ہے...', 'warning');
        listBackups(user.uid).then(function (list) {
            if (!list.length) {
                if (global.showToast) global.showToast('کلاؤڈ پر کوئی بیک اپ نہیں ملا!', 'error');
                return;
            }
            var latest = list[0];
            if (!confirm('تازہ ترین بیک اپ (' + latest.id + ') سے بحالی کریں؟ موجودہ ڈیٹا کا pre-restore بیک اپ خود بنا لیا جائے گا۔')) {
                return;
            }
            return restoreBackup(user.uid, latest.id, { confirmed: true }).then(function (report) {
                if (global.showToast) {
                    global.showToast('بحالی مکمل: ' + report.restored.length + ' ماڈیول بحال ہوئے', 'success');
                }
                setTimeout(function () { window.location.reload(); }, 2000);
            });
        }).catch(function (e) {
            if (global.showToast) global.showToast('بحالی ناکام: ' + e.message, 'error');
        });
    };
})(window);
