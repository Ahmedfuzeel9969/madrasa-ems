// @ts-check
const { test, expect } = require('@playwright/test');
var boot = require('../helpers/wait-for-boot');

test.describe('Phase 3 — load smoke (hosting bundle)', function () {
  test('index loads with lazy loader and core offline scripts', async function ({ page }) {
    await page.addInitScript(function () { window.EMS_OFFLINE_ONLY = false; });
    var started = Date.now();
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    var loadMs = Date.now() - started;
    var html = await page.content();
    expect(html).toContain('ems-lazy-loader.js');
    expect(html).toContain('ems-post-auth-loader.js');
    expect(html).not.toContain('src="admission.js');
    expect(loadMs).toBeLessThan(15000);
    await boot.waitForPostAuthRepo(page);
    await boot.waitForCloudStack(page);
    var deferredLoaded = await page.evaluate(function () {
      return typeof window.emsCacheGet === 'function'
        && typeof window.emsApplyDashboardStats === 'function';
    });
    expect(deferredLoaded).toBe(true);
  });

  test('ribbon shell present in DOM (login gate)', async function ({ page }) {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.ribbon-bar')).toHaveCount(1);
    await expect(page.locator('#tab-dashboard')).toHaveCount(1);
    await expect(page.locator('#tab-admission')).toHaveCount(1);
  });
});
