// ============================================================================
// EMS Firestore Paths — single SSOT for tenant id + collection paths
// Write (admission.js) and read (repo / cloud pull) MUST use the same helpers.
// Path: All_Madrasas/{tenantId}/Registrations/{docId}
// Owner tenantId === Firebase Auth uid (Gmail account doc under All_Madrasas)
// ============================================================================
(function (global) {
    'use strict';

    var ROOT = 'All_Madrasas';
    var DEMO_ROOT = 'Demo_Madrasas';
    var COL_REGISTRATIONS = 'Registrations';
    var COL_REJECTED = 'Rejected';
    var COL_REGISTRATION_META = 'RegistrationMeta';

    function authUid() {
        try {
            var u = firebase.auth().currentUser;
            return u ? u.uid : null;
        } catch (e) { /* ignore */ }
        return null;
    }

    function authEmail() {
        try {
            var u = firebase.auth().currentUser;
            return u && u.email ? u.email : null;
        } catch (e) { /* ignore */ }
        return null;
    }

    function isLocalTenantId(id) {
        return !!id && String(id).indexOf('local_') === 0;
    }

    function readPersistedTenantId() {
        if (typeof global.emsReadPersistedBootTenantId === 'function') {
            return global.emsReadPersistedBootTenantId();
        }
        try {
            return localStorage.getItem('ems_persisted_tenant_id_v1') || null;
        } catch (e) {
            return null;
        }
    }

    function getFirestoreDb() {
        if (typeof global.getDbOrNull === 'function') {
            var db = global.getDbOrNull();
            if (db) return db;
        }
        try {
            if (typeof firebase !== 'undefined' && firebase.firestore) {
                return firebase.firestore();
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    function ensureAuthTokenFresh() {
        try {
            var u = firebase.auth().currentUser;
            if (u && typeof u.getIdToken === 'function') {
                return u.getIdToken(true).catch(function () { return null; });
            }
        } catch (e) { /* ignore */ }
        return Promise.resolve(null);
    }

    global.emsFirestoreEnsureAuthToken = ensureAuthTokenFresh;
    global.emsFirestoreGetDb = getFirestoreDb;

    /**
     * Canonical Firestore tenant id — identical logic for save, push, and pull.
     * Owner: madrasa doc id === auth.uid (never local_* when Gmail session active).
     */
    function activeRoot() {
        if (typeof global.emsGetTenantRootCollection === 'function') {
            return global.emsGetTenantRootCollection();
        }
        if (typeof global.emsIsDemoSandbox === 'function' && global.emsIsDemoSandbox()) {
            return DEMO_ROOT;
        }
        return ROOT;
    }

    function isDemoTenantId(id) {
        return !!id && String(id).indexOf('demo_guest_') === 0;
    }

    global.emsResolveFirestoreTenantId = function (opts) {
        opts = opts || {};
        if (opts.tenantId) return String(opts.tenantId).trim() || null;

        if (typeof global.emsIsDemoSandbox === 'function' && global.emsIsDemoSandbox()) {
            return global.CURRENT_MADRASA_TENANT_ID
                || (typeof global.emsBuildDemoTenantId === 'function' ? global.emsBuildDemoTenantId(authUid()) : null);
        }

        var uid = authUid();
        var role = global.CURRENT_USER_TENANT_ROLE;
        var current = global.CURRENT_MADRASA_TENANT_ID;
        var active = global.EMS_ACTIVE_TENANT_ID;

        if (uid && role === 'owner') {
            if (current && isDemoTenantId(current)) return current;
            if (typeof global.emsIsDemoSandbox === 'function' && global.emsIsDemoSandbox() && current) {
                return current;
            }
            return uid;
        }

        if (current) {
            if (role === 'staff' || role === 'parent') {
                return current;
            }
            if (isLocalTenantId(current) && uid) {
                return uid;
            }
            if (uid && role === 'owner') {
                return uid;
            }
            if (uid && current === uid) {
                return uid;
            }
            return current;
        }

        if (active) {
            if (isLocalTenantId(active) && uid) {
                return uid;
            }
            return active;
        }

        if (uid && (role === 'owner' || !role)) {
            return uid;
        }

        if (typeof global.emsGetTenantId === 'function') {
            var legacyTid = global.emsGetTenantId();
            if (legacyTid && !(uid && isLocalTenantId(legacyTid))) {
                return legacyTid;
            }
        }

        var persisted = readPersistedTenantId();
        if (uid && persisted && isLocalTenantId(persisted)) {
            return uid;
        }
        if (persisted && !isLocalTenantId(persisted)) {
            return persisted;
        }

        if (uid && opts.allowAuthUidFallback !== false) {
            return uid;
        }
        if (persisted) {
            return persisted;
        }
        return null;
    };

    /** After a successful cloud probe, align session tenant with Firestore path. */
    global.emsFirestoreAlignSessionTenant = function (tenantId) {
        tenantId = tenantId ? String(tenantId).trim() : null;
        if (!tenantId) return;
        global.CURRENT_MADRASA_TENANT_ID = tenantId;
        global.EMS_ACTIVE_TENANT_ID = tenantId;
        try {
            localStorage.setItem('ems_persisted_tenant_id_v1', tenantId);
        } catch (e) { /* ignore */ }
        if (typeof global.emsActivateTenantStorage === 'function') {
            global.emsActivateTenantStorage(tenantId);
        }
        if (typeof global.emsRegRepoInit === 'function') {
            global.emsRegRepoInit(tenantId);
        }
    };

    global.emsFirestoreRootCollection = function () {
        return activeRoot();
    };

    global.emsFirestoreRegistrationsCollectionName = function () {
        return COL_REGISTRATIONS;
    };

    global.emsFirestoreRegistrationsPath = function (tenantId) {
        tenantId = tenantId || global.emsResolveFirestoreTenantId();
        if (!tenantId) return null;
        return activeRoot() + '/' + tenantId + '/' + COL_REGISTRATIONS;
    };

    global.emsFirestoreTenantDocRef = function (db, tenantId) {
        db = db || getFirestoreDb();
        tenantId = tenantId || global.emsResolveFirestoreTenantId();
        if (!db || !tenantId) return null;
        return db.collection(activeRoot()).doc(tenantId);
    };

    global.emsFirestoreSubColRef = function (db, tenantId, collectionName) {
        var docRef = global.emsFirestoreTenantDocRef(db, tenantId);
        if (!docRef || !collectionName) return null;
        return docRef.collection(collectionName);
    };

    global.emsFirestoreCollectionColRef = function (db, tenantId, collectionName) {
        return global.emsFirestoreSubColRef(db, tenantId, collectionName);
    };

    global.emsFirestoreRegistrationsColRef = function (db, tenantId) {
        return global.emsFirestoreCollectionColRef(db, tenantId, COL_REGISTRATIONS);
    };

    global.emsFirestoreRejectedColRef = function (db, tenantId) {
        return global.emsFirestoreCollectionColRef(db, tenantId, COL_REJECTED);
    };

    function firestoreGet(query, opts) {
        opts = opts || {};
        var attempts = [];
        if (opts.preferServer !== false) {
            attempts.push(function () { return query.get({ source: 'server' }); });
        }
        attempts.push(function () { return query.get(); });
        var chain = Promise.reject(new Error('no_query'));
        attempts.forEach(function (fn) {
            chain = chain.catch(function () { return fn(); });
        });
        return chain;
    }

    /** Server probe — plain limit (no orderBy) so legacy docs without timestamp are found. */
    global.emsFirestoreProbeRegistrationCount = function (tenantId, opts) {
        opts = opts || {};
        return ensureAuthTokenFresh().then(function () {
            var db = getFirestoreDb();
            tenantId = tenantId || global.emsResolveFirestoreTenantId(opts);
            tenantId = tenantId ? String(tenantId).trim() : null;
            var path = tenantId ? global.emsFirestoreRegistrationsPath(tenantId) : null;
            if (!db || !tenantId) {
                return {
                    ok: false,
                    count: 0,
                    tenantId: tenantId,
                    path: path,
                    hasData: false,
                    reason: 'no_db_or_tenant'
                };
            }
            var col = global.emsFirestoreRegistrationsColRef(db, tenantId);
            var sampleLimit = opts.limit || 5000;
            return firestoreGet(col.limit(1)).then(function (snap) {
                if (snap.empty) {
                    return {
                        ok: true,
                        count: 0,
                        tenantId: tenantId,
                        path: path,
                        hasData: false,
                        probeMode: 'plain_limit'
                    };
                }
                return firestoreGet(col.limit(sampleLimit)).then(function (snap2) {
                    return {
                        ok: true,
                        count: snap2.size,
                        truncated: snap2.size >= sampleLimit,
                        tenantId: tenantId,
                        path: path,
                        hasData: snap2.size > 0,
                        probeMode: 'plain_limit'
                    };
                });
            }).catch(function (err) {
                return {
                    ok: false,
                    count: -1,
                    tenantId: tenantId,
                    path: path,
                    hasData: false,
                    error: err && err.message ? err.message : String(err)
                };
            });
        });
    };

    global.emsFirestoreListPullCandidates = function () {
        var uid = authUid();
        var candidates = [];
        function add(id, source) {
            if (!id) return;
            id = String(id).trim();
            if (!id) return;
            for (var i = 0; i < candidates.length; i++) {
                if (candidates[i].tenantId === id) return;
            }
            candidates.push({ tenantId: id, source: source });
        }

        if (uid) add(uid, 'auth_uid');
        add(global.CURRENT_MADRASA_TENANT_ID, 'CURRENT_MADRASA_TENANT_ID');
        add(global.EMS_ACTIVE_TENANT_ID, 'EMS_ACTIVE_TENANT_ID');
        add(global.emsResolveFirestoreTenantId(), 'resolved');

        var persisted = readPersistedTenantId();
        if (persisted && !(uid && isLocalTenantId(persisted))) {
            add(persisted, 'persisted');
        }

        return candidates;
    };

    /** Try candidate tenant ids until Firestore returns registration data. */
    global.emsFirestoreFindTenantWithRegistrationData = function () {
        return ensureAuthTokenFresh().then(function () {
            var db = getFirestoreDb();
            if (!db) {
                return { ok: false, reason: 'no_db', tenantId: null, count: 0 };
            }

            var candidates = global.emsFirestoreListPullCandidates();
            var chain = Promise.resolve(null);

            candidates.forEach(function (c) {
                chain = chain.then(function (found) {
                    if (found && found.hasData) return found;
                    return global.emsFirestoreProbeRegistrationCount(c.tenantId).then(function (probe) {
                        if (probe.error) {
                            return found || {
                                ok: false,
                                tenantId: c.tenantId,
                                path: probe.path,
                                source: c.source,
                                error: probe.error,
                                hasData: false,
                                count: 0
                            };
                        }
                        if (probe.hasData) {
                            if (typeof global.emsFirestoreAlignSessionTenant === 'function') {
                                global.emsFirestoreAlignSessionTenant(c.tenantId);
                            }
                            return {
                                ok: true,
                                tenantId: c.tenantId,
                                path: probe.path,
                                source: c.source,
                                hasData: true,
                                count: probe.count,
                                truncated: probe.truncated
                            };
                        }
                        return found;
                    });
                });
            });

            return chain.then(function (found) {
                if (found && found.hasData) return found;
                return found || {
                    ok: true,
                    tenantId: global.emsResolveFirestoreTenantId(),
                    path: global.emsFirestoreRegistrationsPath(),
                    hasData: false,
                    count: 0,
                    source: 'none'
                };
            });
        });
    };

    global.emsFirestorePathMeta = function () {
        var tenantId = global.emsResolveFirestoreTenantId();
        return {
            root: activeRoot(),
            registrations: COL_REGISTRATIONS,
            rejected: COL_REJECTED,
            registrationMeta: COL_REGISTRATION_META,
            tenantId: tenantId,
            registrationsPath: global.emsFirestoreRegistrationsPath(tenantId),
            authUid: authUid(),
            authEmail: authEmail(),
            role: global.CURRENT_USER_TENANT_ROLE || null,
            currentMadrasaTenantId: global.CURRENT_MADRASA_TENANT_ID || null,
            activeTenantId: global.EMS_ACTIVE_TENANT_ID || null,
            persistedTenantId: readPersistedTenantId()
        };
    };

})(typeof window !== 'undefined' ? window : globalThis);
