// ============================================================================
// EMS Sync Engine — centralized offline queue + Firestore source of truth
// Phase 1 Completion: reliable write, coalesced queue, no silent failures
// ============================================================================
(function (global) {
    'use strict';

    var DB_NAME = 'EMS_SyncDB';
    var DB_VERSION = 1;
    var DEBOUNCE_MS = 3000;
    var MAX_RETRIES = 5;
    var RETRY_INTERVAL_MS = 45000;
    var SCHEMA_VERSION = '1.0';

    function mayAutoSyncPush(options) {
        options = options || {};
        if (options.immediate || options.manual || options.force) return true;
        if (options.mutation === true) {
            if (typeof global.emsMayPushToCloud === 'function') {
                return global.emsMayPushToCloud({ mutation: true });
            }
            return true;
        }
        // Phase C: ambient localStorage blob push disabled.
        return false;
    }

    var MIRROR_KEYS = {
        'ems_full_users': true,
        'ems_rejected_users': true
    };

    var UI_KEYS = global.EmsCachePolicy ? global.EmsCachePolicy.UI_ONLY_KEYS : {
        'ems_sys_theme': true,
        'ems_sys_dict': true,
        'ems_custom_buttons': true,
        'ems_btn_action_toggles': true,
        'ems_custom_fields': true,
        'ems_field_visibility': true,
        'ems_layout_config': true,
        'ems_sys_permissions': true,
        'ems_sys_auto_rules': true,
        'ems_custom_reports': true,
        'ems_custom_dashboard': true,
        'ems_custom_form_templates': true,
        'ems_cache_meta': true
    };

    var SYNC_REGISTRY = {
        'ems_full_exams': 'Exams',
        'ems_exam_types': 'Exams',
        'ems_library_books': 'Exams',
        'ems_exam_templates': 'Exams',
        'ems_curriculum_plans': 'Curriculum',
        'ems_curriculum_daily': 'Curriculum',
        'ems_curriculum_settings': 'Curriculum',
        'ems_curriculum_audit': 'Curriculum',
        'ems_tar_prayer': 'Training',
        'ems_tar_ethics': 'Training',
        'ems_tar_discipline': 'Training',
        'ems_tar_reform': 'Training',
        'ems_tar_awards': 'Training',
        'ems_tar_warnings': 'Training',
        'ems_tar_settings': 'Training',
        'ems_tar_audit': 'Training',
        'ems_fee_categories': 'Finance',
        'ems_student_fee_setup': 'Finance',
        'ems_fee_collections': 'Finance',
        'ems_fee_bills': 'Finance',
        'ems_full_ledger': 'Ledger',
        'ems_ledger_master_categories': 'Ledger',
        'ems_ledger_blackouts': 'Ledger',
        'ems_payroll_history': 'Ledger',
        'ems_full_salary': 'Ledger',
        'ems_ledger_funds': 'Ledger',
        'ems_ledger_budgets': 'Ledger',
        'ems_ledger_audit_log': 'Ledger',
        'ems_ledger_settings': 'Ledger',
        'ems_ledger_liabilities': 'Ledger',
        'ems_ledger_employee_dues': 'Ledger',
        'ems_payroll_special': 'Ledger',
        'ems_ledger_archive': 'Ledger',
        'ems_announcements': 'Announcements',
        'ems_full_announcements': 'Announcements',
        'ems_ann_categories': 'Announcements',
        'ems_ann_programs': 'Announcements',
        'ems_ann_poster_templates': 'Announcements',
        'ems_ann_audit_log': 'Announcements',
        'ems_ann_settings': 'Announcements',
        'ems_ann_groups': 'Announcements',
        'ems_sys_config_v2': 'SystemSettings',
        'ems_sys_profiles': 'SystemSettings',
        'ems_sys_settings_audit': 'SystemSettings',
        'ems_sys_dict': 'SystemSettings',
        'ems_custom_buttons': 'SystemSettings',
        'ems_btn_action_toggles': 'SystemSettings',
        'ems_custom_fields': 'SystemSettings',
        'ems_field_visibility': 'SystemSettings',
        'ems_layout_config': 'SystemSettings',
        'ems_sys_permissions': 'SystemSettings',
        'ems_sys_auto_rules': 'SystemSettings',
        'ems_custom_reports': 'SystemSettings',
        'ems_custom_dashboard': 'SystemSettings',
        'ems_custom_form_templates': 'SystemSettings',
        'ems_staff_permissions': 'Admin',
        'ems_parent_permissions': 'Admin',
        'ems_parent_messages': 'Admin',
        'ems_classes': 'Registration',
        'ems_att_settings': 'Attendance',
        'ems_att_symbols': 'Attendance',
        'ems_att_periods': 'Attendance',
        'ems_att_holidays': 'Attendance',
        'ems_att_audit': 'Attendance',
        'ems_att_recycle': 'Attendance',
        'ems_att_custom_teachers': 'Attendance',
        'ems_att_events_db': 'Attendance'
    };

    var MODULE_KEYS = {
        Exams: ['ems_full_exams', 'ems_exam_types', 'ems_library_books', 'ems_exam_templates', 'ems_exam_locks', 'ems_master_sheet_meta'],
        Curriculum: ['ems_curriculum_plans', 'ems_curriculum_daily', 'ems_curriculum_settings', 'ems_curriculum_audit'],
        Training: ['ems_tar_prayer', 'ems_tar_ethics', 'ems_tar_discipline', 'ems_tar_reform', 'ems_tar_awards', 'ems_tar_warnings', 'ems_tar_settings', 'ems_tar_audit'],
        Finance: ['ems_fee_categories', 'ems_class_fee_structure', 'ems_student_fee_setup', 'ems_fee_collections', 'ems_fee_bills'],
        Ledger: ['ems_full_ledger', 'ems_ledger_master_categories', 'ems_ledger_blackouts', 'ems_payroll_history', 'ems_full_salary', 'ems_ledger_funds', 'ems_ledger_budgets', 'ems_ledger_audit_log', 'ems_ledger_settings', 'ems_ledger_liabilities', 'ems_ledger_employee_dues', 'ems_payroll_special', 'ems_ledger_archive'],
        Announcements: ['ems_announcements', 'ems_full_announcements', 'ems_ann_categories', 'ems_ann_programs', 'ems_ann_poster_templates', 'ems_ann_audit_log', 'ems_ann_settings', 'ems_ann_groups'],
        SystemSettings: ['ems_sys_config_v2', 'ems_sys_profiles', 'ems_sys_settings_audit', 'ems_sys_dict', 'ems_custom_buttons', 'ems_btn_action_toggles', 'ems_custom_fields', 'ems_field_visibility', 'ems_layout_config', 'ems_sys_permissions', 'ems_sys_auto_rules', 'ems_custom_reports', 'ems_custom_dashboard', 'ems_custom_form_templates'],
        Admin: ['ems_staff_permissions', 'ems_parent_permissions', 'ems_parent_messages'],
        Attendance: ['ems_att_settings', 'ems_att_symbols', 'ems_att_periods', 'ems_att_holidays', 'ems_att_audit', 'ems_att_recycle', 'ems_att_custom_teachers', 'ems_att_events_db']
    };

    var state = {
        uid: null,
        idb: null,
        debounceTimers: {},
        flushTimer: null,
        retryTimer: null,
        flushing: false,
        lastPullAt: 0,
        pendingCount: 0,
        failedCount: 0,
        online: typeof navigator !== 'undefined' ? navigator.onLine : true,
        lastError: null
    };

    function getDb() {
        if (typeof global.getDbOrNull === 'function') {
            var db = global.getDbOrNull();
            if (db) return db;
        }
        if (global.EMS_FIRESTORE_DB) return global.EMS_FIRESTORE_DB;
        return null;
    }

    function simpleHash(str) {
        var h = 0;
        for (var i = 0; i < str.length; i++) {
            h = ((h << 5) - h) + str.charCodeAt(i);
            h |= 0;
        }
        return String(h);
    }

    function isActiveSyncKey(key) {
        if (!SYNC_REGISTRY[key]) return false;
        if (global.EmsDirect && global.EmsDirect.isDirectKey(key)) return false;
        return true;
    }

    /* See cloud/sync-engine.js: timetable reads require attendance ownership checks. */
    function isGenericPullKey(key) {
        return isActiveSyncKey(key) && key !== 'ems_att_periods';
    }

    function notifySyncConflict(key, reason) {
        emitSyncEvent('sync_conflict', { key: key, reason: reason });
        if (typeof global.showToast === 'function') {
            global.showToast('⚠️ دوسرے آلے سے تازہ ڈیٹا — ' + key + ' اپڈیٹ ہوا', 'warning');
        }
    }

    function emitSyncEvent(type, detail) {
        detail = detail || {};
        if (typeof global.emsOnSyncEvent === 'function') {
            try { global.emsOnSyncEvent(type, detail); } catch (e) { /* ignore */ }
        }
        if (type === 'sync_failed' && typeof global.showTopAlert === 'function') {
            global.showTopAlert(
                '⚠️ کلاؤڈ سنک ناکام: ' + (detail.key || '') + '<br>' + (detail.message || 'دوبارہ کوشش ہوگی۔'),
                true
            );
        }
        if ((type === 'sync_failed' || type === 'sync_error') && typeof global.emsLogSecurityEvent === 'function') {
            global.emsLogSecurityEvent('sync_failed', detail);
        }
    }

    function openIdb() {
        return new Promise(function (resolve, reject) {
            if (state.idb) return resolve(state.idb);
            var req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains('sync_queue')) {
                    var q = db.createObjectStore('sync_queue', { keyPath: 'id', autoIncrement: true });
                    q.createIndex('status', 'status', { unique: false });
                    q.createIndex('key', 'key', { unique: false });
                }
                if (!db.objectStoreNames.contains('module_cache')) {
                    db.createObjectStore('module_cache', { keyPath: 'key' });
                }
            };
            req.onsuccess = function (e) {
                state.idb = e.target.result;
                resolve(state.idb);
            };
            req.onerror = function () { reject(req.error); };
        });
    }

    /** Replace pending queue entry for same key — prevents write explosion */
    function queueUpsert(key, value) {
        return openIdb().then(function (idb) {
            return new Promise(function (resolve, reject) {
                var tx = idb.transaction('sync_queue', 'readwrite');
                var store = tx.objectStore('sync_queue');
                var idx = store.index('status');
                var cursorReq = idx.openCursor(IDBKeyRange.only('pending'));
                var removed = 0;

                cursorReq.onsuccess = function (ev) {
                    var cursor = ev.target.result;
                    if (cursor) {
                        if (cursor.value.key === key) {
                            cursor.delete();
                            removed++;
                        }
                        cursor.continue();
                    }
                };

                tx.onerror = function () { reject(tx.error); };
                tx.oncomplete = function () {
                    var tx2 = idb.transaction('sync_queue', 'readwrite');
                    tx2.objectStore('sync_queue').add({
                        key: key,
                        value: value,
                        module: SYNC_REGISTRY[key] || 'General',
                        status: 'pending',
                        retries: 0,
                        createdAt: Date.now()
                    });
                    tx2.oncomplete = function () { resolve(removed); };
                    tx2.onerror = function () { reject(tx2.error); };
                };
            });
        });
    }

    function queuePending() {
        return openIdb().then(function (idb) {
            return new Promise(function (resolve, reject) {
                var tx = idb.transaction('sync_queue', 'readonly');
                var req = tx.objectStore('sync_queue').index('status').getAll('pending');
                req.onsuccess = function () { resolve(req.result || []); };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    function queueFailed() {
        return openIdb().then(function (idb) {
            return new Promise(function (resolve, reject) {
                var tx = idb.transaction('sync_queue', 'readonly');
                var req = tx.objectStore('sync_queue').index('status').getAll('failed');
                req.onsuccess = function () { resolve(req.result || []); };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    function queueMarkDone(id) {
        return openIdb().then(function (idb) {
            return new Promise(function (resolve, reject) {
                var tx = idb.transaction('sync_queue', 'readwrite');
                tx.objectStore('sync_queue').delete(id);
                tx.oncomplete = resolve;
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    function queueMarkFailed(item, errMsg) {
        return openIdb().then(function (idb) {
            return new Promise(function (resolve, reject) {
                var tx = idb.transaction('sync_queue', 'readwrite');
                var store = tx.objectStore('sync_queue');
                item.retries = (item.retries || 0) + 1;
                item.lastError = errMsg || state.lastError || 'unknown';
                if (item.retries >= MAX_RETRIES) {
                    item.status = 'failed';
                    emitSyncEvent('sync_failed', { key: item.key, message: item.lastError, retries: item.retries });
                }
                store.put(item);
                tx.oncomplete = resolve;
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    function queueResetFailedToPending() {
        return queueFailed().then(function (items) {
            if (!items.length) return 0;
            return openIdb().then(function (idb) {
                return new Promise(function (resolve, reject) {
                    var tx = idb.transaction('sync_queue', 'readwrite');
                    var store = tx.objectStore('sync_queue');
                    items.forEach(function (item) {
                        item.status = 'pending';
                        item.retries = 0;
                        store.put(item);
                    });
                    tx.oncomplete = function () { resolve(items.length); };
                    tx.onerror = function () { reject(tx.error); };
                });
            });
        });
    }

    function firestoreModuleRef(uid, key) {
        var module = SYNC_REGISTRY[key] || 'General';
        return getDb().collection('All_Madrasas').doc(uid)
            .collection('ModuleData').doc(module + '__' + key);
    }

    function writeToFirestore(uid, key, value) {
        var db = getDb();
        if (!db || !uid) {
            return Promise.reject(new Error('Firebase یا tenant ID دستیاب نہیں'));
        }
        var ref = firestoreModuleRef(uid, key);
        return ref.set({
            key: key,
            module: SYNC_REGISTRY[key] || 'General',
            data: value,
            checksum: simpleHash(value),
            schemaVersion: SCHEMA_VERSION,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true }).then(function () {
            if (global.EmsCachePolicy && typeof global.EmsCachePolicy.markSynced === 'function') {
                global.EmsCachePolicy.markSynced(key, Date.now());
            }
            emitSyncEvent('sync_ok', { key: key, path: 'All_Madrasas/' + uid + '/ModuleData/' + (SYNC_REGISTRY[key] || 'General') + '__' + key });
            return true;
        });
    }

    function coalescePendingItems(items) {
        var latest = {};
        var duplicates = [];
        items.forEach(function (item) {
            if (!latest[item.key] || item.createdAt >= latest[item.key].createdAt) {
                if (latest[item.key]) duplicates.push(latest[item.key]);
                latest[item.key] = item;
            } else {
                duplicates.push(item);
            }
        });
        return { toWrite: Object.values(latest), duplicates: duplicates };
    }

    function scheduleDebouncedFlush(options) {
        if (!mayAutoSyncPush(options)) return;
        if (state.flushTimer) clearTimeout(state.flushTimer);
        state.flushTimer = setTimeout(function () {
            state.flushTimer = null;
            flushQueue();
        }, DEBOUNCE_MS);
    }

    function scheduleRetryLoop() {
        if (typeof global.emsIsOfflineFirstSsot === 'function' && global.emsIsOfflineFirstSsot()) {
            return;
        }
        if (state.retryTimer) return;
        state.retryTimer = setInterval(function () {
            if (!state.uid || !state.online) return;
            if (!mayAutoSyncPush()) return;
            refreshPendingCount().then(function () {
                if (state.pendingCount > 0 || state.failedCount > 0) {
                    queueResetFailedToPending().then(function () {
                        return flushQueue();
                    });
                }
            });
        }, RETRY_INTERVAL_MS);
    }

    function updateSyncBanner() {
        var el = document.getElementById('ems-sync-status-bar');
        if (!el) return;
        if (state.failedCount > 0) {
            el.style.display = 'block';
            el.style.background = '#ef4444';
            el.style.color = '#fff';
            el.innerHTML = '<i class="fas fa-exclamation-triangle"></i> ' + state.failedCount +
                ' سنک ناکام — Admin Panel Tab 6 سے «Force Sync» کریں';
        } else if (!state.online && state.pendingCount > 0) {
            el.style.display = 'block';
            el.style.background = '#f59e0b';
            el.style.color = '#1e293b';
            el.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> آف لائن: ' + state.pendingCount + ' تبدیلیاں منتظر سنک';
        } else if (state.flushing) {
            el.style.display = 'block';
            el.style.background = '#3b82f6';
            el.style.color = '#fff';
            el.innerHTML = '<i class="fas fa-sync fa-spin"></i> کلاؤڈ سنک جاری ہے...';
        } else if (state.pendingCount > 0) {
            el.style.display = 'block';
            el.style.background = '#f59e0b';
            el.style.color = '#1e293b';
            el.innerHTML = '<i class="fas fa-clock"></i> ' + state.pendingCount + ' تبدیلیاں سنک کے منتظر';
        } else {
            el.style.display = 'none';
        }
    }

    function refreshPendingCount() {
        return Promise.all([queuePending(), queueFailed()]).then(function (results) {
            state.pendingCount = results[0].length;
            state.failedCount = results[1].length;
            updateSyncBanner();
            return state.pendingCount;
        });
    }

    function flushQueue() {
        if (state.flushing) return Promise.resolve({ synced: 0, busy: true });
        if (!state.uid) return Promise.resolve({ synced: 0, reason: 'no_uid' });
        var db = getDb();
        if (!db) return Promise.resolve({ synced: 0, reason: 'no_db' });
        if (!state.online) return Promise.resolve({ synced: 0, offline: true });

        state.flushing = true;
        updateSyncBanner();

        return queuePending().then(function (items) {
            var coalesced = coalescePendingItems(items);
            var synced = 0;
            var chain = Promise.resolve();

            coalesced.duplicates.forEach(function (dup) {
                chain = chain.then(function () { return queueMarkDone(dup.id); });
            });

            coalesced.toWrite.forEach(function (item) {
                chain = chain.then(function () {
                    return writeToFirestore(state.uid, item.key, item.value)
                        .then(function () {
                            return queueMarkDone(item.id).then(function () { synced++; });
                        })
                        .catch(function (err) {
                            state.lastError = err && err.message ? err.message : String(err);
                            return queueMarkFailed(item, state.lastError);
                        });
                });
            });

            return chain.then(function () {
                state.flushing = false;
                return refreshPendingCount().then(function () {
                    return { synced: synced, pending: state.pendingCount, failed: state.failedCount };
                });
            });
        }).catch(function (err) {
            state.flushing = false;
            state.lastError = err && err.message ? err.message : String(err);
            updateSyncBanner();
            emitSyncEvent('sync_error', { message: state.lastError });
            return refreshPendingCount().then(function () {
                return { synced: 0, error: state.lastError };
            });
        });
    }

    function cacheLocalWrite(key, value) {
        return openIdb().then(function (idb) {
            return new Promise(function (resolve, reject) {
                var tx = idb.transaction('module_cache', 'readwrite');
                tx.objectStore('module_cache').put({ key: key, value: value, at: Date.now() });
                tx.oncomplete = resolve;
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    function persistKey(key, value, options) {
        options = options || {};
        if (!global.EmsSyncEngine.shouldSyncKey(key)) {
            return Promise.resolve({ status: 'local_only', key: key });
        }
        return cacheLocalWrite(key, value).then(function () {
            if (global.EmsCachePolicy && typeof global.EmsCachePolicy.markDirty === 'function') {
                global.EmsCachePolicy.markDirty(key);
            }
            return queueUpsert(key, value);
        }).then(function () {
            return refreshPendingCount();
        }).then(function () {
            if (!mayAutoSyncPush(options)) {
                return { status: 'queued_manual', key: key, pending: state.pendingCount };
            }
            if (options.immediate && state.uid && state.online) {
                return flushQueue();
            }
            scheduleDebouncedFlush(options);
            if (state.uid && state.online) {
                return { status: 'queued', key: key, pending: state.pendingCount };
            }
            return { status: 'offline_queued', key: key, pending: state.pendingCount };
        });
    }

    function pullModuleKey(uid, key, options) {
        options = options || {};
        if (typeof global.emsMayPullFromCloud === 'function' && !global.emsMayPullFromCloud(options)) {
            return Promise.resolve(false);
        }
        var db = getDb();
        if (!db || !isActiveSyncKey(key)) return Promise.resolve(false);
        return firestoreModuleRef(uid, key).get({ source: 'server' }).then(function (doc) {
            if (!doc.exists) return false;
            var remote = doc.data();
            if (!remote || remote.data == null) return false;
            var remoteStr = typeof remote.data === 'string' ? remote.data : JSON.stringify(remote.data);
            var local = localStorage.getItem(key);
            var remoteAt = global.EmsCachePolicy
                ? global.EmsCachePolicy.remoteDocTimestamp(remote)
                : 0;
            var decision = global.EmsCachePolicy
                ? global.EmsCachePolicy.resolvePullConflict(key, local, remoteStr, remoteAt)
                : { apply: !local || local === '[]' || local === '{}', reason: 'fallback' };

            if (decision.markSync && global.EmsCachePolicy) {
                global.EmsCachePolicy.markSynced(key, remoteAt);
                return false;
            }
            if (!decision.apply) return false;

            if (decision.conflict) notifySyncConflict(key, decision.reason);
            applyLocalFromRemote(key, remoteStr, uid);
            if (global.EmsCachePolicy) global.EmsCachePolicy.markSynced(key, remoteAt);
            return true;
        }).catch(function () { return false; });
    }

    function applyLocalFromRemote(key, remoteStr, tenantId) {
        tenantId = tenantId || state.uid;
        global._emsSuppressSync = true;
        var physical = typeof global.emsResolvePhysicalWriteKey === 'function'
            ? global.emsResolvePhysicalWriteKey(key, tenantId)
            : key;
        if (!physical) {
            global._emsSuppressSync = false;
            return;
        }
        if (typeof global.emsOfflineWriteLocalSync === 'function') {
            var payload = remoteStr;
            try { payload = JSON.parse(remoteStr); } catch (eParse) { /* keep string */ }
            global.emsOfflineWriteLocalSync(key, payload, { tenantId: tenantId });
            global._emsSuppressSync = false;
        } else if (global._emsOriginalSetItem) {
            global._emsOriginalSetItem.call(localStorage, physical, remoteStr);
            global._emsSuppressSync = false;
        } else {
            localStorage.setItem(physical, remoteStr);
            global._emsSuppressSync = false;
        }
        if (global.EmsCachePolicy) global.EmsCachePolicy.touchKey(key);
        emitSyncEvent('pull_ok', { key: key, tenantId: tenantId });
    }

    function pullCoreModules(uid) {
        return pullModuleGroup(uid, 'SystemSettings');
    }

    function pullAllModules(uid, options) {
        options = options || {};
        if (typeof global.emsMayPullFromCloud === 'function' && !global.emsMayPullFromCloud(options)) {
            return Promise.resolve({ pulled: 0, source: 'pull_blocked_offline_first' });
        }
        var db = getDb();
        if (!db || !uid) return Promise.resolve({ pulled: 0 });
        var keys = Object.keys(SYNC_REGISTRY).filter(isGenericPullKey);
        var pulled = 0;
        var chain = Promise.resolve();
        keys.forEach(function (key) {
            chain = chain.then(function () {
                return pullModuleKey(uid, key, options).then(function (changed) {
                    if (changed) pulled++;
                });
            });
        });
        return chain.then(function () {
            state.lastPullAt = Date.now();
            return { pulled: pulled };
        });
    }

    function pullModuleGroup(uid, groupName, options) {
        options = options || {};
        if (typeof global.emsMayPullFromCloud === 'function' && !global.emsMayPullFromCloud(options)) {
            return Promise.resolve({ pulled: 0, source: 'pull_blocked_offline_first' });
        }
        var keys = (MODULE_KEYS[groupName] || []).filter(isGenericPullKey);
        var pulled = 0;
        var chain = Promise.resolve();
        keys.forEach(function (key) {
            chain = chain.then(function () {
                return pullModuleKey(uid, key, options).then(function (c) { if (c) pulled++; });
            });
        });
        return chain.then(function () { return { pulled: pulled }; });
    }

    function hydrateLocalFromModuleCache(filterKeys) {
        var filter = null;
        if (Array.isArray(filterKeys) && filterKeys.length) {
            filter = {};
            filterKeys.forEach(function (k) { filter[k] = true; });
        }
        return openIdb().then(function (idb) {
            if (!idb) return { hydrated: 0 };
            return new Promise(function (resolve) {
                var hydrated = 0;
                var tx = idb.transaction('module_cache', 'readonly');
                var store = tx.objectStore('module_cache');
                var req = store.openCursor();
                req.onsuccess = function (ev) {
                    var cursor = ev.target.result;
                    if (!cursor) return resolve({ hydrated: hydrated });
                    var row = cursor.value;
                    if (row && row.key && row.key !== 'ems_att_periods'
                        && row.value != null && (!filter || filter[row.key])) {
                        var remoteStr = typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
                        applyLocalFromRemote(row.key, remoteStr, state.uid);
                        hydrated++;
                    }
                    cursor.continue();
                };
                req.onerror = function () { resolve({ hydrated: hydrated }); };
            });
        });
    }

    function migrateLegacyBackup(uid) {
        var db = getDb();
        if (!db || !uid) return Promise.resolve();
        return db.collection('All_Madrasas').doc(uid).collection('Backup').limit(100000).get()
            .then(function (snap) {
                if (snap.empty) return;
                var batch = db.batch();
                var count = 0;
                snap.forEach(function (doc) {
                    var key = doc.id;
                    if (!SYNC_REGISTRY[key] || MIRROR_KEYS[key]) return;
                    var data = doc.data();
                    if (!data || data.data == null) return;
                    var module = SYNC_REGISTRY[key];
                    var ref = db.collection('All_Madrasas').doc(uid)
                        .collection('ModuleData').doc(module + '__' + key);
                    batch.set(ref, {
                        key: key,
                        module: module,
                        data: data.data,
                        migratedFrom: 'Backup',
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                    count++;
                });
                if (count > 0) return batch.commit();
            }).catch(function () { });
    }

    global.EmsSyncEngine = {
        SCHEMA_VERSION: SCHEMA_VERSION,
        SYNC_REGISTRY: SYNC_REGISTRY,
        MODULE_KEYS: MODULE_KEYS,
        MIRROR_KEYS: MIRROR_KEYS,

        init: function (uid) {
            if (!uid) return Promise.reject(new Error('tenant ID required'));
            state.uid = uid;
            state.online = navigator.onLine;
            scheduleRetryLoop();
            return openIdb()
                .then(function () { return migrateLegacyBackup(uid); })
                .then(function () {
                    if (state.online && mayAutoSyncPush()) {
                        return flushQueue().then(function () {
                            if (typeof global.emsMayPullFromCloud === 'function' && !global.emsMayPullFromCloud()) {
                                return refreshPendingCount();
                            }
                            return pullCoreModules(uid);
                        });
                    }
                    return refreshPendingCount();
                })
                .then(function () {
                    if (global.EmsBackupService && typeof global.EmsBackupService.scheduleAutoBackup === 'function') {
                        global.EmsBackupService.scheduleAutoBackup(uid);
                    }
                    emitSyncEvent('init_ok', { uid: uid });
                    return refreshPendingCount();
                });
        },

        shutdown: function () {
            state.uid = null;
            Object.keys(state.debounceTimers).forEach(function (k) {
                clearTimeout(state.debounceTimers[k]);
            });
            state.debounceTimers = {};
            if (state.flushTimer) clearTimeout(state.flushTimer);
            state.flushTimer = null;
        },

        shouldSyncKey: function (key) {
            if (!key || !key.startsWith('ems_')) return false;
            if (UI_KEYS[key] || MIRROR_KEYS[key]) return false;
            return isActiveSyncKey(key);
        },

        onLocalWrite: function (key, value) {
            if (!this.shouldSyncKey(key)) return Promise.resolve({ status: 'skipped' });
            if (global.EmsCachePolicy) global.EmsCachePolicy.touchKey(key);
            return Promise.resolve({ status: 'local_only_ambient_blocked', key: key });
        },

        persistAndSync: function (key, value, options) {
            options = options || {};
            if (!options.mutation && !options.manual && !options.force) {
                return Promise.resolve({ status: 'local_only', key: key });
            }
            return persistKey(key, value, options);
        },

        pushBlob: function (module, docId, dataArray) {
            var db = getDb();
            var uid = state.uid;
            if (!db || !uid) return Promise.reject(new Error('Sync engine not ready'));
            var value = JSON.stringify(dataArray);
            var ref = db.collection('All_Madrasas').doc(uid)
                .collection('ModuleData').doc(module + '__' + docId);
            return ref.set({
                key: docId,
                module: module,
                data: value,
                checksum: simpleHash(value),
                schemaVersion: SCHEMA_VERSION,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true }).then(function () { return true; });
        },

        pullBlob: function (module, docId) {
            var db = getDb();
            var uid = state.uid;
            if (!db || !uid) return Promise.resolve(null);
            var ref = db.collection('All_Madrasas').doc(uid)
                .collection('ModuleData').doc(module + '__' + docId);
            return ref.get({ source: 'server' }).then(function (doc) {
                if (!doc.exists) return null;
                var d = doc.data();
                if (!d || d.data == null) return null;
                try {
                    return typeof d.data === 'string' ? JSON.parse(d.data) : d.data;
                } catch (e) {
                    return null;
                }
            });
        },

        flushQueue: flushQueue,
        pullAllModules: pullAllModules,
        pullCoreModules: pullCoreModules,
        pullModuleGroup: pullModuleGroup,
        hydrateLocalFromModuleCache: hydrateLocalFromModuleCache,
        refreshPendingCount: refreshPendingCount,

        getStatus: function () {
            return {
                uid: state.uid,
                online: state.online,
                pending: state.pendingCount,
                failed: state.failedCount,
                flushing: state.flushing,
                lastPullAt: state.lastPullAt,
                lastError: state.lastError,
                schemaVersion: SCHEMA_VERSION
            };
        },

        getFirestorePath: function (key) {
            if (!state.uid || !SYNC_REGISTRY[key]) return null;
            return 'All_Madrasas/' + state.uid + '/ModuleData/' + SYNC_REGISTRY[key] + '__' + key;
        },

        collectBusinessLocalKeys: function () {
            return Object.keys(SYNC_REGISTRY);
        },

        getRegistryModule: function (key) {
            return SYNC_REGISTRY[key] || 'General';
        }
    };

    window.addEventListener('online', function () {
        state.online = true;
        updateSyncBanner();
        if (state.uid && mayAutoSyncPush()) {
            flushQueue();
        }
    });

    window.addEventListener('offline', function () {
        state.online = false;
        updateSyncBanner();
    });
})(window);
