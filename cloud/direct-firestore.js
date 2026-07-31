// ============================================================================
// EMS Direct Firestore — Registration/Attendance style immediate read/write
// Path: All_Madrasas/{tenantId}/{Collection}/{docId}
// ============================================================================
(function (global) {
    'use strict';

    var IDB_NAME = 'EMS_DirectSyncDB';
    var IDB_VER = 1;
    var BATCH_SIZE = 400;

    /**
     * type: array | blob | map
     * array: localStorage JSON array → one Firestore doc per item (idField)
     * blob: single config doc { data: jsonString }
     * map: localStorage JSON object → one doc per key
     */
    var DIRECT_REGISTRY = {
        'ems_full_exams': { type: 'array', collection: 'ExamResults', idField: 'id', group: 'Exams' },
        'ems_exam_types': { type: 'blob', collection: 'Exams_Config', docId: 'exam_types', group: 'Exams' },
        'ems_library_books': { type: 'blob', collection: 'Exams_Config', docId: 'library_books', group: 'Exams' },
        'ems_exam_templates': { type: 'blob', collection: 'Exams_Config', docId: 'exam_templates', group: 'Exams' },
        'ems_exam_locks': { type: 'blob', collection: 'Exams_Config', docId: 'exam_locks', group: 'Exams' },
        'ems_curriculum_plans': { type: 'module_data_blob', module: 'Curriculum', group: 'Curriculum' },
        'ems_curriculum_daily': { type: 'module_data_blob', module: 'Curriculum', group: 'Curriculum' },
        'ems_curriculum_settings': { type: 'module_data_blob', module: 'Curriculum', group: 'Curriculum' },
        'ems_curriculum_audit': { type: 'module_data_blob', module: 'Curriculum', group: 'Curriculum' },
        'ems_tar_prayer': { type: 'array', collection: 'TrainingPrayer', idField: 'id', group: 'Training' },
        'ems_tar_ethics': { type: 'array', collection: 'TrainingEthics', idField: 'id', group: 'Training' },
        'ems_tar_discipline': { type: 'array', collection: 'TrainingDiscipline', idField: 'id', group: 'Training' },
        'ems_tar_reform': { type: 'array', collection: 'TrainingReform', idField: 'id', group: 'Training' },
        'ems_tar_awards': { type: 'array', collection: 'TrainingAwards', idField: 'id', group: 'Training' },
        'ems_tar_warnings': { type: 'array', collection: 'TrainingWarnings', idField: 'id', group: 'Training' },
        'ems_tar_settings': { type: 'blob', collection: 'Training_Config', docId: 'settings', group: 'Training' },
        'ems_tar_audit': { type: 'blob', collection: 'Training_Config', docId: 'audit', group: 'Training' },
        'ems_fee_categories': { type: 'blob', collection: 'Finance_Config', docId: 'fee_categories', group: 'Finance' },
        'ems_class_fee_structure': { type: 'blob', collection: 'Finance_Config', docId: 'class_fee_structure', group: 'Finance' },
        'ems_student_fee_setup': { type: 'map', collection: 'FeeSetups', group: 'Finance' },
        'ems_fee_collections': { type: 'array', collection: 'FeeCollections', idField: 'id', group: 'Finance' },
        'ems_fee_bills': { type: 'array', collection: 'FeeBills', idField: 'id', group: 'Finance' },
        'ems_full_ledger': { type: 'array', collection: 'LedgerEntries', idField: 'id', group: 'Ledger' },
        'ems_ledger_master_categories': { type: 'blob', collection: 'Ledger_Config', docId: 'master_categories', group: 'Ledger' },
        'ems_ledger_blackouts': { type: 'blob', collection: 'Ledger_Config', docId: 'blackouts', group: 'Ledger' },
        'ems_payroll_history': { type: 'blob', collection: 'Ledger_Config', docId: 'payroll_history', group: 'Ledger' },
        'ems_full_salary': { type: 'blob', collection: 'Ledger_Config', docId: 'salary', group: 'Ledger' },
        'ems_ledger_funds': { type: 'blob', collection: 'Ledger_Config', docId: 'funds', group: 'Ledger' },
        'ems_ledger_budgets': { type: 'blob', collection: 'Ledger_Config', docId: 'budgets', group: 'Ledger' },
        'ems_ledger_audit_log': { type: 'blob', collection: 'Ledger_Config', docId: 'audit_log', group: 'Ledger' },
        'ems_ledger_settings': { type: 'blob', collection: 'Ledger_Config', docId: 'settings', group: 'Ledger' },
        'ems_ledger_liabilities': { type: 'blob', collection: 'Ledger_Config', docId: 'liabilities', group: 'Ledger' },
        'ems_ledger_employee_dues': { type: 'blob', collection: 'Ledger_Config', docId: 'employee_dues', group: 'Ledger' },
        'ems_payroll_special': { type: 'blob', collection: 'Ledger_Config', docId: 'payroll_special', group: 'Ledger' },
        'ems_ledger_archive': { type: 'blob', collection: 'Ledger_Config', docId: 'archive', group: 'Ledger' },
        'ems_announcements': { type: 'array', collection: 'Announcements', idField: 'id', group: 'Announcements' },
        'ems_full_announcements': { type: 'array', collection: 'Announcements', idField: 'id', group: 'Announcements' },
        'ems_ann_categories': { type: 'blob', collection: 'Announcements_Config', docId: 'categories', group: 'Announcements' },
        'ems_ann_programs': { type: 'blob', collection: 'Announcements_Config', docId: 'programs', group: 'Announcements' },
        'ems_ann_poster_templates': { type: 'blob', collection: 'Announcements_Config', docId: 'poster_templates', group: 'Announcements' },
        'ems_ann_audit_log': { type: 'blob', collection: 'Announcements_Config', docId: 'audit_log', group: 'Announcements' },
        'ems_ann_settings': { type: 'blob', collection: 'Announcements_Config', docId: 'settings', group: 'Announcements' },
        'ems_ann_groups': { type: 'blob', collection: 'Announcements_Config', docId: 'groups', group: 'Announcements' },
        'ems_sys_config_v2': { type: 'blob', collection: 'SystemSettings_Config', docId: 'config_v2', group: 'SystemSettings' },
        'ems_sys_profiles': { type: 'blob', collection: 'SystemSettings_Config', docId: 'profiles', group: 'SystemSettings' },
        'ems_sys_settings_audit': { type: 'blob', collection: 'SystemSettings_Config', docId: 'settings_audit', group: 'SystemSettings' },
        'ems_sys_dict': { type: 'blob', collection: 'SystemSettings_Config', docId: 'dictionary', group: 'SystemSettings' },
        'ems_custom_buttons': { type: 'blob', collection: 'SystemSettings_Config', docId: 'custom_buttons', group: 'SystemSettings' },
        'ems_btn_action_toggles': { type: 'blob', collection: 'SystemSettings_Config', docId: 'action_toggles', group: 'SystemSettings' },
        'ems_custom_fields': { type: 'blob', collection: 'SystemSettings_Config', docId: 'custom_fields', group: 'SystemSettings' },
        'ems_field_visibility': { type: 'blob', collection: 'SystemSettings_Config', docId: 'field_visibility', group: 'SystemSettings' },
        'ems_layout_config': { type: 'blob', collection: 'SystemSettings_Config', docId: 'layout_config', group: 'SystemSettings' },
        'ems_sys_permissions': { type: 'blob', collection: 'SystemSettings_Config', docId: 'sys_permissions', group: 'SystemSettings' },
        'ems_sys_auto_rules': { type: 'blob', collection: 'SystemSettings_Config', docId: 'auto_rules', group: 'SystemSettings' },
        'ems_custom_reports': { type: 'blob', collection: 'SystemSettings_Config', docId: 'custom_reports', group: 'SystemSettings' },
        'ems_custom_dashboard': { type: 'blob', collection: 'SystemSettings_Config', docId: 'custom_dashboard', group: 'SystemSettings' },
        'ems_custom_form_templates': { type: 'blob', collection: 'SystemSettings_Config', docId: 'form_templates', group: 'SystemSettings' },
        'ems_staff_permissions': { type: 'map', collection: 'StaffPermissions', group: 'Admin' },
        'ems_parent_permissions': { type: 'map', collection: 'ParentPermissions', group: 'Admin' },
        'ems_parent_messages': { type: 'array', collection: 'ParentMessages', idField: 'id', group: 'Admin' },
        'ems_master_dictionary': { type: 'blob', collection: 'Registration_Config', docId: 'master_dictionary', group: 'Registration' },
        'ems_branding': { type: 'blob', collection: 'Registration_Config', docId: 'branding', group: 'Registration' },
        'ems_card_templates': { type: 'blob', collection: 'Registration_Config', docId: 'card_templates', group: 'Registration' },
        'ems_import_history': { type: 'array', collection: 'ImportHistory', idField: 'id', group: 'Registration' }
    };

    var GROUPS = {
        Exams: ['ems_full_exams', 'ems_exam_types', 'ems_library_books', 'ems_exam_templates', 'ems_exam_locks'],
        Curriculum: ['ems_curriculum_plans', 'ems_curriculum_daily', 'ems_curriculum_settings', 'ems_curriculum_audit'],
        Training: ['ems_tar_prayer', 'ems_tar_ethics', 'ems_tar_discipline', 'ems_tar_reform', 'ems_tar_awards', 'ems_tar_warnings', 'ems_tar_settings', 'ems_tar_audit'],
        Finance: ['ems_fee_categories', 'ems_class_fee_structure', 'ems_student_fee_setup', 'ems_fee_collections', 'ems_fee_bills'],
        Ledger: ['ems_full_ledger', 'ems_ledger_master_categories', 'ems_ledger_blackouts', 'ems_payroll_history', 'ems_full_salary', 'ems_ledger_funds', 'ems_ledger_budgets', 'ems_ledger_audit_log', 'ems_ledger_settings', 'ems_ledger_liabilities', 'ems_ledger_employee_dues', 'ems_payroll_special', 'ems_ledger_archive'],
        Announcements: ['ems_announcements', 'ems_full_announcements', 'ems_ann_categories', 'ems_ann_programs', 'ems_ann_poster_templates', 'ems_ann_audit_log', 'ems_ann_settings', 'ems_ann_groups'],
        SystemSettings: ['ems_sys_config_v2', 'ems_sys_profiles', 'ems_sys_settings_audit', 'ems_sys_dict', 'ems_custom_buttons', 'ems_btn_action_toggles', 'ems_custom_fields', 'ems_field_visibility', 'ems_layout_config', 'ems_sys_permissions', 'ems_sys_auto_rules', 'ems_custom_reports', 'ems_custom_dashboard', 'ems_custom_form_templates'],
        Admin: ['ems_staff_permissions', 'ems_parent_permissions', 'ems_parent_messages'],
        Registration: ['ems_master_dictionary', 'ems_branding', 'ems_card_templates', 'ems_import_history']
    };

    function getDb() {
        if (typeof global.getDbOrNull === 'function') return global.getDbOrNull();
        return global.EMS_FIRESTORE_DB || null;
    }

    function getTenantId() {
        if (global.emsGetTenantId) return global.emsGetTenantId();
        if (global.CURRENT_MADRASA_TENANT_ID) return global.CURRENT_MADRASA_TENANT_ID;
        var u = firebase.auth().currentUser;
        return u ? u.uid : null;
    }

    function tenantRef() {
        var db = getDb();
        var tid = getTenantId();
        if (!db || !tid) return null;
        return db.collection('All_Madrasas').doc(tid);
    }

    function applyLocal(key, str) {
        global._emsSuppressSync = true;
        if (typeof global.emsIsLargeBlobKey === 'function' && global.emsIsLargeBlobKey(key)
            && typeof global.emsDurableWriteRaw === 'function') {
            global.emsDurableWriteRaw(key, str);
        } else if (global._emsOriginalSetItem) {
            global._emsOriginalSetItem.call(localStorage, key, str);
        } else {
            localStorage.setItem(key, str);
        }
        global._emsSuppressSync = false;
        if (typeof global.emsCacheInvalidate === 'function') {
            global.emsCacheInvalidate(key);
        }
        if (global.EmsCachePolicy && typeof global.EmsCachePolicy.touchKey === 'function') {
            global.EmsCachePolicy.touchKey(key);
        }
    }

    function openQueueIdb() {
        return new Promise(function (resolve, reject) {
            var req = indexedDB.open(IDB_NAME, IDB_VER);
            req.onupgradeneeded = function (e) {
                var idb = e.target.result;
                if (!idb.objectStoreNames.contains('queue')) {
                    idb.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
                }
            };
            req.onsuccess = function (e) { resolve(e.target.result); };
            req.onerror = function () { reject(req.error); };
        });
    }

    function queueWrite(op) {
        if (typeof global.emsOfflineEnqueueDirectPersist === 'function') {
            return global.emsOfflineEnqueueDirectPersist(op.key, op.value, op.cfg);
        }
        return openQueueIdb().then(function (idb) {
            return new Promise(function (resolve, reject) {
                var tx = idb.transaction('queue', 'readwrite');
                tx.objectStore('queue').add(op);
                tx.oncomplete = resolve;
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    function flushQueue() {
        if (typeof global.emsOfflineFlushAll === 'function') {
            return global.emsOfflineFlushAll({ manual: true }).then(function (res) {
                return { flushed: res.flushed || 0, pending: res.pending, failed: res.queueFailed };
            });
        }
        if (!navigator.onLine) return Promise.resolve({ flushed: 0 });
        var ref = tenantRef();
        if (!ref) return Promise.resolve({ flushed: 0 });
        return openQueueIdb().then(function (idb) {
            return new Promise(function (resolve, reject) {
                var tx = idb.transaction('queue', 'readonly');
                var req = tx.objectStore('queue').getAll();
                req.onsuccess = function () { resolve(req.result || []); };
                req.onerror = function () { reject(req.error); };
            });
        }).then(function (ops) {
            var chain = Promise.resolve();
            var flushed = 0;
            ops.forEach(function (op) {
                chain = chain.then(function () {
                    return executePersistWithMeta(op.key, op.value, op.cfg).then(function () {
                        flushed++;
                        return openQueueIdb().then(function (idb) {
                            return new Promise(function (res, rej) {
                                var tx = idb.transaction('queue', 'readwrite');
                                tx.objectStore('queue').delete(op.id);
                                tx.oncomplete = res;
                                tx.onerror = function () { rej(tx.error); };
                            });
                        });
                    }).catch(function () { return Promise.resolve(); });
                });
            });
            return chain.then(function () { return { flushed: flushed }; });
        });
    }

    function writeBlob(ref, collection, docId, key, jsonStr) {
        return ref.collection(collection).doc(docId).set({
            key: key,
            data: jsonStr,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    }

    function moduleDataDocId(cfg, key) {
        return (cfg.module || 'General') + '__' + key;
    }

    function writeModuleDataBlob(ref, cfg, key, jsonStr) {
        var docId = moduleDataDocId(cfg, key);
        return ref.collection('ModuleData').doc(docId).set({
            key: key,
            module: cfg.module || 'General',
            data: jsonStr,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    }

    function writeArrayItems(ref, collection, items, idField) {
        idField = idField || 'id';
        var chain = Promise.resolve();
        var i = 0;
        while (i < items.length) {
            (function (sliceStart) {
                chain = chain.then(function () {
                    var batch = getDb().batch();
                    var slice = items.slice(sliceStart, sliceStart + BATCH_SIZE);
                    slice.forEach(function (item) {
                        if (!item) return;
                        var id = item[idField];
                        if (!id) return;
                        var docRef = ref.collection(collection).doc(String(id));
                        batch.set(docRef, Object.assign({}, item, {
                            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                        }), { merge: true });
                    });
                    return batch.commit();
                });
            })(i);
            i += BATCH_SIZE;
        }
        return chain;
    }

    function writeMapItems(ref, collection, obj) {
        var keys = Object.keys(obj || {});
        var chain = Promise.resolve();
        var i = 0;
        while (i < keys.length) {
            (function (sliceStart) {
                chain = chain.then(function () {
                    var batch = getDb().batch();
                    keys.slice(sliceStart, sliceStart + BATCH_SIZE).forEach(function (k) {
                        batch.set(ref.collection(collection).doc(String(k)), Object.assign({}, obj[k] || {}, {
                            _mapKey: k,
                            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                        }), { merge: true });
                    });
                    return batch.commit();
                });
            })(i);
            i += BATCH_SIZE;
        }
        return chain;
    }

    function executePersist(key, jsonStr, cfg) {
        var ref = tenantRef();
        if (!ref) return Promise.reject(new Error('Firestore unavailable'));
        cfg = cfg || DIRECT_REGISTRY[key];
        if (!cfg) return Promise.reject(new Error('Unknown key'));

        var parsed;
        try { parsed = JSON.parse(jsonStr); } catch (e) {
            return Promise.reject(new Error('Invalid JSON'));
        }

        if (cfg.type === 'blob') {
            return writeBlob(ref, cfg.collection, cfg.docId, key, jsonStr);
        }
        if (cfg.type === 'module_data_blob') {
            return writeModuleDataBlob(ref, cfg, key, jsonStr);
        }
        if (cfg.type === 'array') {
            if (!Array.isArray(parsed)) parsed = [];
            return writeArrayItems(ref, cfg.collection, parsed, cfg.idField);
        }
        if (cfg.type === 'map') {
            if (typeof parsed !== 'object' || Array.isArray(parsed)) parsed = {};
            return writeMapItems(ref, cfg.collection, parsed);
        }
        return Promise.reject(new Error('Unknown type'));
    }

    function executePersistWithMeta(key, jsonStr, cfg) {
        return executePersist(key, jsonStr, cfg).then(function (result) {
            if (global.EmsCachePolicy && typeof global.EmsCachePolicy.markSynced === 'function') {
                global.EmsCachePolicy.markSynced(key, Date.now());
            }
            return result;
        });
    }

    function applyRemoteDecision(localKey, remoteStr, remoteAt) {
        var local = null;
        if (typeof global.emsCacheGetRaw === 'function') {
            local = global.emsCacheGetRaw(localKey);
        } else {
            local = localStorage.getItem(localKey);
        }
        var decision = global.EmsCachePolicy
            ? global.EmsCachePolicy.resolvePullConflict(localKey, local, remoteStr, remoteAt)
            : { apply: true, reason: 'fallback' };

        if (decision.markSync && global.EmsCachePolicy) {
            global.EmsCachePolicy.markSynced(localKey, remoteAt);
            return false;
        }
        if (!decision.apply) return false;

        if (decision.conflict && typeof global.showToast === 'function') {
            global.showToast('⚠️ دوسرے آلے سے تازہ ڈیٹا — ' + localKey, 'warning');
        }
        applyLocal(localKey, remoteStr);
        if (global.EmsCachePolicy) global.EmsCachePolicy.markSynced(localKey, remoteAt);
        return true;
    }

    function readLocalJson(localKey, fallback) {
        if (typeof global.emsCacheGet === 'function') {
            return global.emsCacheGet(localKey, fallback);
        }
        try {
            var raw = localStorage.getItem(localKey);
            if (raw == null) return fallback;
            return JSON.parse(raw);
        } catch (e) {
            return fallback;
        }
    }

    function mergeArrayById(existing, incoming, idField) {
        idField = idField || 'id';
        var map = Object.create(null);
        (existing || []).forEach(function (item) {
            if (!item) return;
            var id = item[idField];
            if (id != null) map[String(id)] = item;
        });
        (incoming || []).forEach(function (item) {
            if (!item) return;
            var id = item[idField];
            if (id != null) map[String(id)] = item;
        });
        return Object.keys(map).map(function (k) { return map[k]; });
    }

    function mergeMapByKey(existing, incoming) {
        return Object.assign({}, existing || {}, incoming || {});
    }

    function pullSinceMs(localKey, opts) {
        opts = opts || {};
        if (opts.forceFull === true) return 0;
        if (opts.delta === false) return 0;
        return global.EmsCachePolicy ? global.EmsCachePolicy.getPullCursor(localKey) : 0;
    }

    function queryDeltaCollection(ref, collection, sinceMs) {
        if (!sinceMs || sinceMs <= 0) {
            return ref.collection(collection).get({ source: 'server' });
        }
        var overlap = Math.max(0, sinceMs - 60000);
        var q = ref.collection(collection);
        if (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.Timestamp) {
            return q.where('updatedAt', '>', firebase.firestore.Timestamp.fromMillis(overlap))
                .get({ source: 'server' })
                .catch(function () {
                    return q.where('clientUpdatedAt', '>', overlap).get({ source: 'server' });
                });
        }
        return q.where('clientUpdatedAt', '>', overlap).get({ source: 'server' });
    }

    function pullBlob(ref, cfg, localKey, opts) {
        return ref.collection(cfg.collection).doc(cfg.docId).get({ source: 'server' }).then(function (doc) {
            if (!doc.exists || doc.data().data == null) return false;
            var remoteAt = global.EmsCachePolicy
                ? global.EmsCachePolicy.remoteDocTimestamp(doc.data())
                : 0;
            return applyRemoteDecision(localKey, doc.data().data, remoteAt);
        });
    }

    function pullModuleDataBlob(ref, cfg, localKey, opts) {
        var docId = moduleDataDocId(cfg, localKey);
        return ref.collection('ModuleData').doc(docId).get({ source: 'server' }).then(function (doc) {
            if (!doc.exists || doc.data().data == null) return false;
            var remoteAt = global.EmsCachePolicy
                ? global.EmsCachePolicy.remoteDocTimestamp(doc.data())
                : 0;
            var remoteStr = typeof doc.data().data === 'string'
                ? doc.data().data
                : JSON.stringify(doc.data().data);
            return applyRemoteDecision(localKey, remoteStr, remoteAt);
        });
    }

    function pullArray(ref, cfg, localKey, opts) {
        opts = opts || {};
        var sinceMs = pullSinceMs(localKey, opts);
        var idField = cfg.idField || 'id';
        var isFull = !sinceMs || sinceMs <= 0;

        return queryDeltaCollection(ref, cfg.collection, sinceMs).then(function (snap) {
            if (snap.empty && !isFull) return false;
            var incoming = [];
            var maxRemoteAt = sinceMs || 0;
            snap.forEach(function (d) {
                var data = d.data();
                var at = global.EmsCachePolicy
                    ? global.EmsCachePolicy.remoteDocTimestamp(data)
                    : 0;
                if (at > maxRemoteAt) maxRemoteAt = at;
                delete data.updatedAt;
                incoming.push(data);
            });
            if (!incoming.length && isFull) return false;

            var merged;
            if (isFull) {
                merged = incoming;
            } else {
                var existing = readLocalJson(localKey, []);
                if (!Array.isArray(existing)) existing = [];
                merged = mergeArrayById(existing, incoming, idField);
            }
            return applyRemoteDecision(localKey, JSON.stringify(merged), maxRemoteAt || Date.now());
        });
    }

    function pullMap(ref, cfg, localKey, opts) {
        opts = opts || {};
        var sinceMs = pullSinceMs(localKey, opts);
        var isFull = !sinceMs || sinceMs <= 0;

        return queryDeltaCollection(ref, cfg.collection, sinceMs).then(function (snap) {
            if (snap.empty && !isFull) return false;
            var incoming = {};
            var maxRemoteAt = sinceMs || 0;
            snap.forEach(function (d) {
                var data = d.data();
                var at = global.EmsCachePolicy
                    ? global.EmsCachePolicy.remoteDocTimestamp(data)
                    : 0;
                if (at > maxRemoteAt) maxRemoteAt = at;
                var k = data._mapKey || d.id;
                delete data.updatedAt;
                delete data._mapKey;
                incoming[k] = data;
            });
            if (!Object.keys(incoming).length && isFull) return false;

            var merged;
            if (isFull) {
                merged = incoming;
            } else {
                var existing = readLocalJson(localKey, {});
                if (typeof existing !== 'object' || Array.isArray(existing)) existing = {};
                merged = mergeMapByKey(existing, incoming);
            }
            return applyRemoteDecision(localKey, JSON.stringify(merged), maxRemoteAt || Date.now());
        });
    }

    function pullKey(key, opts) {
        var ref = tenantRef();
        var cfg = DIRECT_REGISTRY[key];
        if (!ref || !cfg) return Promise.resolve(false);
        if (cfg.type === 'blob') return pullBlob(ref, cfg, key, opts);
        if (cfg.type === 'module_data_blob') return pullModuleDataBlob(ref, cfg, key, opts);
        if (cfg.type === 'array') return pullArray(ref, cfg, key, opts);
        if (cfg.type === 'map') return pullMap(ref, cfg, key, opts);
        return Promise.resolve(false);
    }

    function migrateModuleDataOnce() {
        var db = getDb();
        var tid = getTenantId();
        if (!db || !tid) return Promise.resolve();
        var flag = 'ems_direct_migrated_' + tid;
        if (localStorage.getItem(flag) === '1') return Promise.resolve();

        return db.collection('All_Madrasas').doc(tid).collection('ModuleData').limit(100000).get()
            .then(function (snap) {
                if (snap.empty) {
                    localStorage.setItem(flag, '1');
                    return;
                }
                var chain = Promise.resolve();
                snap.forEach(function (doc) {
                    var d = doc.data();
                    if (!d || !d.key || !d.data) return;
                    var key = d.key;
                    if (!DIRECT_REGISTRY[key]) return;
                    chain = chain.then(function () {
                        return executePersistWithMeta(key, typeof d.data === 'string' ? d.data : JSON.stringify(d.data), DIRECT_REGISTRY[key]);
                    });
                });
                return chain.then(function () {
                    localStorage.setItem(flag, '1');
                });
            }).catch(function () { });
    }

    global.EmsDirect = {
        REGISTRY: DIRECT_REGISTRY,
        GROUPS: GROUPS,

        isDirectKey: function (key) {
            return !!DIRECT_REGISTRY[key];
        },

        getFirestorePath: function (key) {
            var cfg = DIRECT_REGISTRY[key];
            var tid = getTenantId();
            if (!cfg || !tid) return null;
            if (cfg.type === 'blob') {
                return 'All_Madrasas/' + tid + '/' + cfg.collection + '/' + cfg.docId;
            }
            if (cfg.type === 'module_data_blob') {
                return 'All_Madrasas/' + tid + '/ModuleData/' + moduleDataDocId(cfg, key);
            }
            return 'All_Madrasas/' + tid + '/' + cfg.collection + '/{docId}';
        },

        getKeyConfig: function (key) {
            return DIRECT_REGISTRY[key] || null;
        },

        persist: function (key, value, options) {
            options = options || {};
            var str = (typeof value === 'string') ? value : JSON.stringify(value);
            var cfg = DIRECT_REGISTRY[key];
            if (!cfg) return Promise.resolve({ status: 'skipped', key: key });

            applyLocal(key, str);
            if (global.EmsCachePolicy && typeof global.EmsCachePolicy.markDirty === 'function') {
                global.EmsCachePolicy.markDirty(key);
            }

            if (!navigator.onLine) {
                return queueWrite({ key: key, value: str, cfg: cfg }).then(function () {
                    if (typeof global.showToast === 'function') {
                        global.showToast('محلی محفوظ — آن لائن ہونے پر Firestore میں جائے گا', 'warning');
                    }
                    return { status: 'offline_queued', key: key };
                });
            }

            return executePersistWithMeta(key, str, cfg).then(function () {
                return { status: 'synced', key: key, path: global.EmsDirect.getFirestorePath(key) };
            }).catch(function (err) {
                return queueWrite({ key: key, value: str, cfg: cfg }).then(function () {
                    if (typeof global.showTopAlert === 'function') {
                        global.showTopAlert('⚠️ Firestore محفوظ ناکام — queue میں: ' + key, true);
                    }
                    if (global.emsLogSecurityEvent) {
                        global.emsLogSecurityEvent('direct_sync_queued', { key: key, err: err.message });
                    }
                    return { status: 'queued', key: key, error: err.message };
                });
            });
        },

        pullKey: pullKey,

        pullAll: function (opts) {
            opts = Object.assign({ delta: true, forceFull: false }, opts || {});
            var keys = Object.keys(DIRECT_REGISTRY);
            var chain = Promise.resolve({ pulled: 0, delta: !!opts.delta && !opts.forceFull });
            keys.forEach(function (key) {
                chain = chain.then(function (acc) {
                    return pullKey(key, opts).then(function (ok) {
                        if (ok) acc.pulled++;
                        return acc;
                    });
                });
            });
            return chain;
        },

        pullAllFull: function (opts) {
            opts = Object.assign({ delta: false, forceFull: true }, opts || {});
            if (opts.skipConfirm) {
                return global.EmsDirect.pullAll(opts);
            }
            var confirmFn = global.emsConfirmFullTenantDownload;
            if (typeof confirmFn === 'function') {
                return confirmFn({ source: 'direct_pull_all_full' }).then(function (ok) {
                    if (!ok) return { pulled: 0, cancelled: true, delta: false };
                    return global.EmsDirect.pullAll(opts);
                });
            }
            return global.EmsDirect.pullAll(opts);
        },

        pullGroup: function (groupName, opts) {
            opts = Object.assign({ delta: true, forceFull: false }, opts || {});
            var keys = GROUPS[groupName] || [];
            var chain = Promise.resolve({ pulled: 0 });
            keys.forEach(function (key) {
                chain = chain.then(function (acc) {
                    return pullKey(key, opts).then(function (ok) {
                        if (ok) acc.pulled++;
                        return acc;
                    });
                });
            });
            return chain;
        },

        init: function () {
            return migrateModuleDataOnce()
                .then(function () { return flushQueue(); });
        },

        flushQueue: flushQueue,

        executePersistQueued: function (key, jsonStr, cfg) {
            return executePersistWithMeta(key, jsonStr, cfg);
        }
    };

    window.addEventListener('online', function () {
        if (global.EmsDirect) global.EmsDirect.flushQueue();
    });

})(window);
