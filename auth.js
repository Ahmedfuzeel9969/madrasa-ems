// ============================================================================
// تصدیق، رسائی کنٹرول اور مدرسہ پروفائل (Authentication & Access Control)
// ============================================================================

window.CURRENT_MADRASA_DATA = null;

// تمام کھلی ونڈوز (modal overlays) بند کریں — ماڈیول بدلنے پر اٹکی ونڈو کا مسئلہ حل
window.emsCloseAllModals = function () {
    document.querySelectorAll('.modal-overlay').forEach(function (m) {
        m.style.display = 'none';
    });
};
window.SYSTEM_GLOBAL_STATUS = 'free';
window.SYSTEM_MAINTENANCE_MODE = false;
window.SYSTEM_MAINTENANCE_MSG = '';
window.SUPER_ADMIN_CACHE = null;

/** @type {string[]} */
window.LICENSED_MODULE_IDS = [
    'admission', 'attendance', 'exams', 'curriculum', 'training', 'finance', 'ledger', 'complaints', 'announcements'
];

/** @type {string[]} */
window.PUBLIC_MODULE_IDS = ['dashboard', 'sys-settings', 'ai-studio'];

let unsubMadrasa = null;
let unsubGlobalSettings = null;
let unsubSystemSettings = null;
let dbWaitAttempts = 0;
const MAX_DB_WAIT_ATTEMPTS = 30;
const MAX_DB_WAIT_OFFLINE = 3;
const MAX_DB_WAIT_TENANT_FALLBACK = 8;

