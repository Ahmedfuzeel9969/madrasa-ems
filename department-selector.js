// ============================================================================
// EMS Department Selector UI — ribbon bar + three-dot menu (Phase A)
// ============================================================================
(function (global) {
    'use strict';

    function $(id) { return document.getElementById(id); }

    function closeMenu() {
        var menu = $('ems-dept-menu');
        if (menu) menu.classList.remove('open');
    }

    function syncSelectValue(id) {
        var sel = $('ems-dept-select');
        if (sel && id) sel.value = id;
        var badge = $('ems-dept-badge');
        if (badge && typeof global.emsGetDepartmentLabel === 'function') {
            badge.textContent = global.emsGetDepartmentLabel(id);
        }
        document.querySelectorAll('.ems-dept-menu-item').forEach(function (btn) {
            btn.classList.toggle('active', btn.getAttribute('data-dept') === id);
        });
    }

    function onDepartmentPick(id) {
        if (typeof global.emsSetDepartment !== 'function') return;
        global.emsSetDepartment(id).then(function () {
            syncSelectValue(id);
            closeMenu();
        }).catch(function () { /* toast inside emsSetDepartment */ });
    }

    global.emsRenderDepartmentSelector = function () {
        var wrap = $('ems-dept-selector-wrap');
        if (!wrap || typeof global.emsListDepartments !== 'function') return;

        var list = global.emsListDepartments();
        var current = global.emsGetDepartmentId ? global.emsGetDepartmentId() : 'boys_dars';

        var sel = $('ems-dept-select');
        if (sel) {
            sel.innerHTML = list.map(function (d) {
                return '<option value="' + d.id + '">' + (d.labelUr || d.label) + '</option>';
            }).join('');
            sel.value = current;
        }

        var menu = $('ems-dept-menu');
        if (menu) {
            menu.innerHTML = list.map(function (d) {
                return '<button type="button" class="ems-dept-menu-item" data-dept="' + d.id + '" onclick="window.emsPickDepartment(\'' + d.id + '\')">' +
                    '<span>' + (d.labelUr || d.label) + '</span>' +
                    '<small>' + d.label + '</small></button>';
            }).join('');
        }

        syncSelectValue(current);
    };

    global.emsPickDepartment = function (id) {
        onDepartmentPick(id);
    };

    global.emsToggleDepartmentMenu = function () {
        var menu = $('ems-dept-menu');
        if (!menu) return;
        menu.classList.toggle('open');
    };

    function bindEvents() {
        var sel = $('ems-dept-select');
        if (sel && !sel._emsDeptBound) {
            sel._emsDeptBound = true;
            sel.addEventListener('change', function () {
                onDepartmentPick(sel.value);
            });
        }

        var moreBtn = $('ems-dept-more-btn');
        if (moreBtn && !moreBtn._emsDeptBound) {
            moreBtn._emsDeptBound = true;
            moreBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                global.emsToggleDepartmentMenu();
            });
        }

        if (!document._emsDeptDocBound) {
            document._emsDeptDocBound = true;
            document.addEventListener('click', function () { closeMenu(); });
            global.addEventListener('ems:department-changed', function (e) {
                if (e.detail && e.detail.departmentId) syncSelectValue(e.detail.departmentId);
            });
        }
    }

    function init() {
        if (typeof global.emsInitDepartmentContext === 'function') {
            global.emsInitDepartmentContext();
        }
        global.emsRenderDepartmentSelector();
        bindEvents();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})(window);
