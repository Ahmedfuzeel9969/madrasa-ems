// ============================================================================
// EMS Lazy Module Loader — defer heavy scripts until tab open (Phase 2 S4)
// ============================================================================
(function (global) {
    'use strict';

    var CACHE_BUST = '20260903_att_holiday_joined_vertical_v1';
    var loaded = Object.create(null);
    var loading = Object.create(null);

    var MANIFEST = {
        admission: [
            'reg-dashboard.js',
            'ems-registration-mobile.js',
            'ems-registration-drafts.js',
            'admission.js',
            'ems-idcard.js',
            'ems-import-export.js',
            'ems-import-legacy.js',
            'ems-import-smart.js',
            'ems-import-templates.js',
            'ems-import-merge.js',
            'ems-import-wizard.js',
            'ems-import-queue.js',
            'registration-ui.js'
        ],
        attendance: ['attendance-helper.js', 'att-metrics.js', 'att-dashboard.js', 'att-save-status.js', 'attendance.js', 'att-collective.js', 'att-collective-view.js'],
        exams: ['ems-import-export.js', 'ems-import-templates.js', 'exams.js', 'exams-import-export.js'],
        curriculum: ['curriculum.js'],
        training: ['training.js'],
        finance: ['ems-smart-slip.js', 'finance.js'],
        ledger: ['ledger.js'],
        announcements: ['announcements.js'],
        complaints: ['complaints.js'],
        'ai-studio': ['cloud/ems-ai-macro-builders.js', 'cloud/ems-ai-studio-ui.js'],
        'admin-panel': ['access-keys.js', 'parent-shared.js', 'admin-panel.js'],
        'parent-portal': ['parent-shared.js', 'parent-portal.js'],
        superadmin: [
            'sa/rbac-config.js',
            'sa/sa-api.js',
            'sa/platform-users.js',
            'sa/sa-charts.js',
            'sa/sa-ui.js',
            'sa/sa-nav.js',
            'sa/sa-core.js',
            'sa/sa-tenants.js',
            'sa/sa-billing.js',
            'sa/sa-audit.js',
            'sa/sa-admins.js',
            'sa/sa-security.js',
            'sa/sa-advisor-ui.js',
            'sa/sa-notifications.js',
            'sa/sa-dashboard.js',
            'sa/sa-users.js',
            'sa/sa-rbac.js',
            'superadmin.js'
        ]
    };

    function cloudExtras(modId) {
        if (typeof global.emsCloudLazyScripts === 'function') {
            return global.emsCloudLazyScripts(modId);
        }
        return [];
    }

    function loadScript(src) {
        if (loaded[src]) return loaded[src];
        if (loading[src]) return loading[src];
        loading[src] = new Promise(function (resolve, reject) {
            var el = document.createElement('script');
            el.src = src + '?v=' + CACHE_BUST;
            el.async = false;
            el.onload = function () {
                loaded[src] = Promise.resolve();
                delete loading[src];
                resolve();
            };
            el.onerror = function () {
                delete loading[src];
                reject(new Error('script load failed: ' + src));
            };
            document.head.appendChild(el);
        });
        return loading[src];
    }

    global.emsLazyLoadModule = function (modId) {
        var list = (MANIFEST[modId] || []).slice();
        if (typeof global.emsIsCloudEnabled === 'function' && global.emsIsCloudEnabled()) {
            list = cloudExtras(modId).concat(list);
        }
        if (!list.length) return Promise.resolve({ modId: modId, scripts: 0 });
        return list.reduce(function (chain, src) {
            return chain.then(function () { return loadScript(src); });
        }, Promise.resolve()).then(function () {
            if (modId === 'admission' && global.RegistrationModule && typeof global.RegistrationModule.init === 'function') {
                global.RegistrationModule.init();
            }
            var userMods = { admission: 1, attendance: 1, finance: 1, exams: 1, curriculum: 1, training: 1, complaints: 1, ledger: 1, announcements: 1, 'ai-studio': 1 };
            if (userMods[modId] && typeof global.emsEnsureUsersReady === 'function') {
                return global.emsEnsureUsersReady().then(function () {
                    return { modId: modId, scripts: list.length };
                });
            }
            return { modId: modId, scripts: list.length };
        });
    };

    global.emsLazyIsLoaded = function (modId) {
        var list = MANIFEST[modId];
        if (!list) return true;
        for (var i = 0; i < list.length; i++) {
            if (!loaded[list[i]]) return false;
        }
        return true;
    };

    global.emsLazyManifest = MANIFEST;
})(typeof window !== 'undefined' ? window : globalThis);
