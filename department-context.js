// ============================================================================
// EMS Department Context — Multi Branch / Multi Department (Phase A)
// Global academic department selector context; filtering in Phase B+.
// ============================================================================
(function (global) {
    'use strict';

    var STORAGE_KEY = 'ems_current_department';
    var DEFAULT_DEPARTMENT = 'boys_dars';
    var ALL_DEPARTMENTS = 'all';

    var DEPARTMENTS = {
        boys_dars: {
            id: 'boys_dars',
            label: 'Boys → Dars-e-Nizami',
            labelUr: 'طلبہ — درس نظامی',
            gender: 'boys',
            track: 'dars'
        },
        boys_hifz: {
            id: 'boys_hifz',
            label: 'Boys → Hifz',
            labelUr: 'طلبہ — حفظ',
            gender: 'boys',
            track: 'hifz'
        },
        girls_dars: {
            id: 'girls_dars',
            label: 'Girls → Dars-e-Nizami',
            labelUr: 'طالبات — درس نظامی',
            gender: 'girls',
            track: 'dars'
        },
        girls_hifz: {
            id: 'girls_hifz',
            label: 'Girls → Hifz',
            labelUr: 'طالبات — حفظ',
            gender: 'girls',
            track: 'hifz'
        }
    };

    /** Modules that will filter by departmentId in Phase B */
    var DEPARTMENT_SCOPED_MODULES = [
        'dashboard', 'admission', 'attendance', 'exams', 'complaints', 'training',
        'curriculum', 'library', 'student-profiles', 'parent-portal'
    ];

    /** Institution-wide modules — no automatic filter (Phase C optional filter) */
    var GLOBAL_MODULES = [
        'finance', 'ledger', 'announcements', 'sys-settings', 'admin-panel', 'superadmin'
    ];

    function isValidDepartmentId(id) {
        return !!DEPARTMENTS[id];
    }

    function readStoredDepartment() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (raw && isValidDepartmentId(raw)) return raw;
        } catch (e) { /* ignore */ }
        return DEFAULT_DEPARTMENT;
    }

    function persistDepartment(id) {
        try { localStorage.setItem(STORAGE_KEY, id); } catch (e) { /* ignore */ }
    }

    function applyDepartment(id, options) {
        options = options || {};
        if (!isValidDepartmentId(id)) id = DEFAULT_DEPARTMENT;
        global.EMS_CURRENT_DEPARTMENT = id;
        if (options.persist !== false) persistDepartment(id);
        if (options.silent !== true) {
            try {
                global.dispatchEvent(new CustomEvent('ems:department-changed', {
                    detail: { departmentId: id, meta: DEPARTMENTS[id] }
                }));
            } catch (e) { /* ignore */ }
        }
        return DEPARTMENTS[id];
    }

    global.emsInitDepartmentContext = function () {
        return applyDepartment(readStoredDepartment(), { persist: false, silent: true });
    };

    global.emsGetDepartmentId = function () {
        if (global.EMS_CURRENT_DEPARTMENT && isValidDepartmentId(global.EMS_CURRENT_DEPARTMENT)) {
            return global.EMS_CURRENT_DEPARTMENT;
        }
        return readStoredDepartment();
    };

    global.emsGetDepartment = function () {
        var id = global.emsGetDepartmentId();
        return DEPARTMENTS[id] || DEPARTMENTS[DEFAULT_DEPARTMENT];
    };

    global.emsListDepartments = function () {
        return Object.keys(DEPARTMENTS).map(function (k) { return DEPARTMENTS[k]; });
    };

    global.emsSetDepartment = function (id) {
        if (!isValidDepartmentId(id)) {
            return Promise.reject(new Error('غلط شعبہ: ' + id));
        }
        var meta = applyDepartment(id, { persist: true, silent: false });
        if (typeof global.showToast === 'function') {
            global.showToast('شعبہ: ' + (meta.labelUr || meta.label), 'success');
        }
        return Promise.resolve(meta);
    };

    global.emsGetDepartmentLabel = function (id) {
        var d = DEPARTMENTS[id || global.emsGetDepartmentId()];
        return d ? (d.labelUr || d.label) : '';
    };

    global.emsIsDepartmentScopedModule = function (moduleId) {
        return DEPARTMENT_SCOPED_MODULES.indexOf(moduleId) >= 0;
    };

    global.emsIsGlobalModule = function (moduleId) {
        return GLOBAL_MODULES.indexOf(moduleId) >= 0;
    };

    /** Phase B helper — resolve departmentId on records (no migration yet) */
    global.emsResolveRecordDepartmentId = function (record) {
        if (record && record.departmentId && record.departmentId !== ALL_DEPARTMENTS) {
            return record.departmentId;
        }
        return DEFAULT_DEPARTMENT;
    };

    /** Phase B helper — match record to active department */
    global.emsRecordMatchesDepartment = function (record, departmentId) {
        departmentId = departmentId || global.emsGetDepartmentId();
        if (!record) return false;
        // Legacy / unscoped rows (no explicit departmentId) appear in every department view
        if (!record.departmentId || record.departmentId === ALL_DEPARTMENTS) {
            return true;
        }
        return record.departmentId === departmentId;
    };

    /** Phase B — display-only filter (full data stays in storage) */
    global.emsFilterByDepartment = function (records, departmentId) {
        if (!Array.isArray(records)) return records;
        return records.filter(function (r) {
            return global.emsRecordMatchesDepartment(r, departmentId);
        });
    };

    /** Phase B — stamp current department on new/edited records */
    global.emsStampDepartment = function (record, departmentId) {
        if (!record || typeof record !== 'object') return record;
        if (!record.departmentId) {
            record.departmentId = departmentId || global.emsGetDepartmentId();
        }
        return record;
    };

    var _deptRefreshHandlers = {};

    global.emsRegisterDepartmentRefresh = function (moduleId, fn) {
        if (typeof fn !== 'function') return;
        _deptRefreshHandlers[moduleId] = fn;
    };

    var _deptRefreshTimer = null;

    global.emsRefreshDepartmentModules = function () {
        if (_deptRefreshTimer) clearTimeout(_deptRefreshTimer);
        _deptRefreshTimer = setTimeout(function () {
            _deptRefreshTimer = null;
            Object.keys(_deptRefreshHandlers).forEach(function (id) {
                try { _deptRefreshHandlers[id](); } catch (e) {
                    console.warn('[EMS dept] refresh failed:', id, e);
                }
            });
        }, 200);
    };

    var OPT_FILTER_PREFIX = 'ems_opt_dept_filter_';

    /** Phase C — optional dept filter for institution-wide modules (default OFF) */
    global.emsIsOptionalDeptFilterOn = function (moduleId) {
        try {
            return localStorage.getItem(OPT_FILTER_PREFIX + moduleId) === '1';
        } catch (e) { return false; }
    };

    global.emsSetOptionalDeptFilter = function (moduleId, on) {
        try {
            localStorage.setItem(OPT_FILTER_PREFIX + moduleId, on ? '1' : '0');
        } catch (e) { /* ignore */ }
        try {
            global.dispatchEvent(new CustomEvent('ems:dept-opt-filter-changed', {
                detail: { moduleId: moduleId, enabled: !!on }
            }));
        } catch (e) { /* ignore */ }
    };

    global.emsIsInstitutionWideRecord = function (record) {
        if (!record) return false;
        if (record.departmentId === ALL_DEPARTMENTS) return true;
        if (record.audience === 'all' && (!record.departmentId || record.departmentId === ALL_DEPARTMENTS)) {
            return true;
        }
        return false;
    };

    global.emsApplyOptionalDeptFilter = function (records, moduleId) {
        if (!Array.isArray(records)) return records;
        if (!global.emsIsOptionalDeptFilterOn(moduleId)) return records;
        return records.filter(function (r) {
            if (moduleId === 'announcements' && global.emsIsInstitutionWideRecord(r)) return true;
            if (moduleId === 'ledger' && !r.departmentId) return true;
            return global.emsRecordMatchesDepartment(r);
        });
    };

    global.emsFilterCollectionsByStudentDept = function (collections, users, moduleId) {
        if (!Array.isArray(collections)) return collections;
        moduleId = moduleId || 'finance';
        if (!global.emsIsOptionalDeptFilterOn(moduleId)) return collections;
        var userMap = {};
        (users || []).forEach(function (u) { if (u && u.id) userMap[u.id] = u; });
        return collections.filter(function (c) {
            var std = userMap[c.studentId];
            if (!std) return global.emsRecordMatchesDepartment(c);
            return global.emsRecordMatchesDepartment(std);
        });
    };

    global.emsMountOptionalDeptFilter = function (mountId, moduleId, onChange) {
        var el = document.getElementById(mountId);
        if (!el) return;
        var checked = global.emsIsOptionalDeptFilterOn(moduleId);
        var label = global.emsGetDepartmentLabel();
        el.innerHTML = '<label class="ems-opt-dept-filter-bar">' +
            '<input type="checkbox" id="ems-opt-dept-' + moduleId + '"' + (checked ? ' checked' : '') + '>' +
            '<span>صرف موجودہ شعبہ' + (label ? ' (' + label + ')' : '') + '</span>' +
            '</label>';
        var cb = document.getElementById('ems-opt-dept-' + moduleId);
        if (cb && !cb._emsOptBound) {
            cb._emsOptBound = true;
            cb.addEventListener('change', function () {
                global.emsSetOptionalDeptFilter(moduleId, cb.checked);
                if (typeof onChange === 'function') onChange(cb.checked);
            });
        } else if (cb) {
            cb.checked = checked;
        }
    };

    /** Phase D — infer departmentId from legacy record fields */
    global.emsInferDepartmentId = function (record, defaultId) {
        defaultId = defaultId || DEFAULT_DEPARTMENT;
        if (!record || typeof record !== 'object') return defaultId;
        if (record.departmentId && record.departmentId !== ALL_DEPARTMENTS && isValidDepartmentId(record.departmentId)) {
            return record.departmentId;
        }
        if (record.audience === 'all') return ALL_DEPARTMENTS;
        var blob = [
            record.branch, record.gender, record.resType, record.class,
            record.dept, record.designation, record.type, record.category
        ].join(' ').toLowerCase();
        var isGirls = /girl|طالبات|female|خواتین|banat|bnat|بنات|staff_female|talibat/i.test(blob);
        var isHifz = /hifz|حفظ|huffaz|حافظ|\bhif\b/i.test(blob);
        if (isGirls) return isHifz ? 'girls_hifz' : 'girls_dars';
        if (isHifz) return 'boys_hifz';
        return defaultId;
    };

    global.emsRecordNeedsDepartmentMigration = function (record) {
        if (!record || typeof record !== 'object') return false;
        if (!record.departmentId) return true;
        if (record.departmentId === ALL_DEPARTMENTS) return false;
        return !isValidDepartmentId(record.departmentId);
    };

    global.EMS_DEPARTMENT_DEFAULT = DEFAULT_DEPARTMENT;
    global.EMS_DEPARTMENT_ALL = ALL_DEPARTMENTS;
    global.EMS_DEPARTMENT_REGISTRY = DEPARTMENTS;
    global.EMS_DEPARTMENT_SCOPED_MODULES = DEPARTMENT_SCOPED_MODULES;
    global.EMS_DEPARTMENT_GLOBAL_MODULES = GLOBAL_MODULES;

    global.emsInitDepartmentContext();

    global.addEventListener('ems:department-changed', function () {
        global.emsRefreshDepartmentModules();
    });

})(window);
