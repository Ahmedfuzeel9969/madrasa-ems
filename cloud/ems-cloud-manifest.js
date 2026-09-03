// ============================================================================
// Cloud stack manifest — Firebase / Firestore / sync (not loaded in offline-only)
// ============================================================================
(function (global) {
    'use strict';

  var CACHE_BUST = '20260903_att_month_view_holiday_v1';

    global.EmsCloudManifest = {
        cacheBust: CACHE_BUST,
        vendor: [
            'vendor/firebasejs/9.22.0/firebase-app-compat.js',
            'vendor/firebasejs/9.22.0/firebase-auth-compat.js',
            'vendor/firebasejs/9.22.0/firebase-firestore-compat.js',
            'vendor/firebasejs/9.22.0/firebase-functions-compat.js'
        ],
        boot: [
            'ems-firebase-init.js',
            'security-layer.js',
            'parent-shared.js',
            'security-mfa.js',
            'tenant-security.js',
            'tenant-delivery.js',
            'tenant-sso.js',
            'identity-gate.js',
            'ems-session-registry.js',
            'ems-trusted-device.js'
        ],
        foundation: [
            'cloud/sync-engine.js',
            'cloud/direct-firestore.js'
        ],
        core: [
            'cloud/backup-service.js',
            'cloud/ems-firebase-read-api.js',
            'cloud/ems-registration-live-sync.js',
            'cloud/ems-registration-sync.js',
            'cloud/ems-dashboard-stats.js'
        ],
        deferred: [
            'cloud/photo-migration.js',
            'cloud/ems-academic-archive.js',
            'cloud/ems-push-register.js'
        ],
        lazy: {
            admission: ['cloud/ems-photo-storage.js', 'cloud/ems-enterprise-search.js'],
            complaints: ['cloud/complaints-firestore.js'],
            'ai-studio': ['cloud/ems-ai-macro-builders.js', 'cloud/ems-ai-studio-ui.js']
        }
    };
})(typeof window !== 'undefined' ? window : globalThis);
