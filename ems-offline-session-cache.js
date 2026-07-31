// ============================================================================
// EMS Offline Session Cache — native instant boot + profile restore
// ----------------------------------------------------------------------------
// Persists tenant ID, role, madrasa profile, and Gmail auth uid after the FIRST
// successful Google login on Desktop (.exe) / Mobile (.apk). Subsequent boots
// restore this snapshot instantly without showing the login screen.
// ============================================================================
(function (global) {
    'use strict';

    var SESSION_KEY = 'ems_offline_session_v1';
    var VERIFIED_OFFLINE_ROLES = { owner: 1, staff: 1, parent: 1, guest: 1 };

    function isVerifiedOfflineRole(role) {
        return !!VERIFIED_OFFLINE_ROLES[role];
    }

    function roleToPortal(role) {
        if (role === 'staff') return 'teacher';
        if (role === 'parent') return 'parent';
        if (role === 'guest') return 'guest';
        return 'admin';
    }

    function readDiskBootSession() {
        if (global.EMS_BOOT_SESSION_FROM_DISK && global.EMS_BOOT_SESSION_FROM_DISK.tenantId) {
            return global.EMS_BOOT_SESSION_FROM_DISK;
        }
        return null;
    }

    function persistBootSessionToDisk(snap) {
        try {
            if (global.emsDesktop && typeof global.emsDesktop.saveBootSession === 'function') {
                global.emsDesktop.saveBootSession(snap).catch(function () { /* ignore */ });
            }
        } catch (eDisk) { /* ignore */ }
    }

    function currentAuthUid(userOverride) {
        if (userOverride && userOverride.uid) return userOverride.uid;
        if (global.EMS_OFFLINE_ONLY === true || global.EMS_LOCAL_AUTH === true) {
            if (typeof global.emsGetOfflineLocalUser === 'function') {
                return global.emsGetOfflineLocalUser().uid;
            }
            return 'local_admin';
        }
        try {
            var u = firebase.auth().currentUser;
            return u ? u.uid : null;
        } catch (e) {
            return null;
        }
    }

    function currentAuthEmail(userOverride) {
        if (userOverride && userOverride.email) return userOverride.email;
        try {
            var u = firebase.auth().currentUser;
            return u && u.email ? u.email : '';
        } catch (e) {
            return '';
        }
    }

    global.emsPersistOfflineSession = function (userOverride) {
        var tenantId = global.CURRENT_MADRASA_TENANT_ID || global.EMS_ACTIVE_TENANT_ID;
        if (!tenantId) return false;
        var tenantRole = global.CURRENT_USER_TENANT_ROLE;
        if (!isVerifiedOfflineRole(tenantRole)) return false;
        var madrasaData = global.CURRENT_MADRASA_DATA;
        if (!madrasaData) {
            madrasaData = { madrasaName: 'آف لائن', subStatus: 'free' };
        }
        var authUid = currentAuthUid(userOverride);
        if (!authUid) return false;

        var snap = {
            tenantId: tenantId,
            role: tenantRole,
            madrasaData: madrasaData,
            staffLink: global.CURRENT_STAFF_LINK || null,
            parentLink: global.CURRENT_PARENT_LINK || null,
            authUid: authUid,
            userEmail: currentAuthEmail(userOverride) || (madrasaData.ownerEmail || ''),
            displayName: (userOverride && userOverride.displayName)
                || (function () {
                    try {
                        var u = firebase.auth().currentUser;
                        return u && u.displayName ? u.displayName : '';
                    } catch (e) { return ''; }
                })(),
            intendedPortal: typeof global.emsGetIntendedPortal === 'function'
                ? (global.emsGetIntendedPortal() || roleToPortal(global.CURRENT_USER_TENANT_ROLE || 'owner'))
                : roleToPortal(global.CURRENT_USER_TENANT_ROLE || 'owner'),
            gateVerified: true,
            verifiedAt: Date.now(),
            savedAt: Date.now(),
            nativeInstantBoot: !!(typeof global.emsIsNativeApp === 'function' && global.emsIsNativeApp())
        };
        try {
            global.localStorage.setItem(SESSION_KEY, JSON.stringify(snap));
            if (snap.tenantId) {
                try {
                    global.localStorage.setItem('ems_persisted_tenant_id_v1', snap.tenantId);
                } catch (eTenant) { /* ignore */ }
            }
            persistBootSessionToDisk(snap);
            if (snap.nativeInstantBoot && typeof global.emsFinalizeNativeInstantBootMode === 'function') {
                global.emsFinalizeNativeInstantBootMode();
            }
            return true;
        } catch (e) {
            return false;
        }
    };

    global.emsReadOfflineSession = function () {
        try {
            var raw = global.localStorage.getItem(SESSION_KEY);
            if (raw) return JSON.parse(raw);
        } catch (e) { /* fall through */ }
        return readDiskBootSession();
    };

    global.emsClearOfflineSession = function () {
        try {
            global.localStorage.removeItem(SESSION_KEY);
        } catch (e) { /* ignore */ }
    };

    global.emsHasOfflineSession = function (user) {
        var snap = global.emsReadOfflineSession();
        if (!snap || !snap.tenantId || !snap.madrasaData) return false;
        if (!snap.authUid) return false;
        if (user && snap.authUid && user.uid !== snap.authUid) return false;
        if (snap.madrasaData.subStatus === 'suspended') return false;
        return true;
    };

    global.emsHasDesktopOfflineBootCache = function () {
        if (global.emsHasOfflineSession(null)) return true;
        try {
            return !!(global.emsReadPersistedBootTenantId && global.emsReadPersistedBootTenantId());
        } catch (e) {
            return false;
        }
    };

    global.emsOfflineSessionStubUser = function () {
        var snap = global.emsReadOfflineSession();
        if (!snap || !snap.authUid) return null;
        return {
            uid: snap.authUid,
            email: snap.userEmail || (snap.madrasaData && snap.madrasaData.ownerEmail) || '',
            displayName: snap.displayName || ''
        };
    };

    global.emsRestoreOfflineSessionGlobals = function (user) {
        var snap = global.emsReadOfflineSession();
        if (!snap || !snap.tenantId || !snap.madrasaData) return null;
        if (snap.gateVerified !== true) return null;
        if (!isVerifiedOfflineRole(snap.role)) return null;
        if (user && snap.authUid && user.uid !== snap.authUid) return null;
        global.CURRENT_MADRASA_TENANT_ID = snap.tenantId;
        global.CURRENT_USER_TENANT_ROLE = snap.role;
        global.CURRENT_MADRASA_DATA = typeof global.normalizeMadrasaAccessData === 'function'
            ? global.normalizeMadrasaAccessData(snap.madrasaData)
            : snap.madrasaData;
        global.CURRENT_STAFF_LINK = snap.staffLink || null;
        global.CURRENT_PARENT_LINK = snap.parentLink || null;
        if (typeof global.emsSetIntendedPortal === 'function') {
            global.emsSetIntendedPortal(snap.intendedPortal || roleToPortal(snap.role));
        }
        if (typeof global.emsActivateTenantStorage === 'function') {
            global.emsActivateTenantStorage(snap.tenantId);
        }
        global.EMS_LOCAL_AUTH = true;
        return snap;
    };
})(typeof window !== 'undefined' ? window : globalThis);
