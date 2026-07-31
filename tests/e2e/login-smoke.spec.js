// @ts-check
const { test, expect } = require('@playwright/test');
var boot = require('../helpers/wait-for-boot');

test.describe('Enterprise login landing', function () {
    test('shows five portal cards in admin-first order', async function ({ page }) {
        await page.goto('/index.html');
        await expect(page.locator('.ems-portal-card')).toHaveCount(5);
        var order = await page.locator('.ems-portal-card').evaluateAll(function (cards) {
            return cards.map(function (c) { return c.getAttribute('data-portal'); });
        });
        expect(order).toEqual(['admin', 'teacher', 'parent', 'student', 'guest']);
        await expect(page.locator('.ems-portal-card.student[data-portal="student"]')).toBeVisible();
        await expect(page.locator('.ems-portal-card.guest[data-portal="guest"]')).toBeVisible();
    });

    test('student portal card shows coming soon overlay', async function ({ page }) {
        await page.goto('/index.html');
        await boot.waitForLandingReady(page);
        await page.locator('.ems-portal-card.student').click();
        await expect(page.locator('#ems-student-coming-soon')).toBeVisible();
        await expect(page.locator('#ems-student-soon-msg')).toContainText(/جلد|Coming Soon/i);
        await page.locator('#ems-student-soon-close').click();
        await expect(page.locator('#ems-student-coming-soon')).toBeHidden();
    });

    test('portal card opens login panel with badge', async function ({ page }) {
        await page.goto('/index.html');
        await boot.waitForLandingReady(page);
        await page.locator('.ems-portal-card.guest').click();
        await page.waitForFunction(function () {
            var p = document.getElementById('ems-login-panel');
            return p && window.getComputedStyle(p).display !== 'none';
        }, null, { timeout: 15000 });
        await expect(page.locator('#ems-login-portal-badge')).toContainText(/مہمان|Guest|Demo/i);
    });

    test('enterprise login scripts are loaded', async function ({ page }) {
        await page.addInitScript(function () { window.EMS_OFFLINE_ONLY = false; });
        await page.goto('/index.html');
        await boot.waitForCloudStack(page);
        var hasPortalAccess = await page.evaluate(function () {
            return typeof window.emsSetIntendedPortal === 'function';
        });
        expect(hasPortalAccess).toBe(true);
    });

    test('parent portal module shell exists', async function ({ page }) {
        await page.goto('/index.html');
        await expect(page.locator('#module-parent-portal')).toBeAttached();
        await expect(page.locator('#pp-content')).toBeAttached();
    });
});
