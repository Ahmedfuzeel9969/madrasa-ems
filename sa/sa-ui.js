/**
 * sa-ui.js — Shared Super Admin UI helpers (safe HTML, loading, empty states)
 */
(function (global) {
    'use strict';

    function utils() {
        return global.EmsUtils || {};
    }

    function esc(str) {
        var u = utils();
        if (u.sanitize) return u.sanitize(str);
        if (typeof global.emsSanitize === 'function') return global.emsSanitize(str);
        return String(str == null ? '' : str);
    }

    function escAttr(str) {
        var u = utils();
        if (u.escAttr) return u.escAttr(str);
        return esc(str);
    }

    function tableLoading(cols, msg) {
        cols = cols || 6;
        msg = msg || 'لوڈ ہو رہا ہے...';
        return '<tr><td colspan="' + cols + '" class="sa-table-state"><i class="fas fa-spinner fa-spin"></i> ' + esc(msg) + '</td></tr>';
    }

    function tableEmpty(cols, msg) {
        cols = cols || 6;
        msg = msg || 'کوئی ڈیٹا نہیں';
        return '<tr><td colspan="' + cols + '" class="sa-table-state sa-table-empty"><i class="fas fa-inbox"></i> ' + esc(msg) + '</td></tr>';
    }

    function tableError(cols, msg) {
        cols = cols || 6;
        return '<tr><td colspan="' + cols + '" class="sa-table-state sa-table-error"><i class="fas fa-exclamation-triangle"></i> ' + esc(msg) + '</td></tr>';
    }

    /**
     * Bind click handlers via data-action / data-* attrs (XSS-safe — no inline onclick with user data).
     */
    function bindActions(root, handlers) {
        if (!root || !handlers) return;
        root.querySelectorAll('[data-action]').forEach(function (el) {
            el.onclick = function (e) {
                e.preventDefault();
                var action = el.getAttribute('data-action');
                if (handlers[action]) handlers[action](el, e);
            };
        });
    }

    global.SaUi = {
        esc: esc,
        escAttr: escAttr,
        tableLoading: tableLoading,
        tableEmpty: tableEmpty,
        tableError: tableError,
        bindActions: bindActions
    };
})(typeof window !== 'undefined' ? window : globalThis);
