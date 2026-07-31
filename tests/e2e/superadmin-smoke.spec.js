// @ts-check
const { test, expect } = require('@playwright/test');
var boot = require('../helpers/wait-for-boot');

test.describe('Super Admin module smoke', function () {
    test('SA shell exists in DOM with two-tier navigation', async function ({ page }) {
        await page.goto('/index.html');
        await expect(page.locator('#module-superadmin')).toBeAttached();
        await expect(page.locator('#sa-main-nav')).toBeAttached();
        await expect(page.locator('#sa-ribbon-menu')).toBeAttached();
        await expect(page.locator('#sa-boot-banner')).toBeAttached();
        await expect(page.locator('#sa-win-dashboard')).toBeAttached();
        await expect(page.locator('#sa-rbac-permissions-matrix')).toBeAttached();
    });

    test('SA scripts load without error', async function ({ page }) {
        var errors = [];
        page.on('pageerror', function (err) { errors.push(err.message); });
        await page.goto('/index.html');
        await boot.waitForCloudStack(page);
        await boot.waitForLazyModule(page, 'superadmin');
        var hasSaNav = await page.evaluate(function () {
            return typeof window.saInitNavigation === 'function'
                && typeof window.saSwitchCategory === 'function'
                && typeof window.initSuperAdminPanel === 'function';
        });
        expect(hasSaNav).toBe(true);
        expect(errors.filter(function (m) { return /sa-nav|superadmin|sa-core/i.test(m); })).toEqual([]);
    });

    test('SA tab hidden until super admin auth', async function ({ page }) {
        await page.goto('/index.html');
        var tab = page.locator('#tab-superadmin');
        await expect(tab).toBeAttached();
        var display = await tab.evaluate(function (el) { return el.style.display; });
        expect(display === 'none' || display === '').toBeTruthy();
    });
});
