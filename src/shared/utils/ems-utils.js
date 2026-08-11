/**
 * EMS shared pure utilities — browser + Node (Vitest)
 */
(function (root, factory) {
    var api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    root.EmsUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function sanitize(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function resolvePullConflict(entry, localStr, remoteStr, remoteUpdatedAtMs) {
        entry = entry || {};
        var localEmpty = !localStr || localStr === '[]' || localStr === '{}' || localStr.length < 3;

        if (localEmpty) {
            return { apply: true, reason: 'local_empty' };
        }
        if (localStr === remoteStr) {
            return { apply: false, reason: 'identical', markSync: true };
        }

        var localAt = entry.localUpdatedAt || 0;
        var dirty = !!entry.dirty;

        if (!dirty) {
            return { apply: true, reason: 'remote_wins_clean' };
        }
        if (remoteUpdatedAtMs > localAt) {
            return { apply: true, reason: 'remote_newer', conflict: true };
        }
        return { apply: false, reason: 'local_pending' };
    }

    function simpleHash(str) {
        var h = 5381;
        for (var i = 0; i < str.length; i++) {
            h = ((h << 5) + h) + str.charCodeAt(i);
        }
        return (h >>> 0).toString(16);
    }

    /** Safe for HTML attribute values (onclick args, etc.) */
    function escAttr(str) {
        return sanitize(str);
    }

    /** Firestore SuperAdmins doc id from email (matches seed-super-admin.js) */
    function saEmailDocKey(email) {
        if (!email) return '';
        return String(email).trim().toLowerCase().replace(/[@.]/g, '_');
    }

    /** Stamp client-side version metadata before cloud push (Phase 1 P0). */
    function stampCloudVersion(doc) {
        if (!doc || typeof doc !== 'object') return doc;
        var out = Object.assign({}, doc);
        out.clientUpdatedAt = Date.now();
        out._version = (typeof out._version === 'number' ? out._version : 0) + 1;
        return out;
    }

    return {
        sanitize: sanitize,
        escAttr: escAttr,
        saEmailDocKey: saEmailDocKey,
        resolvePullConflict: resolvePullConflict,
        simpleHash: simpleHash,
        stampCloudVersion: stampCloudVersion
    };
});

/** Global non-destructive print helper — always available (dashboard 360, exams, finance, …) */
(function (global) {
    'use strict';
    if (!global) return;

    global.printDiv = function (divId) {
        var el = global.document && global.document.getElementById(divId);
        if (!el) {
            if (typeof global.showToast === 'function') {
                global.showToast('پرنٹ ایریا نہیں ملا', 'error');
            }
            return;
        }
        var links = '';
        if (global.document.querySelectorAll) {
            global.document.querySelectorAll('link[rel="stylesheet"]').forEach(function (l) {
                if (l.href) links += '<link rel="stylesheet" href="' + l.href + '">';
            });
        }
        var iframe = global.document.createElement('iframe');
        iframe.setAttribute('aria-hidden', 'true');
        iframe.style.cssText = 'position:fixed; right:0; bottom:0; width:0; height:0; border:0; visibility:hidden;';
        global.document.body.appendChild(iframe);
        var doc = iframe.contentWindow.document;
        doc.open();
        /* Override any global @media print { body * { visibility:hidden } } from app CSS */
        doc.write('<!DOCTYPE html><html dir="rtl" lang="ur"><head><meta charset="utf-8"><title>پرنٹ</title>' + links +
            '<style>body{font-family:"Noto Nastaliq Urdu","Jameel Noori Nastaleeq",Arial,sans-serif;direction:rtl;text-align:right;padding:14px;margin:0;color:#0f172a;background:#fff;}' +
            'table{border-collapse:collapse;width:100%;} th,td{padding:6px 8px;}' +
            '@media print{' +
            'body,body *{visibility:visible!important;}' +
            '.no-print,.tpl-matrix-ctrl,.tpl-matrix-del{display:none!important;}' +
            '.tpl-paper-date-print{display:block!important;}' +
            '@page{margin:12mm;}' +
            '}</style></head><body>' +
            el.innerHTML + '</body></html>');
        doc.close();
        var done = false;
        function go() {
            if (done) return;
            done = true;
            try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } catch (e) { /* ignore */ }
            setTimeout(function () {
                if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
            }, 1500);
        }
        iframe.onload = function () { setTimeout(go, 350); };
        setTimeout(go, 1400);
    };
})(typeof window !== 'undefined' ? window : globalThis);
