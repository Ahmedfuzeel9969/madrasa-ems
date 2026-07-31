// ============================================================================
// EMS Native Google Sign-In (Capacitor Android APK)
// Native account chooser → Google ID token → Firebase signInWithCredential
// Web browsers keep auth.js popup/redirect flow.
// ============================================================================
(function (global) {
    'use strict';

    /** Web OAuth client (client_type 3) from android/app/google-services.json */
    var WEB_CLIENT_ID = '529775229216-h0pmuqqvrhendoa3n71ong4upmiqa3ad.apps.googleusercontent.com';

    var FIREBASE_CONFIG = {
        apiKey: 'AIzaSyBdcP1CEpupMTGuWxHUQqsYCd1Z-qTHr7Y',
        authDomain: 'madrasa-mangment-app.firebaseapp.com',
        projectId: 'madrasa-mangment-app',
        storageBucket: 'madrasa-mangment-app.firebasestorage.app',
        messagingSenderId: '529775229216',
        appId: '1:529775229216:web:77a1e019dae4b974e3ff45'
    };

    var initPromise = null;
    var preparePromise = null;
    var prepareReady = false;
    var socialLoginPlugin = null;
    /** Stage-by-stage diagnosis for Android login prep (shown in UI / console). */
    var lastDiag = {
        at: null,
        stage: null,
        pluginAvailable: null,
        pluginSource: null,
        capacitorReady: null,
        firebaseAuthReady: null,
        socialLoginInitOk: null,
        code: null,
        message: null,
        raw: null
    };

    function setDiag(patch) {
        Object.keys(patch || {}).forEach(function (k) {
            lastDiag[k] = patch[k];
        });
        lastDiag.at = new Date().toISOString();
        global.EMS_NATIVE_GOOGLE_DIAG = lastDiag;
        try {
            console.info('[EMS:native-google:diag]', JSON.parse(JSON.stringify(lastDiag)));
        } catch (eLog) {
            console.info('[EMS:native-google:diag]', lastDiag.stage, lastDiag.code, lastDiag.message);
        }
        return lastDiag;
    }

    global.emsGetNativeGoogleDiag = function () {
        return lastDiag;
    };

    function getCapacitorPlatform() {
        try {
            if (global.Capacitor && typeof global.Capacitor.getPlatform === 'function') {
                return global.Capacitor.getPlatform();
            }
        } catch (e) { /* ignore */ }
        return 'web';
    }

    global.emsShouldUseNativeGoogleSignIn = function () {
        if (getCapacitorPlatform() !== 'android') return false;
        if (typeof global.emsIsAndroidApp === 'function') {
            return global.emsIsAndroidApp();
        }
        try {
            return !!(global.Capacitor && global.Capacitor.isNativePlatform && global.Capacitor.isNativePlatform());
        } catch (e2) {
            return false;
        }
    };

    function waitForCapacitor(maxMs) {
        maxMs = maxMs || 8000;
        if (global.Capacitor && (global.Capacitor.Plugins || global.Capacitor.registerPlugin)) {
            return Promise.resolve(global.Capacitor);
        }
        return new Promise(function (resolve, reject) {
            var elapsed = 0;
            var step = 50;
            var timer = setInterval(function () {
                elapsed += step;
                if (global.Capacitor && (global.Capacitor.Plugins || global.Capacitor.registerPlugin)) {
                    clearInterval(timer);
                    resolve(global.Capacitor);
                } else if (elapsed >= maxMs) {
                    clearInterval(timer);
                    reject(new Error('Capacitor bridge not ready after ' + maxMs + 'ms'));
                }
            }, step);
        });
    }

    function getSocialLoginPlugin() {
        if (socialLoginPlugin) return socialLoginPlugin;
        try {
            if (global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.SocialLogin) {
                socialLoginPlugin = global.Capacitor.Plugins.SocialLogin;
                return socialLoginPlugin;
            }
            if (global.Capacitor && typeof global.Capacitor.registerPlugin === 'function') {
                socialLoginPlugin = global.Capacitor.registerPlugin('SocialLogin');
                return socialLoginPlugin;
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    function extractIdToken(loginResult) {
        if (!loginResult) return null;
        if (loginResult.result && loginResult.result.idToken) return loginResult.result.idToken;
        if (loginResult.authentication && loginResult.authentication.idToken) {
            return loginResult.authentication.idToken;
        }
        if (loginResult.idToken) return loginResult.idToken;
        return null;
    }

    function makeAuthError(err, fallbackCode, stage) {
        var msg;
        var code = fallbackCode || 'auth/native-google-failed';
        var raw = null;
        if (!err) {
            msg = 'نامعلوم native Google login خرابی';
        } else if (typeof err === 'string') {
            msg = err;
            raw = err;
        } else {
            msg = err.message || err.errorMessage || err.error || String(err);
            raw = msg;
            if (err.code != null && err.code !== '') code = String(err.code);
        }
        // Keep original message; only hint code when message lacks a code-like tag.
        if (/28444|Developer console is not set up/i.test(msg) && code === 'auth/native-google-failed') {
            code = 'auth/developer-console';
        } else if (/script load failed/i.test(msg) && code === 'auth/native-google-failed') {
            code = 'auth/script-load-failed';
        } else if (/Capacitor bridge not ready/i.test(msg) && code === 'auth/native-google-failed') {
            code = 'auth/capacitor-not-ready';
        } else if (/SocialLogin|plugin not available|unavailable/i.test(msg) && code === 'auth/native-google-failed') {
            code = 'auth/plugin-not-available';
        } else if (/Firebase Auth SDK/i.test(msg) && code === 'auth/native-google-failed') {
            code = 'auth/firebase-not-ready';
        }
        var error = new Error(msg);
        error.code = code;
        error.stage = stage || lastDiag.stage || null;
        error.diag = setDiag({
            stage: error.stage,
            code: code,
            message: msg,
            raw: raw
        });
        return error;
    }

    function cacheBust() {
        return (global.EmsCloudManifest && global.EmsCloudManifest.cacheBust) || '20260716';
    }

    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            var existing = document.querySelector('script[src="' + src + '"]');
            if (existing) {
                resolve();
                return;
            }
            var el = document.createElement('script');
            el.src = src;
            el.async = false;
            el.onload = function () { resolve(); };
            el.onerror = function () { reject(new Error('script load failed: ' + src)); };
            document.head.appendChild(el);
        });
    }

    /** Auth only — no Firestore, no ems-firebase-init.js */
    function initFirebaseAuthOnly() {
        if (typeof firebase === 'undefined') return false;
        try {
            if (!firebase.apps || !firebase.apps.length) {
                firebase.initializeApp(FIREBASE_CONFIG);
            }
        } catch (eInit) { /* already initialized */ }
        try {
            if (firebase.auth && firebase.auth.Auth) {
                firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function () { });
            }
        } catch (e2) { /* ignore */ }
        return !!(firebase.auth);
    }

    function bootstrapFirebaseAuthMinimal() {
        setDiag({ stage: 'firebase-bootstrap', firebaseAuthReady: false });
        if (initFirebaseAuthOnly()) {
            setDiag({ firebaseAuthReady: true, stage: 'firebase-bootstrap-ok' });
            return Promise.resolve(true);
        }
        var bust = cacheBust();
        var scripts = [
            'vendor/firebasejs/9.22.0/firebase-app-compat.js?v=' + bust,
            'vendor/firebasejs/9.22.0/firebase-auth-compat.js?v=' + bust
        ];
        return scripts.reduce(function (chain, src) {
            return chain.then(function () {
                setDiag({ stage: 'firebase-script:' + src });
                return loadScript(src);
            });
        }, Promise.resolve()).then(function () {
            if (!initFirebaseAuthOnly()) {
                throw new Error('Firebase Auth SDK not loaded after script injection.');
            }
            setDiag({ firebaseAuthReady: true, stage: 'firebase-bootstrap-ok' });
            return true;
        });
    }

    function ensureNativePluginReady() {
        if (initPromise) return initPromise;
        setDiag({
            stage: 'capacitor-wait',
            capacitorReady: false,
            pluginAvailable: false,
            socialLoginInitOk: false
        });
        initPromise = waitForCapacitor().then(function () {
            setDiag({ capacitorReady: true, stage: 'plugin-resolve' });
            var plugin = null;
            var pluginSource = null;
            try {
                if (global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.SocialLogin) {
                    plugin = global.Capacitor.Plugins.SocialLogin;
                    pluginSource = 'Capacitor.Plugins.SocialLogin';
                } else if (global.Capacitor && typeof global.Capacitor.registerPlugin === 'function') {
                    plugin = global.Capacitor.registerPlugin('SocialLogin');
                    pluginSource = 'Capacitor.registerPlugin(SocialLogin)';
                }
            } catch (eResolve) {
                throw new Error('SocialLogin resolve threw: ' + (eResolve && eResolve.message ? eResolve.message : String(eResolve)));
            }
            socialLoginPlugin = plugin;
            setDiag({
                pluginAvailable: !!(plugin && typeof plugin.initialize === 'function'),
                pluginSource: pluginSource,
                stage: 'plugin-resolved'
            });
            if (!plugin || typeof plugin.initialize !== 'function') {
                throw new Error(
                    'SocialLogin Capacitor plugin not available'
                    + ' (source=' + (pluginSource || 'none')
                    + ', hasPlugins=' + !!(global.Capacitor && global.Capacitor.Plugins)
                    + ', hasRegister=' + !!(global.Capacitor && global.Capacitor.registerPlugin)
                    + ')'
                );
            }
            console.info('[EMS:native-google] initialize webClientId=', WEB_CLIENT_ID.slice(0, 24) + '…');
            setDiag({ stage: 'sociallogin-initialize' });
            return plugin.initialize({
                google: {
                    webClientId: WEB_CLIENT_ID,
                    mode: 'online'
                }
            });
        }).then(function (initResult) {
            setDiag({
                socialLoginInitOk: true,
                stage: 'sociallogin-initialize-ok',
                raw: initResult == null ? 'initialize returned void/null' : JSON.stringify(initResult).slice(0, 400)
            });
            console.info('[EMS:native-google] initialize OK', initResult);
            return true;
        }).catch(function (err) {
            initPromise = null;
            setDiag({
                socialLoginInitOk: false,
                stage: lastDiag.stage || 'sociallogin-initialize',
                code: err && err.code ? String(err.code) : null,
                message: err && err.message ? err.message : String(err),
                raw: err && err.message ? err.message : String(err)
            });
            throw err;
        });
        return initPromise;
    }

    global.emsPrepareAndroidGoogleLogin = function () {
        if (!global.emsShouldUseNativeGoogleSignIn()) {
            return Promise.resolve(false);
        }
        if (prepareReady) return Promise.resolve(true);
        if (preparePromise) return preparePromise;

        setDiag({
            stage: 'prepare-start',
            pluginAvailable: null,
            pluginSource: null,
            capacitorReady: null,
            firebaseAuthReady: null,
            socialLoginInitOk: null,
            code: null,
            message: null,
            raw: null
        });

        global.EMS_OFFLINE_ONLY = false;
        global.EMS_NETWORK_OFFLINE_AT_BOOT = false;
        global.EMS_CLOUD_REACHABLE = true;
        global.EMS_ALLOW_FIRST_LOGIN_CLOUD_FETCH = true;
        try { global.localStorage.setItem('ems_online_mode', '1'); } catch (e) { /* ignore */ }
        if (typeof global.emsResetCloudReachabilityProbe === 'function') {
            global.emsResetCloudReachabilityProbe();
        }

        preparePromise = bootstrapFirebaseAuthMinimal()
            .then(function () { return ensureNativePluginReady(); })
            .then(function () {
                prepareReady = true;
                global.EMS_NATIVE_GOOGLE_PREPARE_OK = true;
                global.EMS_NATIVE_GOOGLE_PREWARM_ERROR = null;
                setDiag({ stage: 'prepare-ok' });
                return true;
            })
            .catch(function (err) {
                preparePromise = null;
                var wrapped = makeAuthError(err, null, lastDiag.stage || 'prepare');
                global.EMS_NATIVE_GOOGLE_PREWARM_ERROR = wrapped;
                console.error('[EMS:native-google] prepare failed:', wrapped.code, wrapped.message, wrapped.diag);
                throw wrapped;
            });

        return preparePromise;
    };

    global.emsEnsureNativeGoogleAuthReady = function () {
        return global.emsPrepareAndroidGoogleLogin();
    };

    global.emsRunNativeGoogleSignIn = function () {
        var loginChain = prepareReady
            ? Promise.resolve(true)
            : global.emsPrepareAndroidGoogleLogin();

        return loginChain.then(function () {
            return waitForCapacitor();
        }).then(function () {
            var plugin = getSocialLoginPlugin();
            if (!plugin || typeof plugin.login !== 'function') {
                throw new Error('SocialLogin.login unavailable');
            }
            return plugin.login({
                provider: 'google',
                options: {
                    // No explicit scopes — Capgo rejects scopes unless MainActivity is modified.
                    // Plugin adds default email/profile/openid internally for ID token.
                    style: 'standard',
                    filterByAuthorizedAccounts: false,
                    forceRefreshToken: false
                }
            });
        }).then(function (loginResult) {
            console.info('[EMS:native-google] login result keys=', loginResult && Object.keys(loginResult));
            var idToken = extractIdToken(loginResult);
            if (!idToken) {
                throw new Error('Native Google login did not return an ID token.');
            }
            return bootstrapFirebaseAuthMinimal().then(function () {
                if (typeof firebase === 'undefined' || !firebase.auth) {
                    throw new Error('Firebase Auth SDK not loaded.');
                }
                var credential = firebase.auth.GoogleAuthProvider.credential(idToken);
                return firebase.auth().signInWithCredential(credential).then(function (cred) {
                    var user = cred && cred.user;
                    console.info('[EMS:native-google] Firebase UID=', user && user.uid, 'email=', user && user.email);
                    return cred;
                });
            });
        }).catch(function (err) {
            throw makeAuthError(err);
        });
    };

    global.emsPreWarmAndroidGoogleLogin = function () {
        if (!global.emsShouldUseNativeGoogleSignIn()) return Promise.resolve(false);
        if (typeof global.emsRequiresFirstTimeGoogleLogin === 'function'
            && !global.emsRequiresFirstTimeGoogleLogin()) {
            return Promise.resolve(false);
        }
        return global.emsPrepareAndroidGoogleLogin().catch(function () {
            return false;
        });
    };

    global.emsNativeGoogleWebClientId = function () {
        return WEB_CLIENT_ID;
    };

    if (global.emsShouldUseNativeGoogleSignIn()
        && typeof global.emsRequiresFirstTimeGoogleLogin === 'function'
        && global.emsRequiresFirstTimeGoogleLogin()) {
        var schedulePrewarm = function () {
            setTimeout(function () {
                global.emsPreWarmAndroidGoogleLogin();
            }, 800);
        };
        if (typeof document !== 'undefined') {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', schedulePrewarm);
            } else {
                schedulePrewarm();
            }
        }
    }
})(typeof window !== 'undefined' ? window : globalThis);