function isNetworkUnavailable() {
    if (typeof window.emsIsNetworkAvailable === 'function') {
        return !window.emsIsNetworkAvailable();
    }
    return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function readOfflineSessionSnap() {
    try {
        if (window.EMS_BOOT_SESSION_FROM_DISK && window.EMS_BOOT_SESSION_FROM_DISK.tenantId) {
            return window.EMS_BOOT_SESSION_FROM_DISK;
        }
        if (typeof window.emsReadOfflineSession === 'function') {
            return window.emsReadOfflineSession();
        }
        var raw = localStorage.getItem('ems_offline_session_v1');
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

/** Saved session + offline → login UI must never appear; Firebase auth blocked. */
function shouldForceStrictOfflineBypass() {
    if (window.EMS_MANUAL_CLOUD_SYNC === true) return false;
    var snap = readOfflineSessionSnap();
    var hasSession = !!(snap && snap.tenantId && snap.authUid);
    if (!hasSession && typeof window.emsHasDesktopOfflineBootCache === 'function') {
        hasSession = window.emsHasDesktopOfflineBootCache();
    }
    if (!hasSession) return false;
    if (window.EMS_OFFLINE_ONLY !== true) return false;
    if (typeof navigator !== 'undefined' && navigator.onLine) return false;
    if (window.EMS_NETWORK_OFFLINE_AT_BOOT === true) return true;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
    return isNetworkUnavailable();
}

window.emsShouldForceStrictOfflineBypass = shouldForceStrictOfflineBypass;

function hideLoginUiForcefully() {
    if (typeof window.emsDismissLoginUi === 'function') {
        window.emsDismissLoginUi();
    } else {
        var landing = document.getElementById('ems-landing');
        if (landing) landing.style.display = 'none';
        var loginPanel = document.getElementById('ems-login-panel');
        if (loginPanel) loginPanel.style.display = 'none';
    }
    var profileGateway = document.getElementById('profile-setup-gateway');
    if (profileGateway) profileGateway.style.display = 'none';
    var keyPanel = document.getElementById('ems-access-key-panel');
    if (keyPanel) keyPanel.style.display = 'none';
    document.documentElement.classList.add('ems-offline-no-signin');
    document.body.classList.remove('ems-locked');
}

window.emsHideLoginUiForcefully = hideLoginUiForcefully;

function attemptStrictOfflineBoot() {
    if (!shouldForceStrictOfflineBypass()) return false;
    hideLoginUiForcefully();
    if (tryNativeInstantBootWithoutAuth()) return true;
    if (tryOfflineLocalBootAnyPlatform(null)) return true;
    tryNativeInstantBootAfterIdbRestore();
    return true;
}

window.emsAttemptStrictOfflineBoot = attemptStrictOfflineBoot;

function showGoogleAuthError(error) {
    if (shouldSuppressFirebaseAuthUiError(error)) {
        console.warn('[EMS:auth] suppressed offline:', error && (error.code || error.message));
        return;
    }
    if (typeof window.emsClearLandingAuthLoading === 'function') {
        window.emsClearLandingAuthLoading();
    }
    var detail = googleAuthErrorMessage(error);
    console.error('[EMS:auth] Google login failed:', error && error.code, detail, error);
    if (typeof window.showTopAlert === 'function') {
        window.showTopAlert('گوگل لاگ ان ناکام: ' + detail, true);
    }
}

function shouldSuppressFirebaseAuthUiError(error) {
    if (!error) return true;
    // Never hide failures during explicit Google login (native or web).
    if (window.EMS_GOOGLE_AUTH_IN_PROGRESS) return false;
    if (typeof window.emsShouldUseNativeGoogleSignIn === 'function' && window.emsShouldUseNativeGoogleSignIn()) {
        return false;
    }
    if (shouldForceStrictOfflineBypass()) return true;
    if (isNetworkUnavailable()) return true;
    var code = error.code || '';
    return code === 'auth/internal-error'
        || code === 'auth/network-request-failed'
        || code === 'auth/too-many-requests';
}

function emsIsIdentityGateReady() {
    return typeof window.emsRunIdentityGate === 'function';
}

function emsFailSecurityLayerMissing(context) {
    emsMadrasaBootStarted = false;
    emsPortalRoutedOnce = false;
    window.EMS_SECURITY_LAYER_FAILED = true;
    console.error('[EMS:auth] Security layer failed to load', context || '');
    if (typeof window.showTopAlert === 'function') {
        window.showTopAlert('Security layer failed to load. Please refresh.', true);
    }
    if (typeof window.emsClearTenantContext === 'function') {
        window.emsClearTenantContext();
    }
    if (typeof window.emsShowLanding === 'function') {
        window.emsShowLanding();
    } else if (typeof window.emsShowAccessDenied === 'function') {
        window.emsShowAccessDenied(
            'Security layer failed to load',
            'Please refresh the page and sign in again.'
        );
    }
    if (typeof firebase !== 'undefined' && firebase.auth) {
        firebase.auth().signOut().catch(function () { /* ignore */ });
    }
}
window.emsFailSecurityLayerMissing = emsFailSecurityLayerMissing;

function emsInvokeIdentityGateOrAbort(user, ctx, contextLabel) {
    if (!emsIsIdentityGateReady()) {
        emsFailSecurityLayerMissing(contextLabel || 'identity-gate');
        return false;
    }
    window.emsRunIdentityGate(user, ctx);
    return true;
}

/** Await cloud manifest + identity-gate.js before online login unlock. */
function emsEnsureSecurityStackReady() {
    if (shouldForceStrictOfflineBypass()) {
        return Promise.resolve({ skipped: true, reason: 'strict_offline_bypass' });
    }
    if (typeof window.emsIsOfflineOnly === 'function'
        && window.emsIsOfflineOnly()
        && isNetworkUnavailable()) {
        return Promise.resolve({ skipped: true, reason: 'offline_only' });
    }
    if (emsIsIdentityGateReady()) {
        return Promise.resolve({ ready: true, cached: true });
    }

    var chain = Promise.resolve();
    if (typeof window.emsLoadCloudStack === 'function') {
        chain = window.emsLoadCloudStack();
    } else if (typeof window.emsEnableOnlineMode === 'function') {
        chain = Promise.resolve(window.emsEnableOnlineMode());
    }

    return chain.then(function () {
        if (typeof window.emsInitFirebase === 'function') {
            window.emsInitFirebase();
        }
        return new Promise(function (resolve, reject) {
            var attempts = 0;
            var timer = setInterval(function () {
                attempts++;
                if (emsIsIdentityGateReady()) {
                    clearInterval(timer);
                    resolve({ ready: true });
                } else if (attempts >= 50) {
                    clearInterval(timer);
                    reject(new Error('identity-gate load timeout'));
                }
            }, 100);
        });
    });
}
window.emsEnsureSecurityStackReady = emsEnsureSecurityStackReady;

function tryOfflineLocalBootAnyPlatform(user) {
    if (typeof window.emsHasOfflineSession === 'function' && window.emsHasOfflineSession(user)) {
        if (typeof window.emsRestoreOfflineSessionGlobals === 'function') {
            var restored = window.emsRestoreOfflineSessionGlobals(user);
            if (!restored) return false;
        }
        if (typeof window.applyModuleAccessUI === 'function') {
            try { window.applyModuleAccessUI(); } catch (e) { /* ignore */ }
        }
        if (emsMadrasaBootStarted) return true;
        emsMadrasaBootStarted = true;
        if (typeof window.emsPipelineDebug === 'function') {
            window.emsPipelineDebug('offline_session_boot', {
                tenantId: window.CURRENT_MADRASA_TENANT_ID,
                offline: true,
                platform: isNativeAppEnv() ? 'native' : 'web'
            });
        }
        var bootUser = user || (typeof window.emsOfflineSessionStubUser === 'function'
            ? window.emsOfflineSessionStubUser() : null);
        finishMadrasaLoginOfflineFast(bootUser || { uid: window.CURRENT_MADRASA_TENANT_ID }, window.CURRENT_MADRASA_TENANT_ID);
        return true;
    }

    return false;
}

window.refreshSuperAdminStatus = function (user, callback) {
    callback = callback || function () {};
    if (!user) {
        window.SUPER_ADMIN_CACHE = false;
        callback(false);
        return Promise.resolve(false);
    }

    function finish(isSA) {
        window.SUPER_ADMIN_CACHE = !!isSA;
        try { callback(!!isSA); } catch (e) { /* ignore */ }
        return !!isSA;
    }

    if (typeof window.emsIsNetworkAvailable === 'function' && !window.emsIsNetworkAvailable()) {
        return Promise.resolve(finish(false));
    }

    function hasSuperAdminClaim(tr) {
        var c = (tr && tr.claims) || {};
        if (c.isSuperAdmin === true) return true;
        var roles = c.roles;
        return !!(roles && roles.indexOf && roles.indexOf('super_admin') >= 0);
    }

    function firestoreCheck(firestore) {
        var email = (user.email || '').trim();
        var emailKey = (window.EmsUtils && window.EmsUtils.saEmailDocKey)
            ? window.EmsUtils.saEmailDocKey(email)
            : email.toLowerCase().replace(/[@.]/g, '_');

        return firestore.collection('SuperAdmins').doc(user.uid).get()
            .then(function (doc) {
                if (doc.exists) return true;
                if (emailKey) {
                    return firestore.collection('SuperAdmins').doc(emailKey).get()
                        .then(function (emailDoc) {
                            if (emailDoc.exists) return true;
                            if (!email) return false;
                            return firestore.collection('SuperAdmins').where('email', '==', email).limit(1).get()
                                .then(function (snap) {
                                    if (!snap.empty) return true;
                                    var lower = email.toLowerCase();
                                    if (lower === email) return false;
                                    return firestore.collection('SuperAdmins').where('email', '==', lower).limit(1).get()
                                        .then(function (s2) { return !s2.empty; });
                                });
                        });
                }
                return false;
            });
    }

    function platformUserCheck(firestore) {
        return firestore.collection('Platform_Users').doc(user.uid).get()
            .then(function (snap) {
                if (!snap.exists) return false;
                var gr = snap.data().globalRoles || [];
                return gr.indexOf('super_admin') >= 0;
            });
    }

    function callResolveCf() {
        if (typeof firebase === 'undefined' || !firebase.functions) return Promise.resolve(null);
        try {
            return firebase.functions().httpsCallable('resolveSuperAdminAccess')({})
                .then(function (res) { return res && res.data ? res.data : null; })
                .catch(function (err) {
                    console.warn('resolveSuperAdminAccess:', err && err.message);
                    return null;
                });
        } catch (e) {
            return Promise.resolve(null);
        }
    }

    function syncSaClaimsThenFinish(isSA) {
        if (!isSA) return Promise.resolve(finish(false));
        return callResolveCf().then(function () {
            return user.getIdToken(true).catch(function () {});
        }).then(function () {
            return finish(true);
        });
    }

    function withTimeout(promise, ms) {
        return Promise.race([
            promise,
            new Promise(function (resolve) {
                setTimeout(function () { resolve(null); }, ms || 4500);
            })
        ]);
    }

    function afterDbReady(firestore) {
        return withTimeout(firestoreCheck(firestore).catch(function () { return null; })).then(function (hit) {
            if (hit) return syncSaClaimsThenFinish(true);
            return withTimeout(platformUserCheck(firestore).catch(function () { return null; })).then(function (puHit) {
                if (puHit) return syncSaClaimsThenFinish(true);
                return withTimeout(callResolveCf()).then(function (cf) {
                    if (cf && cf.ok) return syncSaClaimsThenFinish(true);
                    return finish(false);
                });
            });
        });
    }

    return withTimeout(user.getIdTokenResult().catch(function () { return null; }), 4500).then(function (tr) {
        if (hasSuperAdminClaim(tr)) return finish(true);
        var fs = window.getDbOrNull();
        if (fs) return afterDbReady(fs);
        return new Promise(function (resolve) {
            window.waitForDb(function (firestore) {
                afterDbReady(firestore).then(resolve);
            }, function () {
                callResolveCf().then(function (cf) {
                    resolve(finish(!!(cf && cf.ok)));
                });
            });
        });
    }).catch(function () {
        return finish(false);
    });
};

window.isSuperAdminUser = function (user) {
    if (!user) return false;
    return window.SUPER_ADMIN_CACHE === true;
};

window.isSuperAdmin = function () {
    if (window.EMS_OFFLINE_ONLY === true) return false;
    if (typeof firebase === 'undefined' || !firebase.auth) return false;
    return window.isSuperAdminUser(firebase.auth().currentUser);
};

window.getDbOrNull = function () {
    if (typeof db !== 'undefined' && db !== null) return db;
    if (window.EMS_FIRESTORE_DB) return window.EMS_FIRESTORE_DB;
    return null;
};

/** Sync engine شروع — تمام login paths سے call */
window.emsStartSyncEngine = function (user, options) {
    options = options || {};
    var tenantId = (typeof window.emsRequireTenantId === 'function' && window.emsRequireTenantId())
        || (window.emsGetTenantId && window.emsGetTenantId())
        || window.CURRENT_MADRASA_TENANT_ID
        || (typeof window.emsReadPersistedBootTenantId === 'function' && window.emsReadPersistedBootTenantId());
    if (!tenantId) return Promise.resolve({ skipped: true, reason: 'no_tenant' });
    if (typeof window.emsIsOfflineOnly === 'function' && window.emsIsOfflineOnly()) {
        return runLocalBootOnly();
    }
    if (typeof window.emsActivateTenantStorage === 'function') {
        window.emsActivateTenantStorage(tenantId);
    }

    function isDesktopSyncEnv() {
        return window.EMS_DESKTOP_UNLIMITED === true
            || (window.emsDesktop && window.emsDesktop.isDesktop);
    }

    function probeSyncNetwork() {
        if (isDesktopSyncEnv() && typeof window.emsProbeCloudReachable === 'function') {
            return window.emsProbeCloudReachable();
        }
        return Promise.resolve(
            typeof window.emsIsNetworkAvailable === 'function'
                ? window.emsIsNetworkAvailable()
                : !!(navigator && navigator.onLine)
        );
    }

    function runLocalBootOnly() {
        if (typeof window.emsRefreshOfflineMode === 'function') {
            window.emsRefreshOfflineMode();
        }
        if (typeof window.emsRefreshCacheRecordCap === 'function') {
            window.emsRefreshCacheRecordCap();
        }
        if (typeof window.emsBootLiteLogin === 'function') {
            return window.emsBootLiteLogin(tenantId).then(function (lite) {
                return { registrationBoot: lite, offline: true, source: 'local_boot_only' };
            });
        }
        return Promise.resolve({ skipped: true, reason: 'no_boot_fn' });
    }

    function startCloudSyncEngine() {
        if (!window.EmsSyncEngine || typeof window.EmsSyncEngine.init !== 'function') {
            return runLocalBootOnly();
        }
        if (typeof window.emsRefreshOfflineMode === 'function') {
            window.emsRefreshOfflineMode();
        }
        if (typeof window.emsRefreshCacheRecordCap === 'function') {
            window.emsRefreshCacheRecordCap();
        }
        var directInit = (window.EmsDirect && typeof window.EmsDirect.init === 'function')
            ? window.EmsDirect.init().catch(function (e) {
                console.warn('EmsDirect init:', e);
            })
            : Promise.resolve();
        return directInit.then(function () {
            return window.EmsSyncEngine.init(tenantId);
        }).then(function (res) {
        if (typeof window.emsArchivePruneLocalStorage === 'function') {
            try { window.emsArchivePruneLocalStorage(); } catch (e) { /* ignore */ }
        }
        if (typeof window.emsArchiveLoadMeta === 'function') {
            window.emsArchiveLoadMeta().catch(function () { });
        }
        if (options.skipRegistrationBoot) {
            if (typeof window.emsBootLiteLogin === 'function') {
                return window.emsBootLiteLogin(tenantId).then(function (lite) {
                    res.registrationBoot = lite;
                    return res;
                });
            }
            return res;
        }
        if (typeof window.emsBootRegistrationData === 'function') {
            return window.emsBootRegistrationData(tenantId).then(function (boot) {
                res.registrationBoot = boot;
                return res;
            }).catch(function (bootErr) {
                console.warn('Registration boot:', bootErr);
                res.registrationBoot = { ready: false, error: bootErr && bootErr.message };
                return res;
            });
        }
        if (typeof window.emsEnsureRegistrationSync === 'function') {
            return window.emsEnsureRegistrationSync().then(function () { return res; });
        }
            return res;
        }).catch(function (err) {
            console.warn('Sync engine init:', err);
            if (options.skipRegistrationBoot) {
                return Promise.resolve({ skipped: true, syncError: err && err.message });
            }
            var tid = (typeof window.emsRequireTenantId === 'function' && window.emsRequireTenantId())
                || (window.emsGetTenantId && window.emsGetTenantId())
                || window.CURRENT_MADRASA_TENANT_ID;
            if (tid && typeof window.emsBootLiteLogin === 'function') {
                return window.emsBootLiteLogin(tid).catch(function () {
                    return { registrationBoot: { ready: false, error: err && err.message } };
                });
            }
            return Promise.resolve({ skipped: true, syncError: err && err.message });
        });
    }

    return probeSyncNetwork().then(function (online) {
        if (!online && options.allowCloudSync !== true) {
            return runLocalBootOnly();
        }
        return startCloudSyncEngine();
    });
};

/** ماڈیول کھلنے پر — آف لائن فرسٹ: مقامی IDB؛ ورنہ Firestore pull */
window.emsPullModuleGroup = function (groupName) {
    if (typeof window.emsMayPullFromCloud === 'function' && !window.emsMayPullFromCloud()) {
        if (typeof window.emsOfflineModuleStoreHydrateGroup === 'function') {
            return window.emsOfflineModuleStoreHydrateGroup(groupName);
        }
        return Promise.resolve({ pulled: 0, source: 'local_hydrate_only' });
    }
    if (window.EmsDirect && typeof window.EmsDirect.pullGroup === 'function') {
        return window.EmsDirect.pullGroup(groupName);
    }
    if (!window.EmsSyncEngine || typeof window.EmsSyncEngine.pullModuleGroup !== 'function') {
        return Promise.resolve({ pulled: 0 });
    }
    var tenantId = (window.emsGetTenantId && window.emsGetTenantId()) || window.CURRENT_MADRASA_TENANT_ID;
    if (!tenantId) return Promise.resolve({ pulled: 0 });
    return window.EmsSyncEngine.pullModuleGroup(tenantId, groupName);
};

window.waitForDb = function (callback, onFailure) {
    if (typeof window.emsIsOfflineOnly === 'function' && window.emsIsOfflineOnly()) {
        var liveUser = null;
        try { liveUser = firebase.auth && firebase.auth().currentUser; } catch (eLu) { liveUser = null; }
        /* Post native-login must not short-circuit Firestore while user is live. */
        if (!(liveUser && window.EMS_PENDING_NATIVE_GOOGLE_SUCCESS)) {
            dbWaitAttempts = 0;
            if (onFailure) onFailure();
            return;
        }
        window.EMS_OFFLINE_ONLY = false;
    }
    if (isNetworkUnavailable()) {
        dbWaitAttempts = 0;
        if (onFailure) onFailure();
        return;
    }
    const firestore = window.getDbOrNull();
    if (firestore) {
        dbWaitAttempts = 0;
        callback(firestore);
        return;
    }
    dbWaitAttempts += 1;
    var hasLocalTenant = !!(window.CURRENT_MADRASA_TENANT_ID
        || (typeof window.emsReadPersistedBootTenantId === 'function' && window.emsReadPersistedBootTenantId()));
    var maxAttempts = isNetworkUnavailable()
        ? MAX_DB_WAIT_OFFLINE
        : (hasLocalTenant ? MAX_DB_WAIT_TENANT_FALLBACK : MAX_DB_WAIT_ATTEMPTS);
    if (dbWaitAttempts >= maxAttempts) {
        if (onFailure) onFailure();
        return;
    }
    setTimeout(function () {
        window.waitForDb(callback, onFailure);
    }, isNetworkUnavailable() ? 400 : 1000);
};

window.showTopAlert = function (msg, isError) {
    if (typeof isError === 'undefined') isError = true;
    const bgColor = isError ? '#e74c3c' : '#27ae60';
    const alertBox = document.createElement('div');
    var safeMsg = String(msg == null ? '' : msg);
    if (typeof window.emsSanitize === 'function') {
        safeMsg = window.emsSanitize(safeMsg).replace(/\n/g, '<br>');
    } else {
        safeMsg = safeMsg.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\n/g, '<br>');
    }
    safeMsg = safeMsg.replace(/&lt;br&gt;/gi, '<br>');
    alertBox.innerHTML = safeMsg;
    alertBox.style.cssText =
        'position: fixed; top: -100px; left: 0; width: 100%; background: ' + bgColor +
        '; color: white; text-align: center; padding: 15px; font-weight: bold; font-size: 16px;' +
        ' z-index: 9999999; box-shadow: 0 4px 10px rgba(0,0,0,0.3); transition: top 0.5s;' +
        ' direction: rtl; font-family: \'Noto Nastaliq Urdu\', Arial, sans-serif;';
    document.body.appendChild(alertBox);
    setTimeout(function () { alertBox.style.top = '0'; }, 10);
    setTimeout(function () {
        alertBox.style.top = '-100px';
        setTimeout(function () { alertBox.remove(); }, 500);
    }, 4000);
};

function moduleAccessDeniedMessage(modId) {
    const names = {
        admission: 'رجسٹریشن / داخلہ',
        attendance: 'حاضری',
        exams: 'امتحانات',
        curriculum: 'نصاب',
        training: 'تربیت و نظم',
        finance: 'فیس سسٹم',
        ledger: 'مالیات و تنخواہ',
        complaints: 'شکایات',
        announcements: 'اعلانات',
        'ai-studio': 'AI تجزیات'
    };
    return names[modId] || modId;
}

/**
 * مکمل رسائی کنٹرول: globalStatus + subStatus + allowedModules
 */
window.buildDefaultAllowedModules = function (status) {
    status = status || 'free';
    var mods = {};
    (window.LICENSED_MODULE_IDS || []).forEach(function (id) {
        mods[id] = { status: status, expiry: '' };
    });
    return mods;
};

window.hasConfiguredModulePolicy = function (data) {
    if (!data || !data.allowedModules) return false;
    return Object.keys(data.allowedModules).length > 0;
};

window.areAllModulesLocked = function (data) {
    if (!data || !data.allowedModules) return false;
    var ids = window.LICENSED_MODULE_IDS || [];
    if (!ids.length) return false;
    for (var i = 0; i < ids.length; i++) {
        var st = (data.allowedModules[ids[i]] || {}).status || 'locked';
        if (st === 'free' || st === 'trial') return false;
    }
    return true;
};

/** Firestore ڈیٹا normalise — صرف واضح خرابیاں درست کریں (default-open) */
window.normalizeMadrasaAccessData = function (data) {
    if (!data) return data;
    var out = Object.assign({}, data);
    var subStatus = out.subStatus || 'default';

    if (subStatus === 'free') {
        out.allowedModules = window.buildDefaultAllowedModules('free');
        return out;
    }
    /* Firestore میں تمام شعبے locked مگر ادارہ معطل نہیں — غلط کنفیگ، کھول دیں */
    if (window.areAllModulesLocked(out) && subStatus !== 'suspended') {
        out.allowedModules = window.buildDefaultAllowedModules('free');
        return out;
    }
    /* باقی صورتوں میں ڈیٹا جوں کا توں — missing = کھula (locked نہ بھریں) */
    return out;
};

function emsAiStudioAccessAllowed() {
    if (window.EMS_GUEST_MODE && typeof window.emsIsDemoSandbox === 'function' && window.emsIsDemoSandbox()) {
        return window.CURRENT_USER_TENANT_ROLE === 'owner';
    }
    if (window.EMS_GUEST_MODE) return false;
    var role = window.CURRENT_USER_TENANT_ROLE;
    if (role === 'parent' || role === 'guest') return false;
    if (typeof window.emsAiCanUse === 'function') return window.emsAiCanUse();
    return role === 'owner' || role === 'staff';
}

/** ribbon tab + navigation دونوں کے لیے واحد چیک */
window.isModuleTabAllowed = function (modId) {
    if (modId === 'ai-studio') {
        return emsAiStudioAccessAllowed();
    }
    if (modId === 'guest-demo') {
        if (window.EMS_GUEST_MODE) return false;
        return window.CURRENT_USER_TENANT_ROLE === 'guest';
    }
    if (window.CURRENT_USER_TENANT_ROLE === 'parent') {
        return typeof window.emsParentModuleAllowed === 'function'
            ? window.emsParentModuleAllowed(modId)
            : modId === 'parent-portal';
    }
    if (window.CURRENT_USER_TENANT_ROLE === 'staff') {
        if (modId === 'admin-panel' || modId === 'superadmin' || modId === 'parent-portal') return false;
        if (typeof window.emsCheckFullModuleAccess === 'function') {
            return window.emsCheckFullModuleAccess(modId);
        }
        return typeof window.checkStaffModuleAccess === 'function'
            ? window.checkStaffModuleAccess(modId, 'view')
            : false;
    }
    if (window.PUBLIC_MODULE_IDS.indexOf(modId) !== -1) return true;
    if (modId === 'superadmin') return !!(window.isSuperAdmin && window.isSuperAdmin());
    if (modId === 'admin-panel') return !!(window.isMadrasaAdmin && window.isMadrasaAdmin());
    if (modId === 'parent-portal') return window.CURRENT_USER_TENANT_ROLE === 'parent';
    if (window.isSuperAdmin && window.isSuperAdmin()) return true;
    if (typeof window.emsCheckFullModuleAccess === 'function') {
        return window.emsCheckFullModuleAccess(modId);
    }
    return window.checkModuleAccess(modId);
};

/** Firestore میں غلط «سب locked» state یک بار درست کریں */
window.maybePersistModuleAccessRepair = function (firestore, tenantId, rawData) {
    if (!firestore || !tenantId || !rawData) return;
    if ((rawData.subStatus || 'default') === 'suspended') return;
    if (!window.areAllModulesLocked(rawData)) return;
    var user = firebase.auth().currentUser;
    if (!user || !(window.isSuperAdmin && window.isSuperAdmin())) return;
    firestore.collection(typeof window.emsGetTenantRootCollection === 'function'
        ? window.emsGetTenantRootCollection()
        : 'All_Madrasas').doc(tenantId).set({
        subStatus: 'free',
        allowedModules: window.buildDefaultAllowedModules('free'),
        accessAutoRepairedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).catch(function (err) {
        console.warn('Module access auto-repair:', err && err.message);
    });
};

/**
 * Default-open رسائی ماڈل:
 * کوئی شعبہ صرف تب بند ہوتا ہے جب سپر ایڈمن نے اسے واضح طور پر
 * status === 'locked' (یا ختم شدہ trial) سیٹ کیا ہو۔ ورنہ کھula رہتا ہے۔
 */
window.checkModuleAccess = function (modId) {
    if (window.isSuperAdmin()) return true;
    if (window.PUBLIC_MODULE_IDS.indexOf(modId) !== -1) return true;
    if (modId === 'superadmin') return false;

    const data = window.CURRENT_MADRASA_DATA;
    if (!data) return false;

    const subStatus = data.subStatus || 'default';
    if (subStatus === 'suspended') return false;
    if (subStatus === 'free') return true;

    if (window.LICENSED_MODULE_IDS.indexOf(modId) === -1) return true;

    const allowed = data.allowedModules || {};
    const modData = allowed[modId];

    /* واضح کنفیگ نہ ہو → کھula (ادارہ بند نہیں ہے) */
    if (!modData || !modData.status) return true;

    if (modData.status === 'free') return true;
    if (modData.status === 'locked') return false;
    if (modData.status === 'trial') {
        if (!modData.expiry) return true;
        const today = new Date().toISOString().split('T')[0];
        return today <= modData.expiry;
    }
    return true;
};

/** Console تشخیص: window.emsDebugAccess() چلائیں */
window.emsDebugAccess = function () {
    var data = window.CURRENT_MADRASA_DATA || {};
    var report = {
        codeVersion: '20260619',
        isSuperAdmin: !!(window.isSuperAdmin && window.isSuperAdmin()),
        tenantRole: window.CURRENT_USER_TENANT_ROLE,
        subStatus: data.subStatus || '(none)',
        globalStatus: window.SYSTEM_GLOBAL_STATUS,
        allowedModules: data.allowedModules || '(none)',
        perModule: {}
    };
    (window.LICENSED_MODULE_IDS || []).forEach(function (id) {
        report.perModule[id] = window.checkModuleAccess(id);
    });
    if (window.EMS_DEBUG === true || (window.localStorage && window.localStorage.getItem('ems_debug') === '1')) {
        console.table(report.perModule);
        console.log('EMS ACCESS DEBUG:', report);
    }
    return report;
};

window.navigateToModule = function (tab) {
    if (!tab || !tab.id) return false;

    const modId = tab.id.replace('tab-', '');

    if (modId === 'guest-demo' && (window.EMS_GUEST_MODE || window.CURRENT_USER_TENANT_ROLE === 'guest')) {
        var dashRedirect = document.getElementById('tab-dashboard');
        if (dashRedirect) return window.navigateToModule(dashRedirect);
        return false;
    }

    if (modId === 'guest-demo' && !window.EMS_GUEST_MODE && window.CURRENT_USER_TENANT_ROLE !== 'guest') {
        window.showTopAlert('🚫 ڈیمو ماحول صرف مہمان کے لیے ہے۔', true);
        return false;
    }

    if (window.EMS_GUEST_MODE || window.CURRENT_USER_TENANT_ROLE === 'guest') {
        if (window.EMS_GUEST_MODE) {
            /* guest mode always uses full admin shell */
        } else if (modId !== 'guest-demo') {
            window.showTopAlert('🚫 مہمان صرف ڈیمو ڈیش بورڈ دیکھ سکتے ہیں۔', true);
            return false;
        }
    }

    if (modId === 'superadmin' && !window.isSuperAdmin()) {
        window.showTopAlert('🚫 سپر ایڈمن پینل صرف منتظم کے لیے ہے۔', true);
        return false;
    }

    if (modId === 'admin-panel' && !window.isMadrasaAdmin()) {
        window.showTopAlert('🚫 ایڈمن پینل صرف ادارے کے منتظم (مہتمم) کے لیے ہے۔', true);
        return false;
    }

    var mfaGatedModules = {
        'admin-panel': 'ایڈمن پینل',
        'finance': 'فیس سسٹم',
        'ledger': 'مالیات و تنخواہ'
    };
    if (mfaGatedModules[modId] && window.isMadrasaAdmin && window.isMadrasaAdmin()) {
        if (typeof window.emsRequireMfaCompliance === 'function') {
            if (!window.emsRequireMfaCompliance(mfaGatedModules[modId])) return false;
        }
    }

    if (modId === 'parent-portal' && window.CURRENT_USER_TENANT_ROLE !== 'parent') {
        window.showTopAlert('🚫 والدین پورٹل صرف منسلک والدین کے لیے ہے۔', true);
        return false;
    }

    if (modId === 'ai-studio' && !emsAiStudioAccessAllowed()) {
        window.showTopAlert('🚫 AI تجزیات صرف منتظم اور مجاز عملے کے لیے ہے۔', true);
        return false;
    }

    if (window.CURRENT_USER_TENANT_ROLE === 'parent' && modId !== 'parent-portal') {
        window.showTopAlert('🚫 والدین صرف اپنے پورٹل تک رسائی رکھتے ہیں۔', true);
        if (typeof window.emsLogSecurityEvent === 'function') {
            window.emsLogSecurityEvent('parent_module_denied', { module: modId });
        }
        return false;
    }

    if (window.CURRENT_USER_TENANT_ROLE === 'staff') {
        if (modId === 'admin-panel' || modId === 'superadmin' || modId === 'parent-portal') {
            window.showTopAlert('🚫 یہ ماڈیول استاد کے لیے ممنوع ہے۔', true);
            if (typeof window.emsLogSecurityEvent === 'function') {
                window.emsLogSecurityEvent('teacher_module_denied', { module: modId });
            }
            return false;
        }
    }

    if (
        modId !== 'dashboard' &&
        modId !== 'sys-settings' &&
        modId !== 'superadmin' &&
        modId !== 'admin-panel' &&
        modId !== 'ai-studio'
    ) {
        var accessOk = typeof window.isModuleTabAllowed === 'function'
            ? window.isModuleTabAllowed(modId)
            : (typeof window.emsCheckFullModuleAccess === 'function'
                ? window.emsCheckFullModuleAccess(modId)
                : window.checkModuleAccess(modId));
        if (!accessOk) {
            window.showTopAlert(
                '🚫 رسائی ممنوع!<br>شعبہ «' + moduleAccessDeniedMessage(modId) +
                '» آپ کے لیے دستیاب نہیں۔',
                true
            );
            if (typeof window.emsLogSecurityEvent === 'function') {
                window.emsLogSecurityEvent('module_access_denied', { module: modId });
            }
            return false;
        }
    } else if (window.CURRENT_USER_TENANT_ROLE === 'staff' && (modId === 'dashboard' || modId === 'sys-settings')) {
        var staffOk = typeof window.isModuleTabAllowed === 'function'
            ? window.isModuleTabAllowed(modId)
            : false;
        if (!staffOk) {
            window.showTopAlert('🚫 یہ شعبہ آپ کی Staff Permissions میں شامل نہیں۔', true);
            if (typeof window.emsLogSecurityEvent === 'function') {
                window.emsLogSecurityEvent('staff_module_denied', { module: modId });
            }
            return false;
        }
    }

    const tabs = document.querySelectorAll('.ribbon-tab');
    const modules = document.querySelectorAll('.module-view');

    window._emsNavGeneration = (window._emsNavGeneration || 0) + 1;
    var navGen = window._emsNavGeneration;
    window._emsActiveModuleId = modId;

    // ماڈیول بدلتے ہی تمام کھلی ونڈوز (modals) بند کریں
    if (typeof window.emsCloseAllModals === 'function') window.emsCloseAllModals();

    tabs.forEach(function (t) { t.classList.remove('active'); });
    modules.forEach(function (m) {
        m.classList.remove('active');
        m.style.display = 'none';
    });

    tab.classList.add('active');
    const targetId = 'module-' + modId;
    const activeModule = document.getElementById(targetId);

    if (activeModule) {
        activeModule.classList.add('active');
        activeModule.style.display = 'block';
    }

    if (typeof window.sysBtnApplyActionToggles === 'function') window.sysBtnApplyActionToggles(modId);
    if (typeof window.sysBtnTagCoreActions === 'function') window.sysBtnTagCoreActions();

    if (window.EmsI18n && typeof window.EmsI18n.onModuleOpen === 'function') {
        window.EmsI18n.onModuleOpen();
    }

    function bootModule() {
        if (window._emsNavGeneration !== navGen || window._emsActiveModuleId !== modId) return;

        if (typeof window.sysLayoutApplyModule === 'function') window.sysLayoutApplyModule(modId);
        if (modId === 'dashboard') {
            if (typeof window.updateMasterDashboard === 'function') window.updateMasterDashboard();
            if (typeof window.sysDashRenderCustomWidgets === 'function') window.sysDashRenderCustomWidgets();
            if (typeof window.emsStartDashboardLive === 'function') window.emsStartDashboardLive();
            if (!window._emsDashboardDataPulled && typeof window.emsPullModuleGroup === 'function') {
                window._emsDashboardDataPulled = true;
                if (typeof window.emsMayPullFromCloud === 'function' && !window.emsMayPullFromCloud()) {
                    if (typeof window.emsOfflineModuleStoreHydrateGroup === 'function') {
                        ['Finance', 'Ledger', 'Announcements'].forEach(function (group) {
                            window.emsOfflineModuleStoreHydrateGroup(group);
                        });
                    }
                } else {
                    ['Finance', 'Ledger', 'Announcements'].forEach(function (group) {
                        window.emsPullModuleGroup(group);
                    });
                }
            }
        } else if (typeof window.emsStopDashboardLive === 'function') {
            window.emsStopDashboardLive();
        }
        if (modId === 'admission') {
            if (window.RegistrationModule && typeof window.RegistrationModule.init === 'function') {
                window.RegistrationModule.init();
            }
            if (typeof window.emsOpenRegistration === 'function') {
                window.emsOpenRegistration();
            }
        }
        if (modId === 'attendance' && typeof window.emsOpenAttendance === 'function') {
            window.emsOpenAttendance();
        }
        if (modId === 'complaints' && typeof window.emsOpenComplaints === 'function') {
            window.emsOpenComplaints();
        }
        if (modId === 'exams' && typeof window.emsOpenExams === 'function') {
            window.emsOpenExams();
        }
        if (modId === 'curriculum' && typeof window.curInitModule === 'function') {
            window.curInitModule();
        }
        if (modId === 'training' && typeof window.tarInitModule === 'function') {
            window.tarInitModule();
        }
        if (modId === 'finance' && typeof window.emsOpenFinance === 'function') {
            window.emsOpenFinance();
        }
        if (modId === 'ledger' && typeof window.emsOpenLedger === 'function') {
            window.emsOpenLedger();
        }
        if (modId === 'sys-settings' && typeof window.refreshSysSettings === 'function') {
            window.refreshSysSettings();
        } else if (modId === 'sys-settings' && typeof loadSystemSettingsUI === 'function') {
            loadSystemSettingsUI();
        }
        if (modId === 'sys-settings' && typeof window.emsDiagnosticsUIInit === 'function') {
            window.emsDiagnosticsUIInit();
        }
        if (modId === 'superadmin' && typeof window.initSuperAdminPanel === 'function') {
            window.initSuperAdminPanel();
        } else if (modId === 'superadmin' && typeof window.loadSuperAdminData === 'function') {
            window.loadSuperAdminData();
        }
        if (modId === 'admin-panel' && typeof window.initAdminPanel === 'function') {
            window.initAdminPanel();
        }
        if (modId === 'parent-portal' && typeof window.initParentPortal === 'function') {
            window.initParentPortal();
        }
        if (modId === 'guest-demo' && typeof window.initGuestDemo === 'function') {
            if (window.EMS_GUEST_MODE || window.CURRENT_USER_TENANT_ROLE === 'guest') {
                return;
            }
            window.initGuestDemo();
        }
        if (modId === 'ai-studio') {
            if (typeof window.emsEnsureAiClient === 'function') {
                window.emsEnsureAiClient().catch(function () { /* studio shows offline banner */ });
            }
            if (typeof window.emsAiStudioInit === 'function') {
                window.emsAiStudioInit();
            } else if (typeof window.emsAiStudioRefresh === 'function') {
                window.emsAiStudioRefresh();
            }
        }

        var syncGroupMap = {
            'admission': 'Registration',
            'attendance': 'Attendance',
            'exams': 'Exams',
            'curriculum': 'Curriculum',
            'training': 'Training',
            'finance': 'Finance',
            'ledger': 'Ledger',
            'announcements': 'Announcements',
            'admin-panel': 'Admin',
            'sys-settings': 'SystemSettings'
        };
        if (modId === 'complaints') {
            var cmpChain = (window.CmpCloud && typeof window.CmpCloud.init === 'function')
                ? window.CmpCloud.init().catch(function () { return null; })
                : Promise.resolve(null);
            cmpChain.then(function () {
                if (typeof window.emsMayPullFromCloud === 'function' && !window.emsMayPullFromCloud()) {
                    return;
                }
                if (typeof window.syncComplaintsFromCloud === 'function') {
                    window.syncComplaintsFromCloud(false);
                }
            });
        } else if (syncGroupMap[modId] && typeof window.emsPullModuleGroup === 'function') {
            window.emsPullModuleGroup(syncGroupMap[modId]).then(function () {
                if (modId === 'exams' && typeof window.refreshExamData === 'function') window.refreshExamData();
                if (modId === 'curriculum' && typeof window.curInitModule === 'function') window.curInitModule();
                if (modId === 'training' && typeof window.tarInitModule === 'function') window.tarInitModule();
                if (modId === 'finance' && typeof window.refreshFinanceData === 'function') window.refreshFinanceData();
                if (modId === 'ledger' && typeof window.refreshLedgerData === 'function') window.refreshLedgerData();
                if (modId === 'announcements' && typeof window.refreshAnnData === 'function') window.refreshAnnData();
                if (modId === 'admin-panel' && typeof window.initAdminPanel === 'function') window.initAdminPanel();
            });
        }
        if (modId === 'sys-settings' && typeof window.emsInitMfaUI === 'function') {
            window.emsInitMfaUI();
        }
    }

    var lazyLoad = typeof window.emsLazyLoadModule === 'function'
        ? window.emsLazyLoadModule(modId)
        : Promise.resolve();
    var REGISTRATION_MODULES = {
        admission: 1, attendance: 1, finance: 1, ledger: 1, exams: 1,
        curriculum: 1, training: 1, complaints: 1, 'parent-portal': 1, 'ai-studio': 1
    };
    var usersReady = REGISTRATION_MODULES[modId] && typeof window.emsEnsureRepositoryReady === 'function'
        ? window.emsEnsureRepositoryReady()
        : Promise.resolve({ ready: true, source: 'skipped' });
    Promise.all([lazyLoad, usersReady]).then(function (results) {
        if (window._emsNavGeneration !== navGen) return;
        var bootRes = results[1];
        if (bootRes && bootRes.hydrationFailed) {
            if (typeof window.showTopAlert === 'function') {
                window.showTopAlert('⚠️ رجسٹریشن ڈیٹا لوڈ نہیں ہوا — ماڈیول محدود موڈ میں کھولا گیا۔', true);
            }
        }
        if (typeof window.emsDeferModuleWork === 'function') {
            window.emsDeferModuleWork(bootModule, { idle: true, timeout: 200 });
        } else if (typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(function () { setTimeout(bootModule, 0); });
        } else {
            setTimeout(bootModule, 0);
        }
    }).catch(function (err) {
        if (window._emsNavGeneration !== navGen) return;
        console.warn('EMS lazy load failed:', err);
        if (typeof window.emsDeferModuleWork === 'function') {
            window.emsDeferModuleWork(bootModule, { idle: true });
        } else {
            bootModule();
        }
    });

    return true;
};

/**
 * ادارہ ایڈمن (مہتمم) کی شناخت۔ موجودہ single-login معماری میں مدرسے کا مالک
 * ہی اپنے ادارے کا ایڈمن ہے؛ سپر ایڈمن بھی رسائی رکھتا ہے۔ مستقبل میں عملہ
 * logins کے لیے یہ 'admin'/'owner' role پر منتقل ہو جائے گا۔
 */
window.isMadrasaAdmin = function () {
    if (typeof window.emsIsDemoSandbox === 'function' && window.emsIsDemoSandbox()) return true;
    if (window.EMS_OFFLINE_ONLY === true || window.EMS_LOCAL_AUTH === true) {
        if (window.EMS_GUEST_MODE || window.CURRENT_USER_TENANT_ROLE === 'guest') return false;
        return window.CURRENT_USER_TENANT_ROLE === 'owner' || !!window.CURRENT_MADRASA_TENANT_ID;
    }
    if (typeof firebase === 'undefined' || !firebase.auth) {
        return window.CURRENT_USER_TENANT_ROLE === 'owner';
    }
    var user = firebase.auth().currentUser;
    if (!user) return false;
    if (window.isSuperAdmin && window.isSuperAdmin()) return true;
    if (window.CURRENT_USER_TENANT_ROLE === 'owner') return true;
    if (window.CURRENT_MADRASA_TENANT_ID && user.uid === window.CURRENT_MADRASA_TENANT_ID && window.CURRENT_MADRASA_DATA) {
        return true;
    }
    if (typeof window.can === 'function' && (window.can('users.manage') || window.can('rbac.assign'))) return true;
    if (window.emsGetStaffRecordForCurrentUser && window.emsGetStaffRecordForCurrentUser()) return false;
    return !!window.CURRENT_MADRASA_DATA && window.CURRENT_USER_TENANT_ROLE !== 'staff';
};

function subscribeGlobalSettings(firestore) {
    if (unsubGlobalSettings) {
        unsubGlobalSettings();
        unsubGlobalSettings = null;
    }
    unsubGlobalSettings = firestore.collection('System_Settings').doc('Subscription')
        .onSnapshot(function (doc) {
            window.SYSTEM_GLOBAL_STATUS = doc.exists && doc.data().globalStatus
                ? doc.data().globalStatus
                : 'free';
            if (window.CURRENT_MADRASA_DATA && typeof window.normalizeMadrasaAccessData === 'function') {
                window.CURRENT_MADRASA_DATA = window.normalizeMadrasaAccessData(window.CURRENT_MADRASA_DATA);
            }
            if (typeof window.applyModuleAccessUI === 'function') {
                window.applyModuleAccessUI();
            }
        }, function (err) {
            console.warn('Global settings listener:', err);
        });

    if (unsubSystemSettings) {
        unsubSystemSettings();
        unsubSystemSettings = null;
    }
    unsubSystemSettings = firestore.collection('System_Settings').doc('System')
        .onSnapshot(function (doc) {
            var d = doc.exists ? doc.data() : {};
            window.SYSTEM_MAINTENANCE_MODE = d.maintenanceMode === 'on';
            window.SYSTEM_MAINTENANCE_MSG = d.maintenanceMessage || 'سسٹم اپڈیٹ جاری ہے۔ براہ کرم بعد میں کوشش کریں۔';
        }, function (err) {
            console.warn('System settings listener:', err);
        });
}

var emsPortalRoutedOnce = false;
var emsMadrasaBootStarted = false;

function isNativeAppEnv() {
    return typeof window.emsIsNativeApp === 'function' && window.emsIsNativeApp();
}

function isDesktopBootEnv() {
    if (isNativeAppEnv()) return true;
    if (window.EMS_DESKTOP_UNLIMITED === true) return true;
    if (window.emsDesktop && window.emsDesktop.isDesktop) return true;
    try {
        if (window.location && window.location.search) {
            if (window.location.search.indexOf('desktop=1') >= 0) return true;
            if (window.location.search.indexOf('localBundle=1') >= 0) return true;
        }
    } catch (e) { /* ignore */ }
    return false;
}

function hasDesktopLocalBootData(user) {
    if (typeof window.emsHasDesktopOfflineBootCache === 'function' && window.emsHasDesktopOfflineBootCache()) {
        return true;
    }
    if (typeof window.emsHasOfflineSession === 'function' && window.emsHasOfflineSession(user)) {
        return true;
    }
    if (typeof window.emsReadPersistedBootTenantId === 'function' && window.emsReadPersistedBootTenantId()) {
        return true;
    }
    return false;
}

/** Offline-only local boot — web legacy fallback ONLY (never on native apps). */
function tryOfflineLocalBoot() {
    if (isNativeAppEnv()) return false;
    if (typeof window.emsIsOfflineOnly !== 'function' || !window.emsIsOfflineOnly()) {
        return false;
    }
    if (emsMadrasaBootStarted || document.body.classList.contains('ems-authenticated')) {
        return true;
    }

    var stub = (typeof window.emsGetOfflineLocalUser === 'function')
        ? window.emsGetOfflineLocalUser()
        : { uid: 'local_admin', email: 'admin@local' };
    window.EMS_LOCAL_AUTH = true;
    window.EMS_GUEST_MODE = false;

    if (typeof window.emsHasOfflineSession === 'function' && window.emsHasOfflineSession(null)) {
        if (typeof window.emsRestoreOfflineSessionGlobals === 'function') {
            window.emsRestoreOfflineSessionGlobals(null);
        }
    } else {
        var tenantId = typeof window.emsEnsureLocalTenantId === 'function'
            ? window.emsEnsureLocalTenantId()
            : null;
        if (!tenantId) return false;
        if (typeof window.emsActivateTenantStorage === 'function') {
            window.emsActivateTenantStorage(tenantId);
        }
        window.CURRENT_MADRASA_TENANT_ID = tenantId;
        window.CURRENT_USER_TENANT_ROLE = 'owner';
        var profileStub = { madrasaName: 'مقامی مدرسہ', subStatus: 'free' };
        try {
            var branding = window.EmsBranding && window.EmsBranding.get ? window.EmsBranding.get() : null;
            if (branding && branding.madrasaName) profileStub.madrasaName = branding.madrasaName;
        } catch (e) { /* ignore */ }
        window.CURRENT_MADRASA_DATA = typeof window.normalizeMadrasaAccessData === 'function'
            ? window.normalizeMadrasaAccessData(profileStub)
            : profileStub;
    }

    if (typeof window.emsSetIntendedPortal === 'function' && !window.emsGetIntendedPortal()) {
        window.emsSetIntendedPortal('admin');
    }

    if (typeof window.emsSetBootSplashMessage === 'function') {
        window.emsSetBootSplashMessage('مقامی سسٹم لوڈ ہو رہا ہے…');
    }

    emsMadrasaBootStarted = true;
    if (typeof window.emsBootMark === 'function') {
        window.emsBootMark('offline-local-boot-start');
    }
    finishMadrasaLogin(stub, null);
    return true;
}

window.emsStartOfflineLocalApp = function () {
    // Restore the durable tenant id from IndexedDB BEFORE resolving a tenant,
    // so a wiped localStorage recovers the existing institution instead of
    // generating a new (orphaned) one.
    var pre = (typeof window.emsIdbRestoreTenantId === 'function')
        ? window.emsIdbRestoreTenantId()
        : Promise.resolve(null);
    return Promise.resolve(pre).then(function () {
        return { ok: tryOfflineLocalBoot() };
    });
};

function tryNativeInstantBootWithoutAuth() {
    if (!isNativeAppEnv()) return false;
    var stub = (typeof window.emsOfflineSessionStubUser === 'function')
        ? window.emsOfflineSessionStubUser()
        : null;
    var hasSession = stub && typeof window.emsHasOfflineSession === 'function' && window.emsHasOfflineSession(stub);
    var hasTenant = typeof window.emsReadPersistedBootTenantId === 'function' && window.emsReadPersistedBootTenantId();
    if (!hasSession && !hasTenant) return false;
    if (typeof window.emsSetBootSplashMessage === 'function') {
        window.emsSetBootSplashMessage('مقامی ڈیٹا لوڈ ہو رہا ہے…');
    }
    if (typeof window.emsShowRegistrationBootOverlay === 'function') {
        window.emsShowRegistrationBootOverlay(true, 'آف لائن موڈ — مقامی ڈیٹا لوڈ ہو رہا ہے…');
    }
    if (hasSession) {
        return tryOfflineSessionBoot(stub);
    }
    return tryLocalIdbOnlyBoot(stub || { uid: hasTenant || 'offline_native' });
}

function tryNativeInstantBootAfterIdbRestore() {
    if (!isNativeAppEnv()) return Promise.resolve(false);
    var restore = (typeof window.emsIdbRestoreTenantId === 'function')
        ? window.emsIdbRestoreTenantId()
        : Promise.resolve(null);
    return restore.then(function () {
        return tryNativeInstantBootWithoutAuth();
    }).catch(function () {
        return tryNativeInstantBootWithoutAuth();
    });
}

/** @deprecated alias — use tryNativeInstantBootWithoutAuth */
function tryOfflineDesktopBootWithoutAuth() {
    return tryNativeInstantBootWithoutAuth();
}

window.emsTryNativeInstantBootImpl = tryNativeInstantBootWithoutAuth;

window.emsDesktopOfflineBootDiagnostics = function () {
    return {
        isDesktop: isDesktopBootEnv(),
        origin: typeof location !== 'undefined' ? location.origin : null,
        diskSession: window.EMS_BOOT_SESSION_FROM_DISK || null,
        hasCache: typeof window.emsHasDesktopOfflineBootCache === 'function'
            ? window.emsHasDesktopOfflineBootCache() : null,
        session: typeof window.emsReadOfflineSession === 'function'
            ? window.emsReadOfflineSession() : null,
        tenantId: typeof window.emsReadPersistedBootTenantId === 'function'
            ? window.emsReadPersistedBootTenantId() : null,
        cloudReachable: window.EMS_CLOUD_REACHABLE,
        networkAvailable: typeof window.emsIsNetworkAvailable === 'function'
            ? window.emsIsNetworkAvailable() : null,
        madrasaBootStarted: emsMadrasaBootStarted,
        authUid: (function () {
            try {
                if (typeof firebase === 'undefined' || !firebase.auth) return null;
                var u = firebase.auth().currentUser;
                return u ? u.uid : null;
            } catch (e) { return null; }
        })()
    };
};

window.emsUpdateOfflineContinueButton = function () {
    var btn = document.getElementById('btn-auth-offline-continue');
    var hint = document.getElementById('ems-login-offline-hint');
    var landingBtn = document.getElementById('btn-landing-offline-continue');
    var landingHint = document.getElementById('ems-landing-offline-hint');
    var show = isNativeAppEnv()
        && typeof window.emsHasNativeInstantBootCache === 'function'
        && window.emsHasNativeInstantBootCache();
    if (btn) btn.style.display = show ? 'block' : 'none';
    if (hint) hint.style.display = show ? 'block' : 'none';
    if (landingBtn) landingBtn.style.display = show ? 'inline-flex' : 'none';
    if (landingHint) landingHint.style.display = show ? 'block' : 'none';
};

var nativeInstantAutoBootTimer = null;
window.emsScheduleNativeInstantAutoBoot = function () {
    if (!isNativeAppEnv()) return;
    if (window.EMS_GOOGLE_AUTH_IN_PROGRESS) return;
    if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) return;
    if (typeof window.emsHasNativeInstantBootCache !== 'function' || !window.emsHasNativeInstantBootCache()) {
        return;
    }
    if (nativeInstantAutoBootTimer) return;
    nativeInstantAutoBootTimer = setTimeout(function () {
        nativeInstantAutoBootTimer = null;
        if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) return;
        if (emsMadrasaBootStarted) return;
        if (document.body.classList.contains('ems-authenticated')) return;
        tryNativeInstantBootWithoutAuth();
    }, 0);
};

var desktopOfflineAutoBootTimer = null;
window.emsScheduleDesktopOfflineAutoBoot = function () {
    window.emsScheduleNativeInstantAutoBoot();
    if (!isDesktopBootEnv()) return;
    if (window.EMS_GOOGLE_AUTH_IN_PROGRESS) return;
    if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) return;
    if (typeof window.emsHasDesktopOfflineBootCache !== 'function' || !window.emsHasDesktopOfflineBootCache()) {
        return;
    }
    if (emsMadrasaBootStarted || document.body.classList.contains('ems-authenticated')) return;

    if (tryNativeInstantBootWithoutAuth()) return;

    if (desktopOfflineAutoBootTimer) return;
    desktopOfflineAutoBootTimer = setTimeout(function () {
        desktopOfflineAutoBootTimer = null;
        if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) return;
        if (emsMadrasaBootStarted) return;
        if (document.body.classList.contains('ems-authenticated')) return;
        if (tryNativeInstantBootWithoutAuth()) return;
        if (typeof window.emsUpdateOfflineContinueButton === 'function') {
            window.emsUpdateOfflineContinueButton();
        }
    }, 200);
};

