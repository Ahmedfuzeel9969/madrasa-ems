// ============================================================================
// EMS Storage Quota — admin warnings + safe bulk failure handling (Priority 6)
// ============================================================================
(function (global) {
    'use strict';

    var WARN_RATIO = 0.80;
    var DANGER_RATIO = 0.90;
    var BLOCK_RATIO = 0.95;
    var WARN_COOLDOWN_MS = 90000;
    var SAVE_CHECK_INTERVAL = 25;
    var BANNER_ID = 'ems-storage-quota-banner';

    var _lastWarn = { level: null, at: 0 };
    var _saveCounter = 0;
    var _testEstimate = null;
    var _lastStatus = { level: 'unknown', usagePercent: null, usage: null, quota: null, remaining: null };

    function formatBytes(n) {
        if (n == null || isNaN(n)) return '—';
        var units = ['B', 'KB', 'MB', 'GB', 'TB'];
        var v = Number(n);
        var i = 0;
        while (v >= 1024 && i < units.length - 1) {
            v /= 1024;
            i++;
        }
        return (Math.round(v * 10) / 10) + ' ' + units[i];
    }

    global.emsStorageQuotaFormatBytes = formatBytes;

    function roundPct(n) {
        return Math.round(n * 10) / 10;
    }

    function isQuotaError(err) {
        if (!err) return false;
        var name = err.name || '';
        var msg = String(err.message || err || '');
        return name === 'QuotaExceededError'
            || /quota/i.test(msg)
            || /QUOTA_EXCEEDED/i.test(msg)
            || /storage full/i.test(msg);
    }

    function recoverySuffix() {
        return ' تجویز: پہلے Encrypted Backup بنائیں، پھر ہی browser/app storage صاف کریں۔'
            + ' بڑے اداروں کے لیے Desktop app استعمال کریں اگر mobile storage محدود ہو۔';
    }

    function messageForLevel(level, pct, stats) {
        stats = stats || {};
        var pctStr = pct != null ? roundPct(pct) + '%' : '';
        var spaceLine = 'استعمال: ' + formatBytes(stats.usage)
            + ' / کل: ' + formatBytes(stats.quota)
            + ' / باقی: ' + formatBytes(stats.remaining);
        if (level === 'block') {
            return '⚠️ Storage/quota تقریباً بھر چکی ہے (' + pctStr + ')\n' + spaceLine
                + ' — ڈیٹا محفوظ طور پر save نہیں ہو سکتا۔ فوری Backup/export کریں۔'
                + recoverySuffix();
        }
        if (level === 'danger') {
            return '⚠️ Storage/quota خطرناک حد (' + pctStr + ')\n' + spaceLine
                + ' — ڈیٹا محفوظ طور پر save نہیں ہو سکتا۔ جگہ خالی کریں یا Backup بنائیں۔'
                + recoverySuffix();
        }
        if (level === 'warn') {
            return '⚠️ Storage/quota ' + pctStr + '\n' + spaceLine
                + ' — جگہ کم ہے؛ ڈیٹا محفوظ save نہ ہونے کا خطرہ۔ Backup/export تجویز ہے۔';
        }
        return '';
    }

    function classify(usage, quota) {
        if (quota == null || quota <= 0 || usage == null || usage < 0) {
            return { level: 'unknown', usagePercent: null };
        }
        var ratio = usage / quota;
        var pct = ratio * 100;
        if (ratio >= BLOCK_RATIO) return { level: 'block', usagePercent: pct };
        if (ratio >= DANGER_RATIO) return { level: 'danger', usagePercent: pct };
        if (ratio >= WARN_RATIO) return { level: 'warn', usagePercent: pct };
        return { level: 'safe', usagePercent: pct };
    }

    global.emsStorageQuotaClassify = classify;

    function readEstimate() {
        if (_testEstimate) {
            return Promise.resolve({
                usage: _testEstimate.usage,
                quota: _testEstimate.quota,
                persisted: _testEstimate.persisted != null ? _testEstimate.persisted : false
            });
        }
        if (typeof global.emsIdbStorageEstimate !== 'function') {
            return Promise.resolve({ usage: null, quota: null, persisted: null });
        }
        return global.emsIdbStorageEstimate();
    }

    function ensureBanner() {
        if (typeof document === 'undefined' || !document.body) return null;
        if (typeof document.getElementById !== 'function') return null;
        if (typeof document.createElement !== 'function') return null;
        var el = document.getElementById(BANNER_ID);
        if (el) return el;
        el = document.createElement('div');
        el.id = BANNER_ID;
        el.setAttribute('data-ems-storage-quota', 'banner');
        el.style.cssText = 'display:none;position:fixed;top:0;left:0;right:0;z-index:9999998;'
            + 'padding:12px 16px;text-align:center;font-weight:bold;font-size:15px;color:#fff;'
            + 'direction:rtl;font-family:\'Noto Nastaliq Urdu\',Arial,sans-serif;box-shadow:0 4px 10px rgba(0,0,0,0.25);';
        document.body.appendChild(el);
        return el;
    }

    function updateBanner(level, msg, stats) {
        var el = ensureBanner();
        if (!el) return;
        if (!msg || level === 'safe' || level === 'unknown') {
            el.style.display = 'none';
            el.innerHTML = '';
            el.textContent = '';
            return;
        }
        var bg = level === 'warn' ? '#d97706' : '#dc2626';
        el.style.background = bg;
        el.style.display = 'block';
        stats = stats || {};
        var statsHtml = '<div style="font-size:13px;margin-top:6px;opacity:0.95;">'
            + 'استعمال: <strong>' + formatBytes(stats.usage) + '</strong>'
            + ' &nbsp;|&nbsp; کل: <strong>' + formatBytes(stats.quota) + '</strong>'
            + ' &nbsp;|&nbsp; باقی: <strong>' + formatBytes(stats.remaining) + '</strong>'
            + '</div>';
        var btnHtml = '<div style="margin-top:10px;">'
            + '<button type="button" data-ems-storage-clean-temp="1" '
            + 'style="background:#fff;color:#1e293b;border:none;border-radius:6px;padding:8px 14px;font-weight:bold;cursor:pointer;">'
            + 'عارضی فائلیں صاف کریں (Clean temporary files)</button></div>';
        var text = String(msg).replace(/\n/g, '<br>');
        el.innerHTML = text + statsHtml + btnHtml;
        var btn = el.querySelector && el.querySelector('[data-ems-storage-clean-temp]');
        if (btn && !btn.__emsBound) {
            btn.__emsBound = true;
            btn.addEventListener('click', function () {
                global.emsStorageQuotaCleanTemporaryFiles().then(function (res) {
                    var toastMsg = '✅ عارضی فائلیں صاف: ' + (res.removedTotal || 0) + ' آئٹمز';
                    if (typeof global.showToast === 'function') {
                        global.showToast(toastMsg, 'success');
                    } else if (typeof global.showTopAlert === 'function') {
                        global.showTopAlert(toastMsg, false);
                    }
                    return global.emsStorageQuotaCheck({ context: 'after_clean', showWarning: true });
                });
            });
        }
    }

    function showUserMessage(msg, level, stats) {
        if (!msg) return;
        var now = Date.now();
        if (_lastWarn.level === level && (now - _lastWarn.at) < WARN_COOLDOWN_MS) {
            updateBanner(level, msg, stats);
            return;
        }
        _lastWarn.level = level;
        _lastWarn.at = now;
        updateBanner(level, msg, stats);
        if (typeof global.showTopAlert === 'function') {
            global.showTopAlert(msg, true);
        } else if (typeof global.showToast === 'function') {
            global.showToast(msg, level === 'warn' ? 'warning' : 'error');
        }
    }

    global.emsStorageQuotaCheck = function (opts) {
        opts = opts || {};
        return readEstimate().then(function (est) {
            var c = classify(est && est.usage, est && est.quota);
            var remaining = (est && est.usage != null && est.quota != null)
                ? Math.max(0, est.quota - est.usage)
                : null;
            var result = {
                ok: true,
                level: c.level,
                usagePercent: c.usagePercent != null ? roundPct(c.usagePercent) : null,
                usage: est && est.usage,
                quota: est && est.quota,
                remaining: remaining,
                usageFormatted: formatBytes(est && est.usage),
                quotaFormatted: formatBytes(est && est.quota),
                remainingFormatted: formatBytes(remaining),
                persisted: est && est.persisted,
                context: opts.context || 'general'
            };
            _lastStatus = {
                level: result.level,
                usagePercent: result.usagePercent,
                usage: result.usage,
                quota: result.quota,
                remaining: result.remaining
            };
            if (opts.showWarning !== false && c.level !== 'safe' && c.level !== 'unknown') {
                showUserMessage(messageForLevel(c.level, c.usagePercent, result), c.level, result);
            } else if (c.level === 'safe') {
                updateBanner('safe', null);
            }
            return result;
        }).catch(function () {
            return { ok: false, level: 'unknown', usagePercent: null, context: opts.context || 'general' };
        });
    };

    global.emsStorageQuotaGetStatus = function () {
        return Object.assign({}, _lastStatus);
    };

    global.emsStorageQuotaConfirmBulk = function (opts) {
        opts = opts || {};
        return global.emsStorageQuotaCheck({
            context: opts.context || 'bulk',
            showWarning: true
        }).then(function (status) {
            if (status.level !== 'block') {
                return { ok: true, allowed: true, status: status };
            }
            var msg = '⚠️ Storage/quota ' + (status.usagePercent != null ? status.usagePercent + '%' : '95%+')
                + ' — بڑا bulk import/index خطرناک ہے۔ پھر بھی جاری رکھیں؟'
                + '\n\n' + recoverySuffix();
            var confirmed = typeof global.confirm === 'function' && global.confirm(msg);
            return { ok: true, allowed: !!confirmed, status: status, needsConfirm: true };
        });
    };

    global.emsStorageQuotaOnWriteFailure = function (source, err) {
        var quota = isQuotaError(err);
        var msg = quota
            ? ('⚠️ Storage/quota — ' + (source || 'write') + ' محفوظ نہیں ہوا۔ ڈیٹا محفوظ save نہیں ہو سکتا۔'
                + recoverySuffix())
            : ('⚠️ مقامی storage write ناکام (' + (source || 'write') + '): '
                + (err && err.message ? err.message : String(err || 'unknown')));
        showUserMessage(msg, quota ? 'danger' : 'danger');
        if (typeof global.dispatchEvent === 'function') {
            try {
                global.dispatchEvent(new CustomEvent('ems:storage-write-failed', {
                    detail: { source: source, error: err && err.message, quota: quota }
                }));
            } catch (e) { /* ignore */ }
        }
        return { ok: false, quota: quota, source: source };
    };

    global.emsStorageQuotaMaybeCheckOnSave = function () {
        _saveCounter++;
        if (_saveCounter % SAVE_CHECK_INTERVAL !== 0) {
            return Promise.resolve(null);
        }
        return global.emsStorageQuotaCheck({ context: 'save', showWarning: true });
    };

    global.emsStorageQuotaGetRecoveryHint = function () {
        return {
            urdu: recoverySuffix(),
            steps: [
                'Encrypted backup export (Settings / DR)',
                'Clear browser or app storage only after verified backup',
                'Use Desktop app for large institutions when mobile storage is limited'
            ]
        };
    };

    global.emsStorageQuotaSetTestEstimate = function (usage, quota, persisted) {
        _testEstimate = { usage: usage, quota: quota, persisted: persisted };
    };

    global.emsStorageQuotaClearTestEstimate = function () {
        _testEstimate = null;
    };

    var TEMP_LS_PREFIXES = ['ems_data_pipeline_debug', 'ems_import_queue_staging_'];
    var TEMP_COLLECTIONS = ['p6_quota_probe'];

    function removeLsTempKeys() {
        var removed = 0;
        try {
            var keys = [];
            for (var i = 0; i < global.localStorage.length; i++) {
                var k = global.localStorage.key(i);
                if (!k) continue;
                var hit = TEMP_LS_PREFIXES.some(function (p) { return k.indexOf(p) === 0; });
                if (hit || k.indexOf('_probe') >= 0) keys.push(k);
            }
            keys.forEach(function (k) {
                try {
                    if (global._emsOriginalRemoveItem) global._emsOriginalRemoveItem.call(global.localStorage, k);
                    else global.localStorage.removeItem(k);
                    removed++;
                } catch (e) { /* ignore */ }
            });
        } catch (e2) { /* ignore */ }
        return removed;
    }

    global.emsStorageQuotaCleanTemporaryFiles = function () {
        var out = { lsKeys: 0, collections: 0, idbKv: 0, removedTotal: 0 };
        out.lsKeys = removeLsTempKeys();
        var chain = Promise.resolve();
        TEMP_COLLECTIONS.forEach(function (col) {
            if (typeof global.emsIdbColClear === 'function') {
                chain = chain.then(function () {
                    return global.emsIdbColClear(col).then(function (n) {
                        if (n > 0) {
                            out.collections += 1;
                            out.removedTotal += n;
                        }
                        return n;
                    });
                });
            }
        });
        if (typeof global.emsIdbKvKeys === 'function') {
            chain = chain.then(function () {
                return global.emsIdbKvKeys().then(function (keys) {
                    var probeKeys = (keys || []).filter(function (k) {
                        return k.indexOf('_probe') >= 0 || k.indexOf('p6_') === 0;
                    });
                    var inner = Promise.resolve();
                    probeKeys.forEach(function (k) {
                        inner = inner.then(function () {
                            if (typeof global.emsIdbKvDelete !== 'function') return false;
                            return global.emsIdbKvDelete(k).then(function (ok) {
                                if (ok) { out.idbKv++; out.removedTotal++; }
                                return ok;
                            });
                        });
                    });
                    return inner;
                });
            });
        }
        if (typeof global.emsDurableListKeys === 'function' && typeof global.emsCacheInvalidate === 'function') {
            (global.emsDurableListKeys('p6_') || []).forEach(function (k) {
                global.emsCacheInvalidate(k);
            });
        }
        return chain.then(function () {
            out.removedTotal += out.lsKeys;
            if (typeof global.dispatchEvent === 'function') {
                try {
                    global.dispatchEvent(new CustomEvent('ems:storage-temp-cleaned', { detail: out }));
                } catch (e) { /* ignore */ }
            }
            return out;
        });
    };

    function bootCheck() {
        var run = function () {
            global.emsStorageQuotaCheck({ context: 'boot', showWarning: true });
        };
        if (typeof global.emsIdbReady === 'function') {
            global.emsIdbReady().then(run).catch(run);
        } else {
            run();
        }
    }

    if (typeof global.addEventListener === 'function') {
        global.addEventListener('ems:tenant-ready', function () {
            global.emsStorageQuotaCheck({ context: 'boot', showWarning: true });
        });
    }
    if (typeof setTimeout === 'function') {
        setTimeout(bootCheck, 3000);
    }
})(typeof window !== 'undefined' ? window : globalThis);
