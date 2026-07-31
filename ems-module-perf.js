// ============================================================================
// EMS Module Performance — tab guards, deferred work, shared UI helpers
// ============================================================================
(function (global) {
    'use strict';

    var DOM_PAGE_SIZE = 50;

    /** Safe init for lazy/deferred scripts — runs immediately if DOM already loaded. */
    global.emsRunWhenDomReady = function (fn) {
        if (typeof fn !== 'function') return;
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', fn, { once: true });
        } else {
            fn();
        }
    };

    global.emsGetDomPageSize = function () {
        return DOM_PAGE_SIZE;
    };

    global.emsIsModuleActive = function (modId) {
        if (!modId) return false;
        if (global._emsActiveModuleId && global._emsActiveModuleId !== modId) return false;
        var el = document.getElementById('module-' + modId);
        if (!el) return false;
        return el.classList.contains('active') && el.style.display !== 'none';
    };

    global.emsIsAdmissionModuleActive = function () {
        return global.emsIsModuleActive('admission');
    };

    global.emsIsAttendanceModuleActive = function () {
        return global.emsIsModuleActive('attendance');
    };

    global.emsIsDashboardModuleActive = function () {
        return global.emsIsModuleActive('dashboard');
    };

    global.emsIsComplaintsModuleActive = function () {
        return global.emsIsModuleActive('complaints');
    };

    global.emsIsExamsModuleActive = function () {
        return global.emsIsModuleActive('exams');
    };

    global.emsIsFinanceModuleActive = function () {
        return global.emsIsModuleActive('finance');
    };

    global.emsIsLedgerModuleActive = function () {
        return global.emsIsModuleActive('ledger');
    };

    global.emsDeferModuleWork = function (fn, opts) {
        opts = opts || {};
        if (typeof fn !== 'function') return;
        var run = function () {
            try { fn(); } catch (e) { console.error('[EMS] deferred module work failed', e); }
        };
        if (opts.idle && typeof global.requestIdleCallback === 'function') {
            global.requestIdleCallback(run, { timeout: opts.timeout || 200 });
            return;
        }
        if (typeof global.requestAnimationFrame === 'function') {
            global.requestAnimationFrame(function () {
                if (opts.idle && typeof global.requestIdleCallback === 'function') {
                    global.requestIdleCallback(run, { timeout: opts.timeout || 200 });
                } else {
                    setTimeout(run, 0);
                }
            });
            return;
        }
        setTimeout(run, 0);
    };

    global.emsCollectClasses = function () {
        if (typeof global.emsRegRepoCollectClasses === 'function') {
            return global.emsRegRepoCollectClasses();
        }
        return [];
    };

    global.emsReadRepoCacheGen = function () {
        if (typeof global.emsRegRepoGetCacheGeneration === 'function') {
            return global.emsRegRepoGetCacheGeneration();
        }
        return 0;
    };

    global.emsFillClassSelect = function (selectEl, opts) {
        if (!selectEl) return;
        opts = opts || {};
        var classes = global.emsCollectClasses();
        var current = selectEl.value;
        var first = opts.allLabel != null
            ? opts.allLabel
            : (selectEl.id && selectEl.id.indexOf('filter') >= 0 ? 'تمام درجات' : 'درجہ منتخب کریں...');
        var html = '<option value="">' + first + '</option>';
        classes.forEach(function (c) {
            html += '<option value="' + String(c).replace(/"/g, '&quot;') + '">' + c + '</option>';
        });
        selectEl.innerHTML = html;
        if (current) selectEl.value = current;
    };

    global.emsFillClassSelects = function (selector, opts) {
        document.querySelectorAll(selector).forEach(function (el) {
            global.emsFillClassSelect(el, opts);
        });
    };

    global.emsFillSelectOptions = function (selectEl, rows, opts) {
        if (!selectEl) return;
        opts = opts || {};
        var limit = opts.limit != null ? opts.limit : DOM_PAGE_SIZE;
        var current = selectEl.value;
        var placeholder = opts.placeholder || 'منتخب کریں...';
        var html = '<option value="">' + placeholder + '</option>';
        var list = Array.isArray(rows) ? rows : [];
        if (list.length > limit) list = list.slice(0, limit);
        list.forEach(function (row) {
            var val = row.value != null ? row.value : row.id;
            var label = row.label != null ? row.label : (row.name + (row.id ? ' (' + row.id + ')' : ''));
            html += '<option value="' + String(val).replace(/"/g, '&quot;') + '">' + label + '</option>';
        });
        if ((rows || []).length > limit) {
            html += '<option value="" disabled>… مزید ' + ((rows.length - limit) + ' ریکارڈ — درجہ/تلاش استعمال کریں') + '</option>';
        }
        selectEl.innerHTML = html;
        if (current) selectEl.value = current;
    };

    /** Class-first student select — never materialize full roster into DOM. */
    global.emsBindLazyStudentSelect = function (studentSelect, classSelect, opts) {
        if (!studentSelect || !classSelect || studentSelect._emsLazyBound) return;
        studentSelect._emsLazyBound = true;
        opts = opts || {};
        var limit = opts.limit || DOM_PAGE_SIZE;
        var placeholder = opts.placeholder || 'پہلے درجہ منتخب کریں…';

        function resetStudent(msg) {
            studentSelect.innerHTML = '<option value="">' + (msg || placeholder) + '</option>';
        }

        resetStudent();

        classSelect.addEventListener('change', function () {
            var cls = classSelect.value;
            if (!cls) {
                resetStudent();
                return;
            }
            resetStudent('لوڈ…');
            var chain = typeof global.emsFetchStudentsLocalFirst === 'function'
                ? global.emsFetchStudentsLocalFirst(cls)
                : Promise.resolve([]);
            chain.then(function (students) {
                if (opts.moduleActive && typeof opts.moduleActive === 'function' && !opts.moduleActive()) return;
                global.emsFillSelectOptions(studentSelect, (students || []).map(function (s) {
                    return { value: s.id, label: s.name + ' (' + s.id + ')' };
                }), { limit: limit, placeholder: 'طالب علم منتخب کریں…' });
            }).catch(function () {
                resetStudent('لوڈ ناکام');
            });
        });
    };

    global.emsBindLazyStaffSelect = function (selectEl, type, opts) {
        if (!selectEl || selectEl._emsStaffLazyLoaded) return;
        selectEl._emsStaffLazyLoaded = true;
        opts = opts || {};
        var limit = opts.limit || DOM_PAGE_SIZE;
        selectEl.innerHTML = '<option value="">…</option>';
        var chain = typeof global.emsFetchStaffLocalFirst === 'function'
            ? global.emsFetchStaffLocalFirst(type || 'teacher')
            : Promise.resolve([]);
        chain.then(function (staff) {
            if (opts.moduleActive && typeof opts.moduleActive === 'function' && !opts.moduleActive()) return;
            global.emsFillSelectOptions(selectEl, (staff || []).map(function (t) {
                return { value: opts.valueField === 'id' ? t.id : t.name, label: t.name + (t.id ? ' (' + t.id + ')' : '') };
            }), { limit: limit, placeholder: opts.placeholder || 'منتخب کریں…' });
        });
    };

    global.emsRenderDomPage = function (opts) {
        opts = opts || {};
        var rows = opts.rows || [];
        var total = opts.total != null ? opts.total : rows.length;
        var page = Math.max(1, opts.page || 1);
        var pageSize = opts.pageSize || DOM_PAGE_SIZE;
        var pages = Math.max(1, Math.ceil(total / pageSize));
        if (page > pages) page = pages;
        var start = (page - 1) * pageSize;
        var slice = rows.slice(start, start + pageSize);
        var tbody = opts.tbody;
        if (tbody) {
            tbody.innerHTML = '';
            slice.forEach(function (row, i) {
                var node = opts.renderRow(row, start + i);
                if (node) tbody.appendChild(node);
            });
        }
        if (typeof opts.renderPager === 'function') {
            opts.renderPager({ total: total, page: page, pages: pages, start: start, end: Math.min(start + pageSize, total) });
        }
        return { page: page, pages: pages, start: start, slice: slice };
    };

})(typeof window !== 'undefined' ? window : globalThis);