window.emsContinueOfflineDesktop = function () {
    if (tryOfflineLocalBootAnyPlatform(
        typeof firebase !== 'undefined' && firebase.auth ? firebase.auth().currentUser : null
    )) {
        return;
    }
    if (tryNativeInstantBootWithoutAuth()) return;
    if (typeof window.emsStartOfflineLocalApp === 'function') {
        window.emsStartOfflineLocalApp().then(function (res) {
            if (res && res.ok) return;
            window.showTopAlert(
                '⚠️ آف لائن سیشن نہیں ملا۔<br>پہلی بار آن لائن لاگ اِن کریں، پھر آف لائن کام کر سکیں گے۔',
                true
            );
        });
        return;
    }
    window.showTopAlert(
        '⚠️ آف لائن سیشن نہیں ملا۔<br>پہلی بار Gmail سے لاگ اِن کریں، پھر آف لائن کام کر سکیں گے۔',
        true
    );
};

function tryOfflineSessionBoot(user) {
    return tryOfflineLocalBootAnyPlatform(user);
}

/** Persisted tenant + IDB when offline session snapshot is missing */
function tryLocalIdbOnlyBoot(user) {
    return tryOfflineLocalBootAnyPlatform(user);
}

function tryOfflineDesktopBoot(user) {
    return tryOfflineLocalBootAnyPlatform(user);
}

