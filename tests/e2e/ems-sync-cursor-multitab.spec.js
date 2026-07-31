// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');

var ROOT = path.resolve(__dirname, '../..');

async function loadCursorStack(page) {
    await page.goto('/bench/idb-scale-bench.html');
    await page.addScriptTag({ path: path.join(ROOT, 'ems-sync-cursor-idb.js') });
    await page.addScriptTag({ path: path.join(ROOT, 'cache-policy.js') });
    await page.evaluate(function () {
        return window.EmsSyncCursorIdb.init();
    });
}

async function resetCursorDb(page) {
    await page.evaluate(function () {
        return window.EmsSyncCursorIdb.resetForTests();
    });
}

test.describe('Phase 4 P2 — atomic sync cursor storage', function () {
    test.describe.configure({ mode: 'serial' });

    test('concurrent write test — 40 trials, 0 lost cursors', async function ({ browser }) {
        test.setTimeout(180000);
        var context = await browser.newContext();
        var p1 = await context.newPage();
        var p2 = await context.newPage();
        await loadCursorStack(p1);
        await loadCursorStack(p2);
        await resetCursorDb(p1);
        await resetCursorDb(p2);
        await p1.evaluate(function () { return window.EmsSyncCursorIdb.init(); });
        await p2.evaluate(function () { return window.EmsSyncCursorIdb.init(); });

        var lost = 0;
        var trials = 40;
        for (var t = 0; t < trials; t++) {
            await Promise.all([
                p1.evaluate(function (i) {
                    return window.EmsSyncCursorIdb.setPullCursor('ems_module_a', 5000 + i);
                }, t),
                p2.evaluate(function (i) {
                    return window.EmsSyncCursorIdb.setPullCursor('ems_module_b', 9000 + i);
                }, t)
            ]);
            var snap = await p1.evaluate(function () {
                return window.EmsSyncCursorIdb.refreshFromIdb().then(function () {
                    return window.EmsSyncCursorIdb.dumpMemoryCache();
                });
            });
            if (!snap.ems_module_a || !snap.ems_module_b) lost++;
        }

        expect(lost).toBe(0);
        await p1.close();
        await p2.close();
        await context.close();
    });

    test('multi-tab test — 2, 5, 10 tabs without cursor loss', async function ({ browser }) {
        test.setTimeout(180000);
        for (var n of [2, 5, 10]) {
            var context = await browser.newContext();
            var pages = [];
            for (var i = 0; i < n; i++) {
                var p = await context.newPage();
                await loadCursorStack(p);
                if (i === 0) await resetCursorDb(p);
                else await p.evaluate(function () { return window.EmsSyncCursorIdb.init(); });
                pages.push(p);
            }
            await Promise.all(pages.map(function (p, idx) {
                return p.evaluate(function (args) {
                    var key = 'ems_tab_key_' + args.tabIdx;
                    return window.EmsSyncCursorIdb.setPullCursor(key, 10000 + args.tabIdx);
                }, { tabIdx: idx, tabCount: n });
            }));
            var snap = await pages[0].evaluate(function (tabCount) {
                return window.EmsSyncCursorIdb.refreshFromIdb().then(function () {
                    var dump = window.EmsSyncCursorIdb.dumpMemoryCache();
                    var missing = [];
                    for (var i = 0; i < tabCount; i++) {
                        var k = 'ems_tab_key_' + i;
                        if (!dump[k]) missing.push(k);
                    }
                    return { missing: missing, count: Object.keys(dump).length };
                });
            }, n);
            expect(snap.missing).toEqual([]);
            for (var j = 0; j < pages.length; j++) await pages[j].close();
            await context.close();
        }
    });

    test('refresh test — cursor persists after reload', async function ({ page }) {
        await loadCursorStack(page);
        await resetCursorDb(page);
        await page.evaluate(function () {
            return window.EmsSyncCursorIdb.setPullCursor('ems_refresh_key', 424242);
        });
        await page.reload();
        await page.addScriptTag({ path: path.join(ROOT, 'ems-sync-cursor-idb.js') });
        await page.addScriptTag({ path: path.join(ROOT, 'cache-policy.js') });
        await page.evaluate(function () { return window.EmsSyncCursorIdb.init(); });
        var val = await page.evaluate(function () {
            return window.EmsSyncCursorIdb.getPullCursor('ems_refresh_key');
        });
        expect(val).toBe(424242);
    });

    test('offline test — cursor readable from IDB while offline', async function ({ context, page }) {
        await loadCursorStack(page);
        await resetCursorDb(page);
        await page.evaluate(function () {
            return window.EmsSyncCursorIdb.setPullCursor('ems_offline_key', 515151);
        });
        await context.setOffline(true);
        var val = await page.evaluate(function () {
            return window.EmsSyncCursorIdb.refreshFromIdb().then(function () {
                return window.EmsSyncCursorIdb.getPullCursor('ems_offline_key');
            });
        });
        await context.setOffline(false);
        expect(val).toBe(515151);
    });

    test('upgrade migration — import once, no duplicate, no loss', async function ({ page }) {
        await page.goto('/bench/idb-scale-bench.html');
        await page.evaluate(function () {
            localStorage.setItem('ems_cache_meta', JSON.stringify({
                ems_fees: { pullCursor: 1111, dirty: false },
                ems_classes: { pullCursor: 2222, dirty: true }
            }));
            localStorage.removeItem('ems_sync_cursor_idb_migrated_v1');
        });
        await page.addScriptTag({ path: path.join(ROOT, 'ems-sync-cursor-idb.js') });
        await page.waitForFunction(function () {
            return window.EmsSyncCursorIdb && localStorage.getItem('ems_sync_cursor_idb_migrated_v1') === '1';
        });
        var second = await page.evaluate(function () {
            return window.EmsSyncCursorIdb.migrateFromLocalStorageOnce();
        });
        var state = await page.evaluate(function () {
            return {
                a: window.EmsSyncCursorIdb.getPullCursor('ems_fees'),
                b: window.EmsSyncCursorIdb.getPullCursor('ems_classes'),
                meta: JSON.parse(localStorage.getItem('ems_cache_meta') || '{}'),
                flag: localStorage.getItem('ems_sync_cursor_idb_migrated_v1')
            };
        });
        expect(second.skipped).toBe(true);
        expect(state.a).toBe(1111);
        expect(state.b).toBe(2222);
        expect(state.meta.ems_fees.pullCursor).toBeUndefined();
        expect(state.flag).toBe('1');
    });

    test('stress test — 3000 cursor updates remain correct', async function ({ page }) {
        test.setTimeout(120000);
        await loadCursorStack(page);
        await resetCursorDb(page);
        var result = await page.evaluate(async function () {
            var t0 = performance.now();
            var last = 0;
            for (var i = 0; i < 3000; i++) {
                var key = 'ems_stress_' + (i % 50);
                last = 1000 + i;
                await window.EmsSyncCursorIdb.setPullCursor(key, last);
            }
            var sample = window.EmsSyncCursorIdb.getPullCursor('ems_stress_49');
            return { ms: Math.round(performance.now() - t0), sample: sample, expectedMin: 1000 + 2999 };
        });
        expect(result.sample).toBeGreaterThanOrEqual(result.expectedMin - 50);
        expect(result.ms).toBeLessThan(60000);
    });
});
