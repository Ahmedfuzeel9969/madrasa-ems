// ============================================================================
// EMS Import Templates — preset column maps (Import Phase 2)
// ============================================================================
(function (global) {
    'use strict';

    var TEMPLATES_KEY = 'ems_import_templates_v1';

    var BUILTIN = {
        student_urdu_standard: {
            name: 'طلبہ — Urdu standard',
            type: 'student',
            map: { 'نام': 'name', 'ولدیت': 'fname', 'شناختی': 'cnic', 'موبائل': 'phone', 'درجہ': 'class', 'پتہ': 'address', 'سرپرست': 'grdName' }
        },
        student_en_standard: {
            name: 'Student — English standard',
            type: 'student',
            map: { 'name': 'name', 'father': 'fname', 'cnic': 'cnic', 'phone': 'phone', 'class': 'class', 'address': 'address' }
        },
        teacher_urdu_standard: {
            name: 'استاد — Urdu standard',
            type: 'teacher',
            map: { 'نام': 'name', 'ولدیت': 'fname', 'شناختی': 'cnic', 'موبائل': 'phone', 'عہدہ': 'designation', 'شعبہ': 'department' }
        },
        staff_urdu_standard: {
            name: 'عملہ — Urdu standard',
            type: 'staff',
            map: { 'نام': 'name', 'ولدیت': 'fname', 'شناختی': 'cnic', 'موبائل': 'phone', 'آسامی': 'position' }
        }
    };

    function headerToMap(headers, templateMap) {
        var out = {};
        headers.forEach(function (h, i) {
            var key = String(h || '').trim();
            if (templateMap[key]) out[i] = templateMap[key];
            else {
                Object.keys(templateMap).forEach(function (tk) {
                    if (key.toLowerCase().indexOf(tk.toLowerCase()) >= 0 || tk.toLowerCase().indexOf(key.toLowerCase()) >= 0) {
                        out[i] = templateMap[tk];
                    }
                });
            }
        });
        return out;
    }

    global.EmsImportTemplates = {
        builtin: BUILTIN,
        list: function (type) {
            var keys = Object.keys(BUILTIN);
            if (type) keys = keys.filter(function (k) { return BUILTIN[k].type === type; });
            return keys.map(function (k) {
                return { id: k, name: BUILTIN[k].name, type: BUILTIN[k].type };
            });
        },
        apply: function (templateId, headers) {
            var t = BUILTIN[templateId];
            if (!t) return {};
            return headerToMap(headers, t.map);
        },
        saveCustom: function (name, type, map) {
            var list = [];
            try { list = JSON.parse(localStorage.getItem(TEMPLATES_KEY) || '[]'); } catch (e) { }
            var entry = { id: 'custom_' + Date.now(), name: name, type: type, map: map, custom: true };
            list.push(entry);
            try { localStorage.setItem(TEMPLATES_KEY, JSON.stringify(list)); } catch (e) { }
            return entry;
        },
        listCustom: function (type) {
            try {
                var list = JSON.parse(localStorage.getItem(TEMPLATES_KEY) || '[]');
                if (type) return list.filter(function (t) { return t.type === type; });
                return list;
            } catch (e) { return []; }
        }
    };

    global.emsImportTemplatesBar = function (containerId, type, headers, onApply) {
        var el = document.getElementById(containerId);
        if (!el || !global.EmsImportTemplates) return;
        var builtins = global.EmsImportTemplates.list(type);
        var opts = '<option value="">— Template —</option>' +
            builtins.map(function (t) { return '<option value="' + t.id + '">' + t.name + '</option>'; }).join('');
        el.innerHTML =
            '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;align-items:center;">' +
            '<label style="font-size:12px;color:#64748b;">Mapping template:</label>' +
            '<select id="import-template-select" class="input-control" style="max-width:220px;font-size:12px;">' + opts + '</select>' +
            '<button type="button" class="btn btn-outline btn-sm" onclick="window.emsImportApplyTemplate()"><i class="fas fa-magic"></i> Apply</button>' +
            '</div>';
        global._emsTemplateHeaders = headers;
        global._emsTemplateType = type;
        global._emsTemplateOnApply = onApply;
    };

    global.emsImportApplyTemplate = function () {
        var sel = document.getElementById('import-template-select');
        if (!sel || !sel.value || !global.EmsImportTemplates) return;
        var map = global.EmsImportTemplates.apply(sel.value, global._emsTemplateHeaders || []);
        if (typeof global._emsTemplateOnApply === 'function') global._emsTemplateOnApply(map);
        if (global.showToast) global.showToast('Template applied');
    };

})(window);
