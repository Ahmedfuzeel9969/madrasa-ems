// ============================================================================
// EMS Registration Permissions — Sprint 5 (fine-grained client guards)
// ============================================================================
(function (global) {
    'use strict';

    var MODULE = 'admission';
    var CACHE_KEY = 'ems_reg_perm_snapshot_v1';

    /** Registration-specific actions (public API). */
    var REG_ACTIONS = [
        'view', 'create', 'edit', 'delete', 'print', 'export', 'import',
        'approve', 'reject', 'duplicate_override', 'audit_view'
    ];

    /** Bridge to Admin Panel action IDs (backward compatible). */
    var ADMIN_BRIDGE = {
        view: 'view',
        create: 'create',
        edit: 'edit',
        delete: 'delete',
        print: 'print',
        export: 'export',
        import: 'import',
        approve: 'approve1',
        reject: 'edit',
        duplicate_override: 'approve1',
        audit_view: 'view'
    };

    /** Default matrix when role template applies but action not explicitly set. */
    var ROLE_DEFAULTS = {
        owner: null,
        admin: null,
        teacher: {
            view: true, print: true
        },
        staff: {
            view: true, create: true, edit: true, print: true
        },
        parent: {},
        viewer: { view: true }
    };

    var TAB_PERM = [
        { panel: 'reg-dashboard-panel', anyOf: ['view'] },
        { panel: 'reg-student-panel', anyOf: ['create', 'edit'] },
        { panel: 'reg-teacher-panel', anyOf: ['create', 'edit'] },
        { panel: 'reg-staff-panel', anyOf: ['create', 'edit'] },
        { panel: 'reg-branding-panel', anyOf: ['edit'], ownerOnly: true },
        { panel: 'reg-list-panel', anyOf: ['view'] },
        { panel: 'reg-rejected-panel', anyOf: ['view'] },
        { panel: 'reg-data-panel', anyOf: ['import', 'export'] }
    ];

    var ID_PERM = {
        'btn-stu-approve': 'approve',
        'btn-tch-approve': 'approve',
        'btn-stf-approve': 'approve',
        'btn-stu-reject': 'reject',
        'btn-tch-reject': 'reject',
        'btn-stf-reject': 'reject',
        'btn-stu-cancel-edit': 'edit',
        'btn-tch-cancel-edit': 'edit',
        'btn-stf-cancel-edit': 'edit'
    };

    function readJson(key) {
        try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
    }

    function writeJson(key, val) {
        try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* ignore */ }
    }

    function getStaffId() {
        if (typeof global.emsGetStaffIdForAccess === 'function') {
            var sid = global.emsGetStaffIdForAccess();
            if (sid) return sid;
        }
        if (typeof global.emsGetStaffRecordForCurrentUser === 'function') {
            var rec = global.emsGetStaffRecordForCurrentUser();
            if (rec && rec.id) return rec.id;
        }
        return null;
    }

    function isOwnerOrAdmin() {
        if (global.isSuperAdmin && global.isSuperAdmin()) return true;
        if (global.isMadrasaAdmin && global.isMadrasaAdmin()) return true;
        if (global.emsIsStaffUser && !global.emsIsStaffUser()) return true;
        return false;
    }

    function isParentUser() {
        return global.CURRENT_USER_TENANT_ROLE === 'parent';
    }

    global.emsRegGetRole = function () {
        if (global.isSuperAdmin && global.isSuperAdmin()) return 'owner';
        if (global.isMadrasaAdmin && global.isMadrasaAdmin()) return 'admin';
        if (isParentUser()) return 'parent';
        if (global.emsIsStaffUser && global.emsIsStaffUser()) {
            var staff = typeof global.emsGetStaffRecordForCurrentUser === 'function'
                ? global.emsGetStaffRecordForCurrentUser()
                : null;
            if (staff && staff.templateId === 'teacher') return 'teacher';
            if (staff && staff.type === 'teacher') return 'teacher';
            return 'staff';
        }
        if (global.CURRENT_MADRASA_DATA) return 'owner';
        return 'viewer';
    };

    global.emsRegRefreshPermCache = function () {
        var staffId = getStaffId();
        if (!staffId || typeof global.apGetStaffPerm !== 'function') {
            writeJson(CACHE_KEY, { staffId: staffId || null, perm: null, ts: Date.now(), role: global.emsRegGetRole() });
            return;
        }
        writeJson(CACHE_KEY, {
            staffId: staffId,
            perm: global.apGetStaffPerm(staffId),
            ts: Date.now(),
            role: global.emsRegGetRole()
        });
    };

    function getCachedPerm() {
        var snap = readJson(CACHE_KEY);
        if (!snap) return null;
        var staffId = getStaffId();
        if (staffId && snap.staffId && snap.staffId !== staffId) return null;
        return snap.perm || null;
    }

    function staffCanAdminAction(actionId) {
        var bridged = ADMIN_BRIDGE[actionId] || actionId;
        if (typeof global.checkStaffModuleAccess === 'function') {
            if (global.checkStaffModuleAccess(MODULE, bridged)) return true;
        }
        var staffId = getStaffId();
        if (staffId && typeof global.staffCanDo === 'function') {
            if (global.staffCanDo(staffId, MODULE, bridged)) return true;
        }
        var perm = getCachedPerm();
        if (perm && perm.modules && perm.modules[MODULE]) {
            if (perm.actions && perm.actions[MODULE] && perm.actions[MODULE][bridged]) return true;
        }
        return false;
    }

    function roleDefaultAllows(action) {
        var role = global.emsRegGetRole();
        if (role === 'owner' || role === 'admin') return true;
        if (role === 'parent') return false;
        var defs = ROLE_DEFAULTS[role];
        if (!defs) return false;
        return !!defs[action];
    }

    global.emsRegCanWriteSsot = function () {
        if (isParentUser()) return false;
        return isOwnerOrAdmin();
    };

    global.emsRegCanDraftWrite = function (editingId) {
        if (isParentUser()) return false;
        if (isOwnerOrAdmin()) return true;
        if (editingId) return global.emsRegCan('edit');
        return global.emsRegCan('create') || global.emsRegCan('edit');
    };

    global.emsRegCan = function (action) {
        action = String(action || '').trim();
        if (REG_ACTIONS.indexOf(action) < 0) return false;
        if (isParentUser()) return false;
        if (isOwnerOrAdmin()) return true;

        if (action === 'duplicate_override') {
            return staffCanAdminAction('duplicate_override') || staffCanAdminAction('approve');
        }
        if (action === 'audit_view') {
            if (staffCanAdminAction('audit_view')) return true;
            return roleDefaultAllows('view') && staffCanAdminAction('view');
        }
        if (action === 'approve' || action === 'reject') {
            return global.emsRegCanWriteSsot();
        }
        if (staffCanAdminAction(action)) return true;
        return roleDefaultAllows(action);
    };

    global.emsRegRequire = function (action, context) {
        if (global.emsRegCan(action)) return true;
        var msg = 'رجسٹریشن: اس عمل کی اجازت نہیں (' + action + ')';
        if (typeof global.showToast === 'function') global.showToast(msg, 'error');
        else if (typeof global.showTopAlert === 'function') global.showTopAlert('🚫 ' + msg, true);
        else if (typeof global.alert === 'function') global.alert(msg);
        if (typeof global.emsLogSecurityEvent === 'function') {
            global.emsLogSecurityEvent('reg_permission_denied', {
                action: action,
                role: global.emsRegGetRole(),
                context: context || null
            });
        }
        return false;
    };

    global.emsRegPermForSave = function (status, currentEditingId, isEditingRejected) {
        if (status === 'rejected') return 'reject';
        if (status === 'approved') {
            if (isEditingRejected && currentEditingId) return 'approve';
            if (!currentEditingId) return 'create';
            return 'edit';
        }
        return 'edit';
    };

    global.emsRegRequireSsotSave = function (status, currentEditingId, isEditingRejected) {
        if (status === 'approved' || status === 'rejected') {
            if (!global.emsRegCanWriteSsot()) {
                var ssotMsg = 'صرف منتظم/مالک مستقل ریکارڈ میں محفوظ کر سکتے ہیں۔ براہ کرم ڈرافٹ محفوظ کریں۔';
                if (typeof global.showToast === 'function') global.showToast(ssotMsg, 'error');
                else if (typeof global.showTopAlert === 'function') global.showTopAlert('🚫 ' + ssotMsg, true);
                else if (typeof global.alert === 'function') global.alert(ssotMsg);
                if (typeof global.emsLogSecurityEvent === 'function') {
                    global.emsLogSecurityEvent('reg_ssot_write_denied', {
                        status: status,
                        role: global.emsRegGetRole(),
                        editingId: currentEditingId || null
                    });
                }
                return false;
            }
        }
        var action = global.emsRegPermForSave(status, currentEditingId, isEditingRejected);
        if (typeof global.emsRegRequire === 'function') {
            return global.emsRegRequire(action, {
                status: status,
                editingId: currentEditingId,
                ssot: true
            });
        }
        return global.emsRegCan(action);
    };

    function setElPerm(el, allowed) {
        if (!el) return;
        if (allowed) {
            el.style.display = '';
            el.disabled = false;
            el.removeAttribute('aria-hidden');
            el.classList.remove('reg-perm-hidden');
        } else {
            el.style.display = 'none';
            el.disabled = true;
            el.setAttribute('aria-hidden', 'true');
            el.classList.add('reg-perm-hidden');
        }
    }

    function tabButtonForPanel(panelId) {
        var menu = document.getElementById('reg-ribbon-menu');
        if (!menu) return null;
        var btns = menu.querySelectorAll('.reg-tab');
        for (var i = 0; i < btns.length; i++) {
            var oc = btns[i].getAttribute('onclick') || '';
            if (oc.indexOf("'" + panelId + "'") >= 0 || oc.indexOf('"' + panelId + '"') >= 0) {
                return btns[i];
            }
        }
        return null;
    }

    function anyPerm(list) {
        for (var i = 0; i < list.length; i++) {
            if (global.emsRegCan(list[i])) return true;
        }
        return false;
    }

    global.emsRegGuardUI = function (root) {
        root = root || document.getElementById('module-admission');
        if (!root) return;

        root.querySelectorAll('[data-reg-perm]').forEach(function (el) {
            setElPerm(el, global.emsRegCan(el.getAttribute('data-reg-perm')));
        });

        Object.keys(ID_PERM).forEach(function (id) {
            setElPerm(document.getElementById(id), global.emsRegCan(ID_PERM[id]));
        });

        TAB_PERM.forEach(function (cfg) {
            var allowed = cfg.ownerOnly
                ? (global.emsRegGetRole() === 'owner' || global.emsRegGetRole() === 'admin')
                : anyPerm(cfg.anyOf);
            setElPerm(tabButtonForPanel(cfg.panel), allowed);
            if (!allowed) {
                var panel = document.getElementById(cfg.panel);
                if (panel && panel.style.display !== 'none') {
                    panel.style.display = 'none';
                }
            }
        });

        root.querySelectorAll('#reg-data-panel button[onclick*="emsDoExport"]').forEach(function (btn) {
            setElPerm(btn, global.emsRegCan('export'));
        });
        setElPerm(document.getElementById('legacy-import-panel'), global.emsRegCan('import'));
        setElPerm(document.getElementById('smart-import-panel'), global.emsRegCan('import'));
        setElPerm(document.getElementById('import-history-card'), global.emsRegCan('import'));

        global.emsRegApplyTableActionGuards(root);
    };

    global.emsRegApplyTableActionGuards = function (root) {
        root = root || document.getElementById('module-admission');
        if (!root) return;
        root.querySelectorAll('[data-reg-perm]').forEach(function (el) {
            setElPerm(el, global.emsRegCan(el.getAttribute('data-reg-perm')));
        });
    };

    global.emsRegWrapProtected = function (fn, action, ctx) {
        return function () {
            if (!global.emsRegRequire(action, ctx)) return undefined;
            return fn.apply(this, arguments);
        };
    };

    try {
        global.addEventListener('ems:post-auth-ready', function () {
            global.emsRegRefreshPermCache();
            global.emsRegGuardUI();
        });
    } catch (e1) { /* ignore */ }

    try {
        global.addEventListener('ems:staff-permissions-changed', function () {
            global.emsRegRefreshPermCache();
            global.emsRegGuardUI();
        });
    } catch (e2) { /* ignore */ }

})(typeof window !== 'undefined' ? window : globalThis);
