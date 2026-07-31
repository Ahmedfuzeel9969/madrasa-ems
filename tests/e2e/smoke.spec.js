// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('EMS landing smoke', function () {
    test('index loads and shows login shell', async function ({ page }) {
        await page.goto('/index.html');
        await expect(page).toHaveTitle(/تعلیمی|EMS|Management/i);
        await expect(page.locator('body')).toHaveClass(/ems-locked/);
        await expect(page.locator('#ems-login-panel')).toBeAttached();
    });

    test('manifest is linked', async function ({ page }) {
        await page.goto('/index.html');
        var manifest = page.locator('link[rel="manifest"]');
        await expect(manifest).toHaveCount(1);
    });
});
