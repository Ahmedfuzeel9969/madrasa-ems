// @ts-check
const { test, expect } = require('@playwright/test');
var boot = require('../helpers/wait-for-boot');

var SOAK_MS = parseInt(process.env.EMS_SOAK_MS || String(60 * 60 * 1000), 10);
var SOAK_INTERVAL_MS = parseInt(process.env.EMS_SOAK_INTERVAL_MS || '60000', 10);
var SKIP_SOAK = process.env.EMS_SOAK_SKIP === '1';

test.describe('P5B — long browser session soak', function () {
    test.skip(SKIP_SOAK, 'EMS_SOAK_SKIP=1');

    test('1h session — memory, responsiveness, no runaway growth', async function ({ page }) {
        test.setTimeout(SOAK_MS + 300000);
        await boot.gotoAndBoot(page, '/index.html');

        await page.evaluate(function () {
            window.CURRENT_MADRASA_TENANT_ID = 'soak-tenant';
            window.emsGetTenantId = function () { return 'soak-tenant'; };
            window.emsRepo.useTenant('soak-tenant');
        });

        var samples = [];
        var started = Date.now();
        var iterations = 0;

        while (Date.now() - started < SOAK_MS) {
            var sample = await page.evaluate(async function () {
                var t0 = performance.now();
                await window.emsRepo.count('registrations');
                if (typeof window.emsCacheGet === 'function') {
                    window.emsCacheGet('ems_classes', []);
                }
                var elapsed = performance.now() - t0;
                var mem = performance.memory ? {
                    usedJSHeapMb: Math.round(performance.memory.usedJSHeapSize / (1024 * 1024)),
                    totalJSHeapMb: Math.round(performance.memory.totalJSHeapSize / (1024 * 1024))
                } : null;
                return { elapsedMs: Math.round(elapsed), mem: mem, t: Date.now() };
            });
            samples.push(sample);
            iterations++;
            expect(sample.elapsedMs).toBeLessThan(5000);
            await page.waitForTimeout(SOAK_INTERVAL_MS);
        }

        var firstMem = samples[0] && samples[0].mem && samples[0].mem.usedJSHeapMb;
        var lastMem = samples[samples.length - 1] && samples[samples.length - 1].mem
            && samples[samples.length - 1].mem.usedJSHeapMb;
        if (firstMem != null && lastMem != null) {
            expect(lastMem - firstMem).toBeLessThan(80);
        }

        console.log('[soak] iterations=' + iterations
            + ' durationMs=' + (Date.now() - started)
            + ' firstHeapMb=' + firstMem
            + ' lastHeapMb=' + lastMem
            + ' samples=' + samples.length);
    });
});
