// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

var SCALES = (process.env.EMS_IDB_BENCH_SCALES || '10000,50000,100000')
    .split(',')
    .map(function (s) { return parseInt(s.trim(), 10); })
    .filter(function (n) { return n > 0; });

test.describe('Real browser IndexedDB scale benchmark', function () {
    test.describe.configure({ mode: 'serial' });

    test('emsRepo IDB pagination at 10k / 50k / 100k', async function ({ page }) {
        var scaleMax = Math.max.apply(null, SCALES);
        test.setTimeout(scaleMax >= 100000 ? 10800000 : scaleMax >= 50000 ? 7200000 : 3600000);

        await page.goto('/bench/idb-scale-bench.html');
        await page.waitForFunction(function () {
            return typeof window.emsRepo === 'object'
                && typeof window.runIdbScaleBench === 'function'
                && typeof window.emsIdbColPage === 'function';
        }, null, { timeout: 120000 });

        var fullReport = {
            generatedAt: new Date().toISOString(),
            scales: [],
            checks: {
                noLoadAllOnSortedPage: true,
                noColAllOnSortedPage: true,
                noLoadAllOnSearch: true,
                noColAllOnSearch: true,
                persistenceOk: true,
                legacyArrearsDisabled: true
            }
        };

        for (var i = 0; i < SCALES.length; i++) {
            var n = SCALES[i];
            var row = await page.evaluate(async function (scale) {
                window.EMS_IDB_BENCH_TRACE = { loadAllCalls: 0, colAllCalls: 0, colAllCollections: [], pagePaths: [] };
                return window.runIdbScaleBench({ scales: [scale] });
            }, n);
            expect(row.scales.length).toBe(1);
            var s = row.scales[0];
            fullReport.scales.push(s);

            if (!row.checks.noLoadAllOnSortedPage) fullReport.checks.noLoadAllOnSortedPage = false;
            if (!row.checks.noColAllOnSortedPage) fullReport.checks.noColAllOnSortedPage = false;
            if (row.checks.noLoadAllOnSearch === false) fullReport.checks.noLoadAllOnSearch = false;
            if (row.checks.noColAllOnSearch === false) fullReport.checks.noColAllOnSearch = false;

            expect(s.trace.afterSortPage.loadAllCalls, 'sorted page must not call loadAll').toBe(0);
            expect(s.trace.afterFilterPage.loadAllCalls, 'filtered sorted page must not call loadAll').toBe(0);
            expect(s.trace.afterAdmission.loadAllCalls, 'admission first page must not call loadAll').toBe(0);
            expect(s.trace.afterSortPage.colAllCalls, 'sorted page must not call emsIdbColAll').toBe(0);
            expect(s.trace.afterFilterPage.colAllCalls, 'filtered page must not call emsIdbColAll').toBe(0);
            expect(s.trace.afterAdmission.colAllCalls, 'admission page must not call emsIdbColAll').toBe(0);
            expect(s.trace.afterSearchPage.loadAllCalls, 'search page must not call loadAll').toBe(0);
            expect(s.trace.afterSearchPage.colAllCalls, 'search page must not call emsIdbColAll').toBe(0);
            expect(s.trace.afterSearchPage.pagePaths, 'search should use row-doc index').toContain('searchIndex:rowDocs');

            await page.reload();
            await page.waitForFunction(function () {
                return typeof window.emsRepo === 'object' && typeof window.emsRepo.count === 'function';
            }, null, { timeout: 30000 });

            var persist = await page.evaluate(async function (expected) {
                window.emsRepo.useTenant('bench_tenant_scale');
                var actual = await window.emsRepo.count('registrations');
                return { expected: expected, actual: actual, ok: actual === expected };
            }, n);

            s.persistence = persist;
            if (!persist.ok) fullReport.checks.persistenceOk = false;
            expect(persist.ok, 'IDB count after reload').toBe(true);
        }

        var legacyGuard = await page.evaluate(function () {
            return window.EMS_DISABLE_LEGACY_ARREARS !== false;
        });
        expect(legacyGuard).toBe(true);
        fullReport.checks.legacyArrearsDisabled = legacyGuard;

        var outPath = path.resolve(__dirname, '../../docs/idb-browser-bench.json');
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, JSON.stringify(fullReport, null, 2), 'utf8');
        console.log('[idb-browser-bench] wrote ' + outPath);
    });
});
