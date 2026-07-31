// @ts-check
const { test, expect } = require('@playwright/test');

var SW_V1 = '20260708_sw_update_v1';

async function mockReload(page) {
    await page.addInitScript(function () {
        window.__reloadCalled = false;
        window.location.reload = function () { window.__reloadCalled = true; };
    });
}

async function resetServiceWorkers(page) {
    await page.goto('about:blank');
    await page.evaluate(async function () {
        if (!('serviceWorker' in navigator)) return;
        var regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(function (r) { return r.unregister(); }));
        if (typeof caches !== 'undefined' && caches.keys) {
            var keys = await caches.keys();
            await Promise.all(keys.map(function (k) { return caches.delete(k); }));
        }
    });
}

test.describe('Phase 4 P3 — SW update handling', function () {
    test.beforeEach(async function ({ page }) {
        await resetServiceWorkers(page);
    });

    test('binds update handler and reads SW build tag', async function ({ page }) {
        await page.goto('/bench/sw-update-bench.html');
        await page.waitForFunction(function () { return window.__swBenchReady === true; }, null, { timeout: 30000 });
        await page.waitForFunction(function () { return !!navigator.serviceWorker.controller; }, null, { timeout: 30000 });

        var state = await page.evaluate(function () {
            return window.emsSwUpdateGetState();
        });
        expect(state.buildTag).toBe(SW_V1);
        expect(state.bound).toBe(true);

        var swTag = await page.evaluate(function () {
            return new Promise(function (resolve) {
                if (!navigator.serviceWorker.controller) return resolve(null);
                var ch = new MessageChannel();
                ch.port1.onmessage = function (ev) { resolve(ev.data && ev.data.tag); };
                navigator.serviceWorker.controller.postMessage({ type: 'ems-get-build-tag' }, [ch.port2]);
                setTimeout(function () { resolve(null); }, 3000);
            });
        });
        expect(swTag).toBe(SW_V1);
    });

    test('mismatched build tag shows update banner when new SW is installed', async function ({ page }) {
        await mockReload(page);
        await page.goto('/bench/sw-update-bench.html');
        await page.waitForFunction(function () { return window.__swBenchReady === true; }, null, { timeout: 30000 });
        await page.waitForFunction(function () { return !!navigator.serviceWorker.controller; }, null, { timeout: 30000 });

        await page.evaluate(function () {
            window.emsSwUpdateTestNotifyInstalledTag('20260708_sw_update_v2');
        });

        await page.waitForSelector('#ems-sw-update-banner', { timeout: 5000 });
        expect(await page.isVisible('#ems-sw-update-banner')).toBe(true);
    });

    test('controllerchange with tag mismatch schedules reload', async function ({ page }) {
        await page.goto('/bench/sw-update-bench.html');
        await page.waitForFunction(function () { return window.__swBenchReady === true; }, null, { timeout: 30000 });
        await page.waitForFunction(function () { return !!navigator.serviceWorker.controller; }, null, { timeout: 30000 });

        var result = await page.evaluate(function () {
            window.__reloadReason = null;
            window.emsSwUpdateReloadNow = function (reason) { window.__reloadReason = reason; };
            window.EMS_BUILD_TAG = 'page_old_tag';
            window.emsSwUpdateTestSetHadController(true);
            return window.emsSwUpdateHandleControllerChange().then(function (info) {
                return new Promise(function (resolve) {
                    setTimeout(function () {
                        resolve({ info: info, reloadReason: window.__reloadReason });
                    }, 700);
                });
            });
        });

        expect(result.info.reloadScheduled).toBe(true);
        expect(result.info.swTag).toBe('20260708_sw_update_v1');
        expect(result.reloadReason).toBe('controllerchange');
    });
});
