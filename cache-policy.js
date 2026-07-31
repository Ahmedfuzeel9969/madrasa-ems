// ============================================================================
// EMS Cache Policy — TTL, size limits, automatic cleanup
// ============================================================================
(function (global) {
    'use strict';

    var META_KEY = 'ems_cache_meta';
    var LS_SOFT_LIMIT = 4 * 1024 * 1024;
    var IDB_SOFT_LIMIT = 50 * 1024 * 1024;
    var TTL_LIST_MS = 24 * 60 * 60 * 1000;
    var TTL_CONFIG_MS = 7 * 24 * 60 * 60 * 1000;
    var CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

    var UI_ONLY_KEYS = {
        'ems_sys_theme': true,
        'ems_sys_config_v2': true,
        'ems_sys_profiles': true,
        'ems_sys_settings_audit': true,
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

    var CONFIG_KEYS = {
        'ems_att_settings': true,
        'ems_att_symbols': true,
        'ems_att_periods': true,
        'ems_att_holidays': true,
        'ems_fee_categories': true,
        'ems_exam_types': true,
        'ems_library_books': true,
        'ems_ann_categories': true,
        'ems_ledger_master_categories': true,
        'ems_ledger_blackouts': true,
        'ems_classes': true
    };

    var LEGACY_KEYS = {
        'ems_full_attendance': true,
        'ems_attendance_db': true
    };

    function readMeta() {
        try {
            return JSON.parse(localStorage.getItem(META_KEY)) || {};
        } catch (e) {
            return {};
        }
    }

    function writeMeta(meta) {
        try {
            localStorage.setItem(META_KEY, JSON.stringify(meta));
        } catch (e) {
            console.warn('Cache meta write failed', e);
        }
    }

    function estimateSize(str) {
        return (str || '').length * 2;
    }

    function getLocalStorageUsage() {
        var total = 0;
        for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            total += estimateSize(localStorage.getItem(k));
        }
        return total;
    }

    var TOUCH_WRITE_INTERVAL_MS = 60000;

    function touchKey(key) {
        if (UI_ONLY_KEYS[key]) return;
        var meta = readMeta();
        meta[key] = meta[key] || {};
        var last = meta[key].lastAccess || 0;
        if (Date.now() - last < TOUCH_WRITE_INTERVAL_MS) return;
        meta[key].lastAccess = Date.now();
        meta[key].ttl = CONFIG_KEYS[key] ? TTL_CONFIG_MS : TTL_LIST_MS;
        writeMeta(meta);
    }

    /** Local write pending cloud push */
    function markDirty(key) {
        if (UI_ONLY_KEYS[key] || !key) return;
        var meta = readMeta();
        meta[key] = meta[key] || {};
        meta[key].localUpdatedAt = Date.now();
        meta[key].dirty = true;
        meta[key].lastAccess = Date.now();
        writeMeta(meta);
    }

    /** Successful server sync — clear dirty flag */
    function markSynced(key, remoteUpdatedAtMs) {
        if (UI_ONLY_KEYS[key] || !key) return;
        var meta = readMeta();
        meta[key] = meta[key] || {};
        meta[key].dirty = false;
        if (remoteUpdatedAtMs) {
            meta[key].remoteUpdatedAt = remoteUpdatedAtMs;
        }
        meta[key].lastAccess = Date.now();
        writeMeta(meta);
        if (remoteUpdatedAtMs && global.EmsSyncCursorIdb && typeof global.EmsSyncCursorIdb.markSyncedCursor === 'function') {
            global.EmsSyncCursorIdb.markSyncedCursor(key, remoteUpdatedAtMs);
        } else if (remoteUpdatedAtMs) {
            meta[key].pullCursor = remoteUpdatedAtMs;
            writeMeta(meta);
        }
    }

    function getPullCursor(key) {
        if (!key) return 0;
        if (global.EmsSyncCursorIdb && typeof global.EmsSyncCursorIdb.getPullCursor === 'function') {
            return global.EmsSyncCursorIdb.getPullCursor(key);
        }
        var entry = readMeta()[key];
        return (entry && entry.pullCursor) || 0;
    }

    function setPullCursor(key, ms, opts) {
        if (UI_ONLY_KEYS[key] || !key) return;
        if (global.EmsSyncCursorIdb && typeof global.EmsSyncCursorIdb.setPullCursor === 'function') {
            global.EmsSyncCursorIdb.setPullCursor(key, ms, opts || {});
            return;
        }
        var meta = readMeta();
        meta[key] = meta[key] || {};
        if (opts && opts.force === true) {
            meta[key].pullCursor = ms || 0;
        } else {
            meta[key].pullCursor = Math.max(meta[key].pullCursor || 0, ms || 0);
        }
        writeMeta(meta);
    }

    function remoteDocTimestamp(docData) {
        if (!docData) return 0;
        var u = docData.updatedAt;
        if (u && typeof u.toMillis === 'function') return u.toMillis();
        if (typeof u === 'number') return u;
        return 0;
    }

    /**
     * Decide whether incoming remote data should overwrite local cache.
     * Last-write-wins using server updatedAt vs localUpdatedAt when dirty.
     */
    function resolvePullConflict(key, localStr, remoteStr, remoteUpdatedAtMs) {
        var meta = readMeta();
        var entry = meta[key] || {};
        if (global.EmsUtils && typeof global.EmsUtils.resolvePullConflict === 'function') {
            return global.EmsUtils.resolvePullConflict(entry, localStr, remoteStr, remoteUpdatedAtMs);
        }
        var localEmpty = !localStr || localStr === '[]' || localStr === '{}' || localStr.length < 3;
        if (localEmpty) return { apply: true, reason: 'local_empty' };
        if (localStr === remoteStr) return { apply: false, reason: 'identical', markSync: true };
        var localAt = entry.localUpdatedAt || 0;
        var dirty = !!entry.dirty;
        if (!dirty) return { apply: true, reason: 'remote_wins_clean' };
        if (remoteUpdatedAtMs > localAt) return { apply: true, reason: 'remote_newer', conflict: true };
        return { apply: false, reason: 'local_pending' };
    }

    function isExpired(key, meta) {
        var entry = meta[key];
        if (!entry || !entry.lastAccess) return false;
        var ttl = entry.ttl || TTL_LIST_MS;
        return Date.now() - entry.lastAccess > ttl;
    }

    function cleanupLocalStorage(force) {
        var meta = readMeta();
        var removed = [];
        var usage = getLocalStorageUsage();

        Object.keys(LEGACY_KEYS).forEach(function (key) {
            if (localStorage.getItem(key) !== null) {
                localStorage.removeItem(key);
                delete meta[key];
                removed.push(key);
            }
        });

        // att_rec_* sheets are durable SSOT (IDB mirror) — never bulk-delete here.

        if (force || usage > LS_SOFT_LIMIT) {
            Object.keys(meta).forEach(function (key) {
                if (UI_ONLY_KEYS[key]) return;
                if (isExpired(key, meta)) {
                    if (localStorage.getItem(key) !== null) {
                        localStorage.removeItem(key);
                        removed.push(key);
                    }
                    delete meta[key];
                }
            });
        }

        writeMeta(meta);
        return { removed: removed, usage: getLocalStorageUsage(), limit: LS_SOFT_LIMIT };
    }

    function wrapGetItem(originalGetItem) {
        return function (key) {
            if (key && key.startsWith('ems_') && !UI_ONLY_KEYS[key]) {
                touchKey(key);
            }
            return originalGetItem.apply(this, arguments);
        };
    }

    function scheduleCleanup() {
        setInterval(function () {
            cleanupLocalStorage(false);
        }, CLEANUP_INTERVAL_MS);
    }

    global.EmsCachePolicy = {
        META_KEY: META_KEY,
        LS_SOFT_LIMIT: LS_SOFT_LIMIT,
        IDB_SOFT_LIMIT: IDB_SOFT_LIMIT,
        UI_ONLY_KEYS: UI_ONLY_KEYS,
        CONFIG_KEYS: CONFIG_KEYS,
        LEGACY_KEYS: LEGACY_KEYS,
        touchKey: touchKey,
        markDirty: markDirty,
        markSynced: markSynced,
        getPullCursor: getPullCursor,
        setPullCursor: setPullCursor,
        remoteDocTimestamp: remoteDocTimestamp,
        resolvePullConflict: resolvePullConflict,
        readMeta: readMeta,
        writeMeta: writeMeta,
        getLocalStorageUsage: getLocalStorageUsage,
        cleanupLocalStorage: cleanupLocalStorage,
        wrapGetItem: wrapGetItem,
        init: function () {
            var cursorInit = (global.EmsSyncCursorIdb && typeof global.EmsSyncCursorIdb.init === 'function')
                ? global.EmsSyncCursorIdb.init()
                : Promise.resolve();
            return cursorInit.then(function () {
                if (localStorage.getItem('ems_cache_policy_init')) {
                    scheduleCleanup();
                    return cleanupLocalStorage(false);
                }
                localStorage.setItem('ems_cache_policy_init', String(Date.now()));
                var result = cleanupLocalStorage(true);
                scheduleCleanup();
                return result;
            });
        }
    };
})(window);
