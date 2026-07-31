// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

var SCALES = (process.env.EMS_INDEX_PROFILE_SCALES || '1000,10000')
    .split(',')
    .map(function (s) { return parseInt(s.trim(), 10); })
    .filter(function (n) { return n > 0; });

test.describe('Index build stage profiler (bench-only instrumentation)', function () {
    test('measure read / token / IDB write breakdown', async function ({ page }) {
        var scaleMax = Math.max.apply(null, SCALES);
        test.setTimeout(scaleMax >= 10000 ? 7200000 : 900000);

        await page.goto('/bench/index-build-profile.html');
        await page.waitForFunction(function () {
            return typeof window.runIndexBuildProfile === 'function'
                && typeof window.emsSearchIndexTokensForRow === 'function';
        }, null, { timeout: 120000 });

        var report = await page.evaluate(async function (scales) {
            return window.runIndexBuildProfile({ scales: scales });
        }, SCALES);

        expect(report.scales.length).toBe(SCALES.length);
        for (var i = 0; i < report.scales.length; i++) {
            var s = report.scales[i];
            expect(s.inserted).toBe(SCALES[i]);
            expect(s.totalTokens).toBeGreaterThan(0);
            expect(s.tokensPerRecord.avg).toBeGreaterThan(0);
            expect(s.idbWritePattern.transactionCount).toBeGreaterThan(0);
            expect(s.idbWritePattern.idbPutCalls).toBe(s.totalIndexEntriesWritten);
            expect(s.stages.indexBuildTotalMs).toBeGreaterThan(0);
        }

        var outPath = path.resolve(__dirname, '../../docs/index-build-profile.json');
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
        console.log('[index-build-profile] wrote ' + outPath);
    });
});
