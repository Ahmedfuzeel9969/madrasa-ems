// @ts-check
// Incremental mirroring: a single add / edit / delete performs exactly ONE
// per-record write into the permanent Repository (window.emsRepo) — never a
// full-collection rewrite. UI state and repository stay perfectly synchronized.
const { test, expect } = require('@playwright/test');
var boot = require('../helpers/wait-for-boot');

test.describe('Registration — incremental emsRepo mirroring', function () {
    test('single add/edit/delete = one put/remove; UI stays in sync', async function ({ page }) {
        test.setTimeout(120000);
        await boot.gotoAndBoot(page, '/index.html');

        // Ensure the admission render path is present (inject only if needed).
        var hasRender = await page.evaluate(function () {
            return typeof window.renderRegTableViaRepo === 'function';
        });
        if (!hasRender) {
            await page.addScriptTag({ url: '/admission.js' });
            await page.waitForFunction(function () {
                return typeof window.renderRegTable === 'function';
            }, null, { timeout: 10000 });
        }

        // Deterministic tenant shared by BOTH the repo mirror (state.tenantId) and
        // the admission render path (getAdmissionTenantId), then a clean baseline.
        await page.evaluate(async function () {
            window.getAdmissionTenantId = function () { return 't-inc'; };
            window.emsRequireTenantId = function () { return 't-inc'; };
            window.emsGetTenantId = function () { return 't-inc'; };
            window.CURRENT_MADRASA_TENANT_ID = 't-inc';
            if (typeof window.emsRegRepoReset === 'function') window.emsRegRepoReset();
            if (typeof window.emsRegRepoInit === 'function') window.emsRegRepoInit('t-inc');
            window.emsRepo.useTenant('t-inc');
            await window.emsRepo.clear('registrations');
            window._regListState = { page: 1, perPage: 25, q: '' };

            // Instrument the repository to count write granularity.
            window.__putCalls = 0; window.__removeCalls = 0; window.__bulkCalls = 0;
            var _put = window.emsRepo.put.bind(window.emsRepo);
            var _rem = window.emsRepo.remove.bind(window.emsRepo);
            var _bulk = window.emsRepo.bulkPut.bind(window.emsRepo);
            window.emsRepo.put = function (c, r) { window.__putCalls++; return _put(c, r); };
            window.emsRepo.remove = function (c, i) { window.__removeCalls++; return _rem(c, i); };
            window.emsRepo.bulkPut = function (c, rows) { window.__bulkCalls++; return _bulk(c, rows); };
        });

        function repoCount() {
            return page.evaluate(function () {
                window.emsRepo.useTenant('t-inc');
                return window.emsRepo.count('registrations');
            });
        }
        function counters() {
            return page.evaluate(function () {
                return { put: window.__putCalls, remove: window.__removeCalls, bulk: window.__bulkCalls };
            });
        }

        expect(await repoCount()).toBe(0);

        // ---- ADD #1 → exactly one put, count 1 -----------------------------
        await page.evaluate(function () {
            window.__putCalls = 0; window.__removeCalls = 0; window.__bulkCalls = 0;
            return window.emsRegRepoUpsert({ id: 'STD-1', type: 'student', name: 'احمد', class: 'اول', timestamp: 1 }, false);
        });
        expect(await repoCount()).toBe(1);
        var c1 = await counters();
        expect(c1.put).toBe(1);
        expect(c1.bulk).toBe(0);
        expect(c1.remove).toBe(0);

        // ---- ADD #2 → one more put, count 2 --------------------------------
        await page.evaluate(function () {
            window.__putCalls = 0; window.__removeCalls = 0; window.__bulkCalls = 0;
            return window.emsRegRepoUpsert({ id: 'STD-2', type: 'student', name: 'بلال', class: 'دوم', timestamp: 2 }, false);
        });
        expect(await repoCount()).toBe(2);
        var c2 = await counters();
        expect(c2.put).toBe(1);
        expect(c2.bulk).toBe(0);

        // ---- EDIT STD-1 (same id) → one put, count stays 2, value updated --
        await page.evaluate(function () {
            window.__putCalls = 0; window.__removeCalls = 0; window.__bulkCalls = 0;
            return window.emsRegRepoUpsert({ id: 'STD-1', type: 'student', name: 'احمد رضا', class: 'اول', timestamp: 3 }, false);
        });
        expect(await repoCount()).toBe(2);
        var c3 = await counters();
        expect(c3.put).toBe(1);
        expect(c3.bulk).toBe(0);
        var edited = await page.evaluate(function () {
            window.emsRepo.useTenant('t-inc');
            return window.emsRepo.get('registrations', 'STD-1').then(function (r) { return r && r.name; });
        });
        expect(edited).toBe('احمد رضا');

        // ---- DELETE STD-2 → one remove, count 1, record gone ---------------
        await page.evaluate(function () {
            window.__putCalls = 0; window.__removeCalls = 0; window.__bulkCalls = 0;
            return window.emsRegRepoRemove('STD-2', false);
        });
        expect(await repoCount()).toBe(1);
        var c4 = await counters();
        expect(c4.remove).toBe(1);
        expect(c4.put).toBe(0);
        expect(c4.bulk).toBe(0);
        var gone = await page.evaluate(function () {
            window.emsRepo.useTenant('t-inc');
            return window.emsRepo.get('registrations', 'STD-2').then(function (r) { return r; });
        });
        expect(gone == null).toBe(true);

        // ---- UI stays in sync: renderRegTable pages from emsRepo -----------
        await boot.renderRegTableAndWait(page);
        var rows = await page.$$eval('#reg-users-table tbody tr', function (trs) {
            return trs.filter(function (tr) { return !tr.querySelector('td[colspan]'); })
                .map(function (tr) { return tr.textContent; });
        });
        expect(rows.length).toBe(1);
        expect(rows[0]).toContain('احمد رضا');
        expect(await page.textContent('#reg-list-count')).toContain('1');
    });
});
