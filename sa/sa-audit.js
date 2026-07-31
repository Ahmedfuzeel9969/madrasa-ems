/**
 * sa-audit.js — Unified audit log with filters and export
 */
(function (global) {
    'use strict';

    var _cachedRows = [];
    var _systemRows = [];
    var _platformRows = [];
    var _auditUnsubs = [];
    var _auditLive = false;

    function core() { return global.SaCore; }
    function esc(v) { return core() ? core().esc(v) : String(v || ''); }
    function toast(msg, type) { if (core()) core().toast(msg, type); }
    function db() { return core() ? core().db() : null; }

    function formatDate(val) {
        if (typeof global.saFormatDate === 'function') return global.saFormatDate(val);
        if (!val) return '-';
        if (val.toDate) return val.toDate().toLocaleString('ur-PK');
        return String(val);
    }

    function getFilters() {
        return {
            action: ((document.getElementById('sa-audit-filter-action') || {}).value || '').trim().toLowerCase(),
            admin: ((document.getElementById('sa-audit-filter-admin') || {}).value || '').trim().toLowerCase(),
            source: (document.getElementById('sa-audit-filter-source') || {}).value || 'all'
        };
    }

    function applyFilters(rows) {
        var f = getFilters();
        return rows.filter(function (d) {
            if (f.source !== 'all' && d.source !== f.source) return false;
            if (f.action && (d.action || '').toLowerCase().indexOf(f.action) === -1) return false;
            if (f.admin && (d.email || '').toLowerCase().indexOf(f.admin) === -1) return false;
            return true;
        });
    }

    function renderRows(rows) {
        var tbody = document.getElementById('sa-audit-tbody');
        if (!tbody) return;
        var filtered = applyFilters(rows);
        if (!filtered.length) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">فلٹر کے مطابق کوئی لاگ نہیں</td></tr>';
            return;
        }
        tbody.innerHTML = filtered.slice(0, 150).map(function (d) {
            return '<tr><td>' + esc(formatDate(d.ts)) + '</td><td><small>' + esc(d.source || '-') + '</small></td>' +
                '<td>' + esc(d.email || '-') + '</td>' +
                '<td><code>' + esc(d.action || '-') + '</code></td><td>' + esc(d.target || '-') + '</td>' +
                '<td>' + esc(d.reason || '-') + '</td></tr>';
        }).join('');
    }

    function mergeAuditRows() {
        var rows = _systemRows.concat(_platformRows);
        rows.sort(function (a, b) {
            var ta = a.ts && a.ts.toDate ? a.ts.toDate().getTime() : 0;
            var tb = b.ts && b.ts.toDate ? b.ts.toDate().getTime() : 0;
            return tb - ta;
        });
        _cachedRows = rows;
        renderRows(rows);
        var liveEl = document.getElementById('sa-audit-live-indicator');
        if (liveEl) liveEl.textContent = _auditLive ? '● Live' : '';
    }

    function mapSystemDoc(doc) {
        var d = doc.data();
        return {
            ts: d.timestamp,
            source: 'System',
            email: d.adminEmail,
            action: d.action,
            target: d.targetName || d.targetUid,
            reason: d.reason
        };
    }

    function mapPlatformDoc(doc) {
        var d = doc.data();
        return {
            ts: d.timestamp,
            source: 'Platform',
            email: d.actorEmail,
            action: d.action,
            target: d.targetUid,
            reason: d.reason
        };
    }

    function stopAuditRealtime() {
        _auditUnsubs.forEach(function (u) { if (typeof u === 'function') u(); });
        _auditUnsubs = [];
        _auditLive = false;
    }

    function startAuditRealtime() {
        var firestore = db();
        if (!firestore) return;
        stopAuditRealtime();
        _auditLive = true;

        _auditUnsubs.push(firestore.collection('System_AuditLog').orderBy('timestamp', 'desc').limit(80)
            .onSnapshot(function (snap) {
                _systemRows = snap.docs.map(mapSystemDoc);
                mergeAuditRows();
            }, function () { }));

        _auditUnsubs.push(firestore.collection('Platform_AuditLog').orderBy('timestamp', 'desc').limit(80)
            .onSnapshot(function (snap) {
                _platformRows = snap.docs.map(mapPlatformDoc);
                mergeAuditRows();
            }, function () {
                _platformRows = [];
                mergeAuditRows();
            }));
    }

    global.loadSaAuditLog = function () {
        if (!global.isSuperAdmin()) return;
        if (core() && !core().can('audit.view')) {
            toast('آڈٹ لاگ دیکھنے کی اجازت نہیں۔', 'error');
            return;
        }
        var tbody = document.getElementById('sa-audit-tbody');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;"><i class="fas fa-spinner fa-spin"></i> لوڈ...</td></tr>';
        startAuditRealtime();
    };

    global.SaAudit = {
        stop: stopAuditRealtime
    };

    global.saReloadAuditOnce = function () {
        var firestore = db();
        var tbody = document.getElementById('sa-audit-tbody');
        if (!firestore || !tbody) return;
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;"><i class="fas fa-spinner fa-spin"></i> لوڈ...</td></tr>';
        Promise.all([
            firestore.collection('System_AuditLog').orderBy('timestamp', 'desc').limit(100).get(),
            firestore.collection('Platform_AuditLog').orderBy('timestamp', 'desc').limit(100).get().catch(function () {
                return { forEach: function () { } };
            })
        ]).then(function (results) {
            _systemRows = [];
            _platformRows = [];
            results[0].forEach(function (doc) { _systemRows.push(mapSystemDoc(doc)); });
            if (results[1] && results[1].forEach) {
                results[1].forEach(function (doc) { _platformRows.push(mapPlatformDoc(doc)); });
            }
            mergeAuditRows();
        }).catch(function (err) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:red;">' + esc(err.message) + '</td></tr>';
        });
    };

    global.saFilterAuditLog = function () {
        renderRows(_cachedRows);
    };

    global.saExportAuditCSV = function () {
        if (core() && !core().requirePermission('audit.export', 'آڈٹ ایکسپورٹ')) return;
        var rows = applyFilters(_cachedRows);
        if (!rows.length) {
            toast('ایکسپورٹ کے لیے کوئی لاگ نہیں۔', 'error');
            return;
        }
        var csvRows = [['Timestamp', 'Source', 'Admin', 'Action', 'Target', 'Reason']];
        rows.forEach(function (d) {
            csvRows.push([
                formatDate(d.ts),
                d.source || '',
                d.email || '',
                d.action || '',
                d.target || '',
                d.reason || ''
            ]);
        });
        var csv = csvRows.map(function (r) {
            return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',');
        }).join('\n');
        var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'audit_export_' + new Date().toISOString().split('T')[0] + '.csv';
        a.click();
        toast('آڈٹ CSV ڈاؤنلوڈ۔', 'success');
    };

})(window);