window.emsAuthMarkPortalRouted = function () {
    emsPortalRoutedOnce = true;
};

function showAuthGateway() {
    if (shouldForceStrictOfflineBypass()) {
        attemptStrictOfflineBoot();
        return;
    }
    if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) {
        return;
    }
    if (window.EMS_GUEST_MODE) return;
    const profileGateway = document.getElementById('profile-setup-gateway');
    if (profileGateway) profileGateway.style.display = 'none';
    emsPortalRoutedOnce = false;
    if (typeof window.emsShowLanding === 'function') {
        window.emsShowLanding();
    }
    if (typeof window.emsUpdateOfflineContinueButton === 'function') {
        window.emsUpdateOfflineContinueButton();
    }
    document.body.style.overflow = 'hidden';
}

function desktopOfflineFailedGateway() {
    if (shouldForceStrictOfflineBypass()) {
        attemptStrictOfflineBoot();
        return;
    }
    if (typeof window.emsShowRegistrationBootOverlay === 'function') {
        window.emsShowRegistrationBootOverlay(false);
    }
    if (typeof window.emsUpdateOfflineContinueButton === 'function') {
        window.emsUpdateOfflineContinueButton();
    }
    showAuthGateway();
}

function showProfileSetup() {
    const profileGateway = document.getElementById('profile-setup-gateway');
    const loginPanel = document.getElementById('ems-login-panel');
    const landing = document.getElementById('ems-landing');
    if (loginPanel) loginPanel.style.display = 'none';
    if (landing) landing.style.display = 'none';
    if (profileGateway) profileGateway.style.display = 'flex';
    if (typeof window.emsApplyProfileSetupLang === 'function') {
        window.emsApplyProfileSetupLang();
    }
    document.body.style.overflow = 'hidden';
}

/** Post-login boot diagnostics (visible panel + logcat). */
window.EMS_POST_LOGIN_DIAG = window.EMS_POST_LOGIN_DIAG || {
    startedAt: 0,
    last_stage: 'init',
    stages: {}
};

function emsPostLoginDiagMark(key, value) {
    try {
        var d = window.EMS_POST_LOGIN_DIAG || (window.EMS_POST_LOGIN_DIAG = { stages: {} });
        d.stages[key] = value;
        if (key === 'last_stage') d.last_stage = value;
        else d[key] = value;
        d.updatedAt = Date.now();
        console.info('[EMS:post-login]', key, value);
        var panel = document.getElementById('ems-post-login-diag');
        if (panel && panel.style.display !== 'none') {
            var pre = panel.querySelector('pre');
            if (pre) pre.textContent = JSON.stringify(d, null, 2);
        }
    } catch (eDiag) { /* ignore */ }
}

function emsHidePostLoginBootFailure() {
    var panel = document.getElementById('ems-post-login-fail');
    if (panel) panel.style.display = 'none';
    var diag = document.getElementById('ems-post-login-diag');
    if (diag) diag.style.display = 'none';
}

function emsShowPostLoginBootFailure(stage, message) {
    emsPostLoginDiagMark('last_stage', stage || 'failed');
    emsPostLoginDiagMark('error', message || stage);
    window.EMS_PENDING_NATIVE_GOOGLE_SUCCESS = false;
    if (typeof window.emsClearLandingAuthLoading === 'function') {
        window.emsClearLandingAuthLoading();
    }
    /* Keep exactly one visible surface: recovery panel (landing may stay under it). */
    if (document.documentElement) {
        document.documentElement.classList.remove('ems-offline-no-signin', 'ems-booting');
    }
    var landing = document.getElementById('ems-landing');
    if (landing) {
        landing.style.display = 'flex';
        landing.style.visibility = 'visible';
    }
    document.body.classList.add('ems-locked');
    document.body.classList.remove('ems-authenticated');

    var panel = document.getElementById('ems-post-login-fail');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'ems-post-login-fail';
        panel.setAttribute('role', 'alert');
        panel.style.cssText = 'position:fixed;inset:0;z-index:1000001;background:#7f1d1d;color:#fff;'
            + 'padding:24px 18px;overflow:auto;font-family:Segoe UI,Tahoma,sans-serif;direction:rtl;';
        panel.innerHTML = '<h2 style="margin:0 0 10px;font-size:18px;">لاگ ان کے بعد بوٹ ناکام</h2>'
            + '<p id="ems-post-login-fail-msg" style="margin:0 0 12px;font-size:14px;line-height:1.5;"></p>'
            + '<div id="ems-post-login-diag" style="background:rgba(0,0,0,.25);border-radius:8px;padding:10px;margin:12px 0;">'
            + '<strong style="font-size:12px;">تشخیصی تفصیل</strong><pre style="white-space:pre-wrap;font-size:11px;margin:8px 0 0;direction:ltr;text-align:left;"></pre></div>'
            + '<button type="button" id="ems-post-login-retry" style="margin-top:8px;padding:10px 16px;font-weight:700;border:0;border-radius:8px;background:#fff;color:#7f1d1d;">دوبارہ کوشش</button>'
            + '<button type="button" id="ems-post-login-signout" style="margin-top:8px;margin-right:8px;padding:10px 16px;font-weight:700;border:0;border-radius:8px;background:#450a0a;color:#fff;">سائن آؤٹ</button>';
        document.body.appendChild(panel);
        var retry = panel.querySelector('#ems-post-login-retry');
        if (retry) {
            retry.addEventListener('click', function () {
                panel.style.display = 'none';
                var u = null;
                try { u = firebase.auth().currentUser; } catch (eU) { u = null; }
                if (u && typeof listenMadrasaProfile === 'function') {
                    window.__emsPostLoginDbRetry = false;
                    window.EMS_OFFLINE_ONLY = false;
                    listenMadrasaProfile(u);
                } else if (typeof window.emsShowLanding === 'function') {
                    window.emsShowLanding();
                }
            });
        }
        var so = panel.querySelector('#ems-post-login-signout');
        if (so) {
            so.addEventListener('click', function () {
                panel.style.display = 'none';
                try { firebase.auth().signOut(); } catch (eSo) { /* ignore */ }
                if (typeof window.emsShowLanding === 'function') window.emsShowLanding();
            });
        }
    }
    panel.style.display = 'block';
    var msgEl = document.getElementById('ems-post-login-fail-msg');
    if (msgEl) {
        msgEl.textContent = String(message || stage || 'نامعلوم خرابی')
            + ' (stage: ' + String(stage || 'unknown') + ')';
    }
    var pre = panel.querySelector('pre');
    if (pre) pre.textContent = JSON.stringify(window.EMS_POST_LOGIN_DIAG || {}, null, 2);
    window.showTopAlert('⚠️ ' + String(message || stage), true);
}

window.emsShowPostLoginBootFailure = emsShowPostLoginBootFailure;
window.emsPostLoginDiagMark = emsPostLoginDiagMark;

function unlockAppScreen() {
    const profileGateway = document.getElementById('profile-setup-gateway');
    if (profileGateway) profileGateway.style.display = 'none';
    /* Unlock shell BEFORE dismissing splash — reverse order caused white flash. */
    if (typeof window.emsHideLanding === 'function') {
        window.emsHideLanding();
    } else if (typeof window.emsDismissLoginUi === 'function') {
        window.emsDismissLoginUi();
        document.body.classList.remove('ems-locked');
        document.body.classList.add('ems-authenticated');
    }
    if (typeof window.emsClearBootStuckWatchdog === 'function') {
        window.emsClearBootStuckWatchdog();
    }
    if (typeof window.emsApplyStatusBar === 'function') {
        window.emsApplyStatusBar('app');
    }
    if (typeof window.emsDismissBootSplash === 'function') {
        window.emsDismissBootSplash();
    }
    var sp = document.getElementById('global-spinner');
    if (sp) {
        sp.style.display = 'none';
        sp.classList.remove('ems-boot-overlay');
        sp.innerHTML = '';
    }
    if (typeof window.applyModuleAccessUI === 'function') {
        window.applyModuleAccessUI();
    }
    if (typeof window.emsStartSessionIdleWatch === 'function') {
        window.emsStartSessionIdleWatch();
    }
    if (!emsPortalRoutedOnce && typeof window.emsRouteAfterLogin === 'function') {
        emsPortalRoutedOnce = true;
        window.emsRouteAfterLogin();
    }
    if (typeof window.emsUpdateGlobalSyncButton === 'function') {
        window.emsUpdateGlobalSyncButton();
    }
    document.body.style.overflow = 'auto';

    /* Future native launches may be offline-first — only AFTER a successful unlock. */
    if (typeof window.emsIsNativeApp === 'function' && window.emsIsNativeApp()
        && window.CURRENT_MADRASA_TENANT_ID
        && typeof window.emsFinalizeNativeInstantBootMode === 'function') {
        try { window.emsFinalizeNativeInstantBootMode(); } catch (eFin) { /* ignore */ }
    }
    if (window.EMS_PENDING_NATIVE_GOOGLE_SUCCESS) {
        window.EMS_PENDING_NATIVE_GOOGLE_SUCCESS = false;
        window.showTopAlert('✅ گوگل لاگ ان کامیاب — ادارہ کھل گیا', false);
    }
    emsPostLoginDiagMark('app_unlocked', true);
    emsPostLoginDiagMark('last_stage', 'app_unlocked');
    emsHidePostLoginBootFailure();
}

function handleSuspendedMadrasa() {
    showAuthGateway();
    window.showTopAlert('🚫 سسٹم معطل!<br>ایڈمنسٹریٹر سے رابطہ کریں۔', true);
    firebase.auth().signOut();
}

/** پرانی offline cache سے غلط suspended نہ ہو — سرور سے تصدیق */
function verifySubStatusFromServer(firestore, uid, callback) {
    firestore.collection('All_Madrasas').doc(uid).get({ source: 'server' })
        .then(function (serverDoc) {
            callback(null, serverDoc.exists ? serverDoc.data() : null);
        })
        .catch(function (err) {
            callback(err, null);
        });
}

function handleMaintenanceMode() {
    showAuthGateway();
    window.showTopAlert(
        '🔧 مینٹیننس موڈ<br>' + (window.SYSTEM_MAINTENANCE_MSG || 'سسٹم عارضی طور پر بند ہے۔'),
        true
    );
    firebase.auth().signOut();
}

/** Offline-only — skip cloud sync / security hooks; load local data and unlock UI. */
function finishMadrasaLoginOfflineFast(user, tenantId) {
    var restoreTenant = (typeof window.emsIdbRestoreTenantId === 'function')
        ? window.emsIdbRestoreTenantId()
        : Promise.resolve(null);
    var postAuth = restoreTenant.then(function () {
        return (typeof window.emsEnsurePostAuthScripts === 'function')
            ? window.emsEnsurePostAuthScripts()
            : Promise.resolve();
    });
    return postAuth.then(function () {
        if (typeof window.emsSetBootSplashMessage === 'function') {
            window.emsSetBootSplashMessage('مقامی ڈیٹا لوڈ ہو رہا ہے…');
        }
        var bootFn = (typeof window.emsBootLiteLogin === 'function')
            ? window.emsBootLiteLogin(tenantId)
            : Promise.resolve({ ready: true, count: 0, hydrationComplete: true });
        return bootFn.then(function () {
            if (typeof window.emsShowRegistrationBootOverlay === 'function') {
                window.emsShowRegistrationBootOverlay(false);
            }
            unlockAppScreen();
            if (typeof window.emsBootMark === 'function') {
                window.emsBootMark('app-shell-unlocked');
            }
            if (typeof window.emsPersistOfflineSession === 'function') {
                window.emsPersistOfflineSession(user);
            }
            if (typeof window.updateMasterDashboard === 'function') {
                try { window.updateMasterDashboard(); } catch (e) { /* ignore */ }
            }
            return { ready: true, source: 'offline_fast', offline: true };
        });
    }).catch(function (err) {
        console.warn('[EMS] offline fast boot:', err);
        if (typeof window.emsShowRegistrationBootOverlay === 'function') {
            window.emsShowRegistrationBootOverlay(false);
        }
        unlockAppScreen();
        return { ready: false, source: 'offline_fast_error', error: err && err.message };
    });
}

