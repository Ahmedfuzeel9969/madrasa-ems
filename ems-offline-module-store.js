// ============================================================================
// EMS Offline Module Store — durable IDB hydrate via emsCacheGet (no cloud)
// ============================================================================
(function (global) {
    'use strict';

    var MODULE_GROUPS = {
        Exams: ['ems_full_exams', 'ems_exam_types', 'ems_library_books', 'ems_exam_templates', 'ems_exam_locks', 'ems_master_sheet_meta'],
        Curriculum: ['ems_curriculum_plans', 'ems_curriculum_daily', 'ems_curriculum_settings', 'ems_curriculum_audit'],
        Training: ['ems_tar_prayer', 'ems_tar_ethics', 'ems_tar_discipline', 'ems_tar_reform', 'ems_tar_awards', 'ems_tar_warnings', 'ems_tar_settings', 'ems_tar_audit'],
        Finance: ['ems_fee_categories', 'ems_class_fee_structure', 'ems_student_fee_setup', 'ems_fee_collections', 'ems_fee_bills'],
        Ledger: ['ems_full_ledger', 'ems_ledger_master_categories', 'ems_ledger_blackouts', 'ems_payroll_history', 'ems_full_salary', 'ems_ledger_funds', 'ems_ledger_budgets', 'ems_ledger_audit_log', 'ems_ledger_settings', 'ems_ledger_liabilities', 'ems_ledger_employee_dues', 'ems_payroll_special', 'ems_ledger_archive'],
        Announcements: ['ems_announcements', 'ems_full_announcements', 'ems_ann_categories', 'ems_ann_programs', 'ems_ann_poster_templates', 'ems_ann_audit_log', 'ems_ann_settings', 'ems_ann_groups'],
        SystemSettings: ['ems_sys_config_v2', 'ems_sys_profiles', 'ems_sys_settings_audit', 'ems_sys_dict', 'ems_custom_buttons', 'ems_btn_action_toggles', 'ems_custom_fields', 'ems_field_visibility', 'ems_layout_config', 'ems_sys_permissions', 'ems_sys_auto_rules', 'ems_custom_reports', 'ems_custom_dashboard', 'ems_custom_form_templates']
    };

    function keysForGroup(groupName) {
        return MODULE_GROUPS[groupName] || [];
    }

    function collectAllModuleKeys() {
        var keys = [];
        Object.keys(MODULE_GROUPS).forEach(function (g) {
            keys = keys.concat(MODULE_GROUPS[g]);
        });
        return keys;
    }

    function hydrateKeys(keys) {
        keys = keys || [];
        var hydrated = 0;
        keys.forEach(function (key) {
            if (typeof global.emsCacheGet === 'function') {
                var val = global.emsCacheGet(key, null);
                if (val != null) hydrated++;
            }
        });
        return Promise.resolve({ hydrated: hydrated, keys: keys.length, source: 'durable_idb' });
    }

    global.emsOfflineModuleStoreHydrateGroup = function (groupName) {
        var keys = keysForGroup(groupName);
        return hydrateKeys(keys).then(function (res) {
            return Object.assign({ group: groupName }, res);
        });
    };

    global.emsOfflineModuleStoreHydrateAll = function (tenantId) {
        if (tenantId && typeof global.emsActivateTenantStorage === 'function') {
            global.emsActivateTenantStorage(tenantId);
        }
        return hydrateKeys(collectAllModuleKeys()).then(function (res) {
            return Object.assign({ tenantId: tenantId || null }, res);
        });
    };
})(typeof window !== 'undefined' ? window : globalThis);
