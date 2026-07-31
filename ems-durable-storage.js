// ============================================================================
// EMS Durable Storage — large blobs in IndexedDB only (Scale Foundation P0)
// Moves att_rec_* and ems_full_* / module blobs off localStorage (~5MB cliff).
// ============================================================================
(function (global) {
    'use strict';

    var MIGRATE_FLAG = 'ems_durable_blob_migrated_v1';
    var memoryRaw = Object.create(null);

    var MODULE_BLOB_KEYS = [
        'ems_full_exams', 'ems_exam_types', 'ems_library_books', 'ems_exam_templates', 'ems_exam_locks',
        'ems_curriculum_plans', 'ems_curriculum_daily', 'ems_curriculum_settings', 'ems_curriculum_audit',
        'ems_tar_prayer', 'ems_tar_ethics', 'ems_tar_discipline', 'ems_tar_reform', 'ems_tar_awards',
        'ems_tar_warnings', 'ems_tar_settings', 'ems_tar_audit',
        'ems_fee_categories', 'ems_class_fee_structure', 'ems_student_fee_setup', 'ems_fee_collections', 'ems_fee_bills',
        'ems_full_ledger', 'ems_ledger_master_categories', 'ems_ledger_blackouts', 'ems_payroll_history',
        'ems_full_salary', 'ems_ledger_funds', 'ems_ledger_budgets', 'ems_ledger_audit_log', 'ems_ledger_settings',
        'ems_ledger_liabilities', 'ems_ledger_employee_dues', 'ems_payroll_special', 'ems_ledger_archive',
        'ems_announcements', 'ems_full_announcements', 'ems_ann_categories', 'ems_ann_programs',
        'ems_ann_poster_templates', 'ems_ann_audit_log', 'ems_ann_settings', 'ems_ann_groups',
        'ems_full_complaints', 'ems_rejected_users'
    ];

    var MODULE_BLOB_SET = Object.create(null);
    MODULE_BLOB_KEYS.forEach(function (k) { MODULE_BLOB_SET[k] = true; });

    function readLs(key) {
        try {
            if (global._emsOriginalGetItem) return global._emsOriginalGetItem.call(localStorage, key);
            return localStorage.getItem(key);
        } catch (e) { return null; }
    }

    function removeLs(key) {
        try {
            if (global._emsOriginalRemoveItem) global._emsOriginalRemoveItem.call(localStorage, key);
            else localStorage.removeItem(key);
        } catch (e) { /* ignore */ }
    }

    global.emsIsLargeBlobKey = function (key) {
        if (!key || typeof key !== 'string') return false;
        if (key.indexOf('att_rec_') === 0) return true;
        if (key.indexOf('ems_full_') === 0) return true;
        if (key === 'ems_att_keys_index') return true;
        return !!MODULE_BLOB_SET[key];
    };

    global.emsDurableReadRaw = function (key) {
        if (!key) return null;
        if (Object.prototype.hasOwnProperty.call(memoryRaw, key)) {
            return memoryRaw[key];
        }
        var ls = readLs(key);
        if (ls != null && global.emsIsLargeBlobKey(key)) {
            memoryRaw[key] = ls;
            if (typeof global.emsIdbKvSet === 'function') {
                global.emsIdbKvSet(key, ls);
            }
            removeLs(key);
            return ls;
        }
        return ls;
    };

    global.emsDurableWriteRaw = function (key, str) {
        if (!key) return false;
        str = str == null ? '' : String(str);
        memoryRaw[key] = str;
        if (typeof global.emsCacheInvalidate === 'function') {
            global.emsCacheInvalidate(key);
        }
        if (typeof global.emsIdbKvSet === 'function') {
            global.emsIdbKvSet(key, str);
        }
        if (global.emsIsLargeBlobKey(key)) {
            removeLs(key);
            return true;
        }
        try {
            if (global._emsOriginalSetItem) {
                global._emsSuppressSync = true;
                global._emsOriginalSetItem.call(localStorage, key, str);
                global._emsSuppressSync = false;
            } else {
                localStorage.setItem(key, str);
            }
            if (typeof global.emsStorageQuotaMaybeCheckOnSave === 'function') {
                global.emsStorageQuotaMaybeCheckOnSave();
            }
        } catch (e) {
            if (typeof global.emsStorageQuotaOnWriteFailure === 'function') {
                global.emsStorageQuotaOnWriteFailure('durable_ls:' + key, e);
            }
        }
        return true;
    };

    function hydrateKeyFromIdb(key) {
        if (typeof global.emsIdbKvGet !== 'function') return Promise.resolve(false);
        return global.emsIdbKvGet(key).then(function (val) {
            if (val == null) return false;
            var str = typeof val === 'string' ? val : JSON.stringify(val);
            memoryRaw[key] = str;
            return true;
        });
    }

    global.emsDurableListKeys = function (prefix) {
        var keys = Object.keys(memoryRaw);
        if (prefix) {
            keys = keys.filter(function (k) { return k.indexOf(prefix) === 0; });
        }
        return keys;
    };

    global.emsDurableHydrateFromIdb = function () {
        if (typeof global.emsIdbKvKeys !== 'function') {
            return Promise.resolve({ hydrated: 0 });
        }
        return global.emsIdbKvKeys().then(function (keys) {
            var blobKeys = (keys || []).filter(global.emsIsLargeBlobKey);
            var chain = Promise.resolve();
            var hydrated = 0;
            blobKeys.forEach(function (key) {
                chain = chain.then(function () {
                    return hydrateKeyFromIdb(key).then(function (ok) {
                        if (ok) hydrated++;
                    });
                });
            });
            return chain.then(function () { return { hydrated: hydrated }; });
        });
    };

    global.emsDurableMigrateBoot = function () {
        try {
            if (localStorage.getItem(MIGRATE_FLAG) === '1') {
                return global.emsDurableHydrateFromIdb();
            }
        } catch (e) { /* ignore */ }

        var migrated = 0;
        var keys = [];
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k && global.emsIsLargeBlobKey(k)) keys.push(k);
            }
        } catch (e2) { /* ignore */ }

        var chain = Promise.resolve();
        keys.forEach(function (key) {
            chain = chain.then(function () {
                var str = readLs(key);
                if (str == null) return;
                memoryRaw[key] = str;
                migrated++;
                if (typeof global.emsIdbKvSet === 'function') {
                    return global.emsIdbKvSet(key, str).then(function () {
                        removeLs(key);
                    });
                }
                removeLs(key);
            });
        });

        return chain.then(function () {
            try { localStorage.setItem(MIGRATE_FLAG, '1'); } catch (e3) { /* ignore */ }
            if (migrated > 0) {
                console.info('[EMS] durable storage migrated blob keys off localStorage:', migrated);
            }
            return global.emsDurableHydrateFromIdb().then(function (h) {
                var attKeys = global.emsDurableListKeys('att_rec_');
                if (attKeys.length) {
                    var idxRaw = memoryRaw['ems_att_keys_index'];
                    var idx = [];
                    try {
                        if (idxRaw) idx = JSON.parse(idxRaw);
                        if (!Array.isArray(idx)) idx = [];
                    } catch (eIdx) { idx = []; }
                    var seen = Object.create(null);
                    idx.forEach(function (k) { seen[k] = true; });
                    attKeys.forEach(function (k) {
                        if (!seen[k]) { idx.push(k); seen[k] = true; }
                    });
                    global.emsDurableWriteRaw('ems_att_keys_index', JSON.stringify(idx));
                }
                return { migrated: migrated, hydrated: h.hydrated || 0 };
            });
        });
    };
})(typeof window !== 'undefined' ? window : globalThis);