function finishMadrasaLogin(user, firestore) {
    if (typeof window.emsMarkLoginStart === 'function') {
        window.emsMarkLoginStart();
    }
    if (typeof window.emsBootMark === 'function') {
        window.emsBootMark('post-login-boot-start', user && user.uid);
    }
    var tenantId = window.CURRENT_MADRASA_TENANT_ID
        || window.EMS_ACTIVE_TENANT_ID
        || (typeof window.emsReadPersistedBootTenantId === 'function' && window.emsReadPersistedBootTenantId())
        || null;
    if (!tenantId && typeof window.emsRequireTenantId === 'function') {
        try {
            tenantId = window.emsRequireTenantId();
        } catch (eTid) {
            console.warn('[EMS] emsRequireTenantId failed during login boot:', eTid);
            tenantId = null;
        }
    }
    if (tenantId && typeof window.emsLiteLoginPrepare === 'function') {
        window.emsLiteLoginPrepare(tenantId);
    } else if (tenantId && typeof window.emsActivateTenantStorage === 'function') {
        window.emsActivateTenantStorage(tenantId);
    }

    if (typeof window.emsIsOfflineOnly === 'function' && window.emsIsOfflineOnly()) {
        return finishMadrasaLoginOfflineFast(user, tenantId);
    }

    if (isNetworkUnavailable() && tenantId) {
        return finishMadrasaLoginOfflineFast(user, tenantId);
    }

    var postAuth = (typeof window.emsEnsurePostAuthScripts === 'function')
        ? window.emsEnsurePostAuthScripts()
        : Promise.resolve();
    return postAuth.then(function () {
        if (typeof window.emsInitSession === 'function') {
            window.emsInitSession(user);
        }
        if (typeof window.emsApplyMfaComplianceGate === 'function') {
            window.emsApplyMfaComplianceGate();
        }
        if (typeof window.emsLogSecurityEvent === 'function') {
            window.emsLogSecurityEvent('login_success', { uid: user.uid });
        }
        if (typeof window.emsRegisterLoginSession === 'function') {
            window.emsRegisterLoginSession(user, tenantId || user.uid).catch(function () { });
        }

        if (typeof window.emsShowRegistrationBootOverlay === 'function') {
            window.emsShowRegistrationBootOverlay(true, 'مقامی ڈیٹا لوڈ ہو رہا ہے…');
        }

        return window.emsStartSyncEngine(user, { skipRegistrationBoot: true }).then(function (syncRes) {
            var regBoot = syncRes && syncRes.registrationBoot;
            var hydrationOk = regBoot && (regBoot.hydrationComplete === true || regBoot.matched === true
                || (regBoot.count === 0 && regBoot.idbCount === 0));

            if (!hydrationOk && regBoot && regBoot.idbCount > 0) {
                console.warn('[EMS] Local hydrate incomplete — unlocking with warning', regBoot);
                window.EMS_LOCAL_HYDRATE_INCOMPLETE = true;
                if (typeof window.showTopAlert === 'function') {
                    window.showTopAlert(
                        '⚠️ مقامی ڈیٹا مکمل لوڈ نہیں ہوا۔ Registration میں «Cloud Sync / Rebuild» استعمال کریں۔',
                        true
                    );
                }
            } else {
                window.EMS_LOCAL_HYDRATE_INCOMPLETE = false;
            }

            if (typeof window.emsShowRegistrationBootOverlay === 'function') {
                window.emsShowRegistrationBootOverlay(false);
            }
            unlockAppScreen();
            if (typeof window.emsBootMark === 'function') {
                window.emsBootMark('app-shell-unlocked');
            }
            if (typeof window.emsPersistOfflineSession === 'function') {
                window.emsPersistOfflineSession(user);
            }

            if (typeof window.emsStartDashboardStatsListener === 'function') {
                window.emsStartDashboardStatsListener();
            }

            if (typeof window.updateMasterDashboard === 'function') {
                window.updateMasterDashboard();
            }

            if (typeof window.emsIsOfflineOnly === 'function' && window.emsIsOfflineOnly()) {
                /* cloud hybrid sync disabled */
            } else if (typeof window.emsHybridSyncInit === 'function') {
                window.emsHybridSyncInit().catch(function () { /* background */ });
            }

            if (typeof window.emsVerifyBackendServices === 'function' && window.emsIsNetworkAvailable && window.emsIsNetworkAvailable()) {
                window.emsVerifyBackendServices().then(function (r) {
                    if (!r.ok && typeof window.showToast === 'function') {
                        window.showToast('⚠️ Cloud Functions deploy/chk کریں (pingBackend)', 'warning');
                    }
                });
            }
            return { ready: true, source: 'lite_login', sync: syncRes };
        }).catch(function (err) {
            console.warn('Lite login sync:', err);
            if (tenantId && typeof window.emsBootLiteLogin === 'function') {
                return window.emsBootLiteLogin(tenantId).then(function (lite) {
                    if (typeof window.emsShowRegistrationBootOverlay === 'function') {
                        window.emsShowRegistrationBootOverlay(false);
                    }
                    unlockAppScreen();
                    if (typeof window.emsPersistOfflineSession === 'function') {
                        window.emsPersistOfflineSession();
                    }
                    if (typeof window.updateMasterDashboard === 'function') {
                        window.updateMasterDashboard();
                    }
                    return { ready: true, source: 'lite_login_offline_fallback', sync: { registrationBoot: lite } };
                });
            }
            if (typeof window.emsShowRegistrationBootOverlay === 'function') {
                window.emsShowRegistrationBootOverlay(true, 'مقامی ڈیٹا لوڈ ناکام — دوبارہ کوشش کریں');
            }
            if (typeof window.showTopAlert === 'function') {
                window.showTopAlert('⚠️ مقامی ڈیٹا لوڈ ناکام: ' + (err && err.message ? err.message : 'unknown'), true);
            }
            return { ready: false, source: 'lite_login_error', error: err && err.message };
        });
    }).catch(function (err) {
        console.warn('finishMadrasaLogin post-auth:', err);
        if (typeof window.emsShowRegistrationBootOverlay === 'function') {
            window.emsShowRegistrationBootOverlay(false);
        }
        if (tenantId && typeof window.emsBootLiteLogin === 'function') {
            return window.emsBootLiteLogin(tenantId).then(function () {
                unlockAppScreen();
                if (typeof window.emsPersistOfflineSession === 'function') {
                    window.emsPersistOfflineSession();
                }
            }).catch(function () {
                showAuthGateway();
            });
        }
        showAuthGateway();
    });
}

function applyMadrasaProfile(user, doc, firestore) {
    if (!doc.exists || !doc.data().madrasaName) {
        window.CURRENT_MADRASA_DATA = null;
        showProfileSetup();
        if (typeof window.applyModuleAccessUI === 'function') {
            window.applyModuleAccessUI();
        }
        return;
    }

    if (window.SYSTEM_MAINTENANCE_MODE && !window.isSuperAdminUser(user)) {
        handleMaintenanceMode();
        return;
    }

    var data = doc.data();
    var mStatus = data.subStatus || 'default';

    if (mStatus === 'suspended') {
        if (doc.metadata && doc.metadata.fromCache) {
            if (typeof window.emsIsNetworkAvailable === 'function' && !window.emsIsNetworkAvailable()) {
                var cached = typeof window.emsReadOfflineSession === 'function' ? window.emsReadOfflineSession() : null;
                if (cached && cached.madrasaData && cached.madrasaData.subStatus !== 'suspended') {
                    window.CURRENT_MADRASA_DATA = typeof window.normalizeMadrasaAccessData === 'function'
                        ? window.normalizeMadrasaAccessData(cached.madrasaData)
                        : cached.madrasaData;
                    if (typeof window.applyModuleAccessUI === 'function') window.applyModuleAccessUI();
                    if (typeof window.emsPersistOfflineSession === 'function') window.emsPersistOfflineSession();
                    if (!emsMadrasaBootStarted) {
                        emsMadrasaBootStarted = true;
                        finishMadrasaLogin(user, firestore);
                    }
                    return;
                }
            }
            verifySubStatusFromServer(firestore, user.uid, function (err, serverData) {
                if (err) {
                    window.showTopAlert('سرور سے تصدیق نہیں ہو سکی۔ انٹرنیٹ چیک کر کے دوبارہ لاگ ان کریں۔', true);
                    return;
                }
                if (serverData && serverData.subStatus === 'suspended') {
                    handleSuspendedMadrasa();
                } else if (serverData && serverData.madrasaName) {
                    window.CURRENT_MADRASA_DATA = typeof window.normalizeMadrasaAccessData === 'function'
                        ? window.normalizeMadrasaAccessData(serverData)
                        : serverData;
                    if (typeof window.applyModuleAccessUI === 'function') {
                        window.applyModuleAccessUI();
                    }
                    finishMadrasaLogin(user, firestore).then(function () {
                        window.showTopAlert('✅ آپ کی رسائی بحال ہو گئی ہے۔ خوش آمدید!', false);
                    });
                }
            });
            return;
        }
        handleSuspendedMadrasa();
        return;
    }

    window.CURRENT_MADRASA_DATA = typeof window.normalizeMadrasaAccessData === 'function'
        ? window.normalizeMadrasaAccessData(data)
        : data;
    if (typeof window.emsLoadTenantSecurityPolicy === 'function' && !(typeof window.emsIsDemoSandbox === 'function' && window.emsIsDemoSandbox())) {
        window.emsLoadTenantSecurityPolicy(user.uid).catch(function () { });
    }
    if (typeof window.emsLoadTenantNotificationDelivery === 'function' && !(typeof window.emsIsDemoSandbox === 'function' && window.emsIsDemoSandbox())) {
        window.emsLoadTenantNotificationDelivery(user.uid).catch(function () { });
    }
    if (typeof window.emsLoadTenantSsoPolicy === 'function' && !(typeof window.emsIsDemoSandbox === 'function' && window.emsIsDemoSandbox())) {
        window.emsLoadTenantSsoPolicy(user.uid).then(function () {
            if (typeof window.emsRenderOrgSsoLoginHint === 'function') window.emsRenderOrgSsoLoginHint();
        }).catch(function () { });
    }
    if (typeof window.maybePersistModuleAccessRepair === 'function') {
        window.maybePersistModuleAccessRepair(firestore, user.uid, data);
    }
    if (typeof window.applyModuleAccessUI === 'function') {
        window.applyModuleAccessUI();
    }
    if (typeof window.emsPersistOfflineSession === 'function') {
        window.emsPersistOfflineSession();
    }
    if (emsMadrasaBootStarted) return;
    emsMadrasaBootStarted = true;
    finishMadrasaLogin(user, firestore);
}

function applyParentTenantProfile(user, ctx, firestore) {
    window.CURRENT_MADRASA_TENANT_ID = ctx.tenantId;
    window.CURRENT_USER_TENANT_ROLE = 'parent';
    window.CURRENT_PARENT_LINK = ctx.link || {};

    return firestore.collection('All_Madrasas').doc(ctx.tenantId).get()
        .then(function (doc) {
            if (!doc.exists) {
                window.showTopAlert('ادارے کا پروفائل نہیں ملا۔', true);
                return;
            }
            window.CURRENT_MADRASA_DATA = typeof window.normalizeMadrasaAccessData === 'function'
                ? window.normalizeMadrasaAccessData(doc.data())
                : doc.data();
            if (typeof window.applyModuleAccessUI === 'function') window.applyModuleAccessUI();
            if (typeof window.emsPersistOfflineSession === 'function') window.emsPersistOfflineSession();
            finishMadrasaLogin(user, firestore).then(function () {
                if (typeof window.emsLogSecurityEvent === 'function') {
                    window.emsLogSecurityEvent('parent_login', { tenantId: ctx.tenantId });
                }
            });
        });
}

function applyStaffTenantProfile(user, doc, firestore, ctx) {
    window.CURRENT_MADRASA_TENANT_ID = ctx.tenantId;
    window.CURRENT_USER_TENANT_ROLE = 'staff';
    window.CURRENT_STAFF_LINK = ctx.link || {};
    var link = ctx.link || {};
    if (!link.staffId) {
        window.showTopAlert('⚠️ Staff Link میں staffId نہیں — منتظم سے account link کروائیں۔', true);
    }

    function finishStaffUnlock() {
        applyMadrasaProfile(user, doc, firestore);
        if (typeof window.emsPersistOfflineSession === 'function') {
            window.emsPersistOfflineSession();
        }
        if (link.staffId && typeof window.emsSyncStaffClaims === 'function') {
            window.emsSyncStaffClaims(ctx.tenantId).catch(function () {});
        }
    }

    finishStaffUnlock();
}

function listenMadrasaProfile(user) {
    emsPostLoginDiagMark('listen_profile_enter', true);
    emsPostLoginDiagMark('firebase_uid', user && user.uid);
    emsPostLoginDiagMark('firebase_email', user && user.email);
    emsPostLoginDiagMark('offline_only_flag', !!(typeof window.emsIsOfflineOnly === 'function' && window.emsIsOfflineOnly()));

    if (isNetworkUnavailable()
        || (typeof window.emsIsOfflineOnly === 'function' && window.emsIsOfflineOnly())
        || window.EMS_NETWORK_OFFLINE_AT_BOOT === true
        || window.EMS_CLOUD_REACHABLE === false) {
        if (tryOfflineLocalBootAnyPlatform(user)) {
            emsPostLoginDiagMark('offline_fallback', 'ok');
            emsPostLoginDiagMark('last_stage', 'offline_boot_ok');
            return;
        }
        emsPostLoginDiagMark('offline_fallback', 'failed_no_session');
        /* Fresh native Google login must stay online until membership/profile resolves.
           Do not leave EMS_OFFLINE_ONLY blocking waitForDb. */
        if (user && firebase.auth && firebase.auth().currentUser) {
            window.EMS_OFFLINE_ONLY = false;
            window.EMS_NETWORK_OFFLINE_AT_BOOT = false;
            emsPostLoginDiagMark('forced_online_for_post_login', true);
        } else if (!(user && firebase.auth && firebase.auth().currentUser)) {
            emsShowPostLoginBootFailure('offline_boot_failed', 'آف لائن سیشن نہیں ملا اور Firebase user غائب ہے۔');
            return;
        }
    }

    if (isDesktopBootEnv()
        && (window.EMS_CLOUD_REACHABLE === false
            || (typeof window.emsIsNetworkAvailable === 'function' && !window.emsIsNetworkAvailable()))) {
        if (tryOfflineLocalBootAnyPlatform(user)) {
            return;
        }
    }

    window.waitForDb(
        function (firestore) {
            emsPostLoginDiagMark('firestore_ready', true);
            emsPostLoginDiagMark('last_stage', 'firestore_ready');
            subscribeGlobalSettings(firestore);

            if (unsubMadrasa) {
                unsubMadrasa();
                unsubMadrasa = null;
            }

            var intendedPortal = typeof window.emsGetIntendedPortal === 'function'
                ? window.emsGetIntendedPortal()
                : null;

            if (intendedPortal === 'guest') {
                emsInvokeIdentityGateOrAbort(user, null, 'guest-portal');
                return;
            }

            if (window.isSuperAdminUser(user) && intendedPortal === 'admin') {
                unsubMadrasa = firestore.collection('All_Madrasas').doc(user.uid)
                    .onSnapshot({ includeMetadataChanges: true }, function (doc) {
                        var ctx = {
                            tenantId: user.uid,
                            role: 'owner',
                            isSuperAdmin: true,
                            profileDoc: doc
                        };
                        emsPostLoginDiagMark('madrasaId', user.uid);
                        emsPostLoginDiagMark('membership', 'super_admin');
                        emsInvokeIdentityGateOrAbort(user, ctx, 'super-admin');
                    });
                return;
            }

            var resolveFn = typeof window.emsResolveTenantContext === 'function'
                ? window.emsResolveTenantContext(user, firestore, { intendedPortal: intendedPortal })
                : Promise.resolve(null);

            resolveFn.then(function (ctx) {
                emsPostLoginDiagMark('membership', ctx ? 'ok' : 'missing');
                emsPostLoginDiagMark('madrasaId', ctx && ctx.tenantId);
                emsPostLoginDiagMark('role', ctx && ctx.role);
                emsPostLoginDiagMark('last_stage', 'tenant_resolved');
                if (!ctx || !ctx.tenantId) {
                    emsShowPostLoginBootFailure(
                        'membership_missing',
                        'madrasaMembers / ادارہ رکنیت نہیں ملی۔ UID: ' + (user && user.uid ? user.uid : '—')
                    );
                }
                emsInvokeIdentityGateOrAbort(user, ctx, 'tenant-resolve');
            }).catch(function (err) {
                console.error('Tenant resolve error:', err);
                emsPostLoginDiagMark('membership', 'error');
                emsPostLoginDiagMark('error', err && err.message);
                emsFailSecurityLayerMissing('tenant-resolve-error');
                emsShowPostLoginBootFailure('tenant_resolve_error', err && err.message);
            });
        },
        function () {
            if (tryOfflineLocalBootAnyPlatform(user)) {
                return;
            }
            /* One recovery pass: clear offline-only and retry Firestore once after native login. */
            if (user && firebase.auth && firebase.auth().currentUser && !window.__emsPostLoginDbRetry) {
                window.__emsPostLoginDbRetry = true;
                window.EMS_OFFLINE_ONLY = false;
                window.EMS_NETWORK_OFFLINE_AT_BOOT = false;
                emsPostLoginDiagMark('waitForDb_retry', true);
                setTimeout(function () { listenMadrasaProfile(user); }, 400);
                return;
            }
            emsPostLoginDiagMark('firestore_ready', false);
            emsPostLoginDiagMark('last_stage', 'waitForDb_failed');
            emsShowPostLoginBootFailure(
                'waitForDb_failed',
                'ڈیٹا بیس سے رابطہ نہیں ہو سکا — مقامی آف لائن بوٹ بھی ناکام۔'
            );
        }
    );
}

