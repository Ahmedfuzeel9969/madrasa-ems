// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

var STRESS_SCALE = parseInt(process.env.EMS_P6_STRESS_SCALE || '100000', 10);
var STRESS_TABS = parseInt(process.env.EMS_P6_STRESS_TABS || '10', 10);
var FAILOVER_SCALE = parseInt(process.env.EMS_P6_FAILOVER_SCALE || '8000', 10);
var REPORT_PATH = path.resolve(__dirname, '../../docs/PRIORITY-6-PREPROD-REPORT.json');

var report = {
    generatedAt: new Date().toISOString(),
    phase: 'Priority 6 — Pre-production verification',
    scales: { failover: FAILOVER_SCALE, stress: STRESS_SCALE, stressTabs: STRESS_TABS },
    findings: {}
};

function round2(n) {
    return Math.round(n * 100) / 100;
}

async function waitHarness(page) {
    await page.goto('/bench/p6-soak.html');
    await page.waitForFunction(function () {
        return typeof window.p6Ready === 'function' && window.p6Ready();
    }, null, { timeout: 120000 });
    await page.evaluate(function () { return window.emsRepo.ready(); });
}

async function initLease(page, ms) {
    await page.evaluate(function (leaseMs) {
        window.p6SetIndexLeaseMs(leaseMs);
    }, ms);
}

