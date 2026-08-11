// ============================================================================
// EMS Portal Access — Landing portals + role-based shell (Method 1 for parents)
// Server-side staff/parent checks live in security-layer.js + auth.js
// ============================================================================
(function (global) {
    'use strict';

    var PORTAL_KEY = 'ems_intended_portal';

    /** Registered landing portals (student = coming soon foundation) */
    global.EMS_ALLOWED_PORTALS = ['admin', 'teacher', 'parent', 'student'];

    /** والدین: صرف parent-portal */
    global.EMS_PARENT_MODULES = ['parent-portal'];

    /** استاد: Admin Panel StaffPermissions سے dynamic (Phase 2) */
    global.EMS_TEACHER_MODULES = null;

    global.emsGetTeacherModuleList = function () {
        if (typeof global.emsGetStaffAllowedModules === 'function') {
            var mods = global.emsGetStaffAllowedModules();
            if (mods && mods.length) return mods;
        }
        return ['dashboard'];
    };

    global.emsFindFirstAllowedModuleTab = function () {
        var preferred = ['dashboard', 'attendance', 'admission', 'exams', 'curriculum', 'training', 'announcements', 'complaints', 'finance', 'ledger'];
        var i;
        for (i = 0; i < preferred.length; i++) {
            var modId = preferred[i];
            if (global.emsRoleAllowsModule(modId)) {
                var tab = document.getElementById('tab-' + modId);
                if (tab) return tab;
            }
        }
        var first = null;
        document.querySelectorAll('.ribbon-tab').forEach(function (tab) {
            if (first) return;
            var modId = tab.id.replace('tab-', '');
            if (global.emsRoleAllowsModule(modId)) first = tab;
        });
        return first;
    };

    global.emsSetIntendedPortal = function (portal) {
        if (global.EMS_ALLOWED_PORTALS.indexOf(portal) < 0) return;
        try { sessionStorage.setItem(PORTAL_KEY, portal); } catch (e) { /* ignore */ }
        global.EMS_INTENDED_PORTAL = portal;
    };

    global.emsIsStudentPortalAvailable = function () {
        return false;
    };

    global.emsShowStudentPortalComingSoon = function () {
        var overlay = document.getElementById('ems-student-coming-soon');
        if (overlay) {
            overlay.style.display = 'flex';
            document.body.style.overflow = 'hidden';
            return;
        }
        var msg = 'طالب علم پورٹل جلد ہی دستیاب ہوگا (Coming Soon)';
        if (typeof global.showToast === 'function') {
            global.showToast(msg, 'info');
        } else if (typeof global.showTopAlert === 'function') {
            global.showTopAlert(msg, false);
        }
    };

    global.emsHideStudentPortalComingSoon = function () {
        var overlay = document.getElementById('ems-student-coming-soon');
        if (overlay) overlay.style.display = 'none';
        if (document.getElementById('ems-landing')) {
            document.body.style.overflow = 'hidden';
        }
    };

    global.emsGetIntendedPortal = function () {
        if (global.EMS_INTENDED_PORTAL) return global.EMS_INTENDED_PORTAL;
        try {
            var v = sessionStorage.getItem(PORTAL_KEY);
            if (v) global.EMS_INTENDED_PORTAL = v;
        } catch (e) { /* ignore */ }
        return global.EMS_INTENDED_PORTAL || null;
    };

    global.emsClearIntendedPortal = function () {
        global.EMS_INTENDED_PORTAL = null;
        try { sessionStorage.removeItem(PORTAL_KEY); } catch (e) { /* ignore */ }
    };

    global.emsGetUserPortalType = function () {
        if (global.CURRENT_USER_TENANT_ROLE === 'parent') return 'parent';
        if (global.CURRENT_USER_TENANT_ROLE === 'staff') return 'teacher';
        if (global.isSuperAdmin && global.isSuperAdmin()) return 'admin';
        if (global.isMadrasaAdmin && global.isMadrasaAdmin()) return 'admin';
        if (global.emsIsStaffUser && global.emsIsStaffUser()) return 'teacher';
        return 'admin';
    };

    global.emsIsParentPortalUser = function () {
        return global.emsGetUserPortalType() === 'parent';
    };

    global.emsIsTeacherPortalUser = function () {
        return global.emsGetUserPortalType() === 'teacher';
    };

    /** والدین کے لیے مکمل مینو چھپانا — Method 1 */
    global.emsParentModuleAllowed = function (modId) {
        return global.EMS_PARENT_MODULES.indexOf(modId) !== -1;
    };

    /** parent / staff / admin کے لیے ماڈیول کی اجازت (license + role) */
    global.emsRoleAllowsModule = function (modId) {
        if (!modId) return false;
        if (modId === 'guest-demo') return false;
        if (modId === 'superadmin') {
            return !!(global.isSuperAdmin && global.isSuperAdmin());
        }
        if (modId === 'admin-panel') {
            return !!(global.isMadrasaAdmin && global.isMadrasaAdmin());
        }
        if (modId === 'parent-portal') {
            return global.CURRENT_USER_TENANT_ROLE === 'parent';
        }

        if (global.emsIsParentPortalUser()) {
            return global.emsParentModuleAllowed(modId);
        }

        if (typeof global.isModuleTabAllowed === 'function') {
            return global.isModuleTabAllowed(modId);
        }
        if (typeof global.emsCheckFullModuleAccess === 'function') {
            return global.emsCheckFullModuleAccess(modId);
        }
        return typeof global.checkModuleAccess === 'function'
            ? global.checkModuleAccess(modId)
            : false;
    };

    function setAppShellVisible(visible) {
        document.querySelectorAll('.ems-app-shell').forEach(function (el) {
            el.style.display = visible ? '' : 'none';
        });
        document.body.classList.toggle('ems-locked', !visible);
        document.body.classList.toggle('ems-authenticated', !!visible);
    }

    global.emsShowLanding = function () {
        var user = typeof firebase !== 'undefined' && firebase.auth ? firebase.auth().currentUser : null;
        if (user) return;
        if (typeof global.emsShouldForceStrictOfflineBypass === 'function'
            && global.emsShouldForceStrictOfflineBypass()) {
            if (typeof global.emsHideLoginUiForcefully === 'function') {
                global.emsHideLoginUiForcefully();
            }
            if (typeof global.emsAttemptStrictOfflineBoot === 'function') {
                global.emsAttemptStrictOfflineBoot();
            }
            return;
        }
        /* Instant-boot may have set offline-no-signin; that uses display:none !important
           and would leave a white screen if boot failed. Always clear before showing login. */
        if (document.documentElement) {
            document.documentElement.classList.remove('ems-offline-no-signin');
        }
        setAppShellVisible(false);
        document.body.classList.remove('ems-portal-parent', 'ems-portal-teacher', 'ems-portal-admin', 'ems-authenticated');
        var landing = document.getElementById('ems-landing');
        if (landing) {
            landing.style.display = 'flex';
            landing.style.visibility = 'visible';
            landing.removeAttribute('hidden');
        }
        var panel = document.getElementById('ems-login-panel');
        if (panel) panel.style.display = 'none';
        var keyPanel = document.getElementById('ems-access-key-panel');
        if (keyPanel) keyPanel.style.display = 'none';
        var deniedPanel = document.getElementById('ems-access-denied-panel');
        if (deniedPanel) deniedPanel.style.display = 'none';
        document.body.style.overflow = 'hidden';
        if (typeof global.emsLandingRefreshBranding === 'function') {
            global.emsLandingRefreshBranding();
        }
        if (typeof global.emsUpdateOfflineContinueButton === 'function') {
            global.emsUpdateOfflineContinueButton();
        }
        if (typeof global.emsScheduleDesktopOfflineAutoBoot === 'function') {
            global.emsScheduleDesktopOfflineAutoBoot();
        }
    };

    global.emsDismissLoginUi = function () {
        var landing = document.getElementById('ems-landing');
        var panel = document.getElementById('ems-login-panel');
        var keyPanel = document.getElementById('ems-access-key-panel');
        var deniedPanel = document.getElementById('ems-access-denied-panel');
        var profileGw = document.getElementById('profile-setup-gateway');
        if (landing) landing.style.display = 'none';
        if (panel) panel.style.display = 'none';
        if (keyPanel) keyPanel.style.display = 'none';
        if (deniedPanel) deniedPanel.style.display = 'none';
        if (profileGw) profileGw.style.display = 'none';
        /* Mid-login only: shell still locked → keep splash (hideLanding unlocks first). */
        if (document.body.classList.contains('ems-locked')
            && !document.body.classList.contains('ems-authenticated')
            && typeof global.emsEnsureBootSplashVisible === 'function') {
            global.emsEnsureBootSplashVisible('سائن ان مکمل — ایپ کھل رہی ہے…');
        }
        document.body.style.overflow = 'auto';
        if (typeof global.emsClearLandingAuthLoading === 'function') {
            global.emsClearLandingAuthLoading();
        }
    };

    global.emsHideLanding = function () {
        /* Unlock shell first so dismissLoginUi never races a locked+hidden landing blank. */
        setAppShellVisible(true);
        global.emsDismissLoginUi();
        if (typeof global.emsClearBootStuckWatchdog === 'function') {
            global.emsClearBootStuckWatchdog();
        }
        if (typeof global.emsDismissBootSplash === 'function') {
            global.emsDismissBootSplash();
        }
    };

    global.emsApplyPortalShell = function () {
        var user = typeof firebase !== 'undefined' && firebase.auth ? firebase.auth().currentUser : null;
        if (!user) return;

        var portal = global.emsGetUserPortalType();
        document.body.classList.remove('ems-portal-parent', 'ems-portal-teacher', 'ems-portal-admin');
        document.body.classList.add('ems-portal-' + portal);

        var ribbon = document.querySelector('.ribbon-wrapper');
        var parentBar = document.getElementById('ems-parent-topbar');

        if (portal === 'parent') {
            if (ribbon) ribbon.style.display = 'none';
            if (parentBar) parentBar.style.display = 'flex';
        } else {
            if (ribbon) ribbon.style.display = '';
            if (parentBar) parentBar.style.display = 'none';
        }

        document.querySelectorAll('.ribbon-tab').forEach(function (tab) {
            var modId = tab.id.replace('tab-', '');
            var show = global.emsRoleAllowsModule(modId);
            if (modId === 'superadmin' && global.SUPER_ADMIN_CACHE === true) {
                show = true;
            }
            tab.style.display = show ? 'inline-block' : 'none';
            tab.classList.toggle('module-locked', false);
            tab.removeAttribute('title');
        });

        if (portal === 'parent') {
            document.querySelectorAll('.module-view').forEach(function (m) {
                var isPp = m.id === 'module-parent-portal';
                if (!isPp) {
                    m.classList.remove('active');
                    m.style.display = 'none';
                }
            });
        }
    };

    global.emsRouteAfterLogin = function () {
        if (typeof global.emsDismissLoginUi === 'function') {
            global.emsDismissLoginUi();
        }

        var portal = global.emsGetUserPortalType();
        var intended = global.emsGetIntendedPortal();

        if (intended && intended !== portal) {
            var portalLabels = {
                admin: 'Admin Portal',
                teacher: 'Teacher Portal',
                parent: 'Parent Portal',
                student: 'Student Portal'
            };
            var msg = 'Redirected to ' + (portalLabels[portal] || portal) + ' based on your access level.';
            if (typeof global.showToast === 'function') {
                global.showToast(msg, 'info');
            }
        }

        setTimeout(function () {
            if (portal === 'parent') {
                var ppTab = document.getElementById('tab-parent-portal');
                if (ppTab && typeof global.navigateToModule === 'function') {
                    global.navigateToModule(ppTab);
                }
                return;
            }

            var dashTab = document.getElementById('tab-dashboard');
            var routeTab = null;
            if (portal === 'teacher' && typeof global.emsFindFirstAllowedModuleTab === 'function') {
                routeTab = global.emsFindFirstAllowedModuleTab();
            } else if (dashTab && global.emsRoleAllowsModule('dashboard')) {
                routeTab = dashTab;
            } else if (typeof global.emsFindFirstAllowedModuleTab === 'function') {
                routeTab = global.emsFindFirstAllowedModuleTab();
            }
            if (routeTab && typeof global.navigateToModule === 'function') {
                global.navigateToModule(routeTab);
            } else {
                var first = null;
                document.querySelectorAll('.ribbon-tab').forEach(function (tab) {
                    if (first) return;
                    if (tab.style.display !== 'none') first = tab;
                });
                if (first && typeof global.navigateToModule === 'function') {
                    global.navigateToModule(first);
                }
            }
        }, 80);
    };

})(window);
