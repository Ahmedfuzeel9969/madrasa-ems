// @ts-check
const { test, expect } = require('@playwright/test');
var boot = require('../helpers/wait-for-boot');
var auth = require('../helpers/auth-mock');

test.describe('P5B — RBAC role matrix in browser', function () {
    test.beforeEach(async function ({ page }) {
        await boot.gotoAndBoot(page, '/index.html');
    });

    test('guest — only guest-demo module allowed; admission blocked', async function ({ page }) {
        await auth.mockGuestRole(page);
        expect(await auth.roleAllowsModule(page, 'guest-demo')).toBe(true);
        expect(await auth.roleAllowsModule(page, 'admission')).toBe(false);
        expect(await auth.roleAllowsModule(page, 'superadmin')).toBe(false);
        expect(await auth.tabDisplay(page, 'tab-admission')).toBe('none');
    });

    test('parent — parent-portal allowed; admission and admin-panel blocked', async function ({ page }) {
        await auth.mockParentRole(page);
        expect(await auth.roleAllowsModule(page, 'parent-portal')).toBe(true);
        expect(await auth.roleAllowsModule(page, 'admission')).toBe(false);
        expect(await auth.roleAllowsModule(page, 'admin-panel')).toBe(false);
        expect(await auth.roleAllowsModule(page, 'superadmin')).toBe(false);
    });

    test('teacher (staff) — allowed modules visible; admin and superadmin blocked', async function ({ page }) {
        await auth.mockTeacherRole(page, ['dashboard', 'admission', 'attendance']);
        expect(await auth.roleAllowsModule(page, 'admission')).toBe(true);
        expect(await auth.roleAllowsModule(page, 'attendance')).toBe(true);
        expect(await auth.roleAllowsModule(page, 'finance')).toBe(false);
        expect(await auth.roleAllowsModule(page, 'admin-panel')).toBe(false);
        expect(await auth.roleAllowsModule(page, 'superadmin')).toBe(false);
    });

    test('madrasa admin — admin-panel allowed; superadmin blocked', async function ({ page }) {
        await auth.mockAdminRole(page);
        expect(await auth.roleAllowsModule(page, 'admin-panel')).toBe(true);
        expect(await auth.roleAllowsModule(page, 'admission')).toBe(true);
        expect(await auth.roleAllowsModule(page, 'superadmin')).toBe(false);
    });

    test('super admin — superadmin module allowed; direct URL bypass denied for guest', async function ({ page }) {
        await boot.waitForLazyModule(page, 'superadmin');
        await auth.mockSuperAdminRole(page);
        expect(await auth.roleAllowsModule(page, 'superadmin')).toBe(true);
        expect(await auth.roleAllowsModule(page, 'admission')).toBe(true);

        await auth.mockGuestRole(page);
        var denied = await page.evaluate(function () {
            if (typeof window.navigateToModule !== 'function') return { skipped: true };
            var prev = window.showTopAlert;
            var msg = '';
            window.showTopAlert = function (m) { msg = String(m || ''); };
            try {
                window.navigateToModule('superadmin');
            } catch (e) { msg = e.message; }
            window.showTopAlert = prev;
            return {
                allows: window.emsRoleAllowsModule('superadmin'),
                tabDisplay: document.getElementById('tab-superadmin').style.display,
                msg: msg
            };
        });
        expect(denied.allows).toBe(false);
        expect(denied.tabDisplay === 'none' || denied.tabDisplay === '').toBeTruthy();
    });
});
