// ============================================================================
// EMS Access Keys — Teacher & Parent identity verification (Phase 1)
// Keys stored as SHA-256 hash in Firestore; plain key shown once to admin.
// ============================================================================
(function (global) {
    'use strict';

    var CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    /** Default key validity: 365 days */
    var DEFAULT_KEY_TTL_MS = 365 * 86400000;

    /** Admin-selectable TTL options (Phase 4) */
    global.ACCESS_KEY_TTL_OPTIONS = [
        { days: 7, label: '7 دن' },
        { days: 30, label: '30 دن' },
        { days: 90, label: '90 دن' },
        { days: 365, label: '365 دن' }
    ];

    global.emsAccessKeyTtlMs = function (days) {
        var d = parseInt(days, 10);
        if (!d || d < 1) d = 365;
        return d * 86400000;
    };

    global.emsFormatKeyTtlLabel = function (ttlMs) {
        var days = Math.round((ttlMs || DEFAULT_KEY_TTL_MS) / 86400000);
        return days + ' دن';
    };

    /** Phase 5: tenant default TTL — All_Madrasas/{id}/TenantSettings/accessKeys */
    global.emsLoadTenantAccessKeySettings = function (madrasaId) {
        var db = getDb();
        if (!db || !madrasaId) {
            return Promise.resolve({ defaultTtlDays: 365 });
        }
        return db.collection('All_Madrasas').doc(madrasaId)
            .collection('TenantSettings').doc('accessKeys').get()
            .then(function (doc) {
                if (!doc.exists) return { defaultTtlDays: 365 };
                var d = doc.data() || {};
                var days = parseInt(d.defaultTtlDays, 10);
                return { defaultTtlDays: days > 0 ? days : 365, updatedAt: d.updatedAt, updatedBy: d.updatedBy };
            })
            .catch(function () { return { defaultTtlDays: 365 }; });
    };

    global.emsSaveTenantAccessKeySettings = function (madrasaId, settings) {
        var db = getDb();
        if (!db || !madrasaId) return Promise.reject(new Error('tenantId درکار ہے'));
        var days = parseInt(settings && settings.defaultTtlDays, 10) || 365;
        return db.collection('All_Madrasas').doc(madrasaId)
            .collection('TenantSettings').doc('accessKeys')
            .set({
                defaultTtlDays: days,
                updatedAt: Date.now(),
                updatedBy: (firebase.auth().currentUser && firebase.auth().currentUser.email) || 'admin'
            }, { merge: true })
            .then(function () {
                global.EMS_TENANT_KEY_TTL_DAYS = days;
                return { defaultTtlDays: days };
            });
    };

    global.emsGetDefaultAccessKeyTtlDays = function (madrasaId) {
        if (global.EMS_TENANT_KEY_TTL_DAYS) {
            return Promise.resolve(global.EMS_TENANT_KEY_TTL_DAYS);
        }
        return global.emsLoadTenantAccessKeySettings(madrasaId).then(function (s) {
            global.EMS_TENANT_KEY_TTL_DAYS = s.defaultTtlDays || 365;
            return global.EMS_TENANT_KEY_TTL_DAYS;
        });
    };

    function getDb() {
        return typeof global.getDbOrNull === 'function' ? global.getDbOrNull() : null;
    }

    function normalizeEmail(email) {
        return (email || '').toLowerCase().trim();
    }

    /** Generate human-readable access key (8 chars) */
    global.emsGenerateAccessKey = function () {
        var out = '';
        var arr = new Uint8Array(8);
        if (global.crypto && global.crypto.getRandomValues) {
            global.crypto.getRandomValues(arr);
            for (var i = 0; i < 8; i++) {
                out += CHARSET[arr[i] % CHARSET.length];
            }
            return out;
        }
        for (var j = 0; j < 8; j++) {
            out += CHARSET[Math.floor(Math.random() * CHARSET.length)];
        }
        return out;
    };

    /** SHA-256 hex hash of normalized key */
    global.emsHashAccessKey = function (plainKey) {
        var key = String(plainKey || '').trim().toUpperCase();
        if (!key) return Promise.reject(new Error('Key خالی ہے'));
        if (!global.crypto || !global.crypto.subtle) {
            var fallback = (global.EmsUtils && global.EmsUtils.simpleHash)
                ? global.EmsUtils.simpleHash('ems-ak-' + key)
                : key;
            return Promise.resolve(fallback);
        }
        var enc = new TextEncoder();
        return global.crypto.subtle.digest('SHA-256', enc.encode('ems-ak-v1:' + key))
            .then(function (buf) {
                return Array.from(new Uint8Array(buf)).map(function (b) {
                    return b.toString(16).padStart(2, '0');
                }).join('');
            });
    };

    global.emsVerifyAccessKey = function (plainKey, storedHash) {
        if (!storedHash) return Promise.resolve(false);
        return global.emsHashAccessKey(plainKey).then(function (h) {
            return h === storedHash;
        });
    };

    global.emsIsAccessKeyExpired = function (keyData) {
        if (!keyData || !keyData.accessKeyExpiresAt) return false;
        return Date.now() > keyData.accessKeyExpiresAt;
    };

    /** Teacher key — StaffPermissions/{staffId} */
    global.emsSaveTeacherAccessKey = function (madrasaId, staffId, plainKey, ttlMs) {
        var db = getDb();
        if (!db || !madrasaId || !staffId || !plainKey) {
            return Promise.reject(new Error('مکمل معلومات درکار ہیں'));
        }
        var expiresAt = Date.now() + (ttlMs || DEFAULT_KEY_TTL_MS);
        return global.emsHashAccessKey(plainKey).then(function (hash) {
            return db.collection('All_Madrasas').doc(madrasaId)
                .collection('StaffPermissions').doc(staffId)
                .set({
                    accessKeyHash: hash,
                    accessKeyIssuedAt: Date.now(),
                    accessKeyExpiresAt: expiresAt,
                    accessKeyIssuedBy: (firebase.auth().currentUser && firebase.auth().currentUser.email) || 'admin'
                }, { merge: true });
        });
    };

    global.emsResetTeacherAccessKey = function (madrasaId, staffId, ttlMs) {
        var key = global.emsGenerateAccessKey();
        return global.emsSaveTeacherAccessKey(madrasaId, staffId, key, ttlMs).then(function () {
            return key;
        });
    };

    global.emsGetTeacherAccessKeyHash = function (madrasaId, staffId) {
        var db = getDb();
        if (!db || !madrasaId || !staffId) return Promise.resolve(null);
        return db.collection('All_Madrasas').doc(madrasaId)
            .collection('StaffPermissions').doc(staffId).get()
            .then(function (doc) {
                if (!doc.exists) return null;
                var d = doc.data();
                if (global.emsIsAccessKeyExpired(d)) return null;
                return d.accessKeyHash || null;
            });
    };

    /** Parent key — ParentAccessKeys/{studentId} (per student) */
    global.emsSaveParentAccessKey = function (madrasaId, studentId, plainKey, ttlMs) {
        var db = getDb();
        if (!db || !madrasaId || !studentId || !plainKey) {
            return Promise.reject(new Error('مکمل معلومات درکار ہیں'));
        }
        var expiresAt = Date.now() + (ttlMs || DEFAULT_KEY_TTL_MS);
        return global.emsHashAccessKey(plainKey).then(function (hash) {
            return db.collection('All_Madrasas').doc(madrasaId)
                .collection('ParentAccessKeys').doc(studentId)
                .set({
                    studentId: studentId,
                    accessKeyHash: hash,
                    accessKeyIssuedAt: Date.now(),
                    accessKeyExpiresAt: expiresAt,
                    accessKeyIssuedBy: (firebase.auth().currentUser && firebase.auth().currentUser.email) || 'admin'
                }, { merge: true });
        });
    };

    global.emsResetParentAccessKey = function (madrasaId, studentId, ttlMs) {
        var key = global.emsGenerateAccessKey();
        return global.emsSaveParentAccessKey(madrasaId, studentId, key, ttlMs).then(function () {
            return key;
        });
    };

    global.emsGetParentAccessKeyHashes = function (madrasaId, studentIds) {
        var db = getDb();
        if (!db || !madrasaId || !studentIds || !studentIds.length) return Promise.resolve([]);
        var promises = studentIds.map(function (sid) {
            return db.collection('All_Madrasas').doc(madrasaId)
                .collection('ParentAccessKeys').doc(sid).get()
                .then(function (doc) {
                    if (!doc.exists) return null;
                    var d = doc.data();
                    if (global.emsIsAccessKeyExpired(d)) return null;
                    return d.accessKeyHash || null;
                });
        });
        return Promise.all(promises).then(function (hashes) {
            return hashes.filter(function (h) { return !!h; });
        });
    };

    global.emsVerifyParentAccessKey = function (madrasaId, studentIds, plainKey) {
        if (typeof global.emsCallFunction === 'function') {
            return global.emsCallFunction('verifyParentAccessKey', {
                tenantId: madrasaId,
                studentIds: studentIds,
                plainKey: plainKey
            }).then(function (res) {
                if (res && typeof res.ok === 'boolean') return res.ok;
                return global.emsGetParentAccessKeyHashes(madrasaId, studentIds).then(function (hashes) {
                    if (!hashes.length) return false;
                    return global.emsHashAccessKey(plainKey).then(function (h) {
                        return hashes.indexOf(h) >= 0;
                    });
                });
            }).catch(function () {
                return global.emsGetParentAccessKeyHashes(madrasaId, studentIds).then(function (hashes) {
                    if (!hashes.length) return false;
                    return global.emsHashAccessKey(plainKey).then(function (h) {
                        return hashes.indexOf(h) >= 0;
                    });
                });
            });
        }
        return global.emsGetParentAccessKeyHashes(madrasaId, studentIds).then(function (hashes) {
            if (!hashes.length) return false;
            return global.emsHashAccessKey(plainKey).then(function (h) {
                return hashes.indexOf(h) >= 0;
            });
        });
    };

    global.emsVerifyTeacherAccessKey = function (madrasaId, staffId, plainKey) {
        if (typeof global.emsCallFunction === 'function') {
            return global.emsCallFunction('verifyTeacherAccessKey', {
                tenantId: madrasaId,
                staffId: staffId,
                plainKey: plainKey
            }).then(function (res) {
                if (res && typeof res.ok === 'boolean') return res.ok;
                return global.emsGetTeacherAccessKeyHash(madrasaId, staffId).then(function (hash) {
                    if (!hash) return false;
                    return global.emsVerifyAccessKey(plainKey, hash);
                });
            }).catch(function () {
                return global.emsGetTeacherAccessKeyHash(madrasaId, staffId).then(function (hash) {
                    if (!hash) return false;
                    return global.emsVerifyAccessKey(plainKey, hash);
                });
            });
        }
        return global.emsGetTeacherAccessKeyHash(madrasaId, staffId).then(function (hash) {
            if (!hash) return false;
            return global.emsVerifyAccessKey(plainKey, hash);
        });
    };

})(window);
