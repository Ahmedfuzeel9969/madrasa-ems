// ============================================================================
// EMS Import Merge — duplicate detection & merge UI (Import Phase 2)
// ============================================================================
(function (global) {
    'use strict';

    function IE() { return global.EmsImportExport; }

    global.emsImportAnalyzeDuplicates = function (records) {
        if (!IE() || typeof IE().smartValidate !== 'function') return { duplicates: [], count: 0 };
        var v = IE().smartValidate(records || []);
        var byIssue = {};
        (v.issues || []).forEach(function (iss) {
            var key = iss.issue + ':' + iss.detail;
            if (!byIssue[key]) byIssue[key] = [];
            byIssue[key].push(iss);
        });
        var dups = [];
        Object.keys(byIssue).forEach(function (k) {
            if (byIssue[k].length > 1) dups.push({ issue: k, rows: byIssue[k] });
        });
        return { duplicates: dups, count: v.count || 0, issues: v.issues || [] };
    };

    global.emsImportMergeStep5Html = function (records) {
        var analysis = global.emsImportAnalyzeDuplicates(records);
        var problems = (records || []).filter(function (r) { return r._skip || (r._issues && r._issues.length); });
        if (!problems.length && !analysis.count) {
            return '<div class="iw-pane"><h4><i class="fas fa-circle-check"></i> اصلاح</h4>' +
                '<p class="iw-ok"><i class="fas fa-check-circle"></i> کوئی duplicate یا مسئلہ نہیں۔</p></div>';
        }
        var dupRows = (analysis.issues || []).slice(0, 40).map(function (iss) {
            return '<tr><td>' + (iss.id || '—') + '</td><td>' + iss.issue + '</td><td>' + (iss.detail || '') + '</td></tr>';
        }).join('');
        var probRows = problems.slice(0, 30).map(function (r) {
            return '<tr><td>' + (r.id || '—') + '</td><td>' + (r.name || '—') + '</td><td style="color:#dc2626">' +
                ((r._issues || []).join('، ') || 'skip') + '</td></tr>';
        }).join('');
        return '<div class="iw-pane"><h4><i class="fas fa-code-merge"></i> Duplicates &amp; Merge</h4>' +
            '<p class="iw-hint">Smart validation: ' + analysis.count + ' possible duplicate field(s). Step 6 میں conflict policy منتخب کریں۔</p>' +
            (analysis.count ? ('<table class="iw-table"><tr><th>ID</th><th>Issue</th><th>Detail</th></tr>' + dupRows + '</table>') : '') +
            (problems.length ? ('<h5 style="margin-top:14px;">Warnings (' + problems.length + ')</h5>' +
                '<table class="iw-table"><tr><th>ID</th><th>نام</th><th>مسئلہ</th></tr>' + probRows + '</table>') : '') +
            '</div>';
    };

    global.emsBulkImportViaCf = function (records, type, conflict) {
        if (typeof global.emsCallFunction !== 'function') {
            return Promise.reject(new Error('Cloud Function unavailable'));
        }
        var tenantId = '';
        if (typeof global.emsGetTenantId === 'function') tenantId = global.emsGetTenantId() || '';
        if (!tenantId && global.CURRENT_MADRASA_TENANT_ID) tenantId = global.CURRENT_MADRASA_TENANT_ID;
        if (!tenantId && global.firebase && firebase.auth().currentUser) tenantId = firebase.auth().currentUser.uid;
        if (!tenantId) return Promise.reject(new Error('Login required'));
        var clean = (records || []).map(function (r) {
            var o = {};
            Object.keys(r).forEach(function (k) { if (k.charAt(0) !== '_') o[k] = r[k]; });
            return o;
        });
        return global.emsCallFunction('bulkImportRegistrations', {
            tenantId: tenantId,
            records: clean.map(function (r) {
                if (!r.status) r.status = 'approved';
                if (!r.timestamp) r.timestamp = Date.now();
                if (!r.date) r.date = new Date().toISOString().slice(0, 10);
                return r;
            }),
            type: type || 'student',
            conflict: conflict || 'skip'
        });
    };

})(window);
