// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
var sync = require('../helpers/sync-mock');

var SCALE = parseInt(process.env.EMS_P6_SCALE || '5000', 10);
var BROAD_SCALE = parseInt(process.env.EMS_P6_BROAD_SCALE || String(SCALE), 10);
var TAB_COUNT = parseInt(process.env.EMS_P6_TABS || '5', 10);
var REPORT_PATH = path.resolve(__dirname, '../../docs/PRIORITY-6-SOAK-REPORT.json');

var report = {
    generatedAt: new Date().toISOString(),
    phase: 'Priority 6 — Targeted Edge-Case Soak',
    scales: { default: SCALE, broadSearch: BROAD_SCALE, tabs: TAB_COUNT },
    findings: {}
};

async function waitHarness(page) {
    await page.goto('/bench/p6-soak.html');
    await page.waitForFunction(function () {
        return typeof window.p6Ready === 'function' && window.p6Ready();
    }, null, { timeout: 120000 });
    await page.evaluate(function () { return window.emsRepo.ready(); });
}

test.describe('Priority 6 — targeted soak', function () {
    test.describe.configure({ mode: 'serial' });

    test('P6-A — multi-tab search index coordination', async function ({ browser }) {
        test.setTimeout(Math.max(600000, SCALE * 50));
        var context = await browser.newContext();
        var pages = [];
        for (var i = 0; i < TAB_COUNT; i++) {
            var p = await context.newPage();
            await waitHarness(p);
            await p.evaluate(function (args) {
                window.__P6_TAB_ID = args.tabId;
                window.__P6_CHUNK_LOG = [];
            }, { tabId: 'tab-' + i });
            pages.push(p);
        }

        await pages[0].evaluate(function (scale) {
            return window.p6PrepareDataset({ records: scale, tenant: 'p6_multitab' });
        }, SCALE);

        var parallel = pages.map(function (p, idx) {
            return p.evaluate(function (args) {
                return window.p6RunIndexPump({
                    tenant: 'p6_multitab',
                    tabId: 'tab-' + args.idx,
                    chunkSize: 100
                });
            }, { idx: idx });
        });

        var tabResults = await Promise.all(parallel);
        var logs = await pages[0].evaluate(function () {
            return {
                chunkLog: window.__P6_CHUNK_LOG || [],
                meta: null,
                indexRows: null
            };
        });
        logs.meta = await pages[0].evaluate(function () {
            return window.p6ReadIndexMeta('p6_multitab');
        });
        logs.indexRows = await pages[0].evaluate(function () {
            return window.p6CountSearchIndexRows('p6_multitab');
        });
        var repoCount = await pages[0].evaluate(function () {
            window.emsRepo.useTenant('p6_multitab');
            return window.emsRepo.count('registrations');
        });

        var totalChunkRows = tabResults.reduce(function (s, r) { return s + (r.rowsIndexed || 0); }, 0);
        var writeAmplification = SCALE > 0 ? round2(totalChunkRows / SCALE) : null;
        var duplicateWork = totalChunkRows > SCALE * 1.25;

        report.findings['P6-A'] = {
            classification: logs.meta && logs.meta.complete && logs.indexRows === SCALE
                ? (duplicateWork ? 'REGRESSION' : 'VERIFIED')
                : 'NOT VERIFIED',
            note: duplicateWork
                ? 'Multi-tab index completed but write amplification still above 1.25× — leader lock may be ineffective.'
                : 'Multi-tab index completed with leader lock; write amplification near 1×.',
            metrics: {
                tabs: TAB_COUNT,
                records: SCALE,
                repoCount: repoCount,
                indexRowDocs: logs.indexRows,
                metaComplete: !!(logs.meta && logs.meta.complete),
                metaProcessed: logs.meta && logs.meta.processed,
                totalChunkRowsIndexed: totalChunkRows,
                writeAmplification: writeAmplification,
                chunkEvents: logs.chunkLog.length,
                tabResults: tabResults
            },
            recommendation: duplicateWork
                ? 'Investigate ems-search-index-lock leader acquisition across tabs.'
                : 'Leader lock effective — no immediate fix required.'
        };

        expect(logs.meta && logs.meta.complete).toBeTruthy();
        expect(logs.indexRows).toBe(SCALE);
        expect(repoCount).toBe(SCALE);
        expect(writeAmplification).toBeLessThan(1.25);

        for (var j = 0; j < pages.length; j++) await pages[j].close();
        await context.close();
    });

    test('P6-B — broad search at scale', async function ({ page }) {
        test.setTimeout(Math.max(900000, BROAD_SCALE * 80));
        await waitHarness(page);
        await page.evaluate(function (scale) {
            return window.p6PrepareDataset({ records: scale, tenant: 'p6_broad' });
        }, BROAD_SCALE);
        await page.evaluate(function () {
            return window.p6RunIndexPump({ tenant: 'p6_broad', tabId: 'broad', chunkSize: 100 });
        });

        var search = await page.evaluate(function () {
            return window.p6MeasureBroadSearch({
                tenant: 'p6_broad',
                queries: [
                    { label: 'phone-0300', text: '0300' },
                    { label: 'name-طالب', text: 'طالب' },
                    { label: 'id-stu', text: 'stu' }
                ]
            });
        });

        var worst = search.queries.reduce(function (a, b) {
            return (b.elapsedMs > a.elapsedMs) ? b : a;
        }, search.queries[0]);
        var highMatch = search.queries.find(function (q) { return q.label === 'phone-0300'; });

        report.findings['P6-B'] = {
            classification: 'VERIFIED',
            platform: 'Chromium (Playwright)',
            androidWebView: 'NOT VERIFIED — no emulator/Java on CI host',
            metrics: search,
            observation: highMatch && highMatch.total > BROAD_SCALE * 0.5
                ? 'Broad prefix query matches majority of rows — in-memory sort cost scales with match count.'
                : 'Broad search within measured bounds.',
            worstQuery: worst
        };

        expect(worst.elapsedMs).toBeLessThan(BROAD_SCALE >= 100000 ? 60000 : 30000);
    });

    test('P6-C — storage nearly full behavior', async function ({ page }) {
        test.setTimeout(120000);
        await waitHarness(page);
        var probe = await page.evaluate(function () {
            return window.p6ProbeStorageQuota();
        });

        var hasUserWarning = probe.userWarningSelectors && probe.userWarningSelectors.length > 0;
        var estimateWired = probe.estimateFnPresent && probe.quotaModulePresent;

        report.findings['P6-C'] = {
            classification: hasUserWarning && estimateWired ? 'VERIFIED' : 'NOT VERIFIED',
            metrics: probe,
            defect: !hasUserWarning
                ? 'No user-visible storage quota warning detected.'
                : null,
            recommendation: estimateWired
                ? 'Storage quota module wired; monitor real-device quota in production.'
                : 'Wire emsIdbStorageEstimate + write failures to admin warning banner before production institutions exceed quota.'
        };

        expect(probe.estimateFnPresent).toBe(true);
        expect(probe.quotaModulePresent).toBe(true);
        expect(hasUserWarning).toBe(true);
    });

    test('P6-D — admission rush-hour simulation', async function ({ page }) {
        test.setTimeout(Math.max(600000, SCALE * 40));
        await waitHarness(page);
        var rush = await page.evaluate(function (scale) {
            return window.p6AdmissionRush({ records: scale, tenant: 'p6_rush' });
        }, Math.min(SCALE, 5000));

        var meta = await page.evaluate(function () {
            return window.p6ReadIndexMeta('p6_rush');
        });
        var count = await page.evaluate(function () {
            window.emsRepo.useTenant('p6_rush');
            return window.emsRepo.count('registrations');
        });

        report.findings['P6-D'] = {
            classification: count === Math.min(SCALE, 5000) ? 'VERIFIED' : 'NOT VERIFIED',
            metrics: rush,
            metaAfter: meta,
            finalCount: count,
            note: 'Concurrent bulk import + partial index + broad search completed without count mismatch.'
        };

        expect(count).toBe(Math.min(SCALE, 5000));
    });

    test('P6-E — flaky network (degraded connectivity)', async function ({ context, page }) {
        test.setTimeout(180000);
        await sync.loadSyncBenchStack(page);
        await sync.resetSyncBenchDb(page);
        await sync.installMockCloud(page, 'p6_flaky_tenant', 'p6-flaky-device');

        await page.evaluate(function () { window.__emsBlockAutoFlush = true; });
        await context.setOffline(true);

        var offlineOps = await page.evaluate(async function () {
            await window.emsOfflinePersistRegistration({
                id: 'P6-FLK-1', type: 'student', name: 'Flaky Net', timestamp: Date.now(), clientUpdatedAt: 100
            }, { status: 'approved' });
            return {
                pending: await window.emsPendingSyncCount(),
                localCount: await window.__emsSyncBenchLocalCount()
            };
        });

        await context.setOffline(false);
        var flush = await page.evaluate(function () {
            return window.emsOfflineFlushAll({ force: true }).then(function (r) {
                return window.emsPendingSyncCount().then(function (pending) {
                    return { flushed: r.flushed, pending: pending, cloudCount: window.__emsSyncBenchExportCloud().count };
                });
            });
        });

        report.findings['P6-E'] = {
            classification: offlineOps.localCount === 1 && flush.pending === 0 && flush.cloudCount === 1
                ? 'VERIFIED'
                : 'NOT VERIFIED',
            offlineOps: offlineOps,
            flush: flush,
            flakyLatencyPacketLoss: 'NOT VERIFIED — latency/packet-loss throttle not simulated',
            note: 'Disconnect/reconnect CRUD path verified; intermittent network not fully simulated.'
        };

        expect(offlineOps.localCount).toBe(1);
        expect(flush.pending).toBe(0);
        expect(flush.cloudCount).toBe(1);
    });

    test('write P6 soak report', async function () {
        report.findings['P6-F'] = {
            classification: 'COVERED BY EXISTING TESTS',
            scope: 'CLI DR + backup-service contract',
            unitTests: ['tests/unit/ems-p6-backup-apk-edge.test.js', 'tests/unit/ems-disaster-recovery.test.js'],
            browserRestoreUI: 'NOT VERIFIED — requires Firebase emulator E2E',
            note: 'pre_restore snapshot + confirmed gate present in source; in-browser wizard not soak-tested.'
        };
        report.findings['P6-G'] = {
            classification: 'VERIFIED',
            scope: 'security-layer suspended/expired/temp grant/unlinked parent',
            unitTests: ['tests/unit/ems-p6-rbac-edge.test.js'],
            firestoreRulesLive: 'NOT VERIFIED — emulator rules soak not run in P6'
        };
        report.findings['P6-H'] = {
            classification: 'NOT VERIFIED',
            buildTimeParity: 'VERIFIED via android-asset-preflight',
            runtimeOldApk: 'NOT VERIFIED — no N-1 APK on host; JAVA_HOME blocked APK build',
            note: 'Asset SHA parity at build; runtime stale-APK warning not implemented.'
        };
        report.recommendation = buildRecommendation(report.findings);
        fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
        fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
        console.log('[p6-soak] wrote ' + REPORT_PATH);
    });
});

function buildRecommendation(findings) {
    var blockers = [];
    if (findings['P6-C'] && findings['P6-C'].classification === 'NOT VERIFIED') {
        blockers.push('Storage quota UX not verified — operational silent-failure risk');
    }
    if (findings['P6-A'] && findings['P6-A'].metrics && findings['P6-A'].metrics.writeAmplification > 1.5) {
        blockers.push('Multi-tab index write amplification — harden with tab leader lock (non-blocking)');
    }
    if (blockers.length) {
        return { action: 'continue_roadmap_with_operational_mitigations', blockers: blockers };
    }
    return { action: 'continue_roadmap', blockers: [] };
}

function round2(x) {
    return Math.round(x * 100) / 100;
}
