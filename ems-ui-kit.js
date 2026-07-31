// ============================================================================
// EMS UI Kit — Smart Field System (Auto-complete + Quick-Select + Manage)
// مرکزی ڈکشنری (EmsMasterData) سے منسلک جدید ان پٹ فیلڈز
// استعمال: <input data-ems-dict="classes"> یا EmsUI.smartField(el, {category})
// ============================================================================
(function (global) {
    'use strict';

    function md() { return global.EmsMasterData; }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

    var openDropdown = null;
    function closeOpen() {
        if (openDropdown) { openDropdown.style.display = 'none'; openDropdown = null; }
    }
    document.addEventListener('click', function (e) {
        if (openDropdown && !openDropdown._wrap.contains(e.target)) closeOpen();
    });

    function buildDropdown(input, category, allowManage) {
        var wrap = input.parentNode;
        if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';

        var dd = document.createElement('div');
        dd.className = 'ems-smart-dd';
        dd.style.display = 'none';
        dd._wrap = wrap;
        wrap.appendChild(dd);

        var activeIdx = -1;
        var current = [];

        function render() {
            var q = input.value;
            current = md() ? md().search(category, q) : [];
            var html = '';
            current.forEach(function (v, i) {
                html += '<div class="ems-smart-opt' + (i === activeIdx ? ' active' : '') + '" data-v="' + esc(v) + '">' +
                    '<i class="fas fa-angle-left" style="opacity:.4;font-size:11px;"></i><span>' + esc(v) + '</span></div>';
            });
            var typed = (q || '').trim();
            if (typed && md() && !md().has(category, typed)) {
                html += '<div class="ems-smart-add" data-add="' + esc(typed) + '"><i class="fas fa-plus-circle"></i> نیا شامل کریں: <strong>' + esc(typed) + '</strong></div>';
            }
            if (!current.length && !typed) {
                html += '<div class="ems-smart-empty">کوئی اندراج نہیں — لکھ کر شامل کریں</div>';
            }
            if (allowManage) {
                html += '<div class="ems-smart-manage" data-manage="1"><i class="fas fa-cog"></i> فہرست کا انتظام (Add / Edit / Delete)</div>';
            }
            dd.innerHTML = html;
        }

        function show() {
            activeIdx = -1;
            render();
            dd.style.display = 'block';
            openDropdown = dd;
        }

        function choose(v) {
            input.value = v;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            closeOpen();
        }

        input.addEventListener('focus', show);
        input.addEventListener('input', function () { activeIdx = -1; if (openDropdown !== dd) show(); else render(); });
        input.addEventListener('keydown', function (e) {
            if (dd.style.display === 'none') return;
            if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, current.length - 1); render(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); render(); }
            else if (e.key === 'Enter') {
                if (activeIdx >= 0 && current[activeIdx]) { e.preventDefault(); choose(current[activeIdx]); }
                else {
                    var typed = (input.value || '').trim();
                    if (typed && md() && !md().has(category, typed)) { e.preventDefault(); md().add(category, typed); choose(typed); }
                }
            } else if (e.key === 'Escape') { closeOpen(); }
        });

        dd.addEventListener('mousedown', function (e) {
            var opt = e.target.closest('.ems-smart-opt');
            var add = e.target.closest('.ems-smart-add');
            var man = e.target.closest('.ems-smart-manage');
            if (opt) { e.preventDefault(); choose(opt.getAttribute('data-v')); }
            else if (add) { e.preventDefault(); var v = add.getAttribute('data-add'); md().add(category, v); choose(v); }
            else if (man) { e.preventDefault(); openManager(category, input); }
        });

        return { show: show, render: render };
    }

    // فہرست کا انتظام (Add / Edit / Delete) — جدید modal
    function openManager(category, sourceInput) {
        closeOpen();
        var existing = document.getElementById('ems-dict-manager');
        if (existing) existing.remove();

        var labels = {
            classes: 'درجات', sections: 'سیکشنز', departments: 'شعبہ جات', subjects: 'مضامین',
            designations: 'عہدے', branches: 'شاخیں', qualifications: 'اسناد', bloodGroups: 'بلڈ گروپ',
            relations: 'رشتے', nationalities: 'قومیت', cities: 'شہر'
        };
        var title = labels[category] || category;

        var overlay = document.createElement('div');
        overlay.id = 'ems-dict-manager';
        overlay.className = 'modal-overlay';
        overlay.style.display = 'flex';
        overlay.innerHTML =
            '<div class="modal-box" style="max-width:520px; text-align:right;">' +
            '<div style="display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #eef2f6; padding-bottom:10px;">' +
            '<h3 style="margin:0; color:var(--primary);"><i class="fas fa-list-check"></i> ' + esc(title) + ' کا انتظام</h3>' +
            '<button class="btn btn-danger" style="padding:5px 12px;" data-close="1"><i class="fas fa-times"></i></button></div>' +
            '<div style="display:flex; gap:8px; margin:14px 0;">' +
            '<input type="text" id="ems-dict-newval" class="input-control" placeholder="نیا اندراج لکھیں..." style="flex:1;">' +
            '<button class="btn btn-primary" id="ems-dict-addbtn"><i class="fas fa-plus"></i> شامل کریں</button></div>' +
            '<div id="ems-dict-list" style="max-height:320px; overflow-y:auto;"></div>' +
            '</div>';
        document.body.appendChild(overlay);

        function renderList() {
            var box = overlay.querySelector('#ems-dict-list');
            var list = md().getList(category);
            if (!list.length) { box.innerHTML = '<p style="text-align:center;color:#94a3b8;padding:14px;">فہرست خالی ہے</p>'; return; }
            box.innerHTML = list.map(function (v) {
                return '<div class="ems-dict-row" data-v="' + esc(v) + '">' +
                    '<span class="val">' + esc(v) + '</span>' +
                    '<span class="acts">' +
                    '<button class="btn btn-secondary" data-edit="' + esc(v) + '" title="ترمیم"><i class="fas fa-pen"></i></button>' +
                    '<button class="btn btn-danger" data-del="' + esc(v) + '" title="حذف"><i class="fas fa-trash"></i></button>' +
                    '</span></div>';
            }).join('');
        }
        renderList();

        function addVal() {
            var inp = overlay.querySelector('#ems-dict-newval');
            var v = (inp.value || '').trim();
            if (!v) return;
            if (md().add(category, v)) { inp.value = ''; renderList(); toast('شامل ہو گیا'); }
            else { toast('پہلے سے موجود ہے', 'warning'); }
        }

        overlay.querySelector('#ems-dict-addbtn').addEventListener('click', addVal);
        overlay.querySelector('#ems-dict-newval').addEventListener('keydown', function (e) { if (e.key === 'Enter') addVal(); });

        overlay.addEventListener('click', function (e) {
            if (e.target.closest('[data-close]') || e.target === overlay) { overlay.remove(); refreshInput(); return; }
            var ed = e.target.closest('[data-edit]');
            var dl = e.target.closest('[data-del]');
            if (ed) {
                var oldV = ed.getAttribute('data-edit');
                var nv = prompt('نیا نام:', oldV);
                if (nv && nv.trim() && nv.trim() !== oldV) { md().update(category, oldV, nv.trim()); renderList(); }
            } else if (dl) {
                var v = dl.getAttribute('data-del');
                if (confirm('"' + v + '" کو حذف کریں؟')) { md().remove(category, v); renderList(); }
            }
        });

        function refreshInput() {
            if (sourceInput) {
                var ev = new Event('input', { bubbles: true });
                sourceInput.dispatchEvent(ev);
            }
        }
        function toast(m, t) { if (global.showToast) global.showToast(m, t || 'success'); }
    }

    var registry = [];
    function upgrade(input) {
        if (!input || input._emsSmart) return;
        var category = input.getAttribute('data-ems-dict');
        if (!category) return;
        input._emsSmart = true;
        input.setAttribute('autocomplete', 'off');
        var allowManage = input.getAttribute('data-ems-manage') !== 'false';
        var api = buildDropdown(input, category, allowManage);
        registry.push({ input: input, category: category, api: api });
    }

    global.EmsUI = {
        smartField: function (input, opts) {
            opts = opts || {};
            if (typeof input === 'string') input = document.getElementById(input);
            if (!input) return;
            if (opts.category) input.setAttribute('data-ems-dict', opts.category);
            if (opts.allowManage === false) input.setAttribute('data-ems-manage', 'false');
            upgrade(input);
        },
        scan: function (root) {
            (root || document).querySelectorAll('[data-ems-dict]').forEach(upgrade);
        },
        openManager: openManager
    };

    function init() {
        global.EmsUI.scan();
        // ڈکشنری بدلنے پر کھلا dropdown ریفریش ہو
        if (md()) md().onChange(function () {
            if (openDropdown && openDropdown._wrap) {
                var inp = openDropdown._wrap.querySelector('[data-ems-dict]');
                if (inp) inp.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

})(window);
