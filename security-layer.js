// ============================================================================
// EMS Security Layer — Phase 2 (client-side gates + security event logging)
// Server-side authority: Firestore Rules + Cloud Functions
// ============================================================================
(function (global) {
    'use strict';

    var LOGIN_ATTEMPTS_KEY = 'ems_login_attempts';
    var MAX_LOGIN_ATTEMPTS = 5;
    var LOCKOUT_MS = 15 * 60 * 1000;
    var SESSION_KEY = 'ems_session_meta';

    function getDb() {
        return typeof global.getDbOrNull === 'function' ? global.getDbOrNull() : null;
    }

    function readJson(key, fallback) {
        try {
            var raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (e) {
            return fallback;
        }
    }

    function writeJson(key, val) {
        try {
            localStorage.setItem(key, JSON.stringify(val));
        } catch (e) { /* ignore */ }
    }

    // --- Input sanitization (XSS reduction for dynamic HTML) ---
    global.emsSanitize = function (str) {
        if (global.EmsUtils && typeof global.EmsUtils.sanitize === 'function') {
            return global.EmsUtils.sanitize(str);
        }
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };

    function getFunctions() {
        if (typeof firebase === 'undefined' || !firebase.functions) return null;
        try { return firebase.functions(); } catch (e) { return null; }
    }

    function callSecurityFn(name, data) {
        var fns = getFunctions();
        if (!fns) return Promise.reject(new Error('functions unavailable'));
        return fns.httpsCallable(name)(data || {}).then(function (res) { return res.data; });
    }

    /** Generic Cloud Function caller (tenant activation, security, etc.) */
    global.emsCallFunction = function (name, data) {
        return callSecurityFn(name, data);
    };

    global.emsVerifyBackendServices = function () {
        if (typeof global.emsCallFunction !== 'function') {
            return Promise.resolve({ ok: false, reason: 'no_functions' });
        }
        return global.emsCallFunction('pingBackend', {})
            .then(function (r) {
                return { ok: !!(r && r.ok), ping: r };
            })
            .catch(function (e) {
                return { ok: false, error: (e && e.message) || 'cf_unreachable' };
            });
    };

    global.emsSyncStaffClaims = function (tenantId) {
        if (!tenantId || typeof global.emsCallFunction !== 'function') {
            return Promise.resolve({ skipped: true });
        }
        return global.emsCallFunction('syncStaffClaims', { tenantId: tenantId })
            .then(function (r) {
                var user = firebase.auth().currentUser;
                if (user && user.getIdToken) {
                    return user.getIdToken(true).then(function () { return r; });
                }
                return r;
            });
    };

    /** Admin: staff permission save کے بعد linked user کے JWT claims تازہ کریں */
    global.emsSyncStaffClaimsForMember = function (tenantId, targetUid) {
        if (!tenantId || !targetUid || typeof global.emsCallFunction !== 'function') {
            return Promise.resolve({ skipped: true });
        }
        return global.emsCallFunction('syncStaffClaimsForMember', {
            tenantId: tenantId,
            targetUid: targetUid
        });
    };

    function getStaffIdForAccess() {
        if (global.CURRENT_STAFF_LINK && global.CURRENT_STAFF_LINK.staffId) {
            return global.CURRENT_STAFF_LINK.staffId;
        }
        var staff = global.emsGetStaffRecordForCurrentUser();
        return staff ? staff.id : null;
    }

    global.emsGetStaffIdForAccess = getStaffIdForAccess;

    function localCheckLoginAllowed(key) {
        if (!key) return { allowed: true };
        var attempts = readJson(LOGIN_ATTEMPTS_KEY, {});
        var entry = attempts[key];
        if (!entry || !entry.lockedUntil) return { allowed: true };
        if (Date.now() < entry.lockedUntil) {
            var mins = Math.ceil((entry.lockedUntil - Date.now()) / 60000);
            return { allowed: false, message: 'بہت زیادہ کوششیں۔ ' + mins + ' منٹ بعد دوبارہ کوشش کریں۔' };
        }
        delete attempts[key];
        writeJson(LOGIN_ATTEMPTS_KEY, attempts);
        return { allowed: true };
    }

    // --- Login brute-force protection (client cache + Cloud Functions authority) ---
    global.emsCheckLoginAllowed = function (email) {
        var key = (email || '').toLowerCase().trim();
        var localResult = localCheckLoginAllowed(key);
        if (!localResult.allowed) return Promise.resolve(localResult);

        return callSecurityFn('checkLoginAllowed', { email: key })
            .then(function (server) {
                if (server && server.allowed === false) {
                    var mins = server.lockedUntil
                        ? Math.ceil((server.lockedUntil - Date.now()) / 60000)
                        : Math.ceil(LOCKOUT_MS / 60000);
                    return { allowed: false, message: 'بہت زیادہ کوششیں۔ ' + mins + ' منٹ بعد دوبارہ کوشش کریں۔' };
                }
                return { allowed: true };
            })
            .catch(function () { return localResult; });
    };

    global.emsRecordLoginFailure = function (email) {
        var key = (email || '').toLowerCase().trim();
        if (!key) return;

        var attempts = readJson(LOGIN_ATTEMPTS_KEY, {});
        var entry = attempts[key] || { count: 0 };
        entry.count = (entry.count || 0) + 1;
        entry.lastAt = Date.now();
        if (entry.count >= MAX_LOGIN_ATTEMPTS) {
            entry.lockedUntil = Date.now() + LOCKOUT_MS;
        }
        attempts[key] = entry;
        writeJson(LOGIN_ATTEMPTS_KEY, attempts);
        global.emsLogSecurityEvent('login_failed', { email: key, count: entry.count });

        callSecurityFn('recordLoginFailure', { email: key }).catch(function () {});
    };

    global.emsClearLoginAttempts = function (email) {
        var key = (email || '').toLowerCase().trim();
        var attempts = readJson(LOGIN_ATTEMPTS_KEY, {});
        if (attempts[key]) {
            delete attempts[key];
            writeJson(LOGIN_ATTEMPTS_KEY, attempts);
        }
        callSecurityFn('clearLoginAttempts', { email: key }).catch(function () {});
    };

    // --- Session metadata ---
    global.emsInitSession = function (user) {
        if (!user) return;
        writeJson(SESSION_KEY, {
            uid: user.uid,
            email: user.email || '',
            startedAt: Date.now(),
            lastActivity: Date.now()
        });
    };

    global.emsTouchSession = function () {
        var s = readJson(SESSION_KEY, null);
        if (s) {
            s.lastActivity = Date.now();
            writeJson(SESSION_KEY, s);
        }
    };

    // --- Tenant / role resolution ---
    global.emsIsTenantOwner = function () {
        var user = firebase.auth().currentUser;
        if (!user) return false;
        if (global.isSuperAdmin && global.isSuperAdmin()) return true;
        if (global.emsIsStaffUser && global.emsIsStaffUser()) return false;
        return !!global.CURRENT_MADRASA_DATA;
    };

    global.emsGetStaffRecordForCurrentUser = function () {
        var user = firebase.auth().currentUser;
        if (!user || !user.email) return null;
        var usersKey = (global.DB && global.DB.users) ? global.DB.users : 'ems_full_users';
        var users = readJson(usersKey, []);
        if (!Array.isArray(users)) return null;
        var email = user.email.toLowerCase();
        for (var i = 0; i < users.length; i++) {
            var u = users[i];
            if (!u) continue;
            if (u.type !== 'teacher' && u.type !== 'staff') continue;
            var uEmail = (u.email || u.gmail || '').toLowerCase();
            if (uEmail && uEmail === email) return u;
        }
        return null;
    };

    global.emsIsStaffUser = function () {
        if (global.isMadrasaAdmin && global.isMadrasaAdmin()) return false;
        if (global.CURRENT_USER_TENANT_ROLE === 'staff') return true;
        return !!global.emsGetStaffRecordForCurrentUser();
    };

    /** استاد کے پاس کم از کم ایک فعال module grant ہے؟ */
    global.emsStaffHasAnyModule = function () {
        if (global.isSuperAdmin && global.isSuperAdmin()) return true;
        if (global.isMadrasaAdmin && global.isMadrasaAdmin()) return true;
        var staffId = getStaffIdForAccess();
        if (!staffId || typeof global.apGetStaffPerm !== 'function') return false;
        var perm = global.apGetStaffPerm(staffId);
        if (!perm || perm.status === 'suspended') return false;
        var mods = perm.modules || {};
        var keys = Object.keys(mods);
        for (var i = 0; i < keys.length; i++) {
            if (mods[keys[i]] === true) return true;
        }
        if (perm.temporary) {
            var today = new Date().toISOString().split('T')[0];
            var tkeys = Object.keys(perm.temporary);
            for (var j = 0; j < tkeys.length; j++) {
                var t = perm.temporary[tkeys[j]];
                if (t && t.expiry && today <= t.expiry) return true;
            }
        }
        return false;
    };

    /** Staff کے لیے اجازت یافتہ modules کی فہرست */
    global.emsGetStaffAllowedModules = function () {
        var staffId = getStaffIdForAccess();
        if (!staffId || typeof global.apGetStaffPerm !== 'function') return [];
        var perm = global.apGetStaffPerm(staffId);
        if (!perm || perm.status === 'suspended') return [];
        var out = [];
        var catalogue = global.ADMIN_STAFF_MODULES || [];
        catalogue.forEach(function (m) {
            if (global.checkStaffModuleAccess(m.id, 'view')) out.push(m.id);
        });
        if (out.indexOf('dashboard') < 0 && global.checkStaffModuleAccess('dashboard', 'view')) {
            out.unshift('dashboard');
        }
        return out;
    };

    // --- Staff module/action authorization (Admin Panel permissions) ---
    global.checkStaffModuleAccess = function (modId, action) {
        action = action || 'view';
        if (global.isSuperAdmin && global.isSuperAdmin()) return true;
        if (global.isMadrasaAdmin && global.isMadrasaAdmin()) return true;

        var staffId = getStaffIdForAccess();
        if (!staffId) {
            var staff = global.emsGetStaffRecordForCurrentUser();
            staffId = staff ? staff.id : null;
        }
        if (!staffId) {
            return global.CURRENT_USER_TENANT_ROLE !== 'staff' && !!global.CURRENT_MADRASA_DATA;
        }

        if (typeof global.apGetStaffPerm !== 'function') return false;
        var perm = global.apGetStaffPerm(staffId);
        if (!perm || perm.status === 'suspended') return false;

        if (perm.modules && perm.modules[modId] === true) {
            if (!action || action === 'view') return true;
            if (perm.actions && perm.actions[modId] && perm.actions[modId][action]) return true;
        }

        var tempKey = modId + '.' + action;
        if (perm.temporary && perm.temporary[tempKey]) {
            var t = perm.temporary[tempKey];
            if (t.expiryAt && typeof t.expiryAt === 'number') {
                if (t.expiryAt > Date.now()) return true;
            } else if (t.expiry && new Date(t.expiry).getTime() > Date.now()) {
                return true;
            }
        }

        if (action === 'view' && perm.actions && perm.actions[modId] && perm.actions[modId].view) {
            return true;
        }
        return false;
    };

    // --- Parent view authorization ---
    global.checkParentViewAccess = function (studentId, viewId) {
        if (global.isSuperAdmin && global.isSuperAdmin()) return true;
        if (global.isMadrasaAdmin && global.isMadrasaAdmin()) return true;

        if (global.CURRENT_USER_TENANT_ROLE === 'parent') {
            var linked = typeof global.emsGetLinkedStudentIds === 'function'
                ? global.emsGetLinkedStudentIds()
                : [];
            if (linked.indexOf(studentId) < 0) return false;
        }

        if (typeof global.parentCanView === 'function') {
            return global.parentCanView(studentId, viewId);
        }
        return false;
    };

    /** والدین کے پاس کم از کم ایک linked student پر view grant ہے؟ */
    global.emsParentHasAnyView = function () {
        var studentIds = typeof global.emsGetLinkedStudentIds === 'function'
            ? global.emsGetLinkedStudentIds()
            : [];
        if (!studentIds.length) return false;

        var viewIds = [];
        if (global.PARENT_VIEWS && global.PARENT_VIEWS.length) {
            global.PARENT_VIEWS.forEach(function (v) { viewIds.push(v.id); });
        } else {
            viewIds = ['attendance', 'results', 'progress', 'fee', 'complaints', 'training', 'leave', 'announcements', 'teacher_notes'];
        }

        for (var i = 0; i < studentIds.length; i++) {
            for (var j = 0; j < viewIds.length; j++) {
                if (typeof global.parentCanView === 'function' && global.parentCanView(studentIds[i], viewIds[j])) {
                    return true;
                }
            }
        }
        return false;
    };

    // --- Security event logging (tenant SecurityLog + platform fallback) ---
    global.emsLogSecurityEvent = function (action, details) {
        details = details || {};
        var db = getDb();
        var user = firebase.auth().currentUser;
        if (!db || !user) return Promise.resolve();

        var payload = {
            action: action,
            uid: user.uid,
            email: user.email || '',
            details: details,
            userAgent: navigator.userAgent ? navigator.userAgent.substring(0, 200) : '',
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            clientTs: Date.now()
        };

        var tenantId = (global.emsGetTenantId && global.emsGetTenantId()) || user.uid;

        var ref = db.collection('All_Madrasas').doc(tenantId).collection('SecurityLog');
        return ref.add(payload).catch(function (err) {
            console.warn('SecurityLog write failed:', err && err.message);
        });
    };

    // --- Combined module access (license + staff) ---
    global.emsCheckFullModuleAccess = function (modId) {
        if (modId === 'superadmin') return global.isSuperAdmin && global.isSuperAdmin();
        if (modId === 'admin-panel') return global.isMadrasaAdmin && global.isMadrasaAdmin();
        if (modId === 'parent-portal' || modId === 'guest-demo') return false;

        if (global.CURRENT_USER_TENANT_ROLE === 'staff' || (global.emsIsStaffUser && global.emsIsStaffUser())) {
            if (typeof global.checkModuleAccess === 'function' && !global.checkModuleAccess(modId)) return false;
            return global.checkStaffModuleAccess(modId, 'view');
        }

        if (global.PUBLIC_MODULE_IDS && global.PUBLIC_MODULE_IDS.indexOf(modId) !== -1) return true;
        if (typeof global.checkModuleAccess === 'function' && !global.checkModuleAccess(modId)) return false;
        return true;
    };

    global.emsGuardAction = function (modId, action, callback) {
        if (!global.checkStaffModuleAccess(modId, action)) {
            if (typeof global.showTopAlert === 'function') {
                global.showTopAlert('🚫 اس عمل کی اجازت نہیں: ' + modId + ' / ' + action, true);
            }
            global.emsLogSecurityEvent('action_denied', { module: modId, action: action });
            return false;
        }
        if (typeof callback === 'function') callback();
        return true;
    };

    /** Staff save/delete guard — returns true if allowed */
    global.emsRequireStaffAction = function (modId, action) {
        if (global.isSuperAdmin && global.isSuperAdmin()) return true;
        if (global.isMadrasaAdmin && global.isMadrasaAdmin()) return true;
        if (global.emsIsStaffUser && !global.emsIsStaffUser()) return true;
        if (global.checkStaffModuleAccess(modId, action)) return true;
        if (typeof global.showToast === 'function') {
            global.showToast('اس عمل کی اجازت نہیں (' + modId + ')', 'error');
        } else if (typeof global.showTopAlert === 'function') {
            global.showTopAlert('🚫 اس عمل کی اجازت نہیں', true);
        }
        global.emsLogSecurityEvent('staff_action_denied', { module: modId, action: action || 'edit' });
        return false;
    };

    /** Payroll maker-checker: accountants post pending; owner/super-admin may auto-approve */
    global.emsPayrollRequiresMakerChecker = function () {
        if (global.isSuperAdmin && global.isSuperAdmin()) return false;
        if (global.isMadrasaAdmin && global.isMadrasaAdmin()) return false;
        return true;
    };

    /** Block staff from paying their own salary (segregation of duties) */
    global.emsPayrollSelfPaymentBlocked = function (targetStaffId) {
        if (global.isSuperAdmin && global.isSuperAdmin()) return { blocked: false };
        if (global.isMadrasaAdmin && global.isMadrasaAdmin()) return { blocked: false };
        var actorId = getStaffIdForAccess();
        if (!actorId || !targetStaffId) return { blocked: false };
        if (String(actorId) === String(targetStaffId)) {
            return {
                blocked: true,
                message: 'آپ اپنی تنخواہ خود ادا نہیں کر سکتے۔ براہ کرم مہتمم سے رابطہ کریں۔'
            };
        }
        return { blocked: false };
    };

    /** Block staff from marking their own attendance on teacher/staff registers */
    global.emsAttendanceSelfEditBlocked = function (targetUid) {
        if (global.isSuperAdmin && global.isSuperAdmin()) return { blocked: false };
        if (global.isMadrasaAdmin && global.isMadrasaAdmin()) return { blocked: false };
        var actorId = getStaffIdForAccess();
        if (!actorId || !targetUid) return { blocked: false };
        if (String(actorId) === String(targetUid)) {
            return {
                blocked: true,
                message: 'آپ اپنی حاضری خود درج نہیں کر سکتے۔'
            };
        }
        return { blocked: false };
    };

    var SESSION_IDLE_MS = 8 * 60 * 60 * 1000;
    var sessionIdleTimer = null;

    global.emsClearSensitiveLocalCache = function () {
        var prefixes = [
            'ems_full_', 'ems_staff_', 'ems_parent_', 'ems_fee_', 'ems_tar_',
            'ems_curriculum', 'ems_full_ledger', 'ems_full_exams', 'ems_full_users',
            'ems_rejected_users', 'ems_announcements', 'ems_login_attempts', 'ems_session_meta'
        ];
        var keysToRemove = [];
        for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (!k || k.indexOf('ems_') !== 0) continue;
            for (var p = 0; p < prefixes.length; p++) {
                if (k.indexOf(prefixes[p]) === 0 || k.indexOf('ems_t_') === 0) {
                    keysToRemove.push(k);
                    break;
                }
            }
        }
        keysToRemove.forEach(function (k) {
            try { localStorage.removeItem(k); } catch (e) { /* ignore */ }
        });
        if (typeof global.emsCacheInvalidate === 'function') {
            global.emsCacheInvalidate();
        }
        if (typeof global.emsPurgeLegacyRegistrationCaches === 'function') {
            global.emsPurgeLegacyRegistrationCaches();
        }
        if (typeof global.emsIdbPurgeLegacyKeys === 'function') {
            global.emsIdbPurgeLegacyKeys(['ems_full_users', 'ems_rejected_users', 'ems_reg_repo_archive']);
        }
    };

    global.emsStartSessionIdleWatch = function () {
        if (sessionIdleTimer) clearInterval(sessionIdleTimer);
        sessionIdleTimer = setInterval(function () {
            var meta = readJson(SESSION_KEY, null);
            if (!meta || !meta.lastActivity) return;
            if (Date.now() - meta.lastActivity > SESSION_IDLE_MS) {
                if (typeof global.showTopAlert === 'function') {
                    global.showTopAlert('⏱️ غیر فعالیت — سیشن ختم ہو رہا ہے۔', true);
                }
                if (typeof global.logoutUser === 'function') {
                    global.logoutUser();
                }
            }
        }, 60000);
    };

    document.addEventListener('click', function () {
        global.emsTouchSession();
    }, true);

})(window);
