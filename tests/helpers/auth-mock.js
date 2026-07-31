// @ts-check
/** In-page role mocks for RBAC browser verification (no live Firebase). */

function stubFirebaseUser(page) {
    return page.evaluate(function () {
        if (typeof window.firebase === 'undefined') {
            window.firebase = {};
        }
        window.firebase.auth = function () {
            return {
                currentUser: { uid: 'p5b-mock-user', email: 'p5b-mock@test.local' }
            };
        };
    });
}

async function mockGuestRole(page) {
    await page.evaluate(function () {
        window.EMS_GUEST_MODE = true;
        window.CURRENT_USER_TENANT_ROLE = 'guest';
        window.CURRENT_MADRASA_DATA = { subStatus: 'free', allowedModules: {} };
        window.SUPER_ADMIN_CACHE = false;
        window.isSuperAdmin = function () { return false; };
        window.isMadrasaAdmin = function () { return false; };
        if (typeof window.emsApplyPortalShell === 'function') window.emsApplyPortalShell();
    });
}

async function mockParentRole(page) {
    await stubFirebaseUser(page);
    await page.evaluate(function () {
        window.EMS_GUEST_MODE = false;
        window.CURRENT_USER_TENANT_ROLE = 'parent';
        window.CURRENT_MADRASA_DATA = { subStatus: 'free', allowedModules: {} };
        window.SUPER_ADMIN_CACHE = false;
        window.isSuperAdmin = function () { return false; };
        window.isMadrasaAdmin = function () { return false; };
        if (typeof window.emsApplyPortalShell === 'function') window.emsApplyPortalShell();
    });
}

async function mockTeacherRole(page, allowedModules) {
    allowedModules = allowedModules || ['dashboard', 'admission', 'attendance'];
    await stubFirebaseUser(page);
    await page.evaluate(function (mods) {
        window.EMS_GUEST_MODE = false;
        window.CURRENT_USER_TENANT_ROLE = 'staff';
        window.CURRENT_MADRASA_DATA = { subStatus: 'free', allowedModules: {} };
        window.SUPER_ADMIN_CACHE = false;
        window.isSuperAdmin = function () { return false; };
        window.isMadrasaAdmin = function () { return false; };
        window.emsCheckFullModuleAccess = function (modId) {
            return mods.indexOf(modId) !== -1;
        };
        window.checkStaffModuleAccess = function (modId) {
            return mods.indexOf(modId) !== -1;
        };
        if (typeof window.emsApplyPortalShell === 'function') window.emsApplyPortalShell();
    }, allowedModules);
}

async function mockAdminRole(page) {
    await stubFirebaseUser(page);
    await page.evaluate(function () {
        window.EMS_GUEST_MODE = false;
        window.CURRENT_USER_TENANT_ROLE = 'owner';
        window.CURRENT_MADRASA_DATA = { subStatus: 'free', allowedModules: {} };
        window.SUPER_ADMIN_CACHE = false;
        window.isSuperAdmin = function () { return false; };
        window.isMadrasaAdmin = function () { return true; };
        if (typeof window.emsApplyPortalShell === 'function') window.emsApplyPortalShell();
    });
}

async function mockSuperAdminRole(page) {
    await stubFirebaseUser(page);
    await page.evaluate(function () {
        window.EMS_GUEST_MODE = false;
        window.CURRENT_USER_TENANT_ROLE = 'admin';
        window.CURRENT_MADRASA_DATA = { subStatus: 'free', allowedModules: {} };
        window.SUPER_ADMIN_CACHE = true;
        window.isSuperAdmin = function () { return true; };
        window.isSuperAdminUser = function () { return true; };
        window.isMadrasaAdmin = function () { return true; };
        if (typeof window.emsApplyPortalShell === 'function') window.emsApplyPortalShell();
    });
}

async function tabDisplay(page, tabId) {
    return page.locator('#' + tabId).evaluate(function (el) {
        return window.getComputedStyle(el).display;
    });
}

async function roleAllowsModule(page, modId) {
    return page.evaluate(function (id) {
        return typeof window.emsRoleAllowsModule === 'function'
            ? window.emsRoleAllowsModule(id)
            : false;
    }, modId);
}

module.exports = {
    mockGuestRole: mockGuestRole,
    mockParentRole: mockParentRole,
    mockTeacherRole: mockTeacherRole,
    mockAdminRole: mockAdminRole,
    mockSuperAdminRole: mockSuperAdminRole,
    tabDisplay: tabDisplay,
    roleAllowsModule: roleAllowsModule
};
