// ============================================================================
// EMS Data Corruption Detection — Priority 3
// Detects invalid JSON in local caches; warns users; safe IDB recovery.
// ============================================================================
(function (global) {
    'use strict';

    var registry = Object.create(null);
    var warned = Object.create(null);
    var recoverScheduled = Object.create(null);

    function isNonEmptyRaw(raw) {
        return typeof raw === 'string' && raw.trim().length > 0;
    }

    function fallbackKind(fallback) {
        if (Array.isArray(fallback)) return 'array';
        if (fallback && typeof fallback === 'object') return 'object';
        return 'array';
    }

    function createSentinel(key, kind) {
        var base = kind === 'object' ? Object.create(null) : [];
        Object.defineProperty(base, '__emsDataCorrupt', {
            value: true,
            enumerable: false,
            configurable: false
        });
        Object.defineProperty(base, '__emsCorruptKey', {
            value: key,
            enumerable: false,
            configurable: false
        });
        return base;
    }

    function showWarning(key) {
        if (warned[key]) return;
        warned[key] = true;
        var msg = '⚠️ مقامی ڈیٹا خراب ہے (' + key
            + ') — یہ خالی فہرست نہیں۔ IndexedDB سے بحالی کی کوشش ہو رہی ہے۔'
            + ' ناکامی پر «Cloud Sync / Pull» یا سپورٹ سے رابطہ کریں۔';
        if (typeof global.showTopAlert === 'function') {
            global.showTopAlert(msg, true);
        } else if (typeof global.showToast === 'function') {
            global.showToast(msg, 'error');
        }
        console.error('[EMS:corruption] corrupt local JSON for key:', key);
    }

    global.emsIsCorruptData = function (value) {
        return !!(value && value.__emsDataCorrupt === true);
    };

    global.emsDataCorruptionGet = function (key) {
        return registry[key] || null;
    };

    global.emsDataCorruptionList = function () {
        return Object.keys(registry);
    };

    global.emsDataCorruptionReport = function (key, err, raw, fallback) {
        if (!key || !isNonEmptyRaw(raw)) {
            return { corrupt: false, sentinel: null };
        }
        registry[key] = {
            key: key,
            error: err && err.message ? err.message : String(err),
            at: new Date().toISOString(),
            rawLength: raw.length
        };
        showWarning(key);
        var kind = fallbackKind(fallback);
        return {
            corrupt: true,
            sentinel: createSentinel(key, kind)
        };
    };

    function parseIdbRaw(raw) {
        if (raw == null) return null;
        if (typeof raw !== 'string') return raw;
        if (!raw.trim()) return null;
        try {
            return JSON.parse(raw);
        } catch (e) {
            return null;
        }
    }

    global.emsDataCorruptionTryRecover = function (key) {
        if (!key) return Promise.resolve({ ok: false, reason: 'no_key' });
        if (typeof global.emsIdbKvGet !== 'function') {
            return Promise.resolve({ ok: false, reason: 'idb_unavailable' });
        }
        return global.emsIdbKvGet(key).then(function (raw) {
            var recovered = parseIdbRaw(raw);
            if (recovered == null) {
                return { ok: false, reason: 'idb_miss_or_invalid' };
            }
            delete registry[key];
            warned[key] = false;
            if (typeof global.emsCacheInvalidate === 'function') {
                global.emsCacheInvalidate(key);
            }
            if (typeof global.emsCacheSet === 'function') {
                global.emsCacheSet(key, recovered);
            } else {
                try {
                    var str = typeof raw === 'string' ? raw : JSON.stringify(recovered);
                    if (global._emsOriginalSetItem) {
                        global._emsOriginalSetItem.call(localStorage, key, str);
                    } else {
                        localStorage.setItem(key, str);
                    }
                } catch (e) { /* quota */ }
            }
            if (typeof global.showToast === 'function') {
                global.showToast('✅ ' + key + ' IndexedDB سے بحال ہو گیا', 'success');
            }
            if (typeof global.dispatchEvent === 'function') {
                try {
                    global.dispatchEvent(new CustomEvent('ems-data-recovered', { detail: { key: key } }));
                } catch (evErr) { /* ignore */ }
            }
            return { ok: true, value: recovered, source: 'idb_kv' };
        }).catch(function (err) {
            return { ok: false, reason: 'idb_error', error: err && err.message ? err.message : String(err) };
        });
    };

    global.emsDataCorruptionScheduleRecover = function (key) {
        if (!key || recoverScheduled[key]) return;
        recoverScheduled[key] = true;
        global.emsDataCorruptionTryRecover(key).then(function (res) {
            if (!res.ok && typeof global.showToast === 'function') {
                global.showToast(
                    '⚠️ ' + key + ' خودکار بحالی ناکام — Cloud Sync / Pull استعمال کریں',
                    'warning'
                );
            }
        });
    };

    global.emsDataCorruptionQuarantineKey = function (key) {
        if (!key) return false;
        try {
            if (global._emsOriginalRemoveItem) {
                global._emsOriginalRemoveItem.call(localStorage, key);
            } else {
                localStorage.removeItem(key);
            }
        } catch (e) { /* ignore */ }
        if (typeof global.emsCacheInvalidate === 'function') {
            global.emsCacheInvalidate(key);
        }
        delete registry[key];
        delete recoverScheduled[key];
        return true;
    };

    global.emsDataCorruptionGetRecoveryHint = function (key) {
        return {
            key: key,
            auto: 'IndexedDB mirror (emsIdbKvGet) — attempted once per corrupt read',
            manual: [
                'Cloud Sync / Pull from registration or admin tools',
                'Restore from encrypted DR backup (npm run backup:restore)',
                'Quarantine corrupt key via emsDataCorruptionQuarantineKey then re-pull'
            ]
        };
    };
})(typeof window !== 'undefined' ? window : globalThis);