test.describe('Priority 6 — pre-production verification', function () {
    test.describe.configure({ mode: 'serial' });

    test('P6-PRE-1 — leader tab kill failover', async function ({ browser }) {
        test.setTimeout(Math.max(900000, FAILOVER_SCALE * 40));
        var tenant = 'p6_failover_kill';
        var context = await browser.newContext();
        var leader = await context.newPage();
        var follower = await context.newPage();
        await waitHarness(leader);
        await waitHarness(follower);
        await initLease(leader, 5000);
        await initLease(follower, 5000);

        var prep = await leader.evaluate(function (args) {
            return window.p6RunFailoverAfterLeaderKill({
                tenant: args.tenant,
                records: args.scale
            });
        }, { tenant: tenant, scale: FAILOVER_SCALE });

        expect(prep.partial.rowsIndexed).toBeGreaterThan(100);
        expect(prep.partial.complete).toBeFalsy();

        await leader.close();

        var takeover = await follower.evaluate(function (args) {
            return window.p6FollowerCompleteIndex({
                tenant: args.tenant,
                tabId: 'failover-follower'
            }).then(function (pump) {
                return window.p6WaitIndexComplete(args.tenant, 600000).then(function (wait) {
                    return window.p6CountSearchIndexRows(args.tenant).then(function (rows) {
                        window.emsRepo.useTenant(args.tenant);
                        return window.emsRepo.count('registrations').then(function (repoCount) {
                            return {
                                pump: pump,
                                wait: wait,
                                indexRows: rows,
                                repoCount: repoCount,
                                lock: window.emsSearchIndexLeaderReadLock
                                    ? window.emsSearchIndexLeaderReadLock(args.tenant + '__registrations')
                                    : null
                            };
                        });
                    });
                });
            });
        }, { tenant: tenant, scale: FAILOVER_SCALE });

        report.findings['P6-PRE-1'] = {
            classification: takeover.wait.complete && takeover.indexRows === FAILOVER_SCALE
                ? 'VERIFIED' : 'NOT VERIFIED',
            prep: prep,
            takeover: takeover
        };

        expect(takeover.wait.complete).toBeTruthy();
        expect(takeover.indexRows).toBe(FAILOVER_SCALE);
        expect(takeover.repoCount).toBe(FAILOVER_SCALE);
        expect(takeover.pump.rowsIndexed).toBeGreaterThan(0);

        await follower.close();
        await context.close();
    });

    test('P6-PRE-2 — lease expiry crash recovery', async function ({ browser }) {
        test.setTimeout(Math.max(900000, FAILOVER_SCALE * 40));
        var tenant = 'p6_failover_crash';
        var context = await browser.newContext();
        var leader = await context.newPage();
        var follower = await context.newPage();
        await waitHarness(leader);
        await waitHarness(follower);
        await initLease(leader, 8000);
        await initLease(follower, 8000);

        var crashPrep = await leader.evaluate(function (args) {
            return window.p6RunFailoverAfterCrashSim({
                tenant: args.tenant,
                records: args.scale
            });
        }, { tenant: tenant, scale: FAILOVER_SCALE });

        expect(crashPrep.crash.ok).toBeTruthy();
        expect(crashPrep.leaseExpired).toBeTruthy();
        expect(crashPrep.partial.rowsIndexed).toBeGreaterThan(100);

        var recovery = await follower.evaluate(function (args) {
            return window.p6FollowerCompleteIndex({
                tenant: args.tenant,
                tabId: 'crash-follower'
            }).then(function (pump) {
                return window.p6WaitIndexComplete(args.tenant, 600000).then(function (wait) {
                    return window.p6CountSearchIndexRows(args.tenant).then(function (rows) {
                        return { pump: pump, wait: wait, indexRows: rows };
                    });
                });
            });
        }, { tenant: tenant });

        report.findings['P6-PRE-2'] = {
            classification: recovery.wait.complete && recovery.indexRows === FAILOVER_SCALE
                ? 'VERIFIED' : 'NOT VERIFIED',
            crashPrep: crashPrep,
            recovery: recovery
        };

        expect(recovery.wait.complete).toBeTruthy();
        expect(recovery.indexRows).toBe(FAILOVER_SCALE);
        expect(recovery.pump.rowsIndexed).toBeGreaterThan(0);

        await leader.close();
        await follower.close();
        await context.close();
    });

    test('P6-PRE-3 — 100k records / 10-tab stress', async function ({ browser }) {
        test.setTimeout(Math.max(7200000, STRESS_SCALE * 50));
        var tenant = 'p6_stress_100k';
        var context = await browser.newContext();
        var pages = [];
        for (var i = 0; i < STRESS_TABS; i++) {
            var p = await context.newPage();
            await waitHarness(p);
            await initLease(p, 45000);
            pages.push(p);
        }

        await pages[0].evaluate(function (args) {
            return window.p6PrepareDataset({ records: args.scale, tenant: args.tenant });
        }, { scale: STRESS_SCALE, tenant: tenant });

        var parallel = pages.map(function (p, idx) {
            return p.evaluate(function (args) {
                return window.p6RunIndexPump({
                    tenant: args.tenant,
                    tabId: 'stress-tab-' + args.idx,
                    chunkSize: 200
                });
            }, { tenant: tenant, idx: idx });
        });

        var tabResults = await Promise.all(parallel);
        var summary = await pages[0].evaluate(function (args) {
            return window.p6ReadIndexMeta(args.tenant).then(function (meta) {
                return window.p6CountSearchIndexRows(args.tenant).then(function (indexRows) {
                    window.emsRepo.useTenant(args.tenant);
                    return window.emsRepo.count('registrations').then(function (repoCount) {
                        return { meta: meta, indexRows: indexRows, repoCount: repoCount };
                    });
                });
            });
        }, { tenant: tenant });

        var totalChunkRows = tabResults.reduce(function (s, r) { return s + (r.rowsIndexed || 0); }, 0);
        var writeAmplification = STRESS_SCALE > 0 ? round2(totalChunkRows / STRESS_SCALE) : null;
        var leaders = tabResults.filter(function (r) { return (r.rowsIndexed || 0) > 500; });

        report.findings['P6-PRE-3'] = {
            classification: summary.meta && summary.meta.complete && summary.indexRows === STRESS_SCALE
                && writeAmplification < 1.25 ? 'VERIFIED' : 'NOT VERIFIED',
            metrics: {
                records: STRESS_SCALE,
                tabs: STRESS_TABS,
                repoCount: summary.repoCount,
                indexRowDocs: summary.indexRows,
                metaComplete: !!(summary.meta && summary.meta.complete),
                totalChunkRowsIndexed: totalChunkRows,
                writeAmplification: writeAmplification,
                activeLeaders: leaders.length,
                tabResults: tabResults
            }
        };

        expect(summary.meta && summary.meta.complete).toBeTruthy();
        expect(summary.indexRows).toBe(STRESS_SCALE);
        expect(summary.repoCount).toBe(STRESS_SCALE);
        expect(writeAmplification).toBeLessThan(1.25);
        expect(leaders.length).toBeGreaterThanOrEqual(1);
        expect(leaders.length).toBeLessThanOrEqual(2);

        for (var j = 0; j < pages.length; j++) await pages[j].close();
        await context.close();
    });

    test('P6-PRE-4 — Android WebView lock API probe', async function ({ browser }) {
        test.setTimeout(120000);
        var androidUa = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 '
            + '(KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36';
        var context = await browser.newContext({
            userAgent: androidUa,
            viewport: { width: 412, height: 915 },
            isMobile: true,
            hasTouch: true
        });
        var a = await context.newPage();
        var b = await context.newPage();
        await waitHarness(a);
        await waitHarness(b);

        var apis = await a.evaluate(function () { return window.p6ProbeLockApis(); });
        var lockTest = await a.evaluate(function () {
            var col = 'p6_android_probe__registrations';
            return window.emsSearchIndexLeaderTryAcquire(col).then(function (gate) {
                return { gate: gate, tabId: window.emsSearchIndexLockTabId() };
            });
        });
        var follower = await b.evaluate(function () {
            var col = 'p6_android_probe__registrations';
            return window.emsSearchIndexLeaderTryAcquire(col);
        });

        var assetProbe = {
            androidAssetsPresent: fs.existsSync(path.resolve(__dirname,
                '../../android/app/src/main/assets/public/ems-search-index-lock.js')),
            distAssetsPresent: fs.existsSync(path.resolve(__dirname,
                '../../dist/ems-search-index-lock.js'))
        };

        report.findings['P6-PRE-4'] = {
            classification: apis.broadcastChannel && lockTest.gate.acquired && !follower.acquired
                ? 'VERIFIED_CHROMIUM_WEBVIEW_SIM' : 'PARTIAL',
            note: 'Real Capacitor APK WebView runtime not executed on host — Chromium mobile UA + asset parity.',
            apis: apis,
            lockTest: lockTest,
            follower: follower,
            assets: assetProbe,
            realApkRuntime: 'NOT VERIFIED — requires device/emulator APK launch'
        };

        expect(apis.broadcastChannel).toBe(true);
        expect(apis.storageQuota).toBe(true);
        expect(apis.storageClean).toBe(true);
        expect(lockTest.gate.acquired).toBe(true);
        expect(follower.acquired).toBe(false);
        expect(assetProbe.distAssetsPresent || assetProbe.androidAssetsPresent).toBeTruthy();

        await a.close();
        await b.close();
        await context.close();
    });

    test('P6-PRE-5 — storage quota stats + clean temporary files', async function ({ page }) {
        test.setTimeout(120000);
        await waitHarness(page);
        var result = await page.evaluate(function () {
            return window.emsIdbStorageEstimate().then(function (est) {
                window.emsStorageQuotaSetTestEstimate(
                    Math.floor((est && est.quota) ? est.quota * 0.88 : 880000000),
                    (est && est.quota) || 1000000000
                );
                return window.emsStorageQuotaCheck({ context: 'preprod', showWarning: true }).then(function (status) {
                    return window.emsStorageQuotaCleanTemporaryFiles().then(function (cleaned) {
                        window.emsStorageQuotaClearTestEstimate();
                        var banner = document.getElementById('ems-storage-quota-banner');
                        return {
                            status: status,
                            cleaned: cleaned,
                            bannerHasStats: !!(banner && /استعمال:|کل:|باقی:/.test(banner.innerHTML || '')),
                            bannerHasCleanBtn: !!(banner && banner.querySelector('[data-ems-storage-clean-temp]'))
                        };
                    });
                });
            });
        });

        report.findings['P6-PRE-5'] = {
            classification: result.bannerHasStats && result.bannerHasCleanBtn ? 'VERIFIED' : 'NOT VERIFIED',
            metrics: result
        };

        expect(result.status.usageFormatted).toBeTruthy();
        expect(result.status.quotaFormatted).toBeTruthy();
        expect(result.status.remainingFormatted).toBeTruthy();
        expect(result.bannerHasStats).toBe(true);
        expect(result.bannerHasCleanBtn).toBe(true);

        await page.close();
    });

    test('write pre-production report', function () {
        fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
        console.log('[p6-preprod] wrote', REPORT_PATH);
        expect(fs.existsSync(REPORT_PATH)).toBeTruthy();
    });
});
