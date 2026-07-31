// ============================================================================
// EMS Registration Bootstrap — offline-first lite login (regent44)
// Local IDB SSOT · cloud only on first empty IDB or manual disaster recovery
// ============================================================================
(function (global) {
    'use strict';

    var bootPromise = null;
    var moduleBootPromise = null;
    var ready = false;
    var bootCount = 0;
    var DB_WAIT_MS = 10000;
    var lastReadyDispatchAt = 0;
    var lastReadyDispatchCount = -1;
    var READY_DISPATCH_COOLDOWN_MS = 5000;

    function getTenantId() {
        if (typeof global.emsRequireTenantId === 'function') {
            var required = global.emsRequireTenantId();
            if (required) return required;
        }
        if (typeof global.emsGetTenantId === 'function') {
            var tid = global.emsGetTenantId();
            if (tid) return tid;
        }
        return null;
    }

    function checkFirestoreHasRegistrations(db, tenantId) {
        if (!db || !tenantId) return Promise.resolve(false);
        var col = typeof global.emsFirestoreSubColRef === 'function'
            ? global.emsFirestoreSubColRef(db, tenantId, 'Registrations')
            : db.collection('All_Madrasas').doc(tenantId).collection('Registrations');
        return col
            .limit(1).get({ source: 'server' })
            .then(function (snap) { return !snap.empty; })
            .catch(function () { return false; });
    }

    function getDb() {
        return typeof global.getDbOrNull === 'function' ? global.getDbOrNull() : null;
    }

    function waitForDbReady() {
        if (typeof global.emsIsOfflineOnly === 'function' && global.emsIsOfflineOnly()) {
            return Promise.resolve(null);
        }
        var db = getDb();
        if (db) return Promise.resolve(db);
        return new Promise(function (resolve) {
            var start = Date.now();
            function tick() {
                var d = getDb();
                if (d) return resolve(d);
                if (Date.now() - start > DB_WAIT_MS) return resolve(null);
                setTimeout(tick, 100);
            }
            tick();
        });
    }

    function refreshAllModules() {
        bootCount = (typeof global.emsRegRepoGetList === 'function')
            ? global.emsRegRepoGetList().length : bootCount;
        if (typeof global.updateMasterDashboard === 'function') {
            try { global.updateMasterDashboard(); } catch (e) { /* ignore */ }
        }
        if (typeof global.renderRegTable === 'function') {
            var regTable = document.querySelector('#reg-users-table tbody');
            if (regTable) {
                try { global.renderRegTable(); } catch (e2) { /* ignore */ }
            }
        }
        var now = Date.now();
        if (bootCount === 0 && lastReadyDispatchCount === 0
            && (now - lastReadyDispatchAt) < READY_DISPATCH_COOLDOWN_MS) {
            return;
        }
        if (global.EMS_REBUILD_IN_PROGRESS === true) {
            return;
        }
        lastReadyDispatchAt = now;
        lastReadyDispatchCount = bootCount;
        try {
            global.dispatchEvent(new CustomEvent('ems:registration-ready', {
                detail: { count: bootCount, suppressedLoop: bootCount === 0 }
            }));
        } catch (e) { /* ignore */ }
    }

    var bootOverlayTimer = null;
    var BOOT_OVERLAY_MAX_MS = 8000;

    global.emsShowRegistrationBootOverlay = function (show, message) {
        var sp = document.getElementById('global-spinner');
        if (!sp) return;
        if (show) {
            sp.classList.add('ems-boot-overlay');
            sp.style.display = 'flex';
            sp.innerHTML = '<div style="text-align:center;color:#fff;font-family:\'Noto Nastaliq Urdu\',Arial,sans-serif;padding:24px;">' +
                '<div style="width:44px;height:44px;border:4px solid rgba(255,255,255,0.2);border-top-color:#14b8a6;border-radius:50%;margin:0 auto 14px;animation:emsBootSpin 0.9s linear infinite;"></div>' +
                '<div>' + (message || 'رجسٹریشن ڈیٹا لوڈ ہو رہا ہے...') + '</div></div>';
            if (typeof global.emsSetBootSplashMessage === 'function') {
                global.emsSetBootSplashMessage(message || 'مقامی ڈیٹا لوڈ ہو رہا ہے…');
            }
            if (bootOverlayTimer) clearTimeout(bootOverlayTimer);
            bootOverlayTimer = setTimeout(function () {
                bootOverlayTimer = null;
                global.emsShowRegistrationBootOverlay(false);
                if (typeof global.showTopAlert === 'function') {
                    global.showTopAlert('⚠️ لوڈنگ میں تاخیر — سسٹم کھول دیا گیا۔', true);
                }
            }, BOOT_OVERLAY_MAX_MS);
        } else {
            if (bootOverlayTimer) {
                clearTimeout(bootOverlayTimer);
                bootOverlayTimer = null;
            }
            sp.style.display = 'none';
            sp.classList.remove('ems-boot-overlay');
            sp.innerHTML = '';
            if (typeof global.emsDismissBootSplash === 'function') {
                global.emsDismissBootSplash();
            }
        }
    };

    /** Offline-first boot — hydrate IDB into RAM before UI unlock; no silent cloud fetch on restart. */
    global.emsBootLiteLogin = function (tenantId) {
        tenantId = tenantId || getTenantId();
        if (!tenantId) {
            return Promise.resolve({
                ready: false,
                hydrationComplete: false,
                source: 'no_tenant'
            });
        }
        if (typeof global.emsLiteLoginPrepare === 'function') {
            global.emsLiteLoginPrepare(tenantId);
        } else if (typeof global.emsActivateTenantStorage === 'function') {
            global.emsActivateTenantStorage(tenantId);
        }
        if (typeof global.emsRegRepoInit === 'function') {
            global.emsRegRepoInit(tenantId);
        }
        if (typeof global.emsStartRegistrationWriteSync === 'function') {
            global.emsStartRegistrationWriteSync(tenantId);
        }

        var hydrateFn = (typeof global.emsRegRepoEnsureHydratedFromIdb === 'function')
            ? global.emsRegRepoEnsureHydratedFromIdb
            : (typeof global.emsRegRepoHydrateFullFromIdb === 'function'
                ? global.emsRegRepoHydrateFullFromIdb
                : null);

        if (!hydrateFn) {
            console.warn('[EMS] emsBootLiteLogin: repository hydrate not ready');
            return Promise.resolve({
                ready: true,
                hydrationComplete: false,
                count: 0,
                idbCount: 0,
                source: 'repo_hydrate_missing'
            });
        }

        return Promise.resolve(hydrateFn(tenantId)).then(function (bootRes) {
            var moduleHydrate = (typeof global.emsOfflineModuleStoreHydrateAll === 'function')
                ? global.emsOfflineModuleStoreHydrateAll(tenantId)
                : Promise.resolve({ hydrated: 0 });
            return moduleHydrate.then(function () { return bootRes; });
        }).then(function (bootRes) {
            bootCount = (typeof global.emsRegRepoGetList === 'function')
                ? global.emsRegRepoGetList().length
                : (bootRes.count || 0);
            var idbCount = bootRes.idbCount != null ? bootRes.idbCount : null;
            var hydrationComplete = bootRes.hydrationComplete === true
                || bootRes.matched === true
                || (bootCount === 0 && idbCount === 0);

            if (typeof global.emsPipelineDebug === 'function') {
                global.emsPipelineDebug('lite_login_idb_hydrate', {
                    tenantId: tenantId,
                    memoryCount: bootCount,
                    idbCount: idbCount,
                    matched: bootRes.matched,
                    hydrationComplete: hydrationComplete,
                    source: bootRes.source || 'idb_hydrate'
                });
            }

            ready = hydrationComplete;
            global.EMS_REPOSITORY_BOOT_COMPLETE = hydrationComplete;
            if (hydrationComplete && bootCount > 0 && typeof global.emsMarkRepositoryReady === 'function') {
                global.emsMarkRepositoryReady(bootCount, {
                    bootComplete: true,
                    source: bootRes.source || 'idb_hydrate'
                });
            }
            if (typeof global.emsBroadcastUsersChanged === 'function') {
                global.emsBroadcastUsersChanged();
            }
            try {
                global.dispatchEvent(new CustomEvent('ems:repo-hydrated', {
                    detail: {
                        count: bootCount,
                        idbCount: idbCount,
                        tenantId: tenantId,
                        hydrationComplete: hydrationComplete
                    }
                }));
            } catch (evtErr) { /* ignore */ }
            refreshAllModules();
            if (typeof global.emsBootMark === 'function') {
                global.emsBootMark('lite-login-idb-hydrate', bootCount);
            }
            return {
                ready: hydrationComplete,
                bootComplete: hydrationComplete,
                hydrationComplete: hydrationComplete,
                count: bootCount,
                idbCount: idbCount,
                matched: bootRes.matched,
                source: bootRes.source || (bootCount > 0 ? 'lite_login_idb' : 'lite_login_idb_empty'),
                error: bootRes.error
            };
        });
    };

    /** Gate for auth.js — do not unlock UI until local datastore contract is satisfied. */
    global.emsAwaitOfflineFirstDatastoreReady = function (tenantId) {
        return global.emsBootLiteLogin(tenantId);
    };

    /** Module open — paginated 50-record fetch, optional live sync */
    global.emsBootRegistrationModule = function (tenantId, options) {
        options = options || {};
        tenantId = tenantId || getTenantId();
        if (!tenantId) {
            if (typeof global.emsPipelineDebug === 'function') {
                global.emsPipelineDebug('module_boot_no_tenant', { recordCount: 0 });
            }
            return Promise.resolve({ ready: false, count: 0, source: 'no_tenant' });
        }
        var liveExisting = (typeof global.emsRegRepoGetList === 'function')
            ? global.emsRegRepoGetList().length : 0;
        if (!options.force && liveExisting > 0) {
            return Promise.resolve({
                ready: true,
                bootComplete: true,
                count: liveExisting,
                source: 'repo_ready'
            });
        }

        if (options._consistencyBoot && liveExisting === 0 && moduleBootPromise) {
            return moduleBootPromise;
        }

        if (global.EMS_REBUILD_IN_PROGRESS === true && !options._rebuildBoot) {
            return Promise.resolve({
                ready: false,
                count: liveExisting,
                source: 'rebuild_in_progress',
                skipped: true
            });
        }

        var idbHydrateFirst = (!options.force && !options._idbEmpty
            && typeof global.emsRegRepoHydrateFullFromIdb === 'function');
        if (idbHydrateFirst) {
            return global.emsRegRepoHydrateFullFromIdb(tenantId).then(function (hydrateRes) {
                var hydratedCount = (typeof global.emsRegRepoGetList === 'function')
                    ? global.emsRegRepoGetList().length : (hydrateRes.count || 0);
                if (hydratedCount > 0) {
                    bootCount = hydratedCount;
                    ready = true;
                    global.EMS_REPOSITORY_BOOT_COMPLETE = true;
                    global.EMS_MODULE_FETCH_ATTEMPTED = true;
                    if (typeof global.emsMarkRepositoryReady === 'function') {
                        global.emsMarkRepositoryReady(hydratedCount, {
                            bootComplete: true,
                            source: hydrateRes.source || 'idb_hydrate'
                        });
                    }
                    refreshAllModules();
                    return {
                        ready: true,
                        bootComplete: true,
                        count: hydratedCount,
                        source: hydrateRes.source || 'idb_hydrate'
                    };
                }
                return global.emsBootRegistrationModule(tenantId, Object.assign({}, options, {
                    force: false,
                    _idbEmpty: true
                }));
            });
        }

        if (moduleBootPromise && !options.force) {
            return moduleBootPromise.then(function (res) {
                var liveCount = (typeof global.emsRegRepoGetList === 'function')
                    ? global.emsRegRepoGetList().length : 0;
                var isDesktop = typeof global.emsIsDesktopEnvironment === 'function'
                    && global.emsIsDesktopEnvironment();
                var offlineFirst = global.EMS_OFFLINE_FIRST_SSOT === true || isDesktop;
                if (offlineFirst) {
                    return Object.assign({}, res, { count: liveCount, source: 'offline_first_no_force' });
                }
                if (isDesktop && liveCount === 0) {
                    return Object.assign({}, res, { count: 0, _emptyRetried: true });
                }
                if (liveCount === 0 && ((res.count || 0) > 0 || !res._emptyRetried)) {
                    moduleBootPromise = null;
                    return global.emsBootRegistrationModule(tenantId, {
                        force: true,
                        startLiveSync: options.startLiveSync,
                        _emptyRetried: true
                    });
                }
                if (liveCount === 0 && (res.count || 0) === 0 && !res._emptyRetried) {
                    return global.emsBootRegistrationModule(tenantId, {
                        force: true,
                        startLiveSync: options.startLiveSync,
                        _emptyRetried: true
                    });
                }
                return Object.assign({}, res, { count: liveCount || res.count || 0 });
            });
        }

        if (typeof global.emsBootMark === 'function') {
            global.emsBootMark('registration-module-start', tenantId);
        }
        if (typeof global.emsPipelineDebug === 'function') {
            global.emsPipelineDebug('module_boot_start', { tenantId: tenantId, force: !!options.force });
        }

        moduleBootPromise = waitForDbReady().then(function (db) {
            if (!db) {
                return { ready: false, count: 0, reason: 'no_db' };
            }
            if (typeof global.emsRegRepoInit === 'function') {
                global.emsRegRepoInit(tenantId);
            }
            var chain = Promise.resolve();
            if (typeof global.emsStartRegistrationWriteSync === 'function') {
                chain = chain.then(function () {
                    return global.emsStartRegistrationWriteSync(tenantId);
                });
            } else if (options.startLiveSync && typeof global.emsStartRegistrationLiveSync === 'function') {
                chain = chain.then(function () {
                    return global.emsStartRegistrationLiveSync(tenantId, {
                        limit: typeof global.emsResolveFetchLimit === 'function' ? global.emsResolveFetchLimit() : 50
                    });
                });
            }
            return chain.then(function () {
                if (typeof global.emsRegRepoHydrateFullFromIdb === 'function') {
                    return global.emsRegRepoHydrateFullFromIdb(tenantId).then(function (hydrateRes) {
                        return {
                            loaded: (typeof global.emsRegRepoGetList === 'function'
                                ? global.emsRegRepoGetList().length : 0) || (hydrateRes.count || 0),
                            source: hydrateRes.source || 'idb_hydrate'
                        };
                    });
                }
                if (typeof global.emsRegRepoEnsureInitial === 'function') {
                    return global.emsRegRepoEnsureInitial(tenantId);
                }
                return { loaded: 0 };
            }).then(function (res) {
                bootCount = (typeof global.emsRegRepoGetList === 'function')
                    ? global.emsRegRepoGetList().length : 0;

                var offlineFirst = global.EMS_OFFLINE_FIRST_SSOT === true
                    || (typeof global.emsIsDesktopEnvironment === 'function' && global.emsIsDesktopEnvironment());

                if (bootCount === 0 && !offlineFirst) {
                    return checkFirestoreHasRegistrations(db, tenantId).then(function (fsHasData) {
                        if (fsHasData && typeof global.emsRegRepoBulkHydrate === 'function') {
                            return global.emsRegRepoBulkHydrate(tenantId, typeof global.emsResolveFetchLimit === 'function'
                                ? global.emsResolveFetchLimit()
                                : 50).then(function () {
                                bootCount = global.emsRegRepoGetList().length;
                                return { res: res, fsHasData: fsHasData, retried: true };
                            });
                        }
                        return { res: res, fsHasData: fsHasData, retried: false };
                    });
                }
                return { res: res, fsHasData: bootCount > 0, retried: false };
            }).then(function (wrap) {
                bootCount = (typeof global.emsRegRepoGetList === 'function')
                    ? global.emsRegRepoGetList().length : 0;
                var bootComplete = bootCount > 0 || !wrap.fsHasData;
                ready = bootCount > 0;
                global.EMS_REPOSITORY_BOOT_COMPLETE = bootComplete;
                global.EMS_MODULE_FETCH_ATTEMPTED = true;
                if (typeof global.emsMarkRepositoryReady === 'function') {
                    global.emsMarkRepositoryReady(bootCount, {
                        bootComplete: bootComplete,
                        source: 'module_pagination',
                        empty: bootCount === 0,
                        hydrationFailed: bootCount === 0 && wrap.fsHasData
                    });
                }
                if (typeof global.emsBootMark === 'function') {
                    global.emsBootMark('registration-module-ready', bootCount);
                }
                if (typeof global.emsPipelineDebug === 'function') {
                    global.emsPipelineDebug('module_boot_done', {
                        tenantId: tenantId,
                        recordCount: bootCount,
                        firestoreHasData: wrap.fsHasData,
                        retried: wrap.retried,
                        hydrationFailed: bootCount === 0 && wrap.fsHasData
                    });
                }
                if (bootCount === 0 && wrap.fsHasData && typeof global.showTopAlert === 'function') {
                    global.showTopAlert('⚠️ سرور پر ریکارڈ موجود ہیں مگر لوڈ نہیں ہوئے — console میں [EMS Pipeline] چیک کریں۔', true);
                }
                refreshAllModules();
                var out = {
                    ready: bootCount > 0 || !wrap.fsHasData,
                    bootComplete: bootComplete,
                    count: bootCount,
                    source: 'module_pagination',
                    detail: wrap.res,
                    empty: bootCount === 0,
                    hydrationFailed: bootCount === 0 && wrap.fsHasData,
                    _emptyRetried: !!options._emptyRetried
                };
                if (bootCount === 0) moduleBootPromise = null;
                return out;
            });
        }).catch(function (err) {
            moduleBootPromise = null;
            if (typeof global.emsPipelineDebug === 'function') {
                global.emsPipelineDebug('module_boot_failed', { error: err && err.message, tenantId: tenantId });
            }
            console.warn('Registration module boot failed:', err);
            throw err;
        });

        return moduleBootPromise;
    };

    global.emsBootRegistrationData = function (tenantId, options) {
        options = options || {};
        if (typeof global.emsCanRunEnterpriseBoot === 'function' && !global.emsCanRunEnterpriseBoot()) {
            if (typeof global.emsBootMark === 'function') {
                global.emsBootMark('registration-boot-skipped', 'pre_auth');
            }
            return Promise.resolve({
                ready: false,
                bootComplete: false,
                count: 0,
                source: 'pre_auth'
            });
        }

        tenantId = tenantId || getTenantId();

        if (global.EMS_LITE_LOGIN && !options.force && !options.moduleOpen) {
            return global.emsBootLiteLogin(tenantId);
        }

        if (options.moduleOpen || options.force) {
            return global.emsBootRegistrationModule(tenantId, {
                force: !!options.force,
                startLiveSync: !!options.startLiveSync
            });
        }

        return global.emsBootLiteLogin(tenantId);
    };

    global.emsIsRegistrationRepositoryReady = function () {
        if (bootCount > 0) return true;
        if (typeof global.emsRegRepoGetList === 'function') {
            return global.emsRegRepoGetList().length > 0;
        }
        return ready && bootCount > 0;
    };

    global.emsResetRegistrationBoot = function () {
        bootPromise = null;
        moduleBootPromise = null;
        ready = false;
        bootCount = 0;
    };

    global.emsForceReloadRegistrationData = function () {
        bootPromise = null;
        moduleBootPromise = null;
        ready = false;
        bootCount = 0;
        global.EMS_REPOSITORY_BOOT_COMPLETE = false;
        global.EMS_LITE_LOGIN = false;
        if (typeof global.emsResetRepositoryReady === 'function') {
            global.emsResetRepositoryReady();
        }
        return global.emsBootRegistrationModule(getTenantId(), { force: true, startLiveSync: false });
    };

    global.emsStartRegistrationSync = function () {
        var tid = getTenantId();
        return global.emsBootRegistrationModule(tid, { force: bootCount === 0, startLiveSync: false }).then(function (res) {
            if (document.getElementById('reg-users-table') && typeof global.renderRegTable === 'function') {
                global.renderRegTable();
            }
            return res;
        });
    };

    /** Full session teardown — logout / tenant switch ONLY. */
    global.emsDestroyRegistrationSession = function () {
        if (typeof global.emsStopRegistrationLiveSync === 'function') {
            global.emsStopRegistrationLiveSync();
        }
        if (typeof global.emsResetRepositoryReady === 'function') {
            global.emsResetRepositoryReady();
        }
        global.EMS_REPOSITORY_BOOT_COMPLETE = false;
        global.EMS_LITE_LOGIN = false;
        global.EMS_MODULE_FETCH_ATTEMPTED = false;
        global.emsResetRegistrationBoot();
        if (typeof global.emsRegRepoStop === 'function') {
            global.emsRegRepoStop();
        }
        if (typeof global.emsResetRegistrationSyncFlag === 'function') {
            global.emsResetRegistrationSyncFlag();
        }
        if (typeof global.emsPurgeLegacyRegistrationCaches === 'function') {
            global.emsPurgeLegacyRegistrationCaches();
        }
        if (typeof global.emsRegDraftPurgeSession === 'function') {
            global.emsRegDraftPurgeSession();
        }
    };

    /** @deprecated use emsDestroyRegistrationSession — kept for logout hook */
    global.emsStopRegistrationSync = global.emsDestroyRegistrationSession;

    /** @deprecated use emsEnterpriseDiagnostic */
    global.emsDiagRegistrationFlow = function () {
        if (typeof global.emsEnterpriseDiagnostic === 'function') {
            return global.emsEnterpriseDiagnostic();
        }
        return Promise.resolve({ error: 'emsEnterpriseDiagnostic not loaded' });
    };

    if (typeof global.addEventListener === 'function') {
        global.addEventListener('ems:users-changed', function () {
            bootCount = (typeof global.emsRegRepoGetList === 'function')
                ? global.emsRegRepoGetList().length : bootCount;
            refreshAllModules();
        });
    }

    if (typeof firebase !== 'undefined' && firebase.auth) {
        var authTeardownTimer = null;
        firebase.auth().onAuthStateChanged(function (user) {
            if (user) {
                if (authTeardownTimer) {
                    clearTimeout(authTeardownTimer);
                    authTeardownTimer = null;
                }
                return;
            }
            authTeardownTimer = setTimeout(function () {
                authTeardownTimer = null;
                try {
                    if (firebase.auth().currentUser) return;
                } catch (e) { /* ignore */ }
                global.emsDestroyRegistrationSession();
            }, 2000);
        });
    }
})(typeof window !== 'undefined' ? window : globalThis);