window.emsAuthContinueAsAdmin = function (user, ctx) {
    window.waitForDb(function (firestore) {
        subscribeGlobalSettings(firestore);
        if (unsubMadrasa) { unsubMadrasa(); unsubMadrasa = null; }
        var tenantId = (ctx && ctx.tenantId) || user.uid;
        var isDemo = !!(ctx && ctx.isDemo) || (typeof window.emsIsDemoSandbox === 'function' && window.emsIsDemoSandbox());
        window.CURRENT_MADRASA_TENANT_ID = tenantId;
        window.CURRENT_USER_TENANT_ROLE = 'owner';
        var profileRef = typeof window.emsFirestoreTenantDocRef === 'function'
            ? window.emsFirestoreTenantDocRef(firestore, tenantId)
            : firestore.collection(isDemo ? 'Demo_Madrasas' : 'All_Madrasas').doc(tenantId);
        unsubMadrasa = profileRef
            .onSnapshot({ includeMetadataChanges: true }, function (doc) {
                applyMadrasaProfile(user, doc, firestore);
                if (isDemo && typeof window.emsShowDemoSandboxBanner === 'function') {
                    window.emsShowDemoSandboxBanner();
                }
            }, function (err) {
                console.error('Admin profile listener:', err);
                window.showTopAlert('⚠️ پروفائل لوڈ نہیں ہو سکی۔', true);
            });
    });
};

window.emsAuthContinueAsTeacher = function (user, ctx) {
    if (!ctx) return;
    window.waitForDb(function (firestore) {
        subscribeGlobalSettings(firestore);
        if (unsubMadrasa) { unsubMadrasa(); unsubMadrasa = null; }
        window.CURRENT_MADRASA_TENANT_ID = ctx.tenantId;
        window.CURRENT_USER_TENANT_ROLE = 'staff';
        window.CURRENT_STAFF_LINK = ctx.link || {};

        function startListener() {
            var link = ctx.link || {};
            if (link.staffId && typeof window.emsStaffHasAnyModule === 'function' && !window.emsStaffHasAnyModule()) {
                if (typeof window.emsShowAccessDenied === 'function') {
                    window.emsShowAccessDenied(
                        'کوئی Module Access نہیں',
                        'منتظم نے ابھی تک آپ کو کوئی module اجازت نہیں دی۔'
                    );
                }
                return;
            }
            unsubMadrasa = firestore.collection('All_Madrasas').doc(ctx.tenantId)
                .onSnapshot({ includeMetadataChanges: true }, function (doc) {
                    applyStaffTenantProfile(user, doc, firestore, ctx);
                });
        }

        var pull = typeof window.emsPullModuleGroup === 'function'
            ? window.emsPullModuleGroup('Admin')
            : Promise.resolve();
        pull.then(startListener).catch(startListener);
    });
};

window.emsAuthContinueAsParent = function (user, ctx) {
    if (!ctx) return;
    window.waitForDb(function (firestore) {
        subscribeGlobalSettings(firestore);

        function startParentUnlock() {
            if (typeof window.emsParentHasAnyView === 'function' && !window.emsParentHasAnyView()) {
                if (typeof window.emsShowAccessDenied === 'function') {
                    window.emsShowAccessDenied(
                        'کوئی Parent View Access نہیں',
                        'منتظم نے ابھی تک آپ کو کوئی view اجازت نہیں دی۔ Admin Panel → Parent Permissions چیک کریں۔'
                    );
                }
                return;
            }
            applyParentTenantProfile(user, ctx, firestore);
        }

        var pull = typeof window.emsPullModuleGroup === 'function'
            ? window.emsPullModuleGroup('Admin')
            : Promise.resolve();
        pull.then(startParentUnlock).catch(startParentUnlock);
    });
};

// --- تصدیق کے بٹن فنکشنز (onAuthStateChanged سے پہلے ضرور رجسٹر ہوں) ---

function emsGuardCloudSignInDisabled() {
    if (typeof window.emsIsOfflineOnly === 'function' && window.emsIsOfflineOnly()) {
        if (typeof window.emsStartOfflineLocalApp === 'function') {
            window.emsStartOfflineLocalApp();
        }
        return true;
    }
    return false;
}

window.signupWithEmail = function () {
    if (emsGuardCloudSignInDisabled()) return;
    const email = document.getElementById('auth-email').value.trim();
    const pass = document.getElementById('auth-pass').value.trim();

    if (!email || !pass) {
        window.showTopAlert('ای میل اور پاسورڈ درج کرنا لازمی ہے!', true);
        return;
    }
    if (pass.length < 6) {
        window.showTopAlert('پاسورڈ کم از کم 6 حروف پر مشتمل ہونا چاہیے!', true);
        return;
    }

    window.showTopAlert('اکاؤنٹ بنایا جا رہا ہے، انتظار کریں...', false);
    firebase.auth().createUserWithEmailAndPassword(email, pass)
        .then(function () {
            window.showTopAlert('اکاؤنٹ کامیابی سے بن گیا! اب پروفائل مکمل کریں۔', false);
        })
        .catch(function (error) {
            window.showTopAlert('اکاؤنٹ بنانے میں مسئلہ: ' + error.message, true);
        });
};

window.loginWithEmail = function () {
    if (emsGuardCloudSignInDisabled()) return;
    const email = document.getElementById('auth-email').value.trim();
    const pass = document.getElementById('auth-pass').value.trim();

    if (!email || !pass) {
        window.showTopAlert('ای میل اور پاسورڈ درج کریں!', true);
        return;
    }

    if (typeof window.emsCheckLoginAllowed === 'function') {
        Promise.resolve(window.emsCheckLoginAllowed(email)).then(function (lockCheck) {
            if (!lockCheck.allowed) {
                window.showTopAlert(lockCheck.message || 'لاگ ان عارضی طور پر بند ہے۔', true);
                return;
            }
            doEmailLogin(email, pass);
        });
        return;
    }

    doEmailLogin(email, pass);
};

function doEmailLogin(email, pass) {
    window.showTopAlert('لاگ ان ہو رہا ہے، براہ کرم انتظار کریں...', false);
    firebase.auth().signInWithEmailAndPassword(email, pass)
        .then(function () {
            if (typeof window.emsClearLoginAttempts === 'function') {
                window.emsClearLoginAttempts(email);
            }
        })
        .catch(function (error) {
            if (typeof window.emsClearLandingAuthLoading === 'function') {
                window.emsClearLandingAuthLoading();
            }
            if (error && error.code === 'auth/multi-factor-auth-required' && typeof window.emsHandleMfaSignInError === 'function') {
                return window.emsHandleMfaSignInError(error).then(function () {
                    if (typeof window.emsClearLoginAttempts === 'function') {
                        window.emsClearLoginAttempts(email);
                    }
                });
            }
            if (typeof window.emsRecordLoginFailure === 'function') {
                window.emsRecordLoginFailure(email);
            }
            window.showTopAlert('لاگ ان ناکام: ' + error.message, true);
        });
}

window.resetPassword = function () {
    if (emsGuardCloudSignInDisabled()) return;
    const email = document.getElementById('auth-email').value.trim();
    if (!email) {
        window.showTopAlert('پاسورڈ ری سیٹ کے لیے پہلے اپنا ای میل درج کریں۔', true);
        return;
    }

    window.showTopAlert('پاسورڈ ری سیٹ کی درخواست بھیجی جا رہی ہے...', false);
    firebase.auth().sendPasswordResetEmail(email)
        .then(function () {
            window.showTopAlert('پاسورڈ تبدیل کرنے کا لنک ' + email + ' پر بھیج دیا گیا!', false);
        })
        .catch(function (error) {
            window.showTopAlert('ای میل بھیجنے میں مسئلہ: ' + error.message, true);
        });
};

function isDesktopAuthContext() {
    return !!(window.emsDesktop && window.emsDesktop.isDesktop) ||
        (typeof window.emsIsDesktopApp === 'function' && window.emsIsDesktopApp());
}

function isMobileNativeContext() {
    if (typeof window.emsIsAndroidApp === 'function' && window.emsIsAndroidApp()) {
        return true;
    }
    try {
        if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function') {
            return window.Capacitor.isNativePlatform();
        }
    } catch (e) { /* ignore */ }
    return false;
}

function shouldUseGoogleRedirect() {
    if (typeof window.emsShouldUseNativeGoogleSignIn === 'function' && window.emsShouldUseNativeGoogleSignIn()) {
        return false;
    }
    if (isDesktopAuthContext()) return false;
    if (isMobileNativeContext()) return true;
    try {
        return window.self !== window.top;
    } catch (e) {
        return true;
    }
}

function shouldHandleRedirectResultAtBoot() {
    if (isDesktopAuthContext()) {
        if (typeof window.emsIsNetworkAvailable === 'function' && !window.emsIsNetworkAvailable()) {
            return false;
        }
        return true;
    }
    if (typeof window.emsIsNetworkAvailable === 'function' && !window.emsIsNetworkAvailable()) {
        return false;
    }
    return true;
}

function emsSafeHandleRedirectResult() {
    if (typeof window.emsShouldUseNativeGoogleSignIn === 'function' && window.emsShouldUseNativeGoogleSignIn()) {
        return;
    }
    if (shouldForceStrictOfflineBypass()) return;
    if (!shouldHandleRedirectResultAtBoot()) return;
    try {
        var auth = firebase.auth();
        if (!auth || typeof auth.getRedirectResult !== 'function') return;
        auth.getRedirectResult().then(function (result) {
            if (result && result.user) {
                window.EMS_GOOGLE_AUTH_IN_PROGRESS = false;
                if (typeof window.emsDismissLoginUi === 'function') {
                    window.emsDismissLoginUi();
                }
                window.showTopAlert('✅ گوگل لاگ ان کامیاب!', false);
            }
        }).catch(function (error) {
            window.EMS_GOOGLE_AUTH_IN_PROGRESS = false;
            if (shouldSuppressFirebaseAuthUiError(error)) {
                console.warn('[EMS:auth] redirect suppressed offline:', error && error.code);
                return;
            }
            if (error && error.code) {
                window.showTopAlert('گوگل لاگ ان ناکام: ' + googleAuthErrorMessage(error), true);
            }
        });
    } catch (err) {
        console.warn('[EMS:auth] getRedirectResult skipped:', err && err.message ? err.message : err);
    }
}

function googleAuthErrorMessage(error) {
    if (!error) return 'نامعلوم خرابی';
    var code = error.code || '';
    var raw = error.message || (typeof error === 'string' ? error : '') || '';
    if (!code && raw) {
        if (/28444|Developer console is not set up/i.test(raw)) {
            return 'Google Cloud / SHA-1 سیٹ اپ مکمل نہیں۔ Debug SHA Firebase میں شامل کریں اور چند گھنٹے انتظار کریں۔';
        }
        if (/No credentials|NoCredential|no google accounts/i.test(raw)) {
            return 'فون پر Google اکاؤنٹ شامل کریں، پھر دوبارہ کوشش کریں۔';
        }
        if (/access token/i.test(raw)) {
            return 'Google access token نہیں ملا — انٹرنیٹ اور Google Play Services چیک کریں۔';
        }
        if (/SocialLogin|plugin not available|unavailable/i.test(raw)) {
            return 'Native Google login plugin لوڈ نہیں ہوا — نئی APK دوبارہ انسٹال کریں۔';
        }
        if (/Capacitor bridge not ready/i.test(raw)) {
            return 'موبائل ایپ کا native bridge تیار نہیں — ایپ بند کر کے دوبارہ کھولیں۔';
        }
        return raw;
    }
    if (!code) return raw || 'نامعلوم خرابی';
    var map = {
        'auth/popup-blocked': 'پاپ اپ بلاک ہے۔ براؤزر popup کی اجازت دیں۔',
        'auth/popup-closed-by-user': 'آپ نے گوگل ونڈو بند کر دی۔',
        'auth/cancelled-popup-request': 'گوگل ونڈو پہلے سے کھل رہی ہے، تھوڑی دیر بعد دوبارہ کوشش کریں۔',
        'auth/operation-not-supported-in-this-environment': 'یہ ماحول popup سپورٹ نہیں کرتا — redirect استعمال ہو رہا ہے۔',
        'auth/unauthorized-domain': 'یہ ڈومین Firebase Console میں Authorized Domains میں شامل نہیں۔',
        'auth/network-request-failed': 'انٹرنیٹ کنکشن چیک کریں اور دوبارہ کوشش کریں۔',
        'auth/timeout': 'گوگل لاگ ان کا وقت ختم ہو گیا۔ موبائل پر Yes دبانے سے پہلے ونڈو بند نہ ہونے دیں۔',
        'auth/missing-id-token': 'موبائل گوگل لاگ ان سے ID token نہیں ملا — SHA-1 / google-services.json چیک کریں۔',
        'auth/firebase-not-ready': 'Firebase Auth لوڈ نہیں ہوا — انٹرنیٹ چیک کر کے دوبارہ کوشش کریں۔',
        'auth/invalid-credential': 'Google credential قبول نہیں ہوا — Web Client ID / SHA-1 درست کریں۔',
        'auth/account-exists-with-different-credential': 'یہ ای میل دوسرے طریقے سے پہلے سے رجسٹر ہے۔',
        'auth/developer-console': 'Google Cloud / SHA-1 سیٹ اپ مکمل نہیں۔ Debug SHA Firebase میں چیک کریں؛ کبھی کبھی چند گھنٹے لگتے ہیں۔',
        'auth/native-google-failed': 'موبائل Google login ناکام۔',
        'auth/access-token-failed': 'Google access token نہیں ملا — دوبارہ کوشش کریں (انٹرنیٹ + Play Services چیک کریں)۔',
        'auth/script-load-failed': 'Firebase فائلیں لوڈ نہیں ہوئیں — ایپ دوبارہ انسٹال کریں یا نئی APK استعمال کریں۔',
        'auth/capacitor-not-ready': 'موبائل bridge تیار نہیں — ایپ بند کر کے دوبارہ کھولیں۔',
        'auth/plugin-not-available': 'Google login plugin نہیں ملا — نئی APK انسٹال کریں۔'
    };
    var msg = map[code] || raw || 'نامعلوم خرابی';
    if (/timeout|expired|timed out/i.test(msg)) {
        return 'گوگل لاگ ان کا وقت ختم ہو گیا۔ چھوٹی ونڈو کھلی رکھیں، موبائل پر Yes دبائیں، پھر دوبارہ کوشش کریں۔';
    }
    var isNative = typeof window.emsShouldUseNativeGoogleSignIn === 'function'
        && window.emsShouldUseNativeGoogleSignIn();
    if (isNative && raw && msg.indexOf(raw) === -1 && raw.length < 220) {
        msg = msg + ' (' + raw + ')';
    }
    return msg;
}

window.EMS_GOOGLE_AUTH_IN_PROGRESS = false;

/** Offline-only guest demo — no Firebase */
window.emsStartOfflineGuestDemo = function () {
    if (typeof window.emsSetIntendedPortal === 'function') {
        window.emsSetIntendedPortal('guest');
    }
    if (typeof window.emsApplyDemoSandboxContext === 'function') {
        window.emsApplyDemoSandboxContext(null, { offlineKey: Date.now() });
    } else {
        window.EMS_GUEST_MODE = true;
        window.CURRENT_MADRASA_TENANT_ID = 'demo';
        window.CURRENT_USER_TENANT_ROLE = 'guest';
        window.CURRENT_MADRASA_DATA = {
            madrasaName: 'ڈیمو ماحول (مہمان)',
            subStatus: 'free',
            allowedModules: window.LICENSED_MODULE_IDS || []
        };
    }
    var loginPanel = document.getElementById('ems-login-panel');
    if (loginPanel) loginPanel.style.display = 'none';

    var boot = (typeof window.emsEnsurePostAuthScripts === 'function')
        ? window.emsEnsurePostAuthScripts()
        : Promise.resolve();

    boot.then(function () {
        document.body.classList.add('ems-portal-admin');
        document.body.classList.remove('ems-portal-parent', 'ems-portal-teacher', 'ems-portal-guest');
        if (typeof window.emsShowDemoSandboxBanner === 'function') {
            window.emsShowDemoSandboxBanner();
        }
        unlockAppScreen();
        if (typeof window.showTopAlert === 'function') {
            window.showTopAlert('✅ ڈیمو ماحول شروع — عارضی ڈیٹا، حقیقی مدرسہ سے الگ۔', false);
        }
    }).catch(function (err) {
        console.warn('[EMS] offline guest boot:', err);
        unlockAppScreen();
    });
};

