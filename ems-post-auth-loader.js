// ============================================================================
// EMS Post-Auth Loader — offline core first; cloud via emsLoadCloudStack()
// ============================================================================
(function (global) {
    'use strict';

    var CACHE_BUST = '20260902_exams_master_sheet_edit_v1';
    var criticalReady = false;
    var allReady = false;
    var loadPromise = null;
    var deferredPromise = null;

    /** Local persistence + offline write (must load before attendance saves). */
    var OFFLINE_FOUNDATION = [
        'ems-outbox-lock.js',
        'ems-data-corruption.js',
        'ems-data-cache.js',
        'ems-durable-storage.js',
        'ems-storage-quota.js',
        'ems-data-pipeline-debug.js',
        'ems-offline-write.js',
        'ems-cloud-mutation.js',
        'ems-sync-failure-ui.js'
    ];

    var OFFLINE_CORE = [
        'parent-shared.js',
        'ems-firestore-paths.js',
        'ems-registration-repository.js',
        'ems-registration-duplicates.js',
        'ems-registration-audit.js',
        'ems-registration-permissions.js',
        'ems-registration-drafts.js',
        'ems-cloud-pull.js',
        'ems-user-service.js',
        'ems-registration-bootstrap.js',
        'ems-user-access.js',
        'ems-offline-module-store.js'
    ];

    var DASHBOARD_LAST = ['dashboard.js'];

    /** AI client stack — sequential (order matters); not cloud-deferred (parallel race). */
    var AI_CLIENT_STACK = [
        'cloud/ems-ai-guard-client.js',
        'cloud/ems-ai-intent-router.js',
        'cloud/ems-ai-context-builders.js',
        'cloud/ems-ai-client.js',
        'cloud/ems-ai-orchestrator.js',
        'cloud/ems-ai-settings.js',
        'cloud/ems-ai-ui.js'
    ];

    var aiClientPromise = null;

    var OFFLINE_DEFERRED = [
        'ems-production-diagnostic.js',
        'ems-enterprise-diagnostic.js',
        'ems-diagnostics-ui.js',
        'ems-virtual-table.js',
        'ems-module-summaries.js',
        'ems-perf-settings.js',
        'department-migration.js',
        'department-selector.js',
        'attendance-helper.js',
        'sys-settings.js',
        'sys-terminology.js',
        'sys-button-builder.js',
        'sys-field-builder.js',
        'sys-layout-builder.js',
        'sys-permissions.js',
        'sys-report-builder.js',
        'dashboard-pro.js',
        'ems-audit.js'
    ];

    function loadOne(src, async) {
        return new Promise(function (resolve, reject) {
            var el = document.createElement('script');
            el.src = src + '?v=' + CACHE_BUST;
            el.async = !!async;
            el.onload = function () { resolve(); };
            el.onerror = function () { reject(new Error('post-auth script failed: ' + src)); };
            document.head.appendChild(el);
        });
    }

    function loadSequential(files) {
        return files.reduce(function (chain, file) {
            return chain.then(function () { return loadOne(file, false); });
        }, Promise.resolve());
    }

    function loadParallel(files) {
        return Promise.all(files.map(function (file) { return loadOne(file, true); }));
    }

    function loadAiClientStack() {
        if (aiClientPromise) return aiClientPromise;
        aiClientPromise = loadSequential(AI_CLIENT_STACK).then(function () {
            if (typeof global.emsAiUiInit === 'function') {
                global.emsAiUiInit();
            }
            try {
                global.dispatchEvent(new CustomEvent('ems:ai-client-ready'));
            } catch (e) { /* ignore */ }
            return { ready: true };
        }).catch(function (err) {
            aiClientPromise = null;
            console.warn('[EMS] AI client stack load failed:', err);
            throw err;
        });
        return aiClientPromise;
    }

    /** Lazy/retry loader — safe to call from 360 button before deferred finishes. */
    global.emsEnsureAiClient = function () {
        if (typeof global.emsAiOpenPanel === 'function' && typeof global.emsAiUiOpen === 'function') {
            return Promise.resolve({ ready: true, cached: true });
        }
        return loadAiClientStack();
    };

    function finishDeferred() {
        allReady = true;
        if (typeof global.emsBootMark === 'function') {
            global.emsBootMark('post-auth-deferred-done');
        }
        if (typeof global.emsStartDictObserver === 'function') {
            global.emsStartDictObserver();
        }
        if (typeof global.emsApplyCustomDictionaryDeferred === 'function') {
            global.emsApplyCustomDictionaryDeferred();
        }
        if (typeof global.sysApplyTheme === 'function') {
            global.sysApplyTheme(typeof global.sysGetConfig === 'function' ? global.sysGetConfig() : null);
        } else if (typeof global.emsApplyRegTopbarContrast === 'function') {
            try {
                var cfg = JSON.parse(localStorage.getItem('ems_sys_config_v2') || 'null');
                if (cfg && cfg.colors) {
                    global.emsApplyRegTopbarContrast(document.documentElement, cfg.colors);
                }
            } catch (themeErr) { /* ignore */ }
        }
        try {
            global.dispatchEvent(new CustomEvent('ems:post-auth-deferred-ready'));
        } catch (e) { /* ignore */ }
    }

    function startDeferredLoad() {
        if (deferredPromise) return deferredPromise;
        deferredPromise = Promise.resolve()
            .then(function () {
                if (typeof global.emsIsCloudEnabled === 'function' && global.emsIsCloudEnabled()) {
                    if (typeof global.emsLoadFirebaseStorage === 'function') {
                        return global.emsLoadFirebaseStorage();
                    }
                }
            })
            .then(function () {
                if (typeof global.emsIsCloudEnabled === 'function' && global.emsIsCloudEnabled()) {
                    if (typeof global.emsLoadFirebaseMessaging === 'function') {
                        return global.emsLoadFirebaseMessaging();
                    }
                }
            })
            .then(function () {
                if (typeof global.emsLoadCloudDeferred === 'function') {
                    return global.emsLoadCloudDeferred();
                }
            })
            .then(function () { return loadAiClientStack(); })
            .then(function () { return loadParallel(OFFLINE_DEFERRED); })
            .then(finishDeferred)
            .catch(function (err) {
                console.warn('[EMS] deferred post-auth load:', err);
            });
        return deferredPromise;
    }

    global.emsEnsurePostAuthScripts = function () {
        if (criticalReady) {
            startDeferredLoad();
            return Promise.resolve({ ready: true, cached: true, critical: true });
        }
        if (loadPromise) return loadPromise;

        var cloudChain = (typeof global.emsLoadCloudStack === 'function')
            ? global.emsLoadCloudStack()
            : Promise.resolve({ skipped: true });

        if (typeof global.emsBootMark === 'function') {
            global.emsBootMark('post-auth-critical-start', (OFFLINE_FOUNDATION.length + OFFLINE_CORE.length + 1) + ' scripts');
        }

        loadPromise = cloudChain
            .then(function () { return loadSequential(OFFLINE_FOUNDATION); })
            .then(function () {
                if (typeof global.emsDurableMigrateBoot === 'function') {
                    return global.emsDurableMigrateBoot().catch(function () { return { migrated: 0 }; });
                }
            })
            .then(function () {
                // Restore durable IndexedDB → localStorage BEFORE the repository
                // hydrates, so data survives localStorage eviction (hard-disk durability).
                if (typeof global.emsCacheRestoreFromIdb === 'function') {
                    return global.emsCacheRestoreFromIdb().catch(function () { });
                }
            })
            .then(function () { return loadParallel(OFFLINE_CORE); })
            .then(function () { return loadSequential(DASHBOARD_LAST); })
            .then(function () {
                criticalReady = true;
                allReady = false;
                if (typeof global.emsBootMark === 'function') {
                    global.emsBootMark('post-auth-critical-done');
                }
                try {
                    global.dispatchEvent(new CustomEvent('ems:post-auth-ready'));
                } catch (e) { /* ignore */ }
                startDeferredLoad();
                return {
                    ready: true,
                    critical: true,
                    offlineOnly: typeof global.emsIsOfflineOnly === 'function' && global.emsIsOfflineOnly(),
                    scripts: OFFLINE_FOUNDATION.length + OFFLINE_CORE.length + DASHBOARD_LAST.length
                };
            }).catch(function (err) {
                loadPromise = null;
                console.warn('[EMS] critical post-auth load failed:', err);
                throw err;
            });
        return loadPromise;
    };

    /**
     * Wait for post-auth deferred helpers when a visible department action
     * needs one of them immediately.  `emsEnsurePostAuthScripts()` intentionally
     * resolves after the critical boot, which is too early for the attendance
     * cloud-recovery helper that lives in OFFLINE_DEFERRED.
     */
    global.emsEnsurePostAuthDeferredScripts = function () {
        return startDeferredLoad().then(function () {
            return { ready: allReady, deferred: true };
        });
    };

    global.emsIsPostAuthReady = function () {
        return criticalReady;
    };

    global.emsIsPostAuthFullyReady = function () {
        return allReady;
    };
})(typeof window !== 'undefined' ? window : globalThis);
