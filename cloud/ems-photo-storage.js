// ============================================================================
// EMS Photo Storage — Firebase Storage for registration photos (Phase A2)
// ============================================================================
(function (global) {
    'use strict';

    function getStorage() {
        try {
            if (typeof firebase !== 'undefined' && firebase.storage) return firebase.storage();
        } catch (e) { /* ignore */ }
        return null;
    }

    function getDb() {
        if (typeof global.getDbOrNull === 'function') return global.getDbOrNull();
        return typeof db !== 'undefined' ? db : null;
    }

    function getTenantId() {
        if (typeof global.emsGetTenantId === 'function') {
            var tid = global.emsGetTenantId();
            if (tid) return tid;
        }
        if (global.CURRENT_MADRASA_TENANT_ID) return global.CURRENT_MADRASA_TENANT_ID;
        try {
            var u = firebase.auth && firebase.auth().currentUser;
            return u ? u.uid : null;
        } catch (e) {
            return null;
        }
    }

    function isHttpUrl(str) {
        return typeof str === 'string' && (str.indexOf('http://') === 0 || str.indexOf('https://') === 0);
    }

    function isDataUrl(str) {
        return typeof str === 'string' && str.indexOf('data:') === 0;
    }

    function looksLikeRawBase64(str) {
        if (typeof str !== 'string' || str.length < 32) return false;
        if (isDataUrl(str) || isHttpUrl(str)) return false;
        return /^[A-Za-z0-9+/=\s]+$/.test(str.replace(/\s/g, '').slice(0, 256));
    }

    /** Normalize legacy inputs to a data URL for upload. */
    function normalizePhotoInput(str) {
        if (!str || typeof str !== 'string') return '';
        if (isHttpUrl(str)) return str;
        if (isDataUrl(str)) return str;
        if (looksLikeRawBase64(str)) {
            var cleaned = str.replace(/\s/g, '');
            return 'data:image/jpeg;base64,' + cleaned;
        }
        return str;
    }

    function parseDataUrl(dataUrl) {
        var match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl || '');
        if (!match) return null;
        return { mime: match[1], base64: match[2] };
    }

    function base64ToBlob(base64, mime) {
        mime = mime || 'image/jpeg';
        var binary = atob(base64);
        var len = binary.length;
        var bytes = new Uint8Array(len);
        for (var i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
        return new Blob([bytes], { type: mime });
    }

    function dataUrlToBlob(dataUrl) {
        var parsed = parseDataUrl(dataUrl);
        if (!parsed) return null;
        try {
            return base64ToBlob(parsed.base64, parsed.mime);
        } catch (e) {
            return null;
        }
    }

    /** Load Firebase Storage compat SDK if not already present. */
    global.emsEnsurePhotoStorageReady = function () {
        if (getStorage()) return Promise.resolve(true);
        if (typeof global.emsLoadFirebaseStorage === 'function') {
            return global.emsLoadFirebaseStorage().then(function () {
                return !!getStorage();
            }).catch(function () { return false; });
        }
        return Promise.resolve(false);
    };

    global.emsIsPhotoStorageReady = function () {
        return !!getStorage();
    };

    /** Display URL — photoUrl preferred, legacy photoBase64 fallback. */
    global.emsGetUserPhotoSrc = function (user) {
        if (!user) return '';
        if (user.photoUrl && isHttpUrl(user.photoUrl)) return user.photoUrl;
        if (user.photoBase64) return user.photoBase64;
        return '';
    };

    /** Strip inline bytes from localStorage mirror; keep photoUrl + hasPhoto flag. */
    global.emsLeanUserForLocalStorage = function (user) {
        if (!user || typeof user !== 'object') return user;
        var lean = Object.assign({}, user);
        if (lean.photoBase64) {
            lean.hasPhoto = true;
            delete lean.photoBase64;
        } else if (lean.photoUrl) {
            lean.hasPhoto = true;
        }
        return lean;
    };

    global.emsLeanUsersForLocalStorage = function (users) {
        return (users || []).map(global.emsLeanUserForLocalStorage);
    };

    global.emsRegistrationPhotoPath = function (tenantId, userType, userId) {
        var safeType = (userType || 'student').replace(/[^\w-]+/g, '_');
        var safeId = String(userId || 'unknown').replace(/[^\w.-]+/g, '_');
        return 'registrations/' + tenantId + '/' + safeType + '/' + safeId + '.jpg';
    };

    /**
     * Upload registration photo to Firebase Storage.
     * @returns {Promise<{photoUrl?:string, keepBase64?:string, storagePath?:string, omitBase64?:boolean}>}
     */
    global.emsUploadRegistrationPhoto = function (base64OrUrl, userId, userType) {
        if (!base64OrUrl) return Promise.resolve({});

        var normalized = normalizePhotoInput(base64OrUrl);
        if (isHttpUrl(normalized)) {
            return Promise.resolve({ photoUrl: normalized, omitBase64: true });
        }

        return global.emsEnsurePhotoStorageReady().then(function (ready) {
            var storage = ready ? getStorage() : null;
            var tenant = getTenantId();
            if (!storage || !tenant || !userId || !isDataUrl(normalized)) {
                return { keepBase64: base64OrUrl };
            }

            var path = global.emsRegistrationPhotoPath(tenant, userType, userId);
            var ref = storage.ref(path);
            var blob = dataUrlToBlob(normalized);
            if (!blob) {
                return fetch(normalized)
                    .then(function (r) { return r.blob(); })
                    .then(function (fetched) {
                        return ref.put(fetched, {
                            contentType: fetched.type || 'image/jpeg',
                            customMetadata: { userId: String(userId), userType: String(userType || 'student') }
                        });
                    })
                    .then(function () { return ref.getDownloadURL(); })
                    .then(function (url) {
                        return { photoUrl: url, omitBase64: true, storagePath: path };
                    })
                    .catch(function (err) {
                        console.warn('[EMS] Photo upload failed — keeping base64 fallback', err);
                        return { keepBase64: base64OrUrl };
                    });
            }

            return ref.put(blob, {
                contentType: blob.type || 'image/jpeg',
                customMetadata: { userId: String(userId), userType: String(userType || 'student') }
            })
                .then(function () { return ref.getDownloadURL(); })
                .then(function (url) {
                    return { photoUrl: url, omitBase64: true, storagePath: path };
                })
                .catch(function (err) {
                    console.warn('[EMS] Photo upload failed — keeping base64 fallback', err);
                    return { keepBase64: base64OrUrl };
                });
        });
    };

    /** Fetch full photo from Firestore when lean local mirror has hasPhoto only. */
    global.emsFetchRegistrationPhoto = function (userId, fromRejected) {
        var firestore = getDb();
        var tenant = getTenantId();
        if (!firestore || !tenant || !userId) return Promise.resolve('');

        var col = fromRejected ? 'Rejected' : 'Registrations';
        return firestore.collection('All_Madrasas').doc(tenant).collection(col).doc(userId).get()
            .then(function (doc) {
                if (!doc.exists) return '';
                return global.emsGetUserPhotoSrc(doc.data());
            })
            .catch(function () { return ''; });
    };

    global.emsApplyPhotoFieldsToUser = function (user, photoResult) {
        if (!user || !photoResult) return user;
        if (photoResult.photoUrl) {
            user.photoUrl = photoResult.photoUrl;
            delete user.photoBase64;
            user.hasPhoto = true;
        } else if (photoResult.keepBase64) {
            user.photoBase64 = photoResult.keepBase64;
            user.hasPhoto = true;
        }
        if (photoResult.storagePath) user.photoStoragePath = photoResult.storagePath;
        return user;
    };

    global.emsPrepareFirestoreUserDoc = function (user) {
        if (!user || typeof user !== 'object') return user;
        var doc = Object.assign({}, user);
        delete doc.photoBase64;
        if (doc.photoUrl && isHttpUrl(doc.photoUrl)) {
            doc.hasPhoto = true;
        } else {
            doc.hasPhoto = !!doc.photoUrl;
        }
        return doc;
    };

    /**
     * Remove inline photoBase64 from local caches (post-migration cleanup).
     * @returns {Promise<{users:number, rejected:number}>}
     */
    global.emsPurgeLocalPhotoBase64 = function () {
        var usersKey = (global.DB && global.DB.users) ? global.DB.users : 'ems_full_users';
        var rejectedKey = 'ems_rejected_users';
        var purgedUsers = 0;
        var purgedRejected = 0;

        function purgeKey(key) {
            var list = typeof global.emsCacheGet === 'function'
                ? global.emsCacheGet(key, [])
                : [];
            if (!Array.isArray(list) || !list.length) {
                return typeof global.emsIdbGet === 'function'
                    ? global.emsIdbGet(key).then(function (idbList) {
                        if (!Array.isArray(idbList) || !idbList.length) return 0;
                        var lean = global.emsLeanUsersForLocalStorage(idbList);
                        var count = idbList.filter(function (u) { return u && u.photoBase64; }).length;
                        if (count && typeof global.emsCacheSet === 'function') {
                            global.emsCacheSet(key, lean, { idbOnly: true });
                        } else if (count && typeof global.emsIdbSet === 'function') {
                            global.emsIdbSet(key, lean);
                        }
                        return count;
                    })
                    : Promise.resolve(0);
            }
            var count = list.filter(function (u) { return u && u.photoBase64; }).length;
            if (!count) return Promise.resolve(0);
            var lean = global.emsLeanUsersForLocalStorage(list);
            if (typeof global.emsCacheSet === 'function') {
                global.emsCacheSet(key, lean);
            } else if (global._emsOriginalSetItem) {
                global._emsSuppressSync = true;
                global._emsOriginalSetItem.call(localStorage, key, JSON.stringify(lean));
                global._emsSuppressSync = false;
            }
            return Promise.resolve(count);
        }

        return purgeKey(usersKey).then(function (n) {
            purgedUsers = n;
            return purgeKey(rejectedKey);
        }).then(function (n) {
            purgedRejected = n;
            if (typeof global.emsCacheInvalidate === 'function') global.emsCacheInvalidate();
            if (typeof global.emsRegRepoRefreshFirstPage === 'function') {
                return global.emsRegRepoRefreshFirstPage().then(function () {
                    return { users: purgedUsers, rejected: purgedRejected };
                }).catch(function () {
                    return { users: purgedUsers, rejected: purgedRejected };
                });
            }
            return { users: purgedUsers, rejected: purgedRejected };
        });
    };
})(typeof window !== 'undefined' ? window : globalThis);