/** Load Firebase Auth + Firestore (cloud stack) if not ready — web pull/sync + Google sign-in. */
function emsEnsureFirebaseAuthReady() {
    var nativeGoogle = typeof window.emsShouldUseNativeGoogleSignIn === 'function'
        && window.emsShouldUseNativeGoogleSignIn();
    if (!window.EMS_MANUAL_CLOUD_SYNC && !nativeGoogle && isNetworkUnavailable()) {
        return Promise.resolve(false);
    }
    if (nativeGoogle && typeof window.emsPrepareAndroidGoogleLogin === 'function') {
        return window.emsPrepareAndroidGoogleLogin();
    }
    if (typeof firebase !== 'undefined' && firebase.auth && typeof window.getDbOrNull === 'function' && window.getDbOrNull()) {
        return Promise.resolve(true);
    }
    window.EMS_OFFLINE_ONLY = false;
    var chain = Promise.resolve();
    if (typeof window.emsEnableOnlineMode === 'function') {
        chain = Promise.resolve(window.emsEnableOnlineMode());
    } else if (typeof window.emsLoadCloudStack === 'function') {
        chain = window.emsLoadCloudStack();
    }
    return chain.then(function () {
        if (typeof window.emsLoadCloudDeferred === 'function') {
            return window.emsLoadCloudDeferred();
        }
    }).then(function () {
        if (typeof window.emsInitFirebase === 'function') {
            window.emsInitFirebase();
        }
        if (typeof firebase !== 'undefined' && firebase.auth && typeof window.getDbOrNull === 'function' && window.getDbOrNull()) {
            return emsEnsureSecurityStackReady();
        }
        return new Promise(function (resolve, reject) {
            var attempts = 0;
            var timer = setInterval(function () {
                attempts++;
                var fsReady = typeof firebase !== 'undefined' && firebase.auth;
                var dbReady = typeof window.getDbOrNull === 'function' && window.getDbOrNull();
                if (fsReady && dbReady) {
                    clearInterval(timer);
                    emsEnsureSecurityStackReady().then(resolve).catch(reject);
                } else if (attempts >= 25) {
                    clearInterval(timer);
                    reject(new Error('Firebase / Firestore load timeout'));
                }
            }, 100);
        });
    });
}
window.emsEnsureFirebaseAuthReady = emsEnsureFirebaseAuthReady;

function emsIsCloudSignedIn() {
    try {
        return !!(typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser);
    } catch (e) {
        return false;
    }
}
window.emsIsCloudSignedIn = emsIsCloudSignedIn;

function emsWaitForFirebaseAuthRestore(timeoutMs) {
    timeoutMs = timeoutMs || 6000;
    if (emsIsCloudSignedIn()) {
        return Promise.resolve(firebase.auth().currentUser);
    }
    if (typeof firebase === 'undefined' || !firebase.auth) {
        return Promise.resolve(null);
    }
    return new Promise(function (resolve) {
        var done = false;
        var unsub = null;
        function finish(user) {
            if (done) return;
            done = true;
            clearTimeout(timer);
            if (typeof unsub === 'function') unsub();
            resolve(user || null);
        }
        try {
            unsub = firebase.auth().onAuthStateChanged(function (user) {
                if (user) finish(user);
            });
        } catch (e) {
            finish(null);
            return;
        }
        var timer = setTimeout(function () {
            try {
                finish(firebase.auth().currentUser || null);
            } catch (e2) {
                finish(null);
            }
        }, timeoutMs);
    });
}
window.emsWaitForFirebaseAuthRestore = emsWaitForFirebaseAuthRestore;

function emsEnsureAuthListenerForCloudSync() {
    if (typeof firebase === 'undefined' || !firebase.auth) {
        return Promise.resolve(false);
    }
    return emsConfigureAuthPersistence().then(function () {
        startAuthStateListener();
        return true;
    });
}
window.emsEnsureAuthListenerForCloudSync = emsEnsureAuthListenerForCloudSync;

function emsRunGoogleSignIn() {
    window.EMS_GOOGLE_AUTH_IN_PROGRESS = true;

    if (typeof window.emsShouldUseNativeGoogleSignIn === 'function' && window.emsShouldUseNativeGoogleSignIn()) {
        window.showTopAlert(
            'گوگل اکاؤنٹ منتخب کریں…<br><small>فون پر Google account chooser کھلے گا۔</small>',
            false
        );
        return window.emsRunNativeGoogleSignIn().then(function (cred) {
            window.EMS_GOOGLE_AUTH_IN_PROGRESS = false;
            /* Stay ONLINE until membership + institution boot complete.
               Premature emsFinalizeNativeInstantBootMode() set EMS_OFFLINE_ONLY and
               made waitForDb() fail immediately → white screen + contradictory toast. */
            window.EMS_NETWORK_OFFLINE_AT_BOOT = false;
            window.EMS_OFFLINE_ONLY = false;
            window.__emsPostLoginDbRetry = false;
            try { localStorage.setItem('ems_online_mode', '1'); } catch (eMode) { /* ignore */ }

            var user = (cred && cred.user) || null;
            try {
                if ((!user || !user.uid) && firebase.auth) user = firebase.auth().currentUser;
            } catch (eCu) { user = user || null; }

            window.EMS_POST_LOGIN_DIAG = {
                startedAt: Date.now(),
                last_stage: 'native_google_firebase',
                stages: {},
                native_login: true,
                firebase_credential: !!(cred && cred.user),
                firebase_uid: user && user.uid,
                firebase_email: user && user.email
            };
            emsPostLoginDiagMark('last_stage', 'firebase_user_confirmed');

            if (!user || !user.uid) {
                emsShowPostLoginBootFailure(
                    'firebase_user_missing',
                    'Native Google account ملا لیکن Firebase auth.currentUser خالی ہے۔'
                );
                return null;
            }

            return user.getIdToken().then(function (token) {
                emsPostLoginDiagMark('id_token_ready', !!token);
                return emsEnsureSecurityStackReady().then(function () {
                    if (typeof startAuthStateListener === 'function' && !authListenerStarted) {
                        startAuthStateListener();
                    }
                    emsPostLoginDiagMark('auth_listener', !!authListenerStarted);
                    window.EMS_PENDING_NATIVE_GOOGLE_SUCCESS = true;
                    if (typeof window.emsSetLandingAuthLoading === 'function') {
                        window.emsSetLandingAuthLoading(true);
                    }
                    window.showTopAlert(
                        'Firebase تصدیق ہو گئی — ادارہ / رکنیت لوڈ ہو رہی ہے…',
                        false
                    );
                    /* Do NOT dismiss landing or finalize offline mode here.
                       unlockAppScreen() completes success after profile/DB boot. */
                    if (typeof listenMadrasaProfile === 'function') {
                        listenMadrasaProfile(user);
                    } else if (typeof emsOnAuthStateReady === 'function') {
                        emsOnAuthStateReady(user);
                    }
                    /* Watchdog: if shell never unlocks, show diagnostics instead of white page. */
                    setTimeout(function () {
                        if (document.body.classList.contains('ems-authenticated')
                            && document.body.classList.contains('ems-locked') === false
                            && document.querySelector('.ems-app-shell')
                            && document.querySelector('.ems-app-shell').style.display !== 'none') {
                            return;
                        }
                        if (document.getElementById('profile-setup-gateway')
                            && document.getElementById('profile-setup-gateway').style.display === 'flex') {
                            return;
                        }
                        if (document.getElementById('ems-post-login-fail')
                            && document.getElementById('ems-post-login-fail').style.display === 'block') {
                            return;
                        }
                        emsShowPostLoginBootFailure(
                            'watchdog_timeout',
                            '30s میں ڈیش بورڈ نہیں کھلا۔ آخری مرحلہ: '
                                + ((window.EMS_POST_LOGIN_DIAG && window.EMS_POST_LOGIN_DIAG.last_stage) || 'unknown')
                        );
                    }, 30000);
                });
            });
        }).catch(function (error) {
            window.EMS_GOOGLE_AUTH_IN_PROGRESS = false;
            window.EMS_PENDING_NATIVE_GOOGLE_SUCCESS = false;
            showGoogleAuthError(error);
            if (typeof window.emsClearLandingAuthLoading === 'function') {
                window.emsClearLandingAuthLoading();
            }
        });
    }

    window.showTopAlert(
        'گوگل سے منسلک کیا جا رہا ہے...<br><small>چھوٹی ونڈو کھلی رکھیں۔ موبائل پر Yes دبائیں — ونڈو بند نہ کریں۔</small>',
        false
    );

    var provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    if (shouldUseGoogleRedirect()) {
        return firebase.auth().signInWithRedirect(provider).catch(function (error) {
            window.EMS_GOOGLE_AUTH_IN_PROGRESS = false;
            showGoogleAuthError(error);
        });
    }

    return firebase.auth().signInWithPopup(provider).then(function () {
        window.EMS_GOOGLE_AUTH_IN_PROGRESS = false;
        if (typeof window.emsDismissLoginUi === 'function') {
            window.emsDismissLoginUi();
        }
        window.showTopAlert('✅ گوگل لاگ ان کامیاب!', false);
    }).catch(function (error) {
        window.EMS_GOOGLE_AUTH_IN_PROGRESS = false;
        if (isMobileNativeContext()) {
            window.showTopAlert('موبائل پر گوگل لاگ ان redirect استعمال کریں۔', true);
            return firebase.auth().signInWithRedirect(provider);
        }
        var popupFailed = error.code === 'auth/popup-blocked' ||
            error.code === 'auth/operation-not-supported-in-this-environment' ||
            error.code === 'auth/cancelled-popup-request' ||
            error.code === 'auth/popup-closed-by-user' ||
            /timeout|expired|timed out/i.test((error.message || ''));
        if (isDesktopAuthContext() && popupFailed) {
            window.showTopAlert(
                'پاپ اپ مکمل نہیں ہوا — اب مین ونڈو میں گوگل لاگ ان کھولا جا رہا ہے۔ موبائل پر Yes دبائیں۔',
                false
            );
            return firebase.auth().signInWithRedirect(provider).catch(function (redirectErr) {
                window.showTopAlert('گوگل لاگ ان ناکام: ' + googleAuthErrorMessage(redirectErr), true);
                if (typeof window.emsClearLandingAuthLoading === 'function') {
                    window.emsClearLandingAuthLoading();
                }
            });
        }
        if (isDesktopAuthContext()) {
            window.showTopAlert(
                'ڈیسک ٹاپ پر گوگل لاگ ان ناکام: ' + googleAuthErrorMessage(error) +
                '\n\nچھوٹی ونڈو کھلی رکھیں اور موبائل پر Yes دبائیں۔',
                true
            );
            if (typeof window.emsClearLandingAuthLoading === 'function') {
                window.emsClearLandingAuthLoading();
            }
            return;
        }
        var useRedirect = error.code === 'auth/popup-blocked' ||
            error.code === 'auth/operation-not-supported-in-this-environment' ||
            error.code === 'auth/cancelled-popup-request';

        if (useRedirect) {
            window.showTopAlert('پاپ اپ نہیں کھل سکا — گوگل صفحے پر بھیجا جا رہا ہے...', false);
            return firebase.auth().signInWithRedirect(provider);
        }
        window.showTopAlert('گوگل لاگ ان ناکام: ' + googleAuthErrorMessage(error), true);
        if (typeof window.emsClearLandingAuthLoading === 'function') {
            window.emsClearLandingAuthLoading();
        }
    });
}

window.loginWithGoogle = function () {
    var portal = typeof window.emsGetIntendedPortal === 'function' ? window.emsGetIntendedPortal() : null;
    var offline = typeof window.emsIsOfflineOnly === 'function' && window.emsIsOfflineOnly();

    // Guest demo in offline mode — the button label changes but handler stays the same
    if (portal === 'guest' && offline) {
        if (typeof window.emsStartOfflineGuestDemo === 'function') {
            window.emsStartOfflineGuestDemo();
        }
        if (typeof window.emsClearLandingAuthLoading === 'function') {
            window.emsClearLandingAuthLoading();
        }
        return;
    }

    // Google button ALWAYS means real Google sign-in (never the local-admin shortcut)
    if (window.EMS_GOOGLE_AUTH_IN_PROGRESS) {
        window.showTopAlert('گوگل لاگ ان پہلے سے جاری ہے…', false);
        if (typeof window.emsClearLandingAuthLoading === 'function') {
            window.emsClearLandingAuthLoading();
        }
        return;
    }

    window.showTopAlert('گوگل لاگ ان تیار ہو رہا ہے…', false);

    emsEnsureFirebaseAuthReady().then(function () {
        if (typeof startAuthStateListener === 'function' && !authListenerStarted) {
            startAuthStateListener();
        }
        return emsRunGoogleSignIn();
    }).catch(function (err) {
        window.EMS_GOOGLE_AUTH_IN_PROGRESS = false;
        if (typeof window.emsClearLandingAuthLoading === 'function') {
            window.emsClearLandingAuthLoading();
        }
        var isNative = typeof window.emsShouldUseNativeGoogleSignIn === 'function'
            && window.emsShouldUseNativeGoogleSignIn();
        if (!isNative) {
            window.showTopAlert(
                'Firebase Auth لوڈ نہیں ہوا: ' + googleAuthErrorMessage(err),
                true
            );
            return;
        }
        // Diagnosis mode: show exact code/message/stage — do not hide behind generic Urdu.
        var code = (err && err.code != null && err.code !== '') ? String(err.code) : '(no code)';
        var msg = (err && err.message) ? String(err.message)
            : (typeof err === 'string' ? err : String(err || 'unknown'));
        var diag = (err && err.diag)
            || (typeof window.emsGetNativeGoogleDiag === 'function' ? window.emsGetNativeGoogleDiag() : null)
            || window.EMS_NATIVE_GOOGLE_DIAG
            || null;
        var stage = (err && err.stage) || (diag && diag.stage) || '(unknown stage)';
        var lines = [
            'موبائل لاگ ان تیار نہیں ہوا',
            'code: ' + code,
            'message: ' + msg,
            'stage: ' + stage
        ];
        if (diag) {
            lines.push(
                'pluginAvailable: ' + String(diag.pluginAvailable),
                'pluginSource: ' + String(diag.pluginSource),
                'capacitorReady: ' + String(diag.capacitorReady),
                'firebaseAuthReady: ' + String(diag.firebaseAuthReady),
                'socialLoginInitOk: ' + String(diag.socialLoginInitOk)
            );
            if (diag.raw) {
                lines.push('raw: ' + String(diag.raw).slice(0, 300));
            }
        }
        console.error('[EMS:auth] Android prepare diagnosis:', {
            code: code,
            message: msg,
            stage: stage,
            diag: diag,
            err: err
        });
        window.showTopAlert(lines.join('<br>'), true);
    });
};

window.saveMadrasaProfile = function () {
    const user = firebase.auth().currentUser;
    if (!user) return;

    const mName = document.getElementById('setup-madrasa-name').value.trim();
    const pName = document.getElementById('setup-principal-name').value.trim();
    const phone = document.getElementById('setup-phone').value.trim();
    const city = (document.getElementById('setup-city') || {}).value ? document.getElementById('setup-city').value.trim() : '';
    const country = (document.getElementById('setup-country') || {}).value ? document.getElementById('setup-country').value.trim() : '';
    const madrasaType = (document.getElementById('setup-madrasa-type') || {}).value || '';
    const subdomain = (document.getElementById('setup-subdomain') || {}).value ? document.getElementById('setup-subdomain').value.trim() : '';

    if (!mName || !pName || !phone) {
        window.showTopAlert('مدرسہ کا نام، منتظم کا نام اور موبائل نمبر لازمی ہیں!', true);
        return;
    }

    const firestore = window.getDbOrNull();
    if (!firestore) {
        window.showTopAlert('ڈیٹا بیس کنیکٹ ہو رہا ہے، چند سیکنڈ بعد دوبارہ کوشش کریں۔', true);
        return;
    }

    window.showTopAlert('ڈیٹا محفوظ ہو رہا ہے، انتظار کریں...', false);
    firestore.collection('All_Madrasas').doc(user.uid).set({
        madrasaName: mName,
        principalName: pName,
        contactPhone: phone,
        city: city,
        country: country,
        madrasaType: madrasaType,
        subdomain: subdomain,
        email: user.email,
        subStatus: 'default',
        allowedModules: window.buildDefaultAllowedModules('free'),
        setupDate: new Date().toISOString()
    }, { merge: true })
        .then(function () {
            if (typeof window.emsRunIdentityGate === 'function') {
                try {
                    sessionStorage.setItem('ems_identity_verified_' + user.uid, JSON.stringify({
                        verified: true, portal: 'admin', at: Date.now()
                    }));
                } catch (e) { /* ignore */ }
            }
            window.showTopAlert('پروفائل کامیابی سے محفوظ ہو گئی!', false);
            if (typeof window.emsAuthContinueAsAdmin === 'function') {
                window.emsAuthContinueAsAdmin(user, { tenantId: user.uid, role: 'owner' });
            } else {
                emsFailSecurityLayerMissing('profile-setup-complete');
            }
        })
        .catch(function (err) {
            window.showTopAlert('ڈیٹا محفوظ کرنے میں مسئلہ: ' + err.message, true);
        });
};

window.applyModuleAccessUI = function () {
    var user = typeof firebase !== 'undefined' && firebase.auth ? firebase.auth().currentUser : null;

    /* لاگ ان سے پہلے tabs لاک نہ کریں */
    if (!user) return;

    if (typeof window.emsApplyPortalShell === 'function') {
        window.emsApplyPortalShell();
        return;
    }

    document.querySelectorAll('.ribbon-tab').forEach(function (tab) {
        var modId = tab.id.replace('tab-', '');
        var allowed = window.isModuleTabAllowed(modId);
        tab.style.display = allowed ? 'inline-block' : 'none';
        tab.classList.remove('module-locked');
        tab.removeAttribute('title');
    });
};

