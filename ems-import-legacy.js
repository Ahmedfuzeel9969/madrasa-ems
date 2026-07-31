// ============================================================================
// EMS Legacy Simple Import — one-screen backward-compatible mode
// Uses same EmsImportExport engine; does not replace the 7-step wizard.
// ============================================================================
(function (global) {
    'use strict';

    function IE() { return global.EmsImportExport; }
    function toast(m, t) { if (global.showToast) global.showToast(m, t || 'success'); }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

    global.emsLegacyOnFile = function (input) {
        var f = input.files && input.files[0];
        var label = document.getElementById('legacy-import-fname');
        if (label) label.textContent = f ? f.name : 'فائل منتخب کریں';
        global._emsLegacyFile = f || null;
    };

    global.emsLegacyQuickImport = function () {
        var file = global._emsLegacyFile;
        var typeEl = document.getElementById('legacy-import-type');
        var type = (typeEl && typeEl.value) ? typeEl.value : 'student';
        if (!file) { toast('پہلے فائل منتخب کریں', 'warning'); return; }
        if (!IE() || typeof IE().legacyQuickImport !== 'function') {
            toast('Import engine لوڈ نہیں', 'error'); return;
        }
        var btn = document.getElementById('legacy-import-btn');
        if (btn) btn.disabled = true;
        IE().legacyQuickImport(file, type, { conflict: 'skip', snapshot: true }).then(function (report) {
            if (btn) btn.disabled = false;
            global._emsLegacyFile = null;
            var fn = document.getElementById('legacy-import-file');
            if (fn) fn.value = '';
            var label = document.getElementById('legacy-import-fname');
            if (label) label.textContent = 'فائل منتخب کریں';
            toast('Staging: ' + (report.recordCount || 0) + ' قطار، ' + (report.validCount || 0) + ' درست' +
                ((report.summary && report.summary.problems > 0) ? ' (' + report.summary.problems + ' مسئلہ)' : '') +
                ' — Confirm Import کریں', (report.validCount || 0) > 1 ? 'success' : 'warning');
            if (typeof global.emsRenderImportHistory === 'function') global.emsRenderImportHistory();
            if (typeof global.emsSmartRefreshSnapshotUi === 'function') global.emsSmartRefreshSnapshotUi();
        }).catch(function (err) {
            if (btn) btn.disabled = false;
            toast((err && err.message) || 'امپورٹ ناکام — Advanced wizard آزمائیں', 'error');
        });
    };

    global.emsLegacyRenderPanel = function () {
        var box = document.getElementById('legacy-import-panel');
        if (!box) return;
        box.innerHTML =
            '<p style="color:#64748b;font-size:13px;margin:0 0 12px;">فائل Staging میں اپ لوڈ ہوگی — ڈیٹا بیس میں منتقل کرنے کے لیے Import History سے <b>Confirm Import</b> دبائیں۔</p>' +
            '<div class="form-grid" style="gap:12px;">' +
            '<div class="input-group"><label>ریکارڈ کی قسم</label>' +
            '<select id="legacy-import-type" class="input-control">' +
            '<option value="student">طلبہ</option><option value="teacher">اساتذہ</option><option value="staff">عملہ</option>' +
            '</select></div>' +
            '<div class="input-group"><label>Excel / CSV / JSON</label>' +
            '<div class="iw-drop" onclick="document.getElementById(\'legacy-import-file\').click()">' +
            '<i class="fas fa-file-arrow-up"></i><div id="legacy-import-fname">فائل منتخب کریں</div></div>' +
            '<input type="file" id="legacy-import-file" accept=".xlsx,.xls,.csv,.json,.xml" style="display:none" onchange="window.emsLegacyOnFile(this)">' +
            '</div></div>' +
            '<button type="button" id="legacy-import-btn" class="btn btn-success" style="width:100%;margin-top:12px;padding:12px;" onclick="window.emsLegacyQuickImport()">' +
            '<i class="fas fa-cloud-arrow-up"></i> فائل اپ لوڈ (Staging)</button>' +
            '<p style="font-size:11px;color:#94a3b8;margin-top:8px;">پیچیدہ فائلوں کے لیے نیچے Advanced wizard استعمال کریں۔</p>';
    };

})(window);
