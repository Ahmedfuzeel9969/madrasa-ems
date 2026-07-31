// @ts-check
const { test, expect } = require('@playwright/test');
var boot = require('../helpers/wait-for-boot');

test.describe('Enterprise login auth shell', function () {
    test('access key and denied panels exist', async function ({ page }) {
        await page.goto('/index.html');
        await expect(page.locator('#ems-access-key-panel')).toBeAttached();
        await expect(page.locator('#ems-access-denied-panel')).toBeAttached();
        await expect(page.locator('#ems-access-key-input')).toBeAttached();
    });

    test('guest portal stores intended portal in session', async function ({ page }) {
        await page.goto('/index.html');
        await page.locator('.ems-portal-card.guest').click();
        var portal = await page.evaluate(function () {
            return sessionStorage.getItem('ems_intended_portal');
        });
        expect(portal).toBe('guest');
    });

    test('teacher portal stores intended portal', async function ({ page }) {
        await page.goto('/index.html');
        await page.locator('.ems-portal-card.teacher').click();
        var portal = await page.evaluate(function () {
            return sessionStorage.getItem('ems_intended_portal');
        });
        expect(portal).toBe('teacher');
    });

    test('identity gate and tenant TTL helpers loaded', async function ({ page }) {
        await page.addInitScript(function () { window.EMS_OFFLINE_ONLY = false; });
        await page.goto('/index.html');
        await boot.waitForCloudStack(page);
        await boot.waitForLazyModule(page, 'admin-panel');
        var ok = await page.evaluate(function () {
            return typeof window.emsIsIdentityVerified === 'function'
                && typeof window.emsLoadTenantAccessKeySettings === 'function'
                && typeof window.emsGetDefaultAccessKeyTtlDays === 'function';
        });
        expect(ok).toBe(true);
    });
});
