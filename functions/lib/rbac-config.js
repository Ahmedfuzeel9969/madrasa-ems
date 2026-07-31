/**
 * ============================================================================
 * Shared RBAC Configuration (Roles + Granular Permissions)
 * ----------------------------------------------------------------------------
 * MUST stay IDENTICAL to /sa/rbac-config.js (client copy).
 * Single source of truth for roles and permissions across the platform.
 * ============================================================================
 */
(function (root, factory) {
    var RBAC = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = RBAC;
    }
    if (typeof window !== 'undefined') {
        window.RBAC = RBAC;
    }
})(this, function () {
    'use strict';

    var PERMISSIONS = {
        'dashboard.view': 'ڈیش بورڈ دیکھیں',
        'users.view': 'صارفین دیکھیں',
        'users.create': 'صارف بنائیں',
        'users.edit': 'صارف میں ترمیم',
        'users.delete': 'صارف حذف',
        'users.activate': 'صارف فعال کریں',
        'users.suspend': 'صارف معطل کریں',
        'users.ban': 'صارف بین کریں',
        'users.restore': 'صارف بحال کریں',
        'users.force_logout': 'تمام سیشن بند کریں',
        'users.bulk': 'بلک آپریشن',
        'rbac.view': 'کردار دیکھیں',
        'rbac.assign': 'کردار تفویض',
        'rbac.manage': 'کردار/اجازت بنائیں و ترمیم',
        'modules.view': 'ماڈیول رسائی دیکھیں',
        'modules.manage': 'ماڈیول رسائی کنٹرول',
        'subscriptions.view': 'سبسکرپشن دیکھیں',
        'subscriptions.manage': 'سبسکرپشن کنٹرول',
        'payments.view': 'ادائیگیاں دیکھیں',
        'payments.manage': 'ادائیگیاں منظم',
        'payments.refund': 'ریفنڈ',
        'security.view': 'سیکیورٹی سینٹر دیکھیں',
        'security.manage': 'سیکیورٹی کنٹرول (force logout, lock)',
        'audit.view': 'آڈٹ لاگ دیکھیں',
        'audit.export': 'آڈٹ ایکسپورٹ',
        'notifications.view': 'نوٹیفیکیشن دیکھیں',
        'notifications.send': 'نوٹیفیکیشن/اعلان بھیجیں',
        'content.view': 'مواد دیکھیں',
        'content.manage': 'مواد منظم',
        'analytics.view': 'تجزیات دیکھیں',
        'analytics.export': 'رپورٹ ایکسپورٹ',
        'config.view': 'سسٹم سیٹنگز دیکھیں',
        'config.manage': 'سسٹم سیٹنگز ترمیم',
        'backup.view': 'بیک اپ دیکھیں',
        'backup.manage': 'بیک اپ/ری اسٹور',
        'licenses.view': 'لائسنس دیکھیں',
        'licenses.manage': 'لائسنس منظم',
        'devconsole.view': 'ڈیولپر کنسول',
        'ai.assistant.use': 'AI مشیر استعمال'
    };

    var ALL_PERMISSION_IDS = Object.keys(PERMISSIONS);

    var ROLES = {
        super_admin: {
            id: 'super_admin', name: 'Super Admin', nameUr: 'سپر ایڈمن',
            level: 0, isSystem: true, permissions: ['*']
        },
        admin: {
            id: 'admin', name: 'Admin', nameUr: 'ایڈمن',
            level: 10, isSystem: true,
            permissions: [
                'dashboard.view',
                'users.view', 'users.create', 'users.edit', 'users.activate',
                'users.suspend', 'users.restore', 'users.bulk',
                'rbac.view', 'rbac.assign',
                'modules.view', 'modules.manage',
                'subscriptions.view', 'subscriptions.manage',
                'payments.view', 'payments.manage',
                'security.view', 'security.manage',
                'audit.view', 'audit.export',
                'notifications.view', 'notifications.send',
                'content.view', 'content.manage',
                'analytics.view', 'analytics.export',
                'config.view', 'backup.view', 'licenses.view',
                'ai.assistant.use'
            ]
        },
        manager: {
            id: 'manager', name: 'Manager', nameUr: 'مینیجر',
            level: 20, isSystem: true,
            permissions: [
                'dashboard.view',
                'users.view', 'users.create', 'users.edit', 'users.activate', 'users.suspend',
                'modules.view', 'subscriptions.view', 'payments.view',
                'audit.view', 'notifications.view', 'notifications.send',
                'content.view', 'content.manage', 'analytics.view'
            ]
        },
        moderator: {
            id: 'moderator', name: 'Moderator', nameUr: 'موڈریٹر',
            level: 30, isSystem: true,
            permissions: [
                'dashboard.view', 'users.view', 'users.suspend',
                'content.view', 'content.manage',
                'notifications.view', 'notifications.send', 'audit.view'
            ]
        },
        editor: {
            id: 'editor', name: 'Editor', nameUr: 'ایڈیٹر',
            level: 40, isSystem: true,
            permissions: ['dashboard.view', 'content.view', 'content.manage', 'notifications.view']
        },
        accountant: {
            id: 'accountant', name: 'Accountant', nameUr: 'محاسب',
            level: 40, isSystem: true,
            permissions: [
                'dashboard.view', 'subscriptions.view',
                'payments.view', 'payments.manage', 'payments.refund',
                'analytics.view', 'analytics.export', 'audit.view'
            ]
        },
        teacher: {
            id: 'teacher', name: 'Teacher', nameUr: 'استاد',
            level: 50, isSystem: true, permissions: ['dashboard.view', 'ai.assistant.use']
        },
        student: {
            id: 'student', name: 'Student', nameUr: 'طالبِ علم',
            level: 60, isSystem: true, permissions: ['dashboard.view']
        }
    };

    function resolvePermissions(roleIds) {
        var result = {};
        var list = Array.isArray(roleIds) ? roleIds : [roleIds];
        for (var i = 0; i < list.length; i++) {
            var role = ROLES[list[i]];
            if (!role) continue;
            if (role.permissions.indexOf('*') !== -1) {
                for (var k = 0; k < ALL_PERMISSION_IDS.length; k++) {
                    result[ALL_PERMISSION_IDS[k]] = true;
                }
                result['*'] = true;
                continue;
            }
            for (var j = 0; j < role.permissions.length; j++) {
                result[role.permissions[j]] = true;
            }
        }
        return result;
    }

    function hasPermission(roleIds, permissionId) {
        var perms = resolvePermissions(roleIds);
        return perms['*'] === true || perms[permissionId] === true;
    }

    return {
        PERMISSIONS: PERMISSIONS,
        ALL_PERMISSION_IDS: ALL_PERMISSION_IDS,
        ROLES: ROLES,
        DEFAULT_ROLE: 'student',
        resolvePermissions: resolvePermissions,
        hasPermission: hasPermission
    };
});
