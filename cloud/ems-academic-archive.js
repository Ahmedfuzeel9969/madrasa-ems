// ============================================================================
// EMS Academic Archive — 2-year client window + Archive_* integration (E11-S1)
// Client never keeps >24 months raw attendance/fee/ledger locally.
// ============================================================================
(function (global) {
    'use strict';

    var MAX_MONTHS = 24;
    var ARCHIVE_META_CACHE = null;

    function parseSettings() {
        try {
            return JSON.parse(localStorage.getItem('ems_att_settings') || '{}') || {};
        } catch (e) {
            return {};
        }
    }

    function defaultAcademicYear() {
        var now = new Date();
        var y = now.getFullYear();
        var m = now.getMonth() + 1;
        if (m >= 4) return y + '-' + (y + 1);
        return (y - 1) + '-' + y;
    }

    global.emsGetAcademicYear = function () {
        var s = parseSettings();
        var y = String(s.year || '').trim();
        return y || defaultAcademicYear();
    };

    global.emsArchiveCutoffMonth = function () {
        var d = new Date();
        d.setMonth(d.getMonth() - MAX_MONTHS);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    };

    global.emsArchiveCutoffDate = function () {
        return global.emsArchiveCutoffMonth() + '-01';
    };

    global.emsArchiveMonthInWindow = function (monthStr) {
        monthStr = String(monthStr || '').slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(monthStr)) return true;
        return monthStr >= global.emsArchiveCutoffMonth();
    };

    global.emsArchiveDateInWindow = function (dateStr) {
        dateStr = String(dateStr || '').slice(0, 10);
        if (!dateStr) return true;
        return dateStr >= global.emsArchiveCutoffDate();
    };

    global.emsArchiveYearMonths = function (academicYear) {
        academicYear = String(academicYear || '').trim();
        var parts = academicYear.split('-').map(function (x) { return parseInt(x, 10); });
        if (!parts[0] || isNaN(parts[0])) return [];
        var y1 = parts[0];
        var months = [];
        var m;
        for (m = 4; m <= 12; m++) months.push(y1 + '-' + String(m).padStart(2, '0'));
        for (m = 1; m <= 3; m++) months.push((y1 + 1) + '-' + String(m).padStart(2, '0'));
        return months;
    };

    global.emsArchiveMonthFromAttKey = function (key) {
        if (!key || key.indexOf('att_rec_') !== 0) return null;
        var parts = key.split('_');
        return parts.length >= 3 ? parts[2] : null;
    };

    global.emsArchiveFilterByDate = function (rows, field) {
        field = field || 'date';
        return (rows || []).filter(function (r) {
            return global.emsArchiveDateInWindow(r && r[field]);
        });
    };

    global.emsArchiveFilterFeeCollections = function (rows) {
        return global.emsArchiveFilterByDate(rows, 'date');
    };

    global.emsArchivePruneLocalStorage = function () {
        var cutoff = global.emsArchiveCutoffMonth();
        var removed = 0;
        var keys = [];
        for (var i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
        keys.forEach(function (key) {
            if (!key) return;
            if (key.indexOf('att_rec_') === 0) {
                var month = global.emsArchiveMonthFromAttKey(key);
                if (month && month < cutoff) {
                    localStorage.removeItem(key);
                    removed++;
                }
            }
        });
        ['ems_fee_collections', 'ems_full_ledger'].forEach(function (storeKey) {
            try {
                var raw = localStorage.getItem(storeKey);
                if (!raw) return;
                var arr = JSON.parse(raw);
                if (!Array.isArray(arr)) return;
                var kept = arr.filter(function (r) { return global.emsArchiveDateInWindow(r && r.date); });
                if (kept.length !== arr.length) {
                    localStorage.setItem(storeKey, JSON.stringify(kept));
                    removed += arr.length - kept.length;
                }
            } catch (e) { /* ignore */ }
        });
        return { removed: removed, cutoffMonth: cutoff };
    };

    global.emsArchiveGetMetaList = function () {
        return ARCHIVE_META_CACHE ? ARCHIVE_META_CACHE.slice() : [];
    };

    global.emsArchiveLoadMeta = function () {
        var db = typeof global.getDbOrNull === 'function' ? global.getDbOrNull() : null;
        var tid = typeof global.emsGetTenantId === 'function' ? global.emsGetTenantId() : null;
        if (!tid && global.CURRENT_MADRASA_TENANT_ID) tid = global.CURRENT_MADRASA_TENANT_ID;
        if (!tid && global.firebase && firebase.auth && firebase.auth().currentUser) {
            tid = firebase.auth().currentUser.uid;
        }
        if (!db || !tid) return Promise.resolve([]);
        return db.collection('All_Madrasas').doc(tid).collection('Archive_Meta').get()
            .then(function (snap) {
                var list = [];
                snap.forEach(function (doc) {
                    list.push(Object.assign({ id: doc.id }, doc.data()));
                });
                list.sort(function (a, b) {
                    return String(b.archivedAt || '').localeCompare(String(a.archivedAt || ''));
                });
                ARCHIVE_META_CACHE = list;
                return list;
            }).catch(function () { return []; });
    };

    global.emsArchiveRunYear = function (academicYear) {
        academicYear = String(academicYear || global.emsGetAcademicYear()).trim();
        if (!academicYear) return Promise.reject(new Error('تعلیمی سال درکار ہے'));
        var tid = typeof global.emsGetTenantId === 'function' ? global.emsGetTenantId() : null;
        if (!tid && global.CURRENT_MADRASA_TENANT_ID) tid = global.CURRENT_MADRASA_TENANT_ID;
        if (!tid && global.firebase && firebase.auth && firebase.auth().currentUser) {
            tid = firebase.auth().currentUser.uid;
        }
        if (!tid) return Promise.reject(new Error('لاگ ان لازمی ہے'));
        if (typeof global.emsCallFunction === 'function') {
            return global.emsCallFunction('archiveTenantAcademicYear', {
                tenantId: tid,
                academicYear: academicYear
            }).then(function (res) {
                global.emsArchivePruneLocalStorage();
                return global.emsArchiveLoadMeta().then(function () { return res; });
            });
        }
        if (!firebase.functions || typeof firebase.functions !== 'function') {
            return Promise.reject(new Error('Cloud Function unavailable'));
        }
        return firebase.functions().httpsCallable('archiveTenantAcademicYear')({
            tenantId: tid,
            academicYear: academicYear
        }).then(function (res) {
            global.emsArchivePruneLocalStorage();
            return global.emsArchiveLoadMeta().then(function () { return res.data || res; });
        });
    };
})(typeof window !== 'undefined' ? window : globalThis);
