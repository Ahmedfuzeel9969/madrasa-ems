// @ts-check
// Repository interface — IndexedDB backend (browser). Proves the SAME contract
// the native fs engine implements works in the browser, and that pagination /
// filter / count go through window.emsRepo without touching storage directly.
const { test, expect } = require('@playwright/test');
var boot = require('../helpers/wait-for-boot');

test.describe('emsRepo — IndexedDB backend parity', function () {
    test('put / bulkPut / count / page / filter / remove via repository', async function ({ page }) {
        await page.goto('/bench/idb-scale-bench.html');
        await page.evaluate(function () {
            return new Promise(function (resolve) {
                var req = indexedDB.deleteDatabase('ems_durable_v1');
                req.onsuccess = req.onerror = req.onblocked = function () { resolve(true); };
            });
        });
        await page.reload();
        await page.waitForFunction(function () {
            return typeof window.emsRepo === 'object'
                && typeof window.emsRepo.page === 'function'
                && typeof window.emsIdbColPut === 'function';
        }, null, { timeout: 60000 });

        var result = await page.evaluate(async function () {
            var repo = window.emsRepo;
            var TENANT = 'test-tenant-repo-' + Date.now();
            var COL = 'repo_spec_' + Date.now();
            // The live app boot also uses the shared emsRepo.useTenant() global (for
            // registration mirroring). Re-assert our tenant immediately before every
            // call — scope is computed synchronously at call time, so a boot mirror
            // that runs during an await cannot steal our scope.
            function scoped(fn) { repo.useTenant(TENANT); return fn(); }

            await scoped(function () { return repo.clear(COL); });

            // seed 800 records through the repository
            var rows = [];
            for (var i = 1; i <= 800; i++) {
                rows.push({
                    id: i,
                    name: 'Rec ' + i,
                    type: (i % 2 === 0) ? 'student' : 'teacher',
                    status: (i % 3 === 0) ? 'approved' : 'pending',
                    createdAt: i,
                    timestamp: i
                });
            }
            var inserted = await scoped(function () { return repo.bulkPut(COL, rows); });

            var backend = repo.backendName();
            var total = await scoped(function () { return repo.count(COL); });
            var approved = await scoped(function () { return repo.count(COL, { status: 'approved' }); });

            var pageAsc = await scoped(function () { return repo.page(COL, { offset: 0, limit: 25, sort: { field: 'timestamp', dir: 'asc' } }); });
            var pageOffset = await scoped(function () { return repo.page(COL, { offset: 50, limit: 25, sort: { field: 'timestamp', dir: 'asc' } }); });
            var filtered = await scoped(function () { return repo.page(COL, { offset: 0, limit: 10, filter: { type: 'student' }, sort: { field: 'timestamp', dir: 'desc' } }); });

            await scoped(function () { return repo.remove(COL, 5); });
            var afterRemove = await scoped(function () { return repo.count(COL); });
            var gone = await scoped(function () { return repo.get(COL, 5); });

            await scoped(function () { return repo.clear(COL); });
            var afterClear = await scoped(function () { return repo.count(COL); });

            return {
                backend: backend,
                inserted: inserted,
                total: total,
                approved: approved,
                firstAsc: pageAsc.rows[0] && pageAsc.rows[0].id,
                lastAsc: pageAsc.rows[24] && pageAsc.rows[24].id,
                pageAscLen: pageAsc.rows.length,
                pageAscTotal: pageAsc.total,
                offsetFirst: pageOffset.rows[0] && pageOffset.rows[0].id,
                filteredTotal: filtered.total,
                filteredAllStudents: filtered.rows.every(function (r) { return r.type === 'student'; }),
                filteredFirst: filtered.rows[0] && filtered.rows[0].id,
                afterRemove: afterRemove,
                gone: gone,
                afterClear: afterClear
            };
        });

        expect(result.backend).toBe('indexeddb');
        expect(result.inserted).toBe(800);
        expect(result.total).toBe(800);
        expect(result.approved).toBe(266); // multiples of 3 in 1..800
        expect(result.pageAscLen).toBe(25);
        expect(result.firstAsc).toBe(1);
        expect(result.lastAsc).toBe(25);
        expect(result.offsetFirst).toBe(51);
        expect(result.filteredAllStudents).toBe(true);
        expect(result.filteredFirst).toBe(800);
        expect(result.afterRemove).toBe(799);
        expect(result.gone).toBe(null);
        expect(result.afterClear).toBe(0);
    });
});
