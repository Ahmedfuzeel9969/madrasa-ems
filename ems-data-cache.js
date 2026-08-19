// ============================================================================
// EMS Data Cache — versioned in-memory parse cache (Phase 2 Sprint 1)
// regent35: emsCacheSet stays synchronous; IDB writes run in background
// ============================================================================
(function (global) {
    'use strict';

    var store = Object.create(null);

    function readRaw(key) {
        if (typeof global.emsIsLargeBlobKey === 'function' && global.emsIsLargeBlobKey(key)) {
            if (typeof global.emsDurableReadRaw === 'function') {
                return global.emsDurableReadRaw(key);
            }
        }
        if (typeof global.emsSafeLocalGet === 'function') {
            return global.emsSafeLocalGet(key);
        }
        if (global._emsOriginalGetItem) {
            return global._emsOriginalGetItem(key);
        }
        return localStorage.getItem(key);
    }

    function writeRaw(key, str, options) {
        options = options || {};
        if (typeof global.emsIsLargeBlobKey === 'function' && global.emsIsLargeBlobKey(key)) {
            if (typeof global.emsDurableWriteRaw === 'function') {
                global.emsDurableWriteRaw(key, str);
                return;
            }
        }
        if (options.noSync && global._emsOriginalSetItem) {
            global._emsSuppressSync = true;
            global._emsOriginalSetItem.call(localStorage, key, str);
            global._emsSuppressSync = false;
        } else {
            try { localStorage.setItem(key, str); } catch (e) { /* quota */ }
        }
        if (typeof global.emsIdbKvSet === 'function' && key && (key.indexOf('ems_') === 0 || key.indexOf('att_rec_') === 0)) {
            global.emsIdbKvSet(key, str);
            if (key.indexOf('att_rec_') === 0 && typeof global.emsAttOfflineKeyIndexInvalidate === 'function') {
                global.emsAttOfflineKeyIndexInvalidate();
            }
        }
    }

    /** Content fingerprint — detects localStorage changes without full hash. */
    function fingerprint(raw) {
        if (raw === null || raw === undefined) return 'null';
        var len = raw.length;
        if (len === 0) return '0';
        return len + ':' + raw.charCodeAt(0) + ':' + raw.charCodeAt(len - 1) + ':' + raw.charCodeAt(Math.floor(len / 2));
    }

    function parseValue(raw, fallback, key) {
        if (raw === null || raw === undefined) {
            return fallback !== undefined ? fallback : null;
        }
        if (typeof raw !== 'string') return raw;
        try {
            return JSON.parse(raw);
        } catch (e) {
            if (key && typeof global.emsDataCorruptionReport === 'function') {
                var report = global.emsDataCorruptionReport(key, e, raw, fallback);
                if (report.corrupt && report.sentinel) {
                    if (typeof global.emsDataCorruptionScheduleRecover === 'function') {
                        global.emsDataCorruptionScheduleRecover(key);
                    }
                    return report.sentinel;
                }
            }
            return fallback !== undefined ? fallback : null;
        }
    }

    function resolveKey(key) {
        if (typeof global.emsResolveCacheKey === 'function') {
            return global.emsResolveCacheKey(key);
        }
        return key;
    }

    function writeLocalStorage(key, str, options) {
        writeRaw(key, str, options);
    }

    global.emsCacheGet = function (key, fallback) {
        key = resolveKey(key);
        // Tenant business data must never fall back to an unscoped legacy key.
        if (!key) return fallback !== undefined ? fallback : null;
        var raw = readRaw(key);
        var hit = store[key];
        if (hit && hit.value !== undefined && hit.value !== null) {
            return hit.value;
        }
        var fp = fingerprint(raw);
        if (hit && hit.fp === fp) return hit.value;
        var value = parseValue(raw, fallback, key);
        if (global.emsIsCorruptData && global.emsIsCorruptData(value)) {
            store[key] = { fp: fp, value: value, corrupt: true };
            return value;
        }
        if ((value === null || value === undefined) && fallback !== undefined) {
            value = fallback;
        }
        store[key] = { fp: fp, value: value };
        return value;
    };

    global.emsCacheGetRaw = function (key) {
        key = resolveKey(key);
        if (!key) return null;
        var raw = readRaw(key);
        var fp = fingerprint(raw);
        var hit = store[key];
        if (hit && hit.fp === fp) return raw;
        var value = parseValue(raw, null, key);
        store[key] = { fp: fp, value: value };
        return raw;
    };

    global.emsCacheInvalidate = function (key) {
        if (key) delete store[key];
        else store = Object.create(null);
    };

    global.emsCacheSet = function (key, value, options) {
        options = options || {};
        key = resolveKey(key);
        if (!key) return null;
        var str = typeof value === 'string' ? value : JSON.stringify(value);
        var parsed = typeof value === 'string' ? parseValue(str, null, key) : value;

        store[key] = { fp: fingerprint(str), value: parsed };

        writeRaw(key, str, options);
        return parsed;
    };

    /**
     * Restore durable IndexedDB kv → localStorage for any ems_* key missing
     * locally (e.g. after localStorage-only eviction). Call at boot BEFORE the
     * repository hydrates from localStorage. Does not overwrite existing local
     * values (session localStorage stays source of truth while present).
     */
    global.emsCacheRestoreFromIdb = function () {
        if (typeof global.emsIdbKvEntries !== 'function') {
            return Promise.resolve({ restored: 0, supported: false });
        }
        return global.emsIdbKvEntries().then(function (entries) {
            var restored = 0;
            (entries || []).forEach(function (e) {
                if (!e || typeof e.key !== 'string') return;
                if (typeof global.emsIsLargeBlobKey === 'function' && global.emsIsLargeBlobKey(e.key)) {
                    return;
                }
                if (e.key.indexOf('ems_') !== 0 && e.key.indexOf('att_rec_') !== 0) return;
                if (typeof global.emsPhysicalKeyBelongsToTenant === 'function'
                    && !global.emsPhysicalKeyBelongsToTenant(e.key)) {
                    return;
                }
                var existing = readRaw(e.key);
                if (existing !== null && existing !== undefined) return;
                var str = typeof e.value === 'string' ? e.value : JSON.stringify(e.value);
                try {
                    if (global._emsOriginalSetItem) {
                        global._emsSuppressSync = true;
                        global._emsOriginalSetItem.call(localStorage, e.key, str);
                        global._emsSuppressSync = false;
                    } else {
                        localStorage.setItem(e.key, str);
                    }
                    global.emsCacheInvalidate(e.key);
                    restored += 1;
                } catch (err) { /* quota */ }
            });
            return { restored: restored, supported: true };
        }).catch(function () { return { restored: 0, supported: true, error: true }; });
    };

    var watchedKeys = [
        'ems_full_users', 'ems_rejected_users', 'ems_full_ledger', 'ems_ledger_db',
        'ems_fee_collections', 'ems_announcements', 'ems_full_announcements',
        'ems_full_complaints', 'ems_student_fee_setup'
    ];

    function shouldInvalidate(key) {
        if (!key) return false;
        for (var i = 0; i < watchedKeys.length; i++) {
            if (key === watchedKeys[i]) return true;
        }
        return key.indexOf('ems_') === 0;
    }

    global.addEventListener && global.addEventListener('storage', function (e) {
        if (e && shouldInvalidate(e.key)) global.emsCacheInvalidate(e.key);
    });
})(typeof window !== 'undefined' ? window : globalThis);
