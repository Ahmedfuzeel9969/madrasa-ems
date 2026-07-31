// ============================================================================
// EMS Firebase Init — re-establishes the cloud connection (restored)
// ----------------------------------------------------------------------------
// Loaded as the FIRST cloud-stack boot script (after firebase-*-compat vendor).
// Idempotent: safe to call many times. Sets window.EMS_FIRESTORE_DB so the
// existing getDbOrNull() / sync-engine / direct-firestore layers light up.
// Does NOT sign the user in and does NOT pull data — that stays manual.
// ============================================================================
(function (global) {
    'use strict';

    var FIREBASE_CONFIG = {
        apiKey: 'AIzaSyBdcP1CEpupMTGuWxHUQqsYCd1Z-qTHr7Y',
        authDomain: 'madrasa-mangment-app.firebaseapp.com',
        projectId: 'madrasa-mangment-app',
        storageBucket: 'madrasa-mangment-app.firebasestorage.app',
        messagingSenderId: '529775229216',
        appId: '1:529775229216:web:77a1e019dae4b974e3ff45'
    };

    global.EMS_FIREBASE_CONFIG = FIREBASE_CONFIG;

    var initialized = false;

    /**
     * Initialize Firebase app + Firestore handle. Returns the Firestore db or null.
     * Requires the firebase compat SDK (vendor) to already be loaded.
     */
    global.emsInitFirebase = function () {
        if (typeof global.firebase === 'undefined' || !global.firebase.initializeApp) {
            return null; // vendor not loaded yet
        }
        try {
            if (!global.firebase.apps || !global.firebase.apps.length) {
                global.firebase.initializeApp(FIREBASE_CONFIG);
            }
        } catch (e) {
            // already initialized elsewhere — ignore
        }

        try {
            if (global.firebase.firestore) {
                var db = global.firebase.firestore();
                global.EMS_FIRESTORE_DB = db;
                if (typeof db.settings === 'function' && !global.__EMS_FS_SETTINGS_DONE) {
                    try {
                        db.settings({ ignoreUndefinedProperties: true, merge: true });
                        global.__EMS_FS_SETTINGS_DONE = true;
                    } catch (se) { /* settings already applied */ }
                }
            }
        } catch (e2) { /* firestore unavailable */ }

        // Keep the session across reloads (offline-friendly), don't force a login.
        try {
            if (global.firebase.auth && global.firebase.auth.Auth) {
                global.firebase.auth().setPersistence(
                    global.firebase.auth.Auth.Persistence.LOCAL
                ).catch(function () { });
            }
        } catch (e3) { /* auth unavailable */ }

        initialized = true;
        try {
            global.dispatchEvent(new CustomEvent('ems:firebase-ready', {
                detail: { hasDb: !!global.EMS_FIRESTORE_DB }
            }));
        } catch (e4) { /* ignore */ }
        return global.EMS_FIRESTORE_DB || null;
    };

    global.emsIsFirebaseReady = function () {
        return initialized && !!global.EMS_FIRESTORE_DB;
    };

    // Auto-init when this script loads as part of the cloud stack (firebase vendor
    // is loaded before this in the manifest boot list).
    if (typeof global.firebase !== 'undefined' && global.firebase.initializeApp) {
        global.emsInitFirebase();
    }
})(typeof window !== 'undefined' ? window : globalThis);
