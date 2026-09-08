// @ts-check
const { test, expect } = require('@playwright/test');
var boot = require('../helpers/wait-for-boot');

test.describe('Enterprise login landing', function () {
    test('shows available portal cards in admin-first order (student hidden until ready)', async function ({ page }) {
        await page.goto('/index.html');
        await boot.waitForLandingReady(page);
        await expect(page.locator('.ems-portal-card.student[data-portal="student"]')).toBeHidden();
        var order = await page.locator('.ems-portal-card:visible').evaluateAll(function (cards) {
            return cards.map(function (c) { return c.getAttribute('data-portal'); });
        });
        expect(order).toEqual(['admin', 'teacher', 'parent']);
    });

    test('student portal remains gated off (card not shown for login)', async function ({ page }) {
        await page.goto('/index.html');
        await boot.waitForLandingReady(page);
        await expect(page.locator('.ems-portal-card.student')).toBeHidden();
        var available = await page.evaluate(function () {
            return typeof window.emsIsStudentPortalAvailable === 'function'
                && window.emsIsStudentPortalAvailable();
        });
        expect(available).toBe(false);
    });

    test('portal card opens login panel with badge', async function ({ page }) {
        await page.goto('/index.html');
        await boot.waitForLandingReady(page);
        await page.locator('.ems-portal-card.admin').click();
        await page.waitForFunction(function () {
            var p = document.getElementById('ems-login-panel');
            return p && window.getComputedStyle(p).display !== 'none';
        }, null, { timeout: 15000 });
        await expect(page.locator('#ems-login-portal-badge')).toContainText(/انتظامیہ|Admin/i);
    });

    test('enterprise login scripts are loaded', async function ({ page }) {
        await page.addInitScript(function () { window.EMS_OFFLINE_ONLY = false; });
        await page.goto('/index.html');
        await boot.waitForLandingReady(page);
        var ok = await page.evaluate(function () {
            return typeof window.emsSetIntendedPortal === 'function'
                && typeof window.emsRunIdentityGate === 'function'
                && typeof window.emsIsStudentPortalAvailable === 'function';
        });
        expect(ok).toBe(true);
    });
});
