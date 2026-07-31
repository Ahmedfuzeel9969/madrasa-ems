// ============================================================================
// EMS Identity Gate — Enterprise login: Auth + Identity + Role + Routing
// Phase 2: Staff module grant validation after access key
// ============================================================================
(function (global) {
    'use strict';

    var SESSION_KEY = 'ems_identity_verified';
    var pendingUser = null;
    var pendingCtx = null;

    global.EMS_IDENTITY = {
        portal: null,
        authVerified: false,
        identityVerified: false,
        roleVerified: false,
        accessGranted: false
    };

    function setIdentity(patch) {
        Object.keys(patch).forEach(function (k) {
            global.EMS_IDENTITY[k] = patch[k];
        });
    }

    function sessionStore(uid, data) {
        try {
            sessionStorage.setItem(SESSION_KEY + '_' + uid, JSON.stringify(data));
        } catch (e) { /* ignore */ }
    }

    function sessionLoad(uid) {
        try {
            var raw = sessionStorage.getItem(SESSION_KEY + '_' + uid);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    function sessionClear(uid) {
        try { sessionStorage.removeItem(SESSION_KEY + '_' + uid); } catch (e) { /* ignore */ }
    }

    global.emsIsIdentityVerified = function (user) {
        user = user || (firebase.auth && firebase.auth().currentUser);
        if (!user) return false;
        var s = sessionLoad(user.uid);
        if (!s || !s.verified) return false;
        var portal = global.emsGetIntendedPortal && global.emsGetIntendedPortal();
        return !portal || s.portal === portal;
    };

    global.emsClearIdentitySession = function (uid) {
        if (uid) sessionClear(uid);
        setIdentity({
            portal: null,
            authVerified: false,
            identityVerified: false,
            roleVerified: false,
            accessGranted: false
        });
        global.EMS_GUEST_MODE = false;
        if (typeof global.emsClearDemoSandboxSession === 'function') {
            global.emsClearDemoSandboxSession();
        }
        pendingUser = null;
        pendingCtx = null;
    };

    function hideAllGateways() {
        var landing = document.getElementById('ems-landing');
        var loginPanel = document.getElementById('ems-login-panel');
        var profileGw = document.getElementById('profile-setup-gateway');
        var keyPanel = document.getElementById('ems-access-key-panel');
        var deniedPanel = document.getElementById('ems-access-denied-panel');
        if (loginPanel) loginPanel.style.display = 'none';
        if (keyPanel) keyPanel.style.display = 'none';
        if (deniedPanel) deniedPanel.style.display = 'none';
        if (profileGw) profileGw.style.display = 'none';
        if (landing) landing.style.display = 'none';
    }

    function revealIdentityShell() {
        var landing = document.getElementById('ems-landing');
        var loginPanel = document.getElementById('ems-login-panel');
        if (landing) landing.style.display = 'flex';
        if (loginPanel) loginPanel.style.display = 'flex';
    }

    global.emsShowAccessDenied = function (message, detail) {
        hideAllGateways();
        revealIdentityShell();
        var panel = document.getElementById('ems-access-denied-panel');
        var msgEl = document.getElementById('ems-access-denied-msg');
        var detailEl = document.getElementById('ems-access-denied-detail');
        if (msgEl) msgEl.textContent = message || 'رسائی مسترد — Access Denied';
        if (detailEl) detailEl.textContent = detail || 'آپ کے Gmail اکاؤنٹ کو اس پورٹل کے لیے اجازت نہیں ہے۔';
        if (panel) panel.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        if (typeof global.emsLogSecurityEvent === 'function') {
            global.emsLogSecurityEvent('access_denied', { portal: global.emsGetIntendedPortal() });
        }
    };

    function clearLoginSuccessRecord(user, ctx) {
        if (!user || !ctx || !ctx.tenantId || !user.email) return;
        if (typeof global.emsClearTenantLoginSuccess === 'function') {
            global.emsClearTenantLoginSuccess(ctx.tenantId, user.email).catch(function () { /* ignore */ });
        }
    }

    function denyAccess(message, detail, recordFailure) {
        if (recordFailure && pendingUser && pendingCtx && pendingCtx.tenantId) {
            if (typeof global.emsRecordTenantLoginFailure === 'function') {
                global.emsRecordTenantLoginFailure(pendingCtx.tenantId, pendingUser.email).catch(function () { /* ignore */ });
            }
        }
        global.emsShowAccessDenied(message, detail);
    }

    /** TH-03 — security CF / network failure: fail-closed, never bypass gates */
    function haltOnSecurityCheckFailure(user) {
        if (user && typeof global.emsClearIdentitySession === 'function') {
            global.emsClearIdentitySession(user.uid);
        }
        pendingUser = null;
        pendingCtx = null;
        if (typeof global.showTopAlert === 'function') {
            global.showTopAlert('سیکیورٹی چیک ناکام ہو گیا۔ براہ کرم دوبارہ لاگ ان کریں۔', true);
        }
        hideAllGateways();
        revealIdentityShell();
        var loginPanel = document.getElementById('ems-login-panel');
        if (loginPanel) loginPanel.style.display = 'flex';
        if (typeof global.emsShowLanding === 'function') {
            global.emsShowLanding();
        }
        if (typeof firebase !== 'undefined' && firebase.auth) {
            firebase.auth().signOut().catch(function () { /* ignore */ });
        }
    }

    function withBruteForceCheck(user, ctx, next) {
        var tenantId = ctx && ctx.tenantId;
        var email = user && user.email;
        if (!tenantId || !email || typeof global.emsCheckTenantLoginAllowed !== 'function') {
            next();
            return;
        }
        global.emsCheckTenantLoginAllowed(tenantId, email).then(function (r) {
            if (r && r.allowed === false) {
                var mins = r.lockedUntil ? Math.max(1, Math.ceil((r.lockedUntil - Date.now()) / 60000)) : 0;
                denyAccess(
                    'لاگ ان عارضی بند',
                    mins ? ('بہت زیادہ ناکام کوششیں۔ ' + mins + ' منٹ بعد دوبارہ کوشش کریں۔') : 'بہت زیادہ ناکام کوششیں۔',
                    false
                );
                return;
            }
            next();
        }).catch(function () { next(); });
    }

    function showAccessKeyPrompt(title, subtitle, portalType) {
        hideAllGateways();
        revealIdentityShell();
        var panel = document.getElementById('ems-access-key-panel');
        var titleEl = document.getElementById('ems-access-key-title');
        var subEl = document.getElementById('ems-access-key-subtitle');
        var input = document.getElementById('ems-access-key-input');
        if (titleEl) titleEl.textContent = title || 'Access Key درج کریں';
        if (subEl) subEl.textContent = subtitle || 'یہ Key مدرسہ انتظامیہ نے فراہم کی ہے۔';
        if (input) { input.value = ''; input.focus(); }
        if (panel) {
            panel.setAttribute('data-portal-type', portalType || '');
            panel.style.display = 'flex';
        }
        document.body.style.overflow = 'hidden';
    }

    global.emsShowAdminProfileSetup = function () {
        hideAllGateways();
        var gw = document.getElementById('profile-setup-gateway');
        if (gw) gw.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    };

    function markVerified(user, portal) {
        sessionStore(user.uid, { verified: true, portal: portal, at: Date.now() });
        setIdentity({
            portal: portal,
            authVerified: true,
            identityVerified: true,
            roleVerified: true,
            accessGranted: true
        });
    }

    function completeGuest(user) {
        if (typeof global.emsApplyDemoSandboxContext === 'function') {
            global.emsApplyDemoSandboxContext(user);
        } else {
            global.EMS_GUEST_MODE = true;
            global.CURRENT_MADRASA_TENANT_ID = 'demo';
            global.CURRENT_USER_TENANT_ROLE = 'guest';
            global.CURRENT_MADRASA_DATA = {
                madrasaName: 'ڈیمو ماحول (مہمان)',
                subStatus: 'free',
                allowedModules: global.LICENSED_MODULE_IDS || []
            };
        }
        markVerified(user, 'guest');
        hideAllGateways();
        if (typeof global.emsAuthMarkPortalRouted === 'function') {
            global.emsAuthMarkPortalRouted();
        }

        var demoId = global.CURRENT_MADRASA_TENANT_ID;
        var boot = typeof global.emsEnsureDemoMadrasaProfile === 'function'
            ? global.emsEnsureDemoMadrasaProfile(user)
            : Promise.resolve(true);

        boot.then(function () {
            if (typeof global.emsAuthContinueAsAdmin === 'function') {
                global.emsAuthContinueAsAdmin(user, {
                    tenantId: demoId,
                    role: 'owner',
                    isDemo: true
                });
            } else {
                if (typeof global.emsHideLanding === 'function') global.emsHideLanding();
                document.body.classList.add('ems-portal-admin');
                document.body.classList.remove('ems-portal-parent', 'ems-portal-teacher', 'ems-portal-guest');
                if (typeof global.emsApplyPortalShell === 'function') global.emsApplyPortalShell();
                if (typeof global.emsRouteAfterLogin === 'function') global.emsRouteAfterLogin();
            }
            if (typeof global.emsShowDemoSandboxBanner === 'function') {
                global.emsShowDemoSandboxBanner();
            }
        });

        if (typeof global.emsLogSecurityEvent === 'function') {
            global.emsLogSecurityEvent('guest_login', { uid: user.uid, demoId: demoId, sandbox: true });
        }
    }

    function completeAdmin(user, ctx) {
        clearLoginSuccessRecord(user, ctx);
        markVerified(user, 'admin');
        hideAllGateways();
        if (typeof global.emsAuthContinueAsAdmin === 'function') {
            global.emsAuthContinueAsAdmin(user, ctx);
        }
    }

    function completeTeacher(user, ctx) {
        clearLoginSuccessRecord(user, ctx);
        markVerified(user, 'teacher');
        hideAllGateways();
        if (typeof global.emsAuthContinueAsTeacher === 'function') {
            global.emsAuthContinueAsTeacher(user, ctx);
        }
    }

    function completeParent(user, ctx) {
        clearLoginSuccessRecord(user, ctx);
        markVerified(user, 'parent');
        hideAllGateways();
        if (typeof global.emsAuthContinueAsParent === 'function') {
            global.emsAuthContinueAsParent(user, ctx);
        }
    }

    function handleGuest(user) {
        if (global.emsIsIdentityVerified(user)) {
            completeGuest(user);
            return;
        }
        setIdentity({ portal: 'guest', authVerified: true });
        completeGuest(user);
    }

    function handleAdmin(user, ctx) {
        setIdentity({ portal: 'admin', authVerified: true });

        if (global.emsIsIdentityVerified(user)) {
            proceedAdminWithDomainGate(user, ctx);
            return;
        }

        if (global.isSuperAdminUser && global.isSuperAdminUser(user)) {
            completeAdmin(user, ctx || { tenantId: user.uid, role: 'owner', isSuperAdmin: true });
            return;
        }

        if (ctx && (ctx.role === 'staff' || ctx.role === 'parent')) {
            global.emsShowAccessDenied(
                'رسائی مسترد — Access Denied',
                'یہ Gmail اکاؤنٹ انتظامیہ کے لیے رجسٹرڈ نہیں۔ اساتذہ یا والدین پورٹل استعمال کریں۔'
            );
            return;
        }

        if (!ctx || !ctx.profileDoc) {
            var firestore = global.getDbOrNull && global.getDbOrNull();
            if (firestore) {
                firestore.collection('All_Madrasas').doc(user.uid).get().then(function (doc) {
                    if (doc.exists && doc.data().madrasaName) {
                        proceedAdminWithDomainGate(user, { tenantId: user.uid, role: 'owner', profileDoc: doc });
                    } else {
                        global.emsShowAdminProfileSetup();
                    }
                }).catch(function () {
                    global.emsShowAdminProfileSetup();
                });
            } else {
                global.emsShowAdminProfileSetup();
            }
            return;
        }

        if (ctx.role === 'owner') {
            proceedAdminWithDomainGate(user, ctx);
            return;
        }

        global.emsShowAccessDenied(
            'رسائی مسترد — Access Denied',
            'انتظامیہ پورٹل صرف رجسٹرڈ مدرسہ ایڈمن کے لیے ہے۔'
        );
    }

    function policyRequiresAccessKey() {
        var policy = null;
        if (typeof global.emsGetTenantSecurityPolicy === 'function') {
            policy = global.emsGetTenantSecurityPolicy();
        } else if (global.EMS_TENANT_SECURITY_POLICY) {
            policy = global.EMS_TENANT_SECURITY_POLICY;
        } else if (global.EMS_DEFAULT_SECURITY_POLICY) {
            policy = global.EMS_DEFAULT_SECURITY_POLICY;
        }
        return !policy || policy.requireAccessKey !== false;
    }

    function runPortalDomainGate(tenantId, portal, user, onOk) {
        if (typeof global.emsValidateEmailDomainForPortal !== 'function') {
            onOk();
            return;
        }
        global.emsValidateEmailDomainForPortal(tenantId, portal, user.email).then(function (r) {
            if (!r || !r.allowed) {
                denyAccess(
                    'Email domain مسترد',
                    (r && r.error) || 'یہ email domain اس مدرسے کے لیے مجاز نہیں۔',
                    true
                );
                return;
            }
            onOk();
        }).catch(function () {
            onOk();
        });
    }

    function runPortalCountryGate(tenantId, portal, user, onOk) {
        if (typeof global.emsValidateLoginCountryForPortal !== 'function') {
            onOk();
            return;
        }
        if (global.isSuperAdminUser && global.isSuperAdminUser(user)) {
            onOk();
            return;
        }
        global.emsValidateLoginCountryForPortal(tenantId, portal).then(function (r) {
            if (!r || !r.allowed) {
                denyAccess(
                    'Country مسترد',
                    (r && r.error) || 'یہ ملک لاگ ان کے لیے مجاز نہیں۔',
                    true
                );
                return;
            }
            onOk();
        }).catch(function () {
            onOk();
        });
    }

    function runPortalIpGate(tenantId, portal, user, onOk) {
        if (typeof global.emsValidateLoginIpForPortal !== 'function') {
            onOk();
            return;
        }
        if (global.isSuperAdminUser && global.isSuperAdminUser(user)) {
            onOk();
            return;
        }
        global.emsValidateLoginIpForPortal(tenantId, portal).then(function (r) {
            if (!r || !r.allowed) {
                denyAccess(
                    'IP address مسترد',
                    (r && r.error) || 'یہ IP address اس ادارے کے لیے مجاز نہیں۔',
                    true
                );
                return;
            }
            onOk();
        }).catch(function () {
            onOk();
        });
    }

    function runPortalSecurityGates(tenantId, portal, user, onOk) {
        runPortalCountryGate(tenantId, portal, user, function () {
            runPortalIpGate(tenantId, portal, user, function () {
                runPortalDomainGate(tenantId, portal, user, onOk);
            });
        });
    }

    function proceedAdminMfaGate(user, ctx) {
        if (global.isSuperAdminUser && global.isSuperAdminUser(user)) {
            completeAdmin(user, ctx);
            return;
        }
        var tenantId = (ctx && ctx.tenantId) || user.uid;
        if (typeof global.emsCheckMfaComplianceForPortal !== 'function') {
            completeAdmin(user, ctx);
            return;
        }
        global.emsCheckMfaComplianceForPortal(tenantId, 'admin').then(function (state) {
            if (!state || state.compliant) {
                completeAdmin(user, ctx);
                return;
            }
            var server = state.server || {};
            if (server.enrolled && server.sessionMfa === false) {
                global.emsShowAccessDenied(
                    'MFA سیشن درکار',
                    'دوبارہ سائن آؤٹ کریں اور Google لاگ ان کے دوران Authenticator کوڈ درج کریں۔'
                );
                return;
            }
            completeAdmin(user, ctx);
        }).catch(function () {
            haltOnSecurityCheckFailure(user);
        });
    }

    function proceedTeacherMfaGate(user, ctx, tenantId, staffId) {
        pendingUser = user;
        pendingCtx = ctx;
        if (typeof global.emsCheckMfaComplianceForPortal !== 'function') {
            proceedTeacherKeyGate(user, ctx, tenantId, staffId);
            return;
        }
        global.emsCheckMfaComplianceForPortal(tenantId, 'staff').then(function (state) {
            if (!state || state.compliant) {
                proceedTeacherKeyGate(user, ctx, tenantId, staffId);
                return;
            }
            var server = state.server || {};
            if (server.enrolled && server.sessionMfa === false) {
                global.emsShowAccessDenied(
                    'MFA سیشن درکار',
                    'Staff MFA policy فعال ہے — Authenticator کوڈ کے ساتھ دوبارہ لاگ ان کریں۔'
                );
                return;
            }
            proceedTeacherKeyGate(user, ctx, tenantId, staffId);
        }).catch(function () {
            proceedTeacherKeyGate(user, ctx, tenantId, staffId);
        });
    }

    function proceedAdminWithDomainGate(user, ctx) {
        if (global.isSuperAdminUser && global.isSuperAdminUser(user)) {
            completeAdmin(user, ctx);
            return;
        }
        var tenantId = (ctx && ctx.tenantId) || user.uid;
        ctx = ctx || { tenantId: tenantId, role: 'owner' };
        withBruteForceCheck(user, ctx, function () {
            runPortalSecurityGates(tenantId, 'admin', user, function () {
                proceedAdminMfaGate(user, ctx);
            });
        });
    }

    function policyRequiresTrustedDeviceForParent() {
        var policy = null;
        if (typeof global.emsGetTenantSecurityPolicy === 'function') {
            policy = global.emsGetTenantSecurityPolicy();
        } else if (global.EMS_TENANT_SECURITY_POLICY) {
            policy = global.EMS_TENANT_SECURITY_POLICY;
        }
        return !!(policy && policy.requireTrustedDeviceForParents);
    }

    function policyRequiresTrustedDevice() {
        var policy = null;
        if (typeof global.emsGetTenantSecurityPolicy === 'function') {
            policy = global.emsGetTenantSecurityPolicy();
        } else if (global.EMS_TENANT_SECURITY_POLICY) {
            policy = global.EMS_TENANT_SECURITY_POLICY;
        }
        return !!(policy && policy.requireTrustedDeviceForStaff);
    }

    function proceedTeacherTrustedGate(user, ctx, tenantId, staffId) {
        pendingUser = user;
        pendingCtx = ctx;

        function afterDomainOk() {
            if (!policyRequiresTrustedDevice() || typeof global.emsCheckTrustedDevice !== 'function') {
                proceedTeacherMfaGate(user, ctx, tenantId, staffId);
                return;
            }
            global.emsCheckTrustedDevice(tenantId, user, 'teacher').then(function (res) {
                if (res && res.trusted) {
                    proceedTeacherMfaGate(user, ctx, tenantId, staffId);
                    return;
                }
                if (res && res.pending) {
                    global.emsShowAccessDenied(
                        'Device approval زیرِ التواء',
                        'منتظم نے ابھی تک اس device کو approve نہیں کیا۔ براہ کرم انتظار کریں۔'
                    );
                    return;
                }
                if (res && (res.status === 'rejected' || res.status === 'revoked' || res.status === 'expired')) {
                    global.emsShowAccessDenied(
                        'Device مسترد / ختم',
                        'یہ device admin نے reject/revoke کر دی ہے یا approval ختم ہو چکی ہے۔'
                    );
                    return;
                }
                global.emsRequestTrustedDevice(tenantId, user).then(function () {
                    global.emsShowAccessDenied(
                        'نئی Device — admin approval درکار',
                        'آپ کی device approval کے لیے بھیج دی گئی ہے۔ منتظم approve کرے گا۔'
                    );
                });
            }).catch(function () {
                proceedTeacherMfaGate(user, ctx, tenantId, staffId);
            });
        }

        runPortalSecurityGates(tenantId, 'teacher', user, afterDomainOk);
    }

    function proceedTeacherKeyGate(user, ctx, tenantId, staffId) {
        pendingUser = user;
        pendingCtx = ctx;

        if (!policyRequiresAccessKey()) {
            completeTeacher(user, ctx);
            return;
        }

        global.emsGetTeacherAccessKeyHash(tenantId, staffId).then(function (hash) {
            if (!hash) {
                global.emsShowAccessDenied(
                    'Teacher Access Key نہیں ملی',
                    'منتظم نے ابھی تک Access Key جاری نہیں کی۔ براہ کرم انتظامیہ سے رابطہ کریں۔'
                );
                return;
            }
            showAccessKeyPrompt(
                'Teacher Access Key',
                'یہ Key مدرسہ انتظامیہ نے آپ کو فراہم کی ہے۔',
                'teacher'
            );
        });
    }

    function proceedParentTrustedGate(user, ctx, tenantId, studentIds) {
        pendingUser = user;
        pendingCtx = ctx;

        function afterTrustedOk() {
            proceedParentMfaGate(user, ctx, tenantId, studentIds);
        }

        if (!policyRequiresTrustedDeviceForParent() || typeof global.emsCheckTrustedDevice !== 'function') {
            afterTrustedOk();
            return;
        }
        global.emsCheckTrustedDevice(tenantId, user, 'parent').then(function (res) {
            if (res && res.trusted) {
                afterTrustedOk();
                return;
            }
            if (res && res.pending) {
                global.emsShowAccessDenied(
                    'Device approval زیرِ التواء',
                    'منتظم نے ابھی تک اس device کو approve نہیں کیا۔'
                );
                return;
            }
            if (res && (res.status === 'rejected' || res.status === 'revoked' || res.status === 'expired')) {
                global.emsShowAccessDenied(
                    'Device مسترد / ختم',
                    'یہ device admin نے reject/revoke کر دی ہے یا approval ختم ہو چکی ہے۔'
                );
                return;
            }
            global.emsRequestTrustedDevice(tenantId, user).then(function () {
                global.emsShowAccessDenied(
                    'نئی Device — admin approval درکار',
                    'آپ کی device approval کے لیے بھیج دی گئی ہے۔'
                );
            });
        }).catch(function () {
            afterTrustedOk();
        });
    }

    function proceedParentMfaGate(user, ctx, tenantId, studentIds) {
        pendingUser = user;
        pendingCtx = ctx;
        if (typeof global.emsCheckMfaComplianceForPortal !== 'function') {
            proceedParentKeyGate(user, ctx, tenantId, studentIds);
            return;
        }
        global.emsCheckMfaComplianceForPortal(tenantId, 'parent').then(function (state) {
            if (!state || state.compliant) {
                proceedParentKeyGate(user, ctx, tenantId, studentIds);
                return;
            }
            var server = state.server || {};
            if (server.enrolled && server.sessionMfa === false) {
                global.emsShowAccessDenied(
                    'MFA سیشن درکار',
                    'Parent MFA policy فعال ہے — Authenticator کوڈ کے ساتھ دوبارہ لاگ ان کریں۔'
                );
                return;
            }
            proceedParentKeyGate(user, ctx, tenantId, studentIds);
        }).catch(function () {
            proceedParentKeyGate(user, ctx, tenantId, studentIds);
        });
    }

    function proceedParentDomainGate(user, ctx, tenantId, studentIds) {
        pendingUser = user;
        pendingCtx = ctx;
        runPortalSecurityGates(tenantId, 'parent', user, function () {
            proceedParentTrustedGate(user, ctx, tenantId, studentIds);
        });
    }

    function proceedParentKeyGate(user, ctx, tenantId, studentIds) {
        pendingUser = user;
        pendingCtx = ctx;

        if (!policyRequiresAccessKey()) {
            completeParent(user, ctx);
            return;
        }

        global.emsGetParentAccessKeyHashes(tenantId, studentIds).then(function (hashes) {
            if (!hashes.length) {
                global.emsShowAccessDenied(
                    'Parent Access Key نہیں ملی',
                    'منتظم نے ابھی تک Access Key جاری نہیں کی۔'
                );
                return;
            }
            showAccessKeyPrompt(
                'Parent Access Key',
                'یہ Key مدرسہ انتظامیہ نے فراہم کی ہے (ہر طالب علم کی الگ Key)۔',
                'parent'
            );
        });
    }

    function handleTeacher(user, ctx) {
        setIdentity({ portal: 'teacher', authVerified: true });

        if (global.emsIsIdentityVerified(user)) {
            completeTeacher(user, ctx);
            return;
        }

        if (!ctx || ctx.role !== 'staff') {
            global.emsShowAccessDenied(
                'رسائی مسترد — Access Denied',
                'یہ Gmail کسی مدرسہ کے Teacher Profile میں موجود نہیں۔'
            );
            return;
        }

        var link = ctx.link || {};
        var staffId = link.staffId;
        var tenantId = ctx.tenantId;

        if (!staffId || !tenantId) {
            global.emsShowAccessDenied('رسائی مسترد', 'Staff Link نامکمل ہے — منتظم سے رابطہ کریں۔');
            return;
        }

        if (typeof global.emsEnsureTenantSecurityPolicy === 'function') {
            global.emsEnsureTenantSecurityPolicy(tenantId).then(function () {
                withBruteForceCheck(user, ctx, function () {
                    proceedTeacherTrustedGate(user, ctx, tenantId, staffId);
                });
            }).catch(function () {
                withBruteForceCheck(user, ctx, function () {
                    proceedTeacherTrustedGate(user, ctx, tenantId, staffId);
                });
            });
            return;
        }
        withBruteForceCheck(user, ctx, function () {
            proceedTeacherTrustedGate(user, ctx, tenantId, staffId);
        });
    }

    function handleParent(user, ctx) {
        setIdentity({ portal: 'parent', authVerified: true });

        if (global.emsIsIdentityVerified(user)) {
            completeParent(user, ctx);
            return;
        }

        if (!ctx || ctx.role !== 'parent') {
            global.emsShowAccessDenied(
                'رسائی مسترد — Access Denied',
                'یہ Gmail کسی طالب علم کے Parent Profile سے منسلک نہیں۔'
            );
            return;
        }

        var link = ctx.link || {};
        var studentIds = link.studentIds || (link.studentId ? [link.studentId] : []);
        var tenantId = ctx.tenantId;

        if (!studentIds.length || !tenantId) {
            global.emsShowAccessDenied('رسائی مسترد', 'Parent Link نامکمل ہے۔');
            return;
        }

        if (typeof global.emsEnsureTenantSecurityPolicy === 'function') {
            global.emsEnsureTenantSecurityPolicy(tenantId).then(function () {
                withBruteForceCheck(user, ctx, function () {
                    proceedParentDomainGate(user, ctx, tenantId, studentIds);
                });
            }).catch(function () {
                withBruteForceCheck(user, ctx, function () {
                    proceedParentDomainGate(user, ctx, tenantId, studentIds);
                });
            });
            return;
        }
        withBruteForceCheck(user, ctx, function () {
            proceedParentDomainGate(user, ctx, tenantId, studentIds);
        });
    }

    global.emsRunIdentityGate = function (user, ctx) {
        if (!user) return;
        pendingUser = user;
        pendingCtx = ctx;

        var portal = global.emsGetIntendedPortal && global.emsGetIntendedPortal();
        if (!portal) {
            global.emsShowAccessDenied('پورٹل منتخب نہیں', 'براہ کرم landing page سے پورٹل منتخب کریں۔');
            return;
        }

        setIdentity({ portal: portal, authVerified: true });

        switch (portal) {
            case 'guest':
                handleGuest(user);
                break;
            case 'admin':
                handleAdmin(user, ctx);
                break;
            case 'teacher':
                handleTeacher(user, ctx);
                break;
            case 'parent':
                handleParent(user, ctx);
                break;
            default:
                global.emsShowAccessDenied('غلط پورٹل', 'نامعلوم پورٹل: ' + portal);
        }
    };

    global.emsSubmitAccessKey = function () {
        var input = document.getElementById('ems-access-key-input');
        var key = input ? input.value.trim() : '';
        if (!key) {
            if (typeof global.showTopAlert === 'function') {
                global.showTopAlert('Access Key درج کریں۔', true);
            }
            return;
        }

        var panel = document.getElementById('ems-access-key-panel');
        var portalType = panel ? panel.getAttribute('data-portal-type') : '';
        var user = pendingUser || (firebase.auth && firebase.auth().currentUser);
        var ctx = pendingCtx;

        if (!user || !ctx) {
            global.emsShowAccessDenied('سیشن ختم', 'دوبارہ لاگ ان کریں۔');
            return;
        }

        if (portalType === 'teacher') {
            var staffId = (ctx.link || {}).staffId;
            global.emsVerifyTeacherAccessKey(ctx.tenantId, staffId, key).then(function (ok) {
                if (!ok) {
                    if (typeof global.emsRecordTenantLoginFailure === 'function') {
                        global.emsRecordTenantLoginFailure(ctx.tenantId, user.email).catch(function () { /* ignore */ });
                    }
                    if (typeof global.showTopAlert === 'function') {
                        global.showTopAlert('غلط یا ختم شدہ Teacher Access Key — دوبارہ کوشش کریں۔', true);
                    }
                    return;
                }
                completeTeacher(user, ctx);
            });
            return;
        }

        if (portalType === 'parent') {
            var studentIds = (ctx.link || {}).studentIds || [];
            global.emsVerifyParentAccessKey(ctx.tenantId, studentIds, key).then(function (ok) {
                if (!ok) {
                    if (typeof global.emsRecordTenantLoginFailure === 'function') {
                        global.emsRecordTenantLoginFailure(ctx.tenantId, user.email).catch(function () { /* ignore */ });
                    }
                    if (typeof global.showTopAlert === 'function') {
                        global.showTopAlert('غلط یا ختم شدہ Parent Access Key — دوبارہ کوشش کریں۔', true);
                    }
                    return;
                }
                completeParent(user, ctx);
            });
        }
    };

    function bindIdentityUi() {
        var btn = document.getElementById('ems-access-key-submit');
        if (btn) {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                global.emsSubmitAccessKey();
            });
        }
        var input = document.getElementById('ems-access-key-input');
        if (input) {
            input.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') global.emsSubmitAccessKey();
            });
        }
        var deniedBtn = document.getElementById('ems-access-denied-signout');
        if (deniedBtn) {
            deniedBtn.addEventListener('click', function () {
                if (typeof global.logoutUser === 'function') global.logoutUser();
                else firebase.auth().signOut().then(function () { window.location.reload(); });
            });
        }
        var keyBack = document.getElementById('ems-access-key-back');
        if (keyBack) {
            keyBack.addEventListener('click', function (e) {
                e.preventDefault();
                firebase.auth().signOut().then(function () {
                    if (typeof global.emsShowLanding === 'function') global.emsShowLanding();
                });
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindIdentityUi);
    } else {
        bindIdentityUi();
    }

})(window);