window.logoutUser = function () {
    if (!confirm('کیا آپ واقعی سائن آؤٹ کرنا چاہتے ہیں؟')) return;

    window.EMS_EXPLICIT_SIGNOUT = true;
    if (window.EmsSyncEngine && typeof window.EmsSyncEngine.shutdown === 'function') {
        window.EmsSyncEngine.shutdown();
    }
    if (typeof window.emsClearTenantContext === 'function') {
        window.emsClearTenantContext();
    }
    if (typeof window.emsGuestClearOverlay === 'function') {
        window.emsGuestClearOverlay();
    }
    if (typeof window.emsClearOfflineSession === 'function') {
        window.emsClearOfflineSession();
    }

    var isNative = typeof window.emsIsNativeApp === 'function' && window.emsIsNativeApp();

    function reloadForNativeOrOffline() {
        window.EMS_LOCAL_AUTH = false;
        emsMadrasaBootStarted = false;
        emsPortalRoutedOnce = false;
        try { sessionStorage.clear(); } catch (e) { /* ignore */ }
        window.location.reload();
    }

    if (isNative || (typeof window.emsIsOfflineOnly === 'function' && window.emsIsOfflineOnly())) {
        if (typeof window.emsClearIdentitySession === 'function') {
            try {
                var uid = (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser)
                    ? firebase.auth().currentUser.uid : null;
                window.emsClearIdentitySession(uid);
            } catch (e) { /* ignore */ }
        }
        if (typeof window.emsClearSensitiveLocalCache === 'function') {
            window.emsClearSensitiveLocalCache();
        }
        if (typeof firebase !== 'undefined' && firebase.auth) {
            firebase.auth().signOut().finally(reloadForNativeOrOffline);
            return;
        }
        reloadForNativeOrOffline();
        return;
    }

    if (typeof window.emsClearIdentitySession === 'function') {
        try {
            var uidWeb = (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser)
                ? firebase.auth().currentUser.uid : null;
            window.emsClearIdentitySession(uidWeb);
        } catch (e) { /* ignore */ }
    }
    if (typeof window.emsClearSensitiveLocalCache === 'function') {
        window.emsClearSensitiveLocalCache();
    }
    if (typeof firebase === 'undefined' || !firebase.auth) {
        sessionStorage.clear();
        window.location.reload();
        return;
    }
    firebase.auth().signOut().then(function () {
        if (typeof window.emsLogSecurityEvent === 'function') {
            window.emsLogSecurityEvent('logout', {});
        }
        sessionStorage.clear();
        window.location.reload();
    });
};

/** Native apps: sign out current Gmail and force first-time login on next boot. */
window.switchGoogleAccount = function () {
    if (!confirm('Gmail اکاؤنٹ تبدیل کرنے کے لیے موجودہ اکاؤنٹ سے سائن آؤٹ ہوگا۔ جاری رکھیں؟')) return;
    window.EMS_SWITCH_ACCOUNT = true;
    window.logoutUser();
};

var authButtonsBound = false;
var authListenerStarted = false;
var authListenerBypassOnly = false;
var authModuleInitialized = false;
var authNullDebounceTimer = null;
window.EMS_AUTH_STATE_READY = false;
window.EMS_EXPLICIT_SIGNOUT = false;

/** LOCAL persistence — keeps Google/email login across desktop app restarts. */
function emsConfigureAuthPersistence() {
    if (shouldForceStrictOfflineBypass()) {
        return Promise.resolve();
    }
    if (typeof firebase === 'undefined' || !firebase.auth) {
        return Promise.resolve();
    }
    var persistence = firebase.auth.Auth && firebase.auth.Auth.Persistence
        ? firebase.auth.Auth.Persistence.LOCAL
        : null;
    if (!persistence) {
        return Promise.resolve();
    }
    return firebase.auth().setPersistence(persistence).then(function () {
        if (typeof window.emsBootMark === 'function') {
            window.emsBootMark('auth-persistence-local');
        }
    }).catch(function (err) {
        console.warn('[EMS:auth] persistence:', err && err.message ? err.message : err);
    });
}

function emsOnAuthStateReady(user) {
    if (!window.EMS_AUTH_STATE_READY) {
        window.EMS_AUTH_STATE_READY = true;
        if (!user) {
            if (shouldForceStrictOfflineBypass()) {
                attemptStrictOfflineBoot();
                return;
            }
            if (typeof window.emsEnsureLoginShellVisible === 'function') {
                window.emsEnsureLoginShellVisible();
            }
            if (typeof window.emsScheduleDesktopOfflineAutoBoot === 'function') {
                window.emsScheduleDesktopOfflineAutoBoot();
            }
        }
    }
}

function bindAuthGatewayButtons() {
    if (authButtonsBound) return;
    authButtonsBound = true;
    var map = [
        ['btn-auth-login', window.loginWithEmail],
        ['btn-auth-signup', window.signupWithEmail],
        ['btn-auth-google', window.loginWithGoogle],
        ['btn-auth-google-alt', window.loginWithGoogle],
        ['btn-auth-reset', window.resetPassword],
        ['btn-auth-save-profile', window.saveMadrasaProfile],
        ['btn-auth-offline-continue', window.emsContinueOfflineDesktop],
        ['btn-landing-offline-continue', window.emsContinueOfflineDesktop]
    ];
    map.forEach(function (pair) {
        var el = document.getElementById(pair[0]);
        if (el && typeof pair[1] === 'function') {
            el.addEventListener('click', function (e) {
                e.preventDefault();
                pair[1]();
            });
        }
    });
    var resetLink = document.getElementById('link-auth-reset');
    if (resetLink) {
        resetLink.addEventListener('click', function (e) {
            e.preventDefault();
            window.resetPassword();
        });
    }
}

function startAuthStateListener() {
    if (shouldForceStrictOfflineBypass()) {
        if (!authListenerStarted) {
            authListenerStarted = true;
            authListenerBypassOnly = true;
            attemptStrictOfflineBoot();
        }
        return;
    }
    if (authListenerStarted && authListenerBypassOnly) {
        authListenerStarted = false;
        authListenerBypassOnly = false;
    }
    if (authListenerStarted) return;
    authListenerStarted = true;
    authListenerBypassOnly = false;

    emsSafeHandleRedirectResult();

    firebase.auth().onAuthStateChanged(function (user) {
        emsOnAuthStateReady(user);
        const tabAdmin = document.getElementById('tab-superadmin');

        if (user) {
            window.EMS_GOOGLE_AUTH_IN_PROGRESS = false;
            if (authNullDebounceTimer) {
                clearTimeout(authNullDebounceTimer);
                authNullDebounceTimer = null;
            }
            var bootPostAuth = (typeof window.emsEnsurePostAuthScripts === 'function')
                ? window.emsEnsurePostAuthScripts()
                : Promise.resolve();
            bootPostAuth.then(function () {
            function runCloudGatedBoot() {
                if (isNetworkUnavailable() && tryOfflineLocalBootAnyPlatform(user)) {
                    return;
                }

                emsEnsureSecurityStackReady().then(function (secResult) {
                    if (secResult && secResult.skipped) {
                        if (tryOfflineLocalBootAnyPlatform(user)) return;
                    }
                    if (!emsIsIdentityGateReady()) {
                        emsFailSecurityLayerMissing('cloud-gated-boot');
                        return;
                    }

                    if (typeof window.ensurePlatformUser === 'function') {
                        window.ensurePlatformUser(user).then(function () {
                            if (typeof window.loadPlatformUser === 'function') {
                                return window.loadPlatformUser(user);
                            }
                        });
                    }
                    window.refreshSuperAdminStatus(user, function (isSA) {
                        if (tabAdmin) {
                            tabAdmin.style.display = isSA ? 'inline-block' : 'none';
                        }
                        if (typeof window.applyModuleAccessUI === 'function') {
                            window.applyModuleAccessUI();
                        }
                        if (isSA && tabAdmin && typeof window.navigateToModule === 'function') {
                            var hash = (window.location.hash || '').replace(/^#/, '');
                            if (hash === 'superadmin') {
                                window.navigateToModule(tabAdmin);
                            }
                        }
                        listenMadrasaProfile(user);
                    });
                }).catch(function (secErr) {
                    console.warn('[EMS:auth] security stack:', secErr);
                    emsFailSecurityLayerMissing('security-stack-load');
                });
            }

            if (isDesktopBootEnv() && hasDesktopLocalBootData(user) && tryOfflineDesktopBoot(user)) {
                return;
            }

            if (isDesktopBootEnv() && typeof window.emsProbeCloudReachable === 'function') {
                return window.emsProbeCloudReachable().then(function (online) {
                    if (!online) {
                        if (tryOfflineDesktopBoot(user)) return;
                        desktopOfflineFailedGateway();
                        return;
                    }
                    if (hasDesktopLocalBootData(user) && isNetworkUnavailable() && tryOfflineDesktopBoot(user)) {
                        return;
                    }
                    runCloudGatedBoot();
                });
            }

            if (isDesktopBootEnv()
                && typeof window.emsIsNetworkAvailable === 'function'
                && !window.emsIsNetworkAvailable()) {
                if (tryOfflineDesktopBoot(user)) return;
                desktopOfflineFailedGateway();
                return;
            }

            runCloudGatedBoot();
            }).catch(function (err) {
                console.warn('Post-auth scripts:', err);
                if (isDesktopBootEnv()) {
                    if (tryOfflineDesktopBoot(user)) return;
                    desktopOfflineFailedGateway();
                    return;
                }
                emsFailSecurityLayerMissing('post-auth-scripts');
            });
        } else {
            if (authNullDebounceTimer) {
                clearTimeout(authNullDebounceTimer);
                authNullDebounceTimer = null;
            }

            window.CURRENT_MADRASA_DATA = null;
            window.SYSTEM_GLOBAL_STATUS = 'free';
            dbWaitAttempts = 0;
            emsMadrasaBootStarted = false;

            if (window.EMS_EXPLICIT_SIGNOUT) {
                window.EMS_EXPLICIT_SIGNOUT = false;
                if (typeof window.emsClearTenantContext === 'function') {
                    window.emsClearTenantContext();
                }
            } else if (typeof window.emsClearTenantContext === 'function') {
                window.emsClearTenantContext({ preserveOfflineCache: true });
            }

            if (unsubMadrasa) {
                unsubMadrasa();
                unsubMadrasa = null;
            }
            if (unsubGlobalSettings) {
                unsubGlobalSettings();
                unsubGlobalSettings = null;
            }
            if (unsubSystemSettings) {
                unsubSystemSettings();
                unsubSystemSettings = null;
            }
            if (tabAdmin) tabAdmin.style.display = 'none';
            window.SUPER_ADMIN_CACHE = null;

            var nullDelay = isDesktopBootEnv() ? 1200 : 0;
            authNullDebounceTimer = setTimeout(function () {
                authNullDebounceTimer = null;
                if (firebase.auth().currentUser) return;

                if (isDesktopBootEnv()) {
                    if (tryOfflineDesktopBootWithoutAuth()) return;
                    if (shouldForceStrictOfflineBypass()) {
                        attemptStrictOfflineBoot();
                        return;
                    }
                    if (typeof window.emsUpdateOfflineContinueButton === 'function') {
                        window.emsUpdateOfflineContinueButton();
                    }
                    showAuthGateway();
                    return;
                }

                showAuthGateway();
            }, nullDelay);
        }
    });
}

function initAuthModule() {
    if (authModuleInitialized) return;

    if (shouldForceStrictOfflineBypass()) {
        authModuleInitialized = true;
        bindAuthGatewayButtons();
        hideLoginUiForcefully();
        tryNativeInstantBootAfterIdbRestore();
        if (typeof window.emsScheduleNativeInstantAutoBoot === 'function') {
            window.emsScheduleNativeInstantAutoBoot();
        }
        if (typeof window.emsScheduleDesktopOfflineAutoBoot === 'function') {
            window.emsScheduleDesktopOfflineAutoBoot();
        }
        if (typeof window.emsBootMark === 'function') {
            window.emsBootMark('auth-strict-offline-bypass');
        }
        return;
    }

    if (typeof window.emsIsOfflineOnly === 'function' && window.emsIsOfflineOnly()) {
        bindAuthGatewayButtons();
        if (typeof window.emsTryNativeInstantBoot === 'function' && window.emsTryNativeInstantBoot()) {
            authModuleInitialized = true;
            if (typeof window.emsBootMark === 'function') {
                window.emsBootMark('auth-native-instant-boot');
            }
            return;
        }
        if (isNativeAppEnv()) {
            authModuleInitialized = true;
            if (typeof window.emsRequiresFirstTimeGoogleLogin === 'function'
                && window.emsRequiresFirstTimeGoogleLogin()) {
                if (typeof window.emsEnableOnlineMode === 'function') {
                    window.emsEnableOnlineMode().catch(function () { });
                }
                if (typeof window.emsShowLanding === 'function') {
                    window.emsShowLanding();
                }
            } else {
                tryNativeInstantBootAfterIdbRestore();
            }
            if (typeof window.emsScheduleNativeInstantAutoBoot === 'function') {
                window.emsScheduleNativeInstantAutoBoot();
            }
            if (typeof window.emsScheduleDesktopOfflineAutoBoot === 'function') {
                window.emsScheduleDesktopOfflineAutoBoot();
            }
            if (typeof window.emsBootMark === 'function') {
                window.emsBootMark('auth-native-offline-init');
            }
            return;
        }
        // Web offline-first — do NOT force Firebase cloud stack when user chose offline or network is down
        authModuleInitialized = true;
        if (typeof window.emsBootMark === 'function') {
            window.emsBootMark('auth-web-offline-first');
        }
        if (tryOfflineLocalBootAnyPlatform(null)) {
            return;
        }
        if (typeof firebase !== 'undefined' && firebase.auth) {
            emsConfigureAuthPersistence().then(function () {
                if (typeof window.emsEnsureLoginShellVisible === 'function') {
                    window.emsEnsureLoginShellVisible();
                }
                bindAuthGatewayButtons();
                startAuthStateListener();
            });
            return;
        }
        if (typeof window.emsStartOfflineLocalApp === 'function') {
            window.emsStartOfflineLocalApp();
        }
        return;
    }

    if (typeof firebase === 'undefined' || !firebase.auth) {
        if (isNativeAppEnv()
            && typeof window.emsHasNativeInstantBootCache === 'function'
            && window.emsHasNativeInstantBootCache()) {
            authModuleInitialized = true;
            tryNativeInstantBootAfterIdbRestore();
            if (typeof window.emsScheduleNativeInstantAutoBoot === 'function') {
                window.emsScheduleNativeInstantAutoBoot();
            }
            if (typeof window.emsScheduleDesktopOfflineAutoBoot === 'function') {
                window.emsScheduleDesktopOfflineAutoBoot();
            }
            return;
        }
        if (typeof window.emsEnableOnlineMode === 'function') {
            window.emsEnableOnlineMode().finally(function () {
                setTimeout(initAuthModule, 100);
            });
        } else {
            setTimeout(initAuthModule, 150);
        }
        return;
    }

    authModuleInitialized = true;
    if (typeof window.emsBootMark === 'function') {
        window.emsBootMark('auth-init-start');
    }

    emsConfigureAuthPersistence().then(function () {
        if (shouldForceStrictOfflineBypass()) {
            hideLoginUiForcefully();
            attemptStrictOfflineBoot();
            return;
        }
        if (isNativeAppEnv() && typeof window.emsProbeCloudReachable === 'function') {
            window.emsProbeCloudReachable().then(function (online) {
                if (!online
                    && typeof window.emsHasNativeInstantBootCache === 'function'
                    && window.emsHasNativeInstantBootCache()
                    && typeof window.emsTryNativeInstantBootImpl === 'function') {
                    window.emsTryNativeInstantBootImpl();
                }
            });
        }
        if (typeof window.emsEnsureLoginShellVisible === 'function') {
            window.emsEnsureLoginShellVisible();
        }
        bindAuthGatewayButtons();
        startAuthStateListener();
        if (isNativeAppEnv()
            && typeof window.emsHasNativeInstantBootCache === 'function'
            && window.emsHasNativeInstantBootCache()) {
            if (typeof window.emsScheduleNativeInstantAutoBoot === 'function') {
                window.emsScheduleNativeInstantAutoBoot();
            }
            if (typeof window.emsScheduleDesktopOfflineAutoBoot === 'function') {
                window.emsScheduleDesktopOfflineAutoBoot();
            }
        }
        if (isNativeAppEnv() && typeof window.emsRequiresFirstTimeGoogleLogin === 'function'
            && window.emsRequiresFirstTimeGoogleLogin()) {
            setTimeout(function () {
                if (firebase.auth().currentUser) return;
                if (document.body.classList.contains('ems-authenticated')) return;
                if (typeof window.emsShowRegistrationBootOverlay === 'function') {
                    window.emsShowRegistrationBootOverlay(false);
                }
                if (typeof window.emsShowLanding === 'function') {
                    window.emsShowLanding();
                }
                if (typeof window.emsUpdateOfflineContinueButton === 'function') {
                    window.emsUpdateOfflineContinueButton();
                }
            }, 300);
        }
        if (typeof window.emsBootMark === 'function') {
            window.emsBootMark('auth-listener-started');
        }
    });
}

document.addEventListener('DOMContentLoaded', function () {
    initAuthModule();

    const ribbon = document.querySelector('.ribbon-bar');
    if (ribbon) {
        ribbon.addEventListener('click', function (e) {
            const tab = e.target.closest('.ribbon-tab');
            if (!tab) return;
            if (e.target.closest('.ribbon-logout-btn')) return;
            e.preventDefault();
            window.navigateToModule(tab);
        });
    }
});

if (document.readyState !== 'loading') {
    initAuthModule();
}
